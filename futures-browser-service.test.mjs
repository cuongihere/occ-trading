import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BrowserFutures} from './futures-browser-service.mjs';
import {WindowsCredentialVault} from './futures-credential-vault.mjs';
import {LiveStatsLedger} from './binance-live-stats.mjs';
const PREFIX=Buffer.from('OCC_MOCK_ENCRYPTED_');
const fakeCrypt=(buf,mode)=>mode==='protect'
 ?Buffer.concat([PREFIX,Buffer.from(buf).reverse()])
 :Buffer.from(buf.subarray(PREFIX.length)).reverse();
const makeVault=dir=>new WindowsCredentialVault(join(dir,'futures-api.dpapi.json'),{crypt:fakeCrypt});
const tmp=t=>{const p=mkdtempSync(join(tmpdir(),'occ-browser-live-'));t.after(()=>rmSync(p,{force:true,recursive:true}));return p;};
function fake({flatRiskRows=false,brokenConfig=false,failStop=false,leverage=5,leverageAckMismatch=false}={}){
 const calls=[],algo=[],normal=[],position={qty:0,entryOrderId:100,nextEntryOrderId:100},
 mode={dualSidePosition:false},leverageState={value:leverage},limit={order:null};
 const api={
  close(){calls.push('closed');},
  async syncClock(){calls.push('time');},
  async get(path,p={}){
   calls.push({method:'GET',path,p});
   if(path==='/fapi/v2/account')return {canTrade:true,totalWalletBalance:'800',totalMarginBalance:'812',totalUnrealizedProfit:'12',totalInitialMargin:'60',assets:[{asset:'USDT',walletBalance:'800',availableBalance:'800'}]};
   if(path==='/fapi/v1/positionSide/dual')return mode;
   if(path==='/fapi/v1/symbolConfig')return brokenConfig?[]:[{symbol:'BTCUSDT',marginType:'ISOLATED',leverage:leverageState.value}];
   if(path==='/fapi/v3/positionRisk')return flatRiskRows&&position.qty===0?[]:[{symbol:'BTCUSDT',positionSide:'BOTH',positionAmt:String(position.qty),entryPrice:position.qty?'77000':'0'}];
   if(path==='/fapi/v1/openOrders')return normal;
   if(path==='/fapi/v1/openAlgoOrders')return algo;
   if(path==='/fapi/v1/exchangeInfo')return {symbols:[{symbol:'BTCUSDT',contractType:'PERPETUAL',
    status:'TRADING',filters:[{filterType:'LOT_SIZE',stepSize:'.001',minQty:'.001'},
    {filterType:'MARKET_LOT_SIZE',stepSize:'.001',minQty:'.001'},
    {filterType:'PRICE_FILTER',tickSize:'.1'},{filterType:'MIN_NOTIONAL',notional:'5'}]}]};
   if(path==='/fapi/v1/ticker/price')return {symbol:'BTCUSDT',price:'77000'};
   if(path==='/fapi/v1/order'){
    if(limit.order&&String(p.orderId)===String(limit.order.orderId))return {...limit.order};
    if(limit.close&&String(p.orderId)===String(limit.close.orderId))return {...limit.close};
    const entry=calls.filter(x=>x.method==='POST'&&x.path==='/fapi/v1/order'&&x.p.reduceOnly!=='true').at(-1)?.p;
    return {symbol:'BTCUSDT',side:entry?.side||'BUY',positionSide:'BOTH',
     status:'FILLED',type:'MARKET',executedQty:'.032',avgPrice:'77000',orderId:position.entryOrderId,
     clientOrderId:entry?.newClientOrderId};
   }
   throw Error('Unexpected GET '+path);
  },
  async post(path,p){
   calls.push({method:'POST',path,p});
   if(path==='/fapi/v1/leverage'){
    if(p.symbol!=='BTCUSDT'||!Number.isInteger(p.leverage))throw Error('Invalid BTCUSDT leverage request');
    if(!leverageAckMismatch)leverageState.value=p.leverage;
    return {symbol:'BTCUSDT',leverage:leverageAckMismatch?p.leverage+1:p.leverage,maxNotionalValue:'1000000'};
   }
   if(path==='/fapi/v1/order'){
    if(p.type==='LIMIT'){
     limit.order={symbol:'BTCUSDT',orderId:9991,clientOrderId:p.newClientOrderId,
      positionSide:'BOTH',side:p.side,type:'LIMIT',timeInForce:'GTD',
      status:'NEW',origQty:p.quantity,executedQty:'0',price:p.price,avgPrice:'0'};
     return {orderId:9991,clientOrderId:p.newClientOrderId};
    }
    if(p.reduceOnly==='true'){
     position.qty=0;
     limit.close={symbol:'BTCUSDT',orderId:999,clientOrderId:p.newClientOrderId,
      type:'MARKET',status:'FILLED',reduceOnly:true,executedQty:p.quantity,
      side:p.side,positionSide:'BOTH'};
     return {orderId:999,status:'FILLED'};
    }
    position.entryOrderId=position.nextEntryOrderId++;
    position.qty=p.side==='BUY'?.032:-.032;return {orderId:position.entryOrderId,status:'FILLED'};
   }
   if(path==='/fapi/v1/algoOrder'){
    if(failStop&&p.type==='STOP_MARKET')throw Error('Simulated Binance STOP failure');
    const id=200+algo.length;
    algo.push({algoId:id,symbol:'BTCUSDT',positionSide:'BOTH',clientAlgoId:p.clientAlgoId,algoStatus:'NEW',
     orderType:p.type,side:p.side,triggerPrice:p.triggerPrice,
     closePosition:p.closePosition==='true',reduceOnly:p.reduceOnly==='true',quantity:p.quantity});
    return {algoId:id,clientAlgoId:p.clientAlgoId};
   }
   throw Error('Unexpected POST');
  },
  async del(path,p){
   calls.push({method:'DELETE',path,p});
   if(path==='/fapi/v1/order'){
    if(!limit.order||String(limit.order.orderId)!==String(p.orderId))throw Error('Unknown LIMIT');
    limit.order.status='CANCELED';return {...limit.order};
   }
   const idx=algo.findIndex(x=>String(x.algoId)===String(p.algoId));
   if(idx>=0)algo.splice(idx,1);return {};
  }
 };
 return {api,calls,algo,normal,position,mode,leverageState,limit};
}
const creds={apiKey:'dummy-api-key',apiSecret:'dummy-secret',environment:'production'};
test('UI backend accepts credentials in memory, stores only harmless configuration, restarts OFF',async t=>{
 const dir=tmp(t),fx=fake(),service=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await service.connect(creds);
 assert.equal(service.snapshot().connected,true);
 assert.equal(service.snapshot().environment,'production');
 service.saveConfig({marginUSDT:500,leverage:5});
 const content=readFileSync(join(dir,'futures-browser-settings.json'),'utf8');
 assert.doesNotMatch(content,/dummy-api-key|dummy-secret/);
 await service.arm('CHAP NHAN BTC FUTURES',77000);assert.equal(service.snapshot().armed,true);
 service.disarm();assert.equal(service.snapshot().armed,false);
 const again=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 assert.equal(again.snapshot().armed,false);
 assert.equal(again.snapshot().config.marginUSDT,500);
 assert.equal(existsSync(join(dir,'futures-live-intent.json')),false);
});
test('Production Auto requires explicit confirmation and rejects missing consent',async t=>{
 const service=new BrowserFutures({dataDir:tmp(t),transportFactory:()=>fake().api,credentialVault:makeVault(tmp(t))});
 await service.connect({...creds,environment:'production'});
 await assert.rejects(service.arm(),/Chưa xác nhận giao dịch tiền thật/);
 service.saveConfig({marginUSDT:100,leverage:5});
 await service.arm('CHAP NHAN BTC FUTURES',77000);assert.equal(service.snapshot().armed,true);
});
test('Production Auto mock sends MARKET then confirmed STOP and three TP, never opens duplicate',async t=>{
 const dir=tmp(t),fx=fake(),service=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await service.connect(creds);service.saveConfig({marginUSDT:500,leverage:5});
 await service.arm('CHAP NHAN BTC FUTURES',77000);
 await service.signal({side:'LONG',barTime:900000},true);
 const posts=fx.calls.filter(x=>x.method==='POST');
 assert.deepEqual(posts.map(x=>x.path),['/fapi/v1/order','/fapi/v1/algoOrder',
 '/fapi/v1/algoOrder','/fapi/v1/algoOrder','/fapi/v1/algoOrder']);
 assert.equal(posts[1].p.type,'STOP_MARKET');assert.equal(posts[1].p.closePosition,'true');
 assert.equal(service.snapshot().armed,true);
 assert.ok(service.snapshot().protectedPosition);
 await service.signal({side:'SHORT',barTime:1800000},true);
 assert.equal(fx.calls.filter(x=>x.method==='POST').length,5);
 assert.ok(service.snapshot().events.some(e=>e.type==='SIGNAL_IGNORED_POSITION'));
 fx.position.qty=.016; // TP1 has filled but BTC position remains open.
 await service.monitor();
 assert.equal(service.snapshot().protectedPosition.entry.side,'LONG');
 await service.signal({side:'SHORT',barTime:2700000},true);
 assert.equal(fx.calls.filter(x=>x.method==='POST').length,5);
 fx.position.qty=0;
 await service.monitor();
 assert.equal(fx.algo.length,0);
 assert.equal(service.snapshot().protectedPosition,null);
 assert.equal(service.snapshot().armed,true);
 assert.equal(fx.calls.filter(x=>x.method==='POST').length,5); // no old queued signal replay
 await service.signal({side:'SHORT',barTime:3600000},true); // NEW crossover after confirmed flat
 assert.equal(fx.calls.filter(x=>x.method==='POST').length,10);
 assert.equal(service.snapshot().protectedPosition?.entry.side,'SHORT');
 service.disarm();
});
test('Unfinished entry intent blocks restart adoption until Binance confirms FLAT',async t=>{
 const dir=tmp(t),fx=fake(),service=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await service.connect(creds);service.saveConfig({marginUSDT:500,leverage:5});await service.arm('CHAP NHAN BTC FUTURES',77000);
 await service.signal({side:'LONG',barTime:900000},true);
 service.saveIntent({phase:'ENTRY_SENDING',clientId:'OCCBTC-unresolved',at:Date.now()});
 const again=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 assert.equal(again.snapshot().armed,false);assert.equal(again.snapshot().halted,true);
 await again.connect(creds);
 await assert.rejects(again.arm('CHAP NHAN BTC FUTURES',77000),/đối soát|còn vị thế/);
 await assert.rejects(again.reconcileFlat(),/còn vị thế/);
 fx.position.qty=0;fx.algo.splice(0);
 await again.reconcileFlat();await again.arm('CHAP NHAN BTC FUTURES',77000);
 assert.equal(again.snapshot().armed,true);
});

test('Resume a protected OCC position with reversal OFF: watch only until FLAT, then NEW crossover',async t=>{
 const dir=tmp(t),fx=fake(),one=new BrowserFutures({
  dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await one.connect(creds);one.saveConfig({marginUSDT:500,leverage:5,reverseOnSignal:false});
 await one.arm('CHAP NHAN BTC FUTURES',77000);
 await one.signal({id:'ORIGINAL',side:'LONG',barTime:900000},true);
 assert.equal(fx.position.qty,.032);
 one.disarm();
 const two=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,
  credentialVault:makeVault(dir)});
 assert.equal(two.snapshot().armed,false);
 assert.equal(two.snapshot().halted,true);
 await two.connect(creds);
 assert.equal(two.snapshot().canResumeManaged,true);
 const before=fx.calls.filter(x=>x.method==='POST'||x.method==='DELETE').length;
 await two.arm('CHAP NHAN BTC FUTURES',77000);
 assert.equal(two.snapshot().armed,true);
 assert.equal(two.snapshot().observeExistingOnly,true);
 assert.equal(two.snapshot().halted,false);
 assert.equal(two.snapshot().protectedPosition.entry.side,'LONG');
 assert.equal(fx.calls.filter(x=>x.method==='POST'||x.method==='DELETE').length,before);
 await two.signal({side:'SHORT',barTime:1800000},true);
 assert.equal(fx.calls.filter(x=>x.method==='POST'||x.method==='DELETE').length,before);
 assert.ok(two.snapshot().events.some(e=>e.type==='SIGNAL_IGNORED_EXISTING'));
 fx.position.qty=0;
 await two.monitor();
 assert.equal(two.snapshot().observeExistingOnly,false);
 assert.equal(two.snapshot().armed,true);
 assert.equal(two.snapshot().protectedPosition,null);
 assert.equal(fx.algo.length,0);
 const afterFlat=fx.calls.filter(x=>x.method==='POST').length;
 await two.signal({side:'SHORT',barTime:2700000},true);
 assert.equal(fx.calls.filter(x=>x.method==='POST').length,afterFlat+5);
 assert.equal(two.snapshot().protectedPosition.entry.side,'SHORT');
});
test('Re-enable monitor-only on an OCC position without restart, even when available margin is low',async t=>{
 const dir=tmp(t),fx=fake(),svc=new BrowserFutures({
  dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await svc.connect(creds);svc.saveConfig({marginUSDT:500,leverage:5,reverseOnSignal:false});
 await svc.arm('CHAP NHAN BTC FUTURES',77000);
 await svc.signal({side:'LONG',barTime:900000},true);
 svc.disarm();
 assert.equal(svc.snapshot().canResumeManaged,true);
 await svc.arm('CHAP NHAN BTC FUTURES',77000);
 assert.equal(svc.snapshot().observeExistingOnly,true);
 await svc.signal({side:'SHORT',barTime:1800000},true);
 assert.equal(fx.calls.filter(x=>x.method==='POST'&&x.path==='/fapi/v1/order').length,1);
});
test('Resumed protected OCC with reverse ON switches LONG to SHORT immediately by MARKET even if normal Entry is LIMIT',async t=>{
 const dir=tmp(t),fx=fake(),first=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await first.connect(creds);
 first.saveConfig({marginUSDT:500,leverage:5,reverseOnSignal:true,entryMode:'MARKET'});
 await first.arm('CHAP NHAN BTC FUTURES',77000);
 await first.signal({side:'LONG',barTime:900000,time:1800000},true);
 assert.equal(fx.position.qty,.032);
 first.disarm();
 const resumed=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await resumed.connect(creds);
 assert.equal(resumed.snapshot().canResumeManaged,true);
 // Enabling reverse while already holding an OCC position works regardless of
 // whether new flat-account entries will use a future LIMIT entry.
 resumed.setReverseOnSignal(true);
 assert.equal(resumed.config.reverseOnSignal,true);
 const before=fx.calls.filter(x=>x.method==='POST').length;
 await resumed.arm('CHAP NHAN BTC FUTURES',77000);
 assert.equal(resumed.snapshot().armed,true);
 assert.equal(resumed.snapshot().observeExistingOnly,true);
 await resumed.signal({side:'SHORT',barTime:1800000,time:2700000},true);
 assert.equal(resumed.snapshot().halted,false,resumed.snapshot().error);
 assert.equal(resumed.snapshot().observeExistingOnly,false);
 assert.equal(resumed.snapshot().protectedPosition?.entry.side,'SHORT');
 assert.equal(fx.position.qty,-.032);
 const posts=fx.calls.filter(x=>x.method==='POST').slice(before);
 assert.deepEqual(posts.map(x=>x.path),[
  '/fapi/v1/order','/fapi/v1/order',...Array(4).fill('/fapi/v1/algoOrder')]);
 assert.equal(posts[0].p.type,'MARKET');
 assert.equal(posts[0].p.reduceOnly,'true');
 assert.equal(posts[0].p.side,'SELL');
 assert.equal(posts[1].p.type,'MARKET');
 assert.equal(posts[1].p.side,'SELL');
 assert.equal(posts[1].p.reduceOnly,undefined);
 assert.equal(posts[2].p.type,'STOP_MARKET');
 assert.ok(resumed.snapshot().events.some(x=>x.type==='REVERSE_FLAT'));
});

test('OCC reversal with LIMIT entry closes old protected position and re-enters MARKET; fresh FLAT entries still LIMIT',async t=>{
 const dir=tmp(t),fx=fake(),svc=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await svc.connect(creds);
 svc.saveConfig({marginUSDT:500,leverage:5,reverseOnSignal:true,entryMode:'LIMIT_PULLBACK',
  limitBasis:'OCC_TRIGGER',limitWaitSeconds:90});
 await svc.arm('CHAP NHAN BTC FUTURES',77000);
 await svc.signal({side:'LONG',barTime:900000,time:1800000,triggerPrice:76000},true);
 assert.equal(fx.limit.order?.type,'LIMIT');
 const limit=fx.limit.order;
 fx.limit.order={...limit,status:'FILLED',executedQty:limit.origQty,avgPrice:limit.price};
 fx.position.qty=Number(limit.origQty);
 // mock's Entry readback must return the verified LIMIT fill.
 await svc.pollLimit();
 assert.equal(svc.snapshot().protectedPosition?.entry.side,'LONG');
 const start=fx.calls.filter(x=>x.method==='POST').length;
 await svc.signal({side:'SHORT',barTime:1800000,time:2700000,triggerPrice:76500},true);
 assert.equal(svc.snapshot().halted,false,svc.snapshot().error);
 assert.equal(svc.snapshot().protectedPosition?.entry.side,'SHORT');
 const newCalls=fx.calls.filter(x=>x.method==='POST').slice(start);
 assert.deepEqual(newCalls.slice(0,2).map(x=>x.p.type),['MARKET','MARKET']);
 assert.equal(newCalls[0].p.reduceOnly,'true');
 assert.equal(newCalls[1].p.reduceOnly,undefined);
 assert.equal(newCalls.filter(x=>x.p.type==='LIMIT').length,0);
 assert.ok(svc.snapshot().events.some(x=>x.type==='REVERSE_ENTRY_MARKET'));
});

test('Stale BTC quote blocks OCC reversal BEFORE any reduceOnly close and retains original exchange STOP',async t=>{
 const dir=tmp(t),fx=fake(),svc=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await svc.connect(creds);svc.saveConfig({marginUSDT:500,leverage:5,reverseOnSignal:true});
 await svc.arm('CHAP NHAN BTC FUTURES',77000);
 await svc.signal({side:'LONG',barTime:900000},true);
 const count=fx.calls.filter(x=>x.method==='POST').length;
 await svc.signal({side:'SHORT',barTime:1800000},true,
  ()=>({symbol:'BTCUSDT',live:true,lastPrice:77000,lastReceivedAt:Date.now()-12000}));
 assert.equal(svc.snapshot().halted,false);
 assert.equal(fx.calls.filter(x=>x.method==='POST').length,count);
 assert.equal(svc.snapshot().protectedPosition.entry.side,'LONG');
 assert.ok(fx.algo.some(x=>x.orderType==='STOP_MARKET'));
});

test('Undersized opposite TP legs skip reversal without closing an owned protected position',async t=>{
 const dir=tmp(t),fx=fake(),svc=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await svc.connect(creds);svc.saveConfig({marginUSDT:500,leverage:5,reverseOnSignal:true});
 await svc.arm('CHAP NHAN BTC FUTURES',77000);
 await svc.signal({side:'LONG',barTime:900000},true);
 svc.disarm();
 // Do not permit config edits while the position is still held.
 assert.throws(()=>svc.saveConfig({marginUSDT:20,leverage:5}),/Tắt Auto và xử lý hết/);
 const before=fx.calls.filter(x=>x.method==='POST').length;
 // A later exchange filter change makes the intended reverse size invalid.
 const original=fx.api.get;
 fx.api.get=async(path,p={})=>{
  const out=await original(path,p);
  if(path==='/fapi/v1/exchangeInfo')
   return {...out,symbols:out.symbols.map(sym=>({...sym,
    filters:sym.filters.map(filter=>filter.filterType==='MARKET_LOT_SIZE'?
     {...filter,minQty:'0.02'}:filter)}))};
  return out;
 };
 // The static preflight uses verified filters from connect, so mutate actual
 // filter state deliberately to assert the safety gate before any close.
 svc.filters={...svc.filters,minQty:.02};
 await svc.arm('CHAP NHAN BTC FUTURES',77000);
 await svc.signal({side:'SHORT',barTime:1800000},true);
 assert.equal(fx.calls.filter(x=>x.method==='POST').length,before);
 assert.equal(fx.position.qty,.032);
 assert.equal(svc.snapshot().protectedPosition.entry.side,'LONG');
 assert.equal(svc.snapshot().halted,false);
});

test('Missing STOP or unrecognized Binance Algo prevents unsafe adoption and does not mutate orders',async t=>{
 const dir=tmp(t),fx=fake(),one=new BrowserFutures({
  dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await one.connect(creds);one.saveConfig({marginUSDT:500,leverage:5});
 await one.arm('CHAP NHAN BTC FUTURES',77000);await one.signal({side:'LONG',barTime:900000},true);
 one.disarm();
 const two=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,
  credentialVault:makeVault(dir)});
 await two.connect(creds);
 const before=fx.calls.filter(x=>x.method==='POST'||x.method==='DELETE').length;
 const stopIndex=fx.algo.findIndex(x=>x.orderType==='STOP_MARKET');
 fx.algo.splice(stopIndex,1);
 await assert.rejects(two.arm('CHAP NHAN BTC FUTURES',77000),/SL|STOP/);
 assert.equal(two.snapshot().armed,false);assert.equal(two.snapshot().halted,true);
 assert.equal(fx.calls.filter(x=>x.method==='POST'||x.method==='DELETE').length,before);
 fx.algo.push({algoId:900001,clientAlgoId:'FOREIGN',symbol:'BTCUSDT',
  positionSide:'BOTH',algoStatus:'NEW',orderType:'STOP_MARKET',side:'SELL',
  triggerPrice:'74000',closePosition:true});
 await assert.rejects(two.arm('CHAP NHAN BTC FUTURES',77000),/SL|Algo|ID/);
 assert.equal(fx.calls.filter(x=>x.method==='POST'||x.method==='DELETE').length,before);
});
test('Position not owned by OCC cannot be adopted or traded while occupied',async t=>{
 const dir=tmp(t),fx=fake(),svc=new BrowserFutures({
  dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await svc.connect(creds);
 fx.position.qty=.004;
 await assert.rejects(svc.arm('CHAP NHAN BTC FUTURES',77000),/không có vị thế\/lệnh cũ/);
 assert.equal(fx.calls.filter(x=>x.method==='POST').length,0);
});
test('After one TP filled, OCC resumes only if remaining active TP amounts equal remaining BTC',async t=>{
 const dir=tmp(t),fx=fake(),one=new BrowserFutures({
  dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await one.connect(creds);one.saveConfig({marginUSDT:500,leverage:5});
 await one.arm('CHAP NHAN BTC FUTURES',77000);await one.signal({side:'LONG',barTime:900000},true);
 one.disarm();
 const firstTp=fx.algo.findIndex(x=>x.clientAlgoId.endsWith('-TP1'));
 fx.algo.splice(firstTp,1);fx.position.qty=.022;
 const two=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await two.connect(creds);
 await two.arm('CHAP NHAN BTC FUTURES',77000);
 assert.equal(two.snapshot().observeExistingOnly,true);
 assert.equal(two.snapshot().protectedPosition.entry.qty,.032);
 assert.equal(fx.position.qty,.022);
});
test('Binance production API accepts V3 positionRisk [] when account is FLAT',async t=>{
 const dir=tmp(t),fx=fake({flatRiskRows:true});
 const service=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await service.connect({...creds,environment:'production'});
 const state=service.snapshot();
 assert.equal(state.connected,true);
 assert.equal(state.account.positionBTC,0);
 assert.equal(state.account.availableUSDT,800);
 assert.equal(state.armed,false);
 await assert.rejects(service.arm(),/Chưa xác nhận giao dịch tiền thật/);
});
test('read-only connection identifies exact failing endpoint instead of generic account error',async t=>{
 const fx=fake({brokenConfig:true});
 const service=new BrowserFutures({dataDir:tmp(t),transportFactory:()=>fx.api,credentialVault:makeVault(tmp(t))});
 await assert.rejects(service.connect({...creds,environment:'production'}),/\/fapi\/v1\/symbolConfig/);
 assert.equal(service.snapshot().connected,false);
});

test('Demo connections are rejected by production-only application',async t=>{
 const svc=new BrowserFutures({dataDir:tmp(t),transportFactory:()=>fake().api,credentialVault:makeVault(tmp(t))});
 await assert.rejects(svc.connect({...creds,environment:'demo'}),/Chỉ sử dụng Binance Futures thật/);
});

test('Real BTCUSDT entry failure to establish STOP triggers one reduce-only emergency close and HALT',async t=>{
 const fx=fake({failStop:true}),service=new BrowserFutures({dataDir:tmp(t),transportFactory:()=>fx.api,credentialVault:makeVault(tmp(t))});
 await service.connect(creds);service.saveConfig({marginUSDT:500,leverage:5});
 await service.arm('CHAP NHAN BTC FUTURES',77000);
 await service.signal({side:'LONG',barTime:900000},true);
 assert.equal(service.snapshot().halted,true);
 assert.equal(service.snapshot().armed,true); // ON intent remains; HALTED blocks all entry orders.
 const posts=fx.calls.filter(x=>x.method==='POST');
 assert.equal(posts.length,3);
 assert.equal(posts[0].path,'/fapi/v1/order');
 assert.equal(posts[1].p.type,'STOP_MARKET');
 assert.equal(posts[2].p.reduceOnly,'true');
 assert.equal(posts[2].p.side,'SELL');
 assert.equal(fx.position.qty,0);
 await service.signal({side:'SHORT',barTime:1800000},true);
 assert.equal(fx.calls.filter(x=>x.method==='POST').length,3);
});

test('Restarts restore Windows-encrypted API automatically but never re-arm real trading',async t=>{
 const dir=tmp(t),fx=fake();
 const one=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await one.connect(creds);
 one.saveConfig({marginUSDT:77,leverage:5,tp1Qty:25,tp2Qty:25});
 const saved=readFileSync(join(dir,'futures-api.dpapi.json'),'utf8');
 assert.doesNotMatch(saved,/dummy-api-key|dummy-secret/);
 assert.match(saved,/DPAPI-CurrentUser/);
 one.close();
 const two=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 assert.equal(two.snapshot().connected,false);
 await two.restoreSavedConnection();
 assert.equal(two.snapshot().connected,true);
 assert.equal(two.snapshot().armed,false);
 assert.equal(two.snapshot().config.marginUSDT,77);
 assert.equal(two.snapshot().credentialSaved,true);
 assert.equal(two.snapshot().account.equityUSDT,812);
 assert.equal(two.snapshot().account.unrealizedUSDT,12);
 two.forgetSavedCredentials();
 assert.equal(two.snapshot().credentialSaved,false);
 assert.equal(two.snapshot().connected,false);
});

test('5x saved in bot and 150x on Binance blocks Auto until explicit readback-verified change',async t=>{
 const dir=tmp(t),fx=fake({leverage:150});
 const service=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await service.connect(creds);
 assert.equal(service.snapshot().config.leverage,5);
 assert.equal(service.snapshot().account.leverage,150);
 await assert.rejects(service.arm('CHAP NHAN BTC FUTURES',77000),/đúng đòn bẩy/);
 assert.equal(fx.calls.filter(x=>x.method==='POST').length,0);
 await assert.rejects(service.applyExchangeLeverage({requestedLeverage:5}),/xác nhận/);
 await service.applyExchangeLeverage({requestedLeverage:5,confirmation:'SYNC_BTCUSDT_LEVERAGE'});
 assert.equal(service.snapshot().account.leverage,5);
 assert.equal(fx.leverageState.value,5);
 const updates=fx.calls.filter(x=>x.method==='POST');
 assert.equal(updates.length,1);
 assert.equal(updates[0].path,'/fapi/v1/leverage');
 assert.deepEqual(updates[0].p,{symbol:'BTCUSDT',leverage:5});
 service.saveConfig({marginUSDT:100,leverage:5});
 await service.arm('CHAP NHAN BTC FUTURES',77000);assert.equal(service.snapshot().armed,true);
 await assert.rejects(service.applyExchangeLeverage({requestedLeverage:5,confirmation:'SYNC_BTCUSDT_LEVERAGE'}),/Tắt Auto/);
 assert.equal(fx.calls.filter(x=>x.method==='POST').length,1);
});
test('Never modify leverage with position or active BTC orders on Binance',async t=>{
 const dir=tmp(t),fx=fake({leverage:150}),svc=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await svc.connect(creds);
 fx.position.qty=.005;
 await assert.rejects(svc.applyExchangeLeverage({requestedLeverage:5,confirmation:'SYNC_BTCUSDT_LEVERAGE'}),/còn vị thế/);
 fx.position.qty=0;fx.normal.push({symbol:'BTCUSDT'});
 await assert.rejects(svc.applyExchangeLeverage({requestedLeverage:5,confirmation:'SYNC_BTCUSDT_LEVERAGE'}),/còn vị thế\/lệnh/);
 assert.equal(fx.calls.filter(x=>x.method==='POST').length,0);
});
test('Unknown or mismatched exchange leverage ACK is not treated as success and is not retried',async t=>{
 const dir=tmp(t),fx=fake({leverage:150,leverageAckMismatch:true});
 const svc=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await svc.connect(creds);
 await assert.rejects(svc.applyExchangeLeverage({requestedLeverage:5,confirmation:'SYNC_BTCUSDT_LEVERAGE'}),/chưa xác nhận/);
 assert.equal(svc.snapshot().account.leverage,150);
 assert.equal(fx.calls.filter(x=>x.method==='POST').length,1);
});

test('Preflight Binance read error skips only that signal and keeps Auto ON for the next valid signal',async t=>{
 const dir=tmp(t),fx=fake(),service=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 const original=fx.api.get.bind(fx.api);
 let failOnce=true;
 fx.api.get=async(path,p)=>{
  if(path==='/fapi/v1/ticker/price'&&failOnce){failOnce=false;throw Error('temporary Binance read timeout');}
  return original(path,p);
 };
 await service.connect(creds);service.saveConfig({marginUSDT:500,leverage:5});
 await service.arm('CHAP NHAN BTC FUTURES',77000);
 await service.signal({side:'LONG',barTime:900000},true);
 assert.equal(service.snapshot().armed,true);
 assert.equal(service.snapshot().halted,false);
 assert.equal(fx.calls.filter(x=>x.method==='POST').length,0);
 assert.ok(service.snapshot().events.some(e=>e.type==='SIGNAL_SKIPPED'));
 await service.signal({side:'LONG',barTime:1800000},true);
 assert.equal(service.snapshot().armed,true);
 assert.equal(service.snapshot().halted,false);
 assert.ok(service.snapshot().protectedPosition);
 assert.equal(fx.calls.filter(x=>x.method==='POST').length,5);
});

test('A missing exchange STOP keeps Auto ON but safety-halts all future entry attempts',async t=>{
 const dir=tmp(t),fx=fake(),service=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await service.connect(creds);service.saveConfig({marginUSDT:500,leverage:5});
 await service.arm('CHAP NHAN BTC FUTURES',77000);
 await service.signal({side:'LONG',barTime:900000},true);
 fx.algo.splice(fx.algo.findIndex(o=>o.orderType==='STOP_MARKET'),1);
 await service.monitor();
 assert.equal(service.snapshot().armed,true);
 assert.equal(service.snapshot().halted,true);
 const postsBefore=fx.calls.filter(x=>x.method==='POST').length;
 await service.signal({side:'SHORT',barTime:1800000},true);
 assert.equal(fx.calls.filter(x=>x.method==='POST').length,postsBefore);
 service.disarm();
 assert.equal(service.snapshot().armed,false);
});

test('AUTO cannot be enabled with three undersized Binance TP legs; warning includes minimum USDT margin',async t=>{
 const dir=tmp(t),fx=fake(),service=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await service.connect(creds);
 service.saveConfig({marginUSDT:20,leverage:5});
 const invalid=service.sizingPreview(service.config,77000);
 assert.equal(invalid.status,'invalid');
 assert.ok(invalid.minimumMarginUSDT>20);
 assert.match(invalid.message,/TP1\/TP2\/TP3/);
 await assert.rejects(service.arm('CHAP NHAN BTC FUTURES',77000),/Chưa thể bật AUTO/);
 assert.equal(service.snapshot().armed,false);
 service.saveConfig({marginUSDT:Math.ceil(invalid.minimumMarginUSDT+2),leverage:5});
 assert.equal(service.sizingPreview(service.config,77000).status,'valid');
 await service.arm('CHAP NHAN BTC FUTURES',77000);
 assert.equal(service.snapshot().armed,true);
});

test('Read-only position breakdown works during HALTED restart and never mutates Binance orders',async t=>{
 const dir=tmp(t),fx=fake();
 const originalGet=fx.api.get.bind(fx.api);
 fx.api.get=async(path,p={})=>{
  const value=await originalGet(path,p);
  if(path==='/fapi/v3/positionRisk')return value.map(row=>({...row,entryPrice:'77000',
   markPrice:'78000',liquidationPrice:'62500',positionInitialMargin:'500',
   unRealizedProfit:String(Number(row.positionAmt)*1000)}));
  return value;
 };
 const one=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await one.connect(creds);one.saveConfig({marginUSDT:500,leverage:5});
 await one.arm('CHAP NHAN BTC FUTURES',77000);
 await one.signal({side:'LONG',barTime:900000},true);
 const first=await one.positionAnalysis();
 assert.equal(first.status,'open');assert.equal(first.slProtected,true);
 assert.equal(first.levels.length,4);assert.equal(first.ownershipVerified,true);
 const mutationCount=fx.calls.filter(x=>x.method==='POST'||x.method==='DELETE').length;
 one.close();
 const afterRestart=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 assert.equal(afterRestart.halted,true);
 await afterRestart.connect(creds);
 const breakdown=await afterRestart.positionAnalysis();
 assert.equal(breakdown.status,'open');
 assert.equal(breakdown.halted,true);
 assert.equal(breakdown.ownershipVerified,true);
 assert.ok(breakdown.levels.every(l=>l.origin==='KHỚP_CHECKPOINT'));
 assert.equal(fx.calls.filter(x=>x.method==='POST'||x.method==='DELETE').length,mutationCount);
 fx.algo.splice(0,1); // SL disappeared on exchange: just warn, never auto-create it.
 const missingStop=await afterRestart.positionAnalysis();
 assert.equal(missingStop.slProtected,false);
 assert.equal(fx.calls.filter(x=>x.method==='POST'||x.method==='DELETE').length,mutationCount);
});

test('Startup automatically clears a previous PROTECTED checkpoint after Binance confirms FLAT and no orders',async t=>{
 const dir=tmp(t),fx=fake(),vault=makeVault(dir);
 const one=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:vault});
 await one.connect(creds);one.saveConfig({marginUSDT:500,leverage:5});
 await one.arm('CHAP NHAN BTC FUTURES',77000);
 await one.signal({side:'LONG',barTime:900000},true);
 assert.equal(one.snapshot().protectedPosition?.entry.side,'LONG');
 fx.position.qty=0;fx.algo.splice(0); // Binance SL/TP finished during app downtime.
 const postsBefore=fx.calls.filter(x=>x.method==='POST').length;
 const two=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 assert.equal(two.snapshot().halted,true);
 await two.restoreSavedConnection();
 assert.equal(two.snapshot().connected,true);
 assert.equal(two.snapshot().halted,false);
 assert.equal(two.snapshot().armed,false);
 assert.equal(two.snapshot().recoveryStatus,'recovered');
 assert.equal(two.snapshot().error,null);
 assert.ok(two.snapshot().events.some(x=>x.type==='STALE_ALGO_CLEARED'));
 assert.equal(JSON.parse(readFileSync(join(dir,'futures-live-intent.json'),'utf8')).phase,'CLEARED');
 assert.equal(JSON.parse(readFileSync(join(dir,'futures-live-protection.json'),'utf8')).phase,'IDLE');
 assert.equal(fx.calls.filter(x=>x.method==='POST').length,postsBefore); // read-only checks, no new orders
 await two.arm('CHAP NHAN BTC FUTURES',77000);
 assert.equal(two.snapshot().armed,true);
});

test('Restart never cancels SL/TP while BTCUSDT position remains open',async t=>{
 const dir=tmp(t),fx=fake();
 const one=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await one.connect(creds);one.saveConfig({marginUSDT:500,leverage:5});
 await one.arm('CHAP NHAN BTC FUTURES',77000);await one.signal({side:'LONG',barTime:900000},true);
 const two=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await two.restoreSavedConnection();
 assert.equal(two.snapshot().halted,true);
 assert.equal(fx.position.qty,.032);
 assert.equal(fx.algo.length,4);
 assert.equal(fx.calls.filter(x=>x.method==='DELETE').length,0);
 await assert.rejects(two.checkBinanceAndReconcile(),/còn vị thế/);
 assert.equal(two.snapshot().halted,true);
 assert.notEqual(JSON.parse(readFileSync(join(dir,'futures-live-intent.json'),'utf8')).phase,'CLEARED');
 fx.position.qty=0;
 await two.checkBinanceAndReconcile();
 assert.equal(two.snapshot().halted,false);
 assert.equal(two.snapshot().armed,false);
 assert.equal(fx.algo.length,0);
});

test('Uncertain in-flight checkpoint stays HALTED on reconnect even when Binance appears flat; manual check can clear',async t=>{
 const dir=tmp(t),fx=fake(),one=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await one.connect(creds);
 one.saveIntent({phase:'ENTRY_SENDING',clientId:'OCCBTC-unknown',at:Date.now()});
 const two=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await two.restoreSavedConnection();
 assert.equal(two.snapshot().halted,true);
 assert.equal(two.snapshot().recoveryStatus,'manual_required');
 assert.equal(two.snapshot().armed,false);
 await two.checkBinanceAndReconcile();
 assert.equal(two.snapshot().halted,false);
 assert.equal(two.snapshot().armed,false);
});

test('Manual check restores encrypted API after failed startup and never auto-arms',async t=>{
 const dir=tmp(t),fx=fake(),one=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await one.connect(creds);
 const original=fx.api.syncClock.bind(fx.api);
 let bad=true;
 fx.api.syncClock=async()=>{if(bad)throw Error('temporary REST timeout');return original();};
 const two=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await two.restoreSavedConnection();
 assert.equal(two.snapshot().connected,false);
 assert.equal(two.snapshot().credentialSaved,true);
 bad=false;
 await two.checkBinanceAndReconcile();
 assert.equal(two.snapshot().connected,true);
 assert.equal(two.snapshot().armed,false);
 assert.equal(two.snapshot().recoveryStatus,'recovered');
});

test('Reverse mode OFF preserves OCC position; ON closes reduceOnly, clears old Algo, then opens opposite',async t=>{
 const dir=tmp(t),fx=fake(),svc=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await svc.connect(creds);
 svc.saveConfig({marginUSDT:500,leverage:5});
 assert.equal(svc.snapshot().config.reverseOnSignal,false);
 await svc.arm('CHAP NHAN BTC FUTURES',77000);
 await svc.signal({side:'LONG',barTime:900000},true);
 assert.equal(fx.position.qty,.032);
 await svc.signal({side:'SHORT',barTime:1800000},true);
 assert.equal(fx.calls.filter(x=>x.method==='POST').length,5);
 svc.setReverseOnSignal(true);assert.equal(svc.snapshot().armed,true);
 const persisted=JSON.parse(readFileSync(join(dir,'futures-browser-settings.json'),'utf8'));
 assert.equal(persisted.reverseOnSignal,true);
 await svc.signal({side:'SHORT',barTime:2700000},true);
 const posts=fx.calls.filter(x=>x.method==='POST');
 assert.equal(svc.snapshot().halted,false,svc.snapshot().error);
 assert.equal(posts.length,11);
 assert.deepEqual(posts.slice(5).map(x=>x.path),[
  '/fapi/v1/order','/fapi/v1/order','/fapi/v1/algoOrder',
  '/fapi/v1/algoOrder','/fapi/v1/algoOrder','/fapi/v1/algoOrder'
 ]);
 assert.equal(posts[5].p.reduceOnly,'true');assert.equal(posts[5].p.side,'SELL');
 assert.equal(posts[5].p.quantity,'.032'.replace(/^\./,'0.'));
 assert.equal(posts[6].p.side,'SELL');assert.equal(posts[6].p.reduceOnly,undefined);
 const deletions=fx.calls.filter(x=>x.method==='DELETE');
 assert.equal(deletions.length,4);
 assert.equal(svc.snapshot().halted,false);
 assert.equal(svc.snapshot().config.reverseOnSignal,true);
 assert.equal(svc.snapshot().protectedPosition.entry.side,'SHORT');
 assert.equal(fx.position.qty,-.032);
 const reversedIndex=fx.calls.findIndex(x=>x.method==='POST'&&x.path==='/fapi/v1/order'&&x.p.reduceOnly==='true');
 const newIndex=fx.calls.findIndex((x,i)=>i>reversedIndex&&x.method==='POST'&&x.path==='/fapi/v1/order'&&x.p.reduceOnly!=='true');
 const lastDelete=fx.calls.findLastIndex(x=>x.method==='DELETE');
 assert.ok(reversedIndex>=0&&lastDelete>reversedIndex&&newIndex>lastDelete);
 svc.setReverseOnSignal(false);
 await svc.signal({side:'LONG',barTime:3600000},true);
 assert.equal(fx.calls.filter(x=>x.method==='POST').length,11);
});

test('If Binance STOP is absent, reverse is safety-halted without opening or closing any new position',async t=>{
 const dir=tmp(t),fx=fake(),svc=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await svc.connect(creds);svc.saveConfig({marginUSDT:500,leverage:5,reverseOnSignal:true});
 await svc.arm('CHAP NHAN BTC FUTURES',77000);
 await svc.signal({side:'LONG',barTime:900000},true);
 fx.algo.splice(fx.algo.findIndex(o=>o.orderType==='STOP_MARKET'),1);
 const before=fx.calls.filter(x=>x.method==='POST').length;
 await svc.signal({side:'SHORT',barTime:1800000},true);
 assert.equal(fx.calls.filter(x=>x.method==='POST').length,before);
 assert.equal(svc.snapshot().halted,true);
 assert.equal(svc.snapshot().armed,true);
 assert.equal(svc.snapshot().protectedPosition.entry.side,'LONG');
});

test('Unknown reduceOnly close outcome cannot send opposing Entry and leaves old stop untouched',async t=>{
 const dir=tmp(t),fx=fake(),svc=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await svc.connect(creds);svc.saveConfig({marginUSDT:500,leverage:5,reverseOnSignal:true});
 await svc.arm('CHAP NHAN BTC FUTURES',77000);
 await svc.signal({side:'LONG',barTime:900000},true);
 const post=fx.api.post.bind(fx.api);
 fx.api.post=async(path,params)=>{if(path==='/fapi/v1/order'&&params.reduceOnly==='true')throw Error('unknown close outcome');return post(path,params);};
 const before=fx.calls.filter(x=>x.method==='POST').length;
 await svc.signal({side:'SHORT',barTime:1800000},true);
 assert.equal(fx.calls.filter(x=>x.method==='POST').length,before);
 assert.equal(fx.position.qty,.032);
 assert.equal(fx.algo.length,4);
 assert.equal(svc.snapshot().halted,true);
 assert.equal(svc.snapshot().config.reverseOnSignal,true);
 assert.equal(JSON.parse(readFileSync(join(dir,'futures-live-intent.json'),'utf8')).phase,'REVERSE_CLOSE_SENDING');
 await svc.signal({side:'SHORT',barTime:2700000},true);
 assert.equal(fx.calls.filter(x=>x.method==='POST').length,before);
});

test('Reverse switch rejects malformed values and cannot change during an in-flight order',async t=>{
 const dir=tmp(t),svc=new BrowserFutures({dataDir:dir,transportFactory:()=>fake().api,credentialVault:makeVault(dir)});
 assert.throws(()=>svc.setReverseOnSignal('true'),/ON hoặc OFF/);
 svc.busy=true;
 assert.throws(()=>svc.setReverseOnSignal(true),/Đang xử lý/);
 svc.busy=false;
 svc.setReverseOnSignal(true);assert.equal(svc.config.reverseOnSignal,true);
 svc.setReverseOnSignal(false);assert.equal(svc.config.reverseOnSignal,false);
});

test('If the reversed NEW Entry cannot place its STOP, bot emergency-closes only verified unprotected BTC and HALTs',async t=>{
 const dir=tmp(t),fx=fake(),svc=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await svc.connect(creds);
 svc.saveConfig({marginUSDT:500,leverage:5,reverseOnSignal:true});
 await svc.arm('CHAP NHAN BTC FUTURES',77000);
 await svc.signal({side:'LONG',barTime:900000},true);
 const original=fx.api.post.bind(fx.api);
 fx.api.post=async(path,p)=>{
  if(path==='/fapi/v1/algoOrder'&&p.type==='STOP_MARKET'&&p.side==='BUY')
   throw Error('new reversed stop failure');
  return original(path,p);
 };
 await svc.signal({side:'SHORT',barTime:1800000},true);
 const posts=fx.calls.filter(x=>x.method==='POST'&&x.path==='/fapi/v1/order');
 assert.equal(posts.length,4); // LONG entry, reverse reduceOnly, SHORT entry, emergency reduceOnly
 assert.equal(posts[0].p.side,'BUY');
 assert.equal(posts[1].p.reduceOnly,'true');
 assert.equal(posts[2].p.side,'SELL');
 assert.equal(posts[3].p.reduceOnly,'true');
 assert.equal(posts[3].p.side,'BUY');
 assert.equal(fx.position.qty,0);
 assert.equal(svc.snapshot().halted,true);
 assert.equal(svc.snapshot().armed,true); // operator ON is retained but trading is blocked
});

test('After app restart, FLAT BTCUSDT and three orphan OCC TPs are cancelled and AUTO can be armed again',async t=>{
 const dir=tmp(t),fx=fake(),one=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await one.connect(creds);one.saveConfig({marginUSDT:500,leverage:5});
 await one.arm('CHAP NHAN BTC FUTURES',77000);await one.signal({side:'LONG',barTime:900000},true);
 assert.equal(fx.algo.length,4);
 fx.position.qty=0;
 fx.algo.splice(fx.algo.findIndex(o=>o.orderType==='STOP_MARKET'),1); // SL fired while app offline, TP1-3 remain.
 const before=fx.calls.filter(x=>x.method==='POST').length;
 const two=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 assert.equal(two.snapshot().halted,true);
 await two.restoreSavedConnection();
 assert.equal(two.snapshot().halted,false,two.snapshot().error);
 assert.equal(two.snapshot().recoveryStatus,'recovered');
 assert.equal(two.snapshot().armed,false);
 assert.equal(fx.algo.length,0);
 assert.equal(fx.calls.filter(x=>x.method==='DELETE').length,3);
 assert.equal(fx.calls.filter(x=>x.method==='POST').length,before); // never creates new orders on startup
 const intent=JSON.parse(readFileSync(join(dir,'futures-live-intent.json'),'utf8'));
 assert.equal(intent.phase,'CLEARED');
 const checkpoint=JSON.parse(readFileSync(join(dir,'futures-live-protection.json'),'utf8'));
 assert.equal(checkpoint.phase,'IDLE');
 await two.arm('CHAP NHAN BTC FUTURES',77000);
 assert.equal(two.snapshot().armed,true);
});

test('Unknown third party Algo blocks auto and manual cleanup, without deleting any orders',async t=>{
 const dir=tmp(t),fx=fake(),one=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await one.connect(creds);one.saveConfig({marginUSDT:500,leverage:5});
 await one.arm('CHAP NHAN BTC FUTURES',77000);await one.signal({side:'LONG',barTime:900000},true);
 fx.position.qty=0;
 fx.algo.push({algoId:99999,symbol:'BTCUSDT',positionSide:'BOTH',
  clientAlgoId:'manual-TP',algoStatus:'NEW',orderType:'TAKE_PROFIT_MARKET',
  side:'SELL',reduceOnly:true,quantity:'0.001'});
 const two=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await two.restoreSavedConnection();
 assert.equal(two.snapshot().halted,true);
 assert.equal(fx.calls.filter(x=>x.method==='DELETE').length,0);
 await assert.rejects(two.checkBinanceAndReconcile(),/ngoài OCC|không tự hủy/);
 assert.equal(fx.algo.length,5);
 assert.equal(two.snapshot().armed,false);
});

test('When BTC is still open on restart, no Algo may be removed',async t=>{
 const dir=tmp(t),fx=fake(),one=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await one.connect(creds);one.saveConfig({marginUSDT:500,leverage:5});
 await one.arm('CHAP NHAN BTC FUTURES',77000);await one.signal({side:'LONG',barTime:900000},true);
 const two=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await two.restoreSavedConnection();
 assert.equal(two.snapshot().halted,true);
 assert.equal(fx.algo.length,4);
 assert.equal(fx.calls.filter(x=>x.method==='DELETE').length,0);
});

test('Unknown DELETE result remains HALTED; manual retry reconciles only remaining verified OCC Algo IDs',async t=>{
 const dir=tmp(t),fx=fake(),one=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await one.connect(creds);one.saveConfig({marginUSDT:500,leverage:5});
 await one.arm('CHAP NHAN BTC FUTURES',77000);await one.signal({side:'LONG',barTime:900000},true);
 fx.position.qty=0;
 let fail=true;
 const del=fx.api.del.bind(fx.api);
 fx.api.del=async(path,p)=>{
  if(fail){fail=false;throw Error('uncertain DELETE response');}
  return del(path,p);
 };
 const two=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await two.restoreSavedConnection();
 assert.equal(two.snapshot().halted,true);
 assert.equal(fx.algo.length,4);
 assert.equal(JSON.parse(readFileSync(join(dir,'futures-live-intent.json'),'utf8')).phase,'STALE_ALGO_CANCEL_SENDING');
 await two.checkBinanceAndReconcile();
 assert.equal(two.snapshot().halted,false);
 assert.equal(fx.algo.length,0);
 assert.equal(two.snapshot().armed,false);
});

function manualFake(){
 const fx=fake(),manualOrders=new Map(),get=fx.api.get.bind(fx.api),
  post=fx.api.post.bind(fx.api);
 let nextManualOrderId=801;
 fx.api.get=async(path,p={})=>{
  if(path==='/fapi/v1/order'&&manualOrders.has(String(p.orderId)))
   return manualOrders.get(String(p.orderId));
  if(path==='/fapi/v3/positionRisk'){
   const rows=await get(path,p);
   return rows.map(o=>({...o,entryPrice:'77000',markPrice:'77500',
    liquidationPrice:'65000',positionInitialMargin:'500',unRealizedProfit:'16'}));
  }
  return get(path,p);
 };
 fx.api.post=async(path,p)=>{
  if(path==='/fapi/v1/order'&&p.reduceOnly==='true'){
   fx.calls.push({method:'POST',path,p});
   const signed=Math.sign(fx.position.qty),qty=Number(p.quantity);
   if(qty>Math.abs(fx.position.qty)+1e-9)throw Error('over-reduce in mock');
   fx.position.qty=Number((fx.position.qty-signed*qty).toFixed(10));
   const id=nextManualOrderId++;
   manualOrders.set(String(id),{symbol:'BTCUSDT',orderId:id,clientOrderId:p.newClientOrderId,
    side:p.side,positionSide:'BOTH',reduceOnly:true,status:'FILLED',
    type:'MARKET',executedQty:p.quantity,avgPrice:'77500'});
   return {orderId:id,status:'FILLED',clientOrderId:p.newClientOrderId};
  }
  return post(path,p);
 };
 return fx;
}
test('TP1 manual MARKET cancels ONLY pending TP1, closes exact lot, leaves SL + TP2/TP3 and stores order ID',async t=>{
 const dir=tmp(t),fx=manualFake();
 const svc=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await svc.connect(creds);svc.saveConfig({marginUSDT:500,leverage:5});
 await svc.arm('CHAP NHAN BTC FUTURES',77000);
 await svc.signal({side:'LONG',barTime:900000},true);
 const snapshot=await svc.positionAnalysis();
 assert.equal(snapshot.status,'open');assert.equal(snapshot.manual.allowed,true);
 assert.equal(snapshot.manual.TP1.quantityBTC,.01);
 const before=fx.calls.length;
 const result=await svc.manualMarketExit({role:'TP1',
  confirmation:'XAC NHAN TP1 BTCUSDT',
  expectedEntryOrderId:snapshot.manual.entryOrderId,
  expectedRemainingBTC:snapshot.manual.remainingBTC});
 assert.equal(result.closedBTC,.01);assert.equal(result.remainingBTC,.022);
 assert.equal(fx.position.qty,.022);assert.equal(fx.algo.length,3);
 assert.deepEqual(fx.algo.map(o=>o.clientAlgoId.endsWith('-SL')?'SL':o.clientAlgoId.slice(-3)),['SL','TP2','TP3']);
 const performed=fx.calls.slice(before).filter(x=>x.method==='POST'||x.method==='DELETE');
 assert.deepEqual(performed.map(x=>x.method),['DELETE','POST']);
 assert.equal(String(performed[0].p.algoId),'201');
 assert.equal(performed[1].p.reduceOnly,'true');
 assert.equal(performed[1].p.quantity,'0.01');
 assert.equal(svc.snapshot().armed,true);assert.equal(svc.snapshot().halted,false);
 const after=await svc.positionAnalysis();
 assert.equal(after.manual.TP1,null);
 assert.equal(after.manual.TP2.quantityBTC,.01);
 const ledger=new LiveStatsLedger(join(dir,'binance-live-stats.sqlite'));
 assert.equal(ledger.orders().filter(x=>x.role==='TP1').length,1);
 ledger.close();
 const requests=fx.calls.filter(x=>x.method==='POST'&&x.path==='/fapi/v1/order');
 await assert.rejects(svc.manualMarketExit({role:'TP1',confirmation:'XAC NHAN TP1 BTCUSDT',
  expectedEntryOrderId:snapshot.manual.entryOrderId,expectedRemainingBTC:.022}),
  /đã chốt|không còn/);
 assert.equal(fx.calls.filter(x=>x.method==='POST'&&x.path==='/fapi/v1/order').length,requests.length);
});

test('Manual close ALL uses reduceOnly remaining BTC, verifies FLAT, cancels all OCC SL TP and preserves operator AUTO',async t=>{
 const dir=tmp(t),fx=manualFake();
 const svc=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await svc.connect(creds);svc.saveConfig({marginUSDT:500,leverage:5});
 await svc.arm('CHAP NHAN BTC FUTURES',77000);await svc.signal({side:'LONG',barTime:900000},true);
 const s=await svc.positionAnalysis();
 const result=await svc.manualMarketExit({role:'ALL',confirmation:'XAC NHAN ALL BTCUSDT',
  expectedEntryOrderId:s.manual.entryOrderId,expectedRemainingBTC:s.manual.remainingBTC});
 assert.equal(result.closedBTC,.032);assert.equal(result.remainingBTC,0);
 assert.equal(fx.position.qty,0);assert.equal(fx.algo.length,0);
 assert.equal(fx.calls.filter(x=>x.method==='DELETE').length,4);
 const reduced=fx.calls.filter(x=>x.method==='POST'&&x.path==='/fapi/v1/order'&&x.p.reduceOnly==='true');
 assert.equal(reduced.length,1);
 assert.equal(reduced[0].p.quantity,'0.032');
 assert.equal(svc.snapshot().halted,false);assert.equal(svc.snapshot().armed,true);
 assert.equal(svc.snapshot().protectedPosition,null);
 assert.equal(JSON.parse(readFileSync(join(dir,'futures-live-protection.json'),'utf8')).phase,'IDLE');
 assert.equal(JSON.parse(readFileSync(join(dir,'futures-live-intent.json'),'utf8')).phase,'CLEARED');
 const ledger=new LiveStatsLedger(join(dir,'binance-live-stats.sqlite'));
 assert.equal(ledger.orders().filter(x=>x.role==='CLOSE').length,1);
 ledger.close();
});

test('Manual TP selected cancelled on Binance then MARKET response unknown: halt, do not retry, other TPs and STOP stay',async t=>{
 const dir=tmp(t),fx=manualFake();
 const svc=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await svc.connect(creds);svc.saveConfig({marginUSDT:500,leverage:5});
 await svc.arm('CHAP NHAN BTC FUTURES',77000);await svc.signal({side:'LONG',barTime:900000},true);
 const s=await svc.positionAnalysis();
 const oldPost=fx.api.post.bind(fx.api);
 fx.api.post=async(path,p)=>{
  if(path==='/fapi/v1/order'&&p.reduceOnly==='true')throw Error('unknown MARKET result');
  return oldPost(path,p);
 };
 await assert.rejects(svc.manualMarketExit({role:'TP2',confirmation:'XAC NHAN TP2 BTCUSDT',
  expectedEntryOrderId:s.manual.entryOrderId,expectedRemainingBTC:s.manual.remainingBTC}),/unknown MARKET/);
 assert.equal(svc.snapshot().halted,true);assert.equal(svc.snapshot().armed,true);
 assert.equal(fx.position.qty,.032);
 assert.equal(fx.algo.length,3);
 assert.ok(fx.algo.some(x=>x.orderType==='STOP_MARKET'));
 assert.ok(!fx.algo.some(x=>x.clientAlgoId.endsWith('-TP2')));
 assert.equal(JSON.parse(readFileSync(join(dir,'futures-live-intent.json'),'utf8')).phase,'MANUAL_MARKET_SENDING');
});

test('Sequential manual TP2 and TP3 after TP1 never recalculate the original lots; TP3 can finish the position',async t=>{
 const dir=tmp(t),fx=manualFake(),svc=new BrowserFutures({
  dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await svc.connect(creds);svc.saveConfig({marginUSDT:500,leverage:5});
 await svc.arm('CHAP NHAN BTC FUTURES',77000);
 await svc.signal({side:'LONG',barTime:900000},true);
 for(const [role,qty,remaining] of [['TP1',.01,.022],['TP2',.01,.012],['TP3',.012,0]]){
  const p=await svc.positionAnalysis();
  assert.equal(p.manual.allowed,true);
  assert.equal(p.manual[role].quantityBTC,qty);
  const result=await svc.manualMarketExit({role,confirmation:'XAC NHAN '+role+' BTCUSDT',
   expectedEntryOrderId:p.manual.entryOrderId,
   expectedRemainingBTC:p.manual.remainingBTC});
  assert.equal(result.closedBTC,qty);
  assert.equal(result.remainingBTC,remaining);
  assert.equal(fx.position.qty,remaining);
 }
 assert.equal(fx.algo.length,0);
 assert.equal(svc.snapshot().halted,false);
 assert.equal(svc.snapshot().protectedPosition,null);
 const ledger=new LiveStatsLedger(join(dir,'binance-live-stats.sqlite'));
 assert.deepEqual(ledger.orders().filter(x=>/^TP[123]$/.test(x.role)).map(x=>x.role),
  ['TP1','TP2','TP3']);
 ledger.close();
});

test('Manual close ALL after restart still works for verified OCC PROTECTED checkpoint while AUTO is OFF',async t=>{
 const dir=tmp(t),fx=manualFake();
 const first=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await first.connect(creds);first.saveConfig({marginUSDT:500,leverage:5});
 await first.arm('CHAP NHAN BTC FUTURES',77000);
 await first.signal({side:'LONG',barTime:900000},true);
 first.close();
 const next=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 assert.equal(next.snapshot().halted,true);
 await next.restoreSavedConnection();
 const p=await next.positionAnalysis();
 assert.equal(p.manual.allowed,true);
 assert.equal(p.manual.ALL.quantityBTC,.032);
 const result=await next.manualMarketExit({role:'ALL',confirmation:'XAC NHAN ALL BTCUSDT',
  expectedEntryOrderId:p.manual.entryOrderId,expectedRemainingBTC:p.manual.remainingBTC});
 assert.equal(result.remainingBTC,0);
 assert.equal(next.snapshot().halted,false);
 assert.equal(next.snapshot().armed,false);
 assert.equal(fx.algo.length,0);
});

test('Market exit with a stale quantity or unknown external Algo never sends a close or cancellation',async t=>{
 const dir=tmp(t),fx=manualFake();
 const svc=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await svc.connect(creds);svc.saveConfig({marginUSDT:500,leverage:5});
 await svc.arm('CHAP NHAN BTC FUTURES',77000);
 await svc.signal({side:'LONG',barTime:900000},true);
 const initial=await svc.positionAnalysis();
 let before=fx.calls.filter(x=>x.method==='POST'||x.method==='DELETE').length;
 await assert.rejects(svc.manualMarketExit({role:'TP1',confirmation:'XAC NHAN TP1 BTCUSDT',
  expectedEntryOrderId:initial.manual.entryOrderId,expectedRemainingBTC:.031}),/Khối lượng BTC thay đổi/);
 assert.equal(fx.calls.filter(x=>x.method==='POST'||x.method==='DELETE').length,before);
 fx.algo.push({symbol:'BTCUSDT',positionSide:'BOTH',algoId:999999,
  clientAlgoId:'manual-extra',algoStatus:'NEW',orderType:'TAKE_PROFIT_MARKET',
  side:'SELL',reduceOnly:true,quantity:'.001'});
 before=fx.calls.filter(x=>x.method==='POST'||x.method==='DELETE').length;
 await assert.rejects(svc.manualMarketExit({role:'ALL',confirmation:'XAC NHAN ALL BTCUSDT',
  expectedEntryOrderId:initial.manual.entryOrderId,expectedRemainingBTC:.032}),/không thuộc OCC/);
 assert.equal(fx.calls.filter(x=>x.method==='POST'||x.method==='DELETE').length,before);
});

test('Fresh Binance websocket quote skips extra REST ticker and measures M15 Entry latency',async t=>{
 const dir=tmp(t),fx=fake(),service=new BrowserFutures({
  dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)
 });
 await service.connect(creds);service.saveConfig({marginUSDT:500,leverage:5});
 await service.arm('CHAP NHAN BTC FUTURES',77000);
 const openedAt=Date.now()-350;
 await service.signal({side:'LONG',barTime:openedAt-900000,time:openedAt,observedAt:Date.now()},
  true,()=>({symbol:'BTCUSDT',live:true,lastPrice:77000,lastReceivedAt:Date.now()}));
 assert.equal(fx.calls.some(c=>c.method==='GET'&&c.path==='/fapi/v1/ticker/price'),false);
 assert.equal(fx.calls.filter(c=>c.method==='POST'&&c.path==='/fapi/v1/order').length,1);
 const timing=service.snapshot().lastEntryTiming;
 assert.ok(timing&&timing.sentAt>=openedAt);
 assert.ok(timing.signalToSendMs>=350&&Number.isFinite(timing.signalToSendMs));
 assert.ok(timing.exchangeAckMs>=0&&Number.isFinite(timing.exchangeAckMs));
 assert.ok(timing.ackAt>=timing.sentAt);
});

test('Stale websocket quote rejects Entry before mutation without retry/fabricated price',async t=>{
 const dir=tmp(t),fx=fake(),service=new BrowserFutures({
  dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)
 });
 await service.connect(creds);service.saveConfig({marginUSDT:500,leverage:5});
 await service.arm('CHAP NHAN BTC FUTURES',77000);
 await service.signal({side:'LONG',barTime:900000,time:1800000},true,
  ()=>({symbol:'BTCUSDT',live:true,lastPrice:77000,lastReceivedAt:Date.now()-8500}));
 assert.equal(fx.calls.filter(c=>c.method==='POST'&&c.path==='/fapi/v1/order').length,0);
 assert.equal(fx.calls.filter(c=>c.method==='GET'&&c.path==='/fapi/v1/ticker/price').length,0);
 assert.equal(service.snapshot().armed,true);
 assert.equal(service.snapshot().halted,false);
 assert.match(service.snapshot().error,/quá hạn/);
});

test('PC LIMIT pullback opt-in queues GTD, cancels unfilled order and awaits a NEW crossover',async t=>{
 const dir=tmp(t),fx=fake(),svc=new BrowserFutures({
  dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await svc.connect(creds);
 svc.saveConfig({marginUSDT:500,leverage:5,entryMode:'LIMIT_PULLBACK',
  limitBasis:'OCC_CROSS',limitOffsetPct:0.05,limitWaitSeconds:90});
 await svc.arm('CHAP NHAN BTC FUTURES',77000);
 await svc.signal({id:'S-1',side:'LONG',barTime:900000,crossPrice:77000,candleClose:77000},true);
 const queued=svc.snapshot().pendingLimit;
 assert.ok(queued&&queued.price<77000&&queued.side==='LONG');
 assert.equal(svc.snapshot().protectedPosition,null);
 assert.equal(fx.calls.filter(x=>x.method==='POST'&&x.path==='/fapi/v1/order').at(-1).p.type,'LIMIT');
 assert.equal(fx.calls.some(x=>x.method==='POST'&&x.path==='/fapi/v1/algoOrder'),false);
 await svc.signal({id:'S-2',side:'SHORT',barTime:1800000,crossPrice:77000},true);
 assert.equal(fx.calls.filter(x=>x.method==='POST'&&x.path==='/fapi/v1/order').length,1);
 await svc.cancelOpenLimit();
 assert.equal(svc.snapshot().pendingLimit,null);
 assert.equal(svc.snapshot().armed,true);
 assert.equal(fx.limit.order.status,'CANCELED');
 assert.equal(fx.calls.filter(x=>x.method==='DELETE'&&x.path==='/fapi/v1/order').length,1);
});

test('PC fully FILLED LIMIT waits for verified position, installs STOP before TP1/2/3',async t=>{
 const dir=tmp(t),fx=fake(),svc=new BrowserFutures({
  dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await svc.connect(creds);
 svc.saveConfig({marginUSDT:500,leverage:5,entryMode:'LIMIT_PULLBACK',
  limitBasis:'OCC_CROSS',limitOffsetPct:0.05,limitWaitSeconds:90});
 await svc.arm('CHAP NHAN BTC FUTURES',77000);
 await svc.signal({id:'S-1',side:'LONG',barTime:900000,crossPrice:77000,candleClose:77000},true);
 const order=fx.limit.order;
 fx.limit.order={...order,status:'FILLED',executedQty:order.origQty,avgPrice:order.price};
 fx.position.qty=Number(order.origQty);
 await svc.pollLimit();
 assert.equal(svc.snapshot().pendingLimit,null);
 assert.ok(svc.snapshot().protectedPosition?.stop);
 const posted=fx.calls.filter(x=>x.method==='POST');
 assert.deepEqual(posted.map(x=>x.path),
  ['/fapi/v1/order',...Array(4).fill('/fapi/v1/algoOrder')]);
 assert.equal(posted[1].p.type,'STOP_MARKET');
 assert.equal(posted[1].p.closePosition,'true');
});

test('Exact OCC BTC trigger LIMIT uses triggerPrice, not MA crossPrice or M15 close',async t=>{
 const dir=tmp(t),fx=fake(),svc=new BrowserFutures({
  dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await svc.connect(creds);
 svc.saveConfig({marginUSDT:500,leverage:5,entryMode:'LIMIT_PULLBACK',
  limitBasis:'OCC_TRIGGER',limitOffsetPct:0.05,limitWaitSeconds:90});
 await svc.arm('CHAP NHAN BTC FUTURES',77000);
 await svc.signal({id:'EXACT',side:'LONG',barTime:900000,
  crossPrice:78000,candleClose:76500,triggerPrice:76000},true);
 assert.equal(svc.snapshot().pendingLimit.price,76000);
 assert.equal(fx.limit.order.price,'76000');
 await svc.cancelOpenLimit();
});
test('Exact OCC trigger skips a now-marketable LONG LIMIT without sending to Binance',async t=>{
 const dir=tmp(t),fx=fake(),svc=new BrowserFutures({
  dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await svc.connect(creds);
 svc.saveConfig({marginUSDT:500,leverage:5,entryMode:'LIMIT_PULLBACK',
  limitBasis:'OCC_TRIGGER',limitWaitSeconds:90});
 await svc.arm('CHAP NHAN BTC FUTURES',77000);
 await svc.signal({id:'STALE',side:'LONG',barTime:900000,triggerPrice:78000},true);
 assert.equal(fx.calls.filter(x=>x.method==='POST'&&x.path==='/fapi/v1/order').length,0);
 assert.equal(svc.snapshot().pendingLimit,null);
});
test('FILLED LIMIT with rejected STOP clears pending but stays HALTED and does not duplicate STOP',async t=>{
 const dir=tmp(t),fx=fake({failStop:true}),svc=new BrowserFutures({
  dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await svc.connect(creds);
 svc.saveConfig({marginUSDT:500,leverage:5,entryMode:'LIMIT_PULLBACK',
  limitBasis:'OCC_CROSS',limitWaitSeconds:90});
 await svc.arm('CHAP NHAN BTC FUTURES',77000);
 await svc.signal({id:'FAILED-STOP',side:'LONG',barTime:900000,crossPrice:77000},true);
 const order=fx.limit.order;
 fx.limit.order={...order,status:'FILLED',executedQty:order.origQty,avgPrice:order.price};
 fx.position.qty=Number(order.origQty);
 await svc.pollLimit();
 assert.equal(svc.snapshot().pendingLimit,null);
 assert.equal(svc.snapshot().halted,true);
 assert.equal(svc.snapshot().protectedPosition,null);
 assert.equal(JSON.parse(readFileSync(join(dir,'futures-live-intent.json'),'utf8')).phase,'LIMIT_FILLED');
 const cp=JSON.parse(readFileSync(join(dir,'futures-live-protection.json'),'utf8'));
 assert.equal(cp.inFlight.role,'SL');
 const posted=fx.calls.filter(x=>x.method==='POST'&&x.path==='/fapi/v1/algoOrder');
 assert.equal(posted.length,1);
 await svc.pollLimit();
 assert.equal(fx.calls.filter(x=>x.method==='POST'&&x.path==='/fapi/v1/algoOrder').length,1);
});
test('PC partially filled LIMIT cancels unfilled remainder then verifies one reduceOnly MARKET FLAT',async t=>{
 const dir=tmp(t),fx=fake(),svc=new BrowserFutures({
  dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await svc.connect(creds);
 svc.saveConfig({marginUSDT:500,leverage:5,entryMode:'LIMIT_PULLBACK',
  limitBasis:'M15_CLOSE',limitOffsetPct:0.05,limitWaitSeconds:90});
 await svc.arm('CHAP NHAN BTC FUTURES',77000);
 await svc.signal({id:'S-1',side:'LONG',barTime:900000,candleClose:77000},true);
 const order=fx.limit.order;
 fx.limit.order={...order,status:'PARTIALLY_FILLED',executedQty:'.001',avgPrice:order.price};
 fx.position.qty=.001;
 await svc.pollLimit();
 assert.equal(svc.snapshot().pendingLimit,null);
 assert.equal(svc.snapshot().protectedPosition,null);
 assert.equal(fx.position.qty,0);
 assert.equal(fx.calls.filter(x=>x.method==='DELETE'&&x.path==='/fapi/v1/order').length,1);
 const exit=fx.calls.filter(x=>x.method==='POST'&&x.path==='/fapi/v1/order'&&x.p.type==='MARKET');
 assert.equal(exit.length,1);
 assert.equal(exit[0].p.reduceOnly,'true');
});

test('PC restarted while LIMIT cancellation outcome was unknown must never send a duplicate DELETE',async t=>{
 const dir=tmp(t),fx=fake();
 const one=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await one.connect(creds);
 one.saveConfig({marginUSDT:500,leverage:5,entryMode:'LIMIT_PULLBACK',
  limitBasis:'OCC_CROSS',limitOffsetPct:.05,limitWaitSeconds:90});
 await one.arm('CHAP NHAN BTC FUTURES',77000);
 await one.signal({id:'S-LIMIT',side:'LONG',barTime:900000,crossPrice:77000},true);
 assert.ok(one.pendingLimit);
 one.saveIntent({phase:'LIMIT_CANCEL_SENDING',...one.pendingLimit});
 const restarted=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,
  credentialVault:makeVault(dir)});
 assert.equal(restarted.armed,false);
 assert.equal(restarted.halted,true);
 assert.equal(restarted.limitCancelUncertain,true);
 await assert.rejects(
  restarted.connect({...creds,apiKey:'wrong-api-credentials-for-another-account'}),
  /đúng API Binance đã mã hóa/);
 await restarted.connect(creds);
 const before=fx.calls.filter(x=>x.method==='DELETE'&&x.path==='/fapi/v1/order').length;
 await assert.rejects(restarted.cancelOpenLimit(),/không gửi hủy lần hai/i);
 assert.equal(fx.calls.filter(x=>x.method==='DELETE'&&x.path==='/fapi/v1/order').length,before);
 assert.equal(restarted.armed,false);
 assert.equal(restarted.halted,true);
});
