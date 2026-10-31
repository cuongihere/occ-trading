import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BrowserFutures} from './futures-browser-service.mjs';
import {WindowsCredentialVault} from './futures-credential-vault.mjs';
const PREFIX=Buffer.from('OCC_MOCK_ENCRYPTED_');
const fakeCrypt=(buf,mode)=>mode==='protect'
 ?Buffer.concat([PREFIX,Buffer.from(buf).reverse()])
 :Buffer.from(buf.subarray(PREFIX.length)).reverse();
const makeVault=dir=>new WindowsCredentialVault(join(dir,'futures-api.dpapi.json'),{crypt:fakeCrypt});
const tmp=t=>{const p=mkdtempSync(join(tmpdir(),'occ-browser-live-'));t.after(()=>rmSync(p,{force:true,recursive:true}));return p;};
function fake({flatRiskRows=false,brokenConfig=false,failStop=false,leverage=5,leverageAckMismatch=false}={}){
 const calls=[],algo=[],normal=[],position={qty:0},mode={dualSidePosition:false},leverageState={value:leverage};
 const api={
  close(){calls.push('closed');},
  async syncClock(){calls.push('time');},
  async get(path,p={}){
   calls.push({method:'GET',path,p});
   if(path==='/fapi/v2/account')return {canTrade:true,totalWalletBalance:'800',totalMarginBalance:'812',totalUnrealizedProfit:'12',totalInitialMargin:'60',assets:[{asset:'USDT',walletBalance:'800',availableBalance:'800'}]};
   if(path==='/fapi/v1/positionSide/dual')return mode;
   if(path==='/fapi/v1/symbolConfig')return brokenConfig?[]:[{symbol:'BTCUSDT',marginType:'ISOLATED',leverage:leverageState.value}];
   if(path==='/fapi/v3/positionRisk')return flatRiskRows&&position.qty===0?[]:[{symbol:'BTCUSDT',positionSide:'BOTH',positionAmt:String(position.qty)}];
   if(path==='/fapi/v1/openOrders')return normal;
   if(path==='/fapi/v1/openAlgoOrders')return algo;
   if(path==='/fapi/v1/exchangeInfo')return {symbols:[{symbol:'BTCUSDT',contractType:'PERPETUAL',
    status:'TRADING',filters:[{filterType:'MARKET_LOT_SIZE',stepSize:'.001',minQty:'.001'},
    {filterType:'PRICE_FILTER',tickSize:'.1'},{filterType:'MIN_NOTIONAL',notional:'5'}]}]};
   if(path==='/fapi/v1/ticker/price')return {symbol:'BTCUSDT',price:'77000'};
   if(path==='/fapi/v1/order')return {symbol:'BTCUSDT',side:'BUY',positionSide:'BOTH',
    status:'FILLED',executedQty:'.032',avgPrice:'77000',orderId:100,
    clientOrderId:calls.find(x=>x.method==='POST'&&x.path==='/fapi/v1/order'&&x.p.reduceOnly!=='true')?.p.newClientOrderId};
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
    if(p.reduceOnly==='true'){position.qty=0;return {orderId:999,status:'FILLED'};}
    position.qty=.032;return {orderId:100,status:'FILLED'};
   }
   if(path==='/fapi/v1/algoOrder'){
    if(failStop&&p.type==='STOP_MARKET')throw Error('Simulated Binance STOP failure');
    const id=200+algo.length;
    algo.push({algoId:id,symbol:'BTCUSDT',clientAlgoId:p.clientAlgoId,algoStatus:'NEW',
     orderType:p.type,side:p.side,triggerPrice:p.triggerPrice,
     closePosition:p.closePosition==='true',reduceOnly:p.reduceOnly==='true',quantity:p.quantity});
    return {algoId:id,clientAlgoId:p.clientAlgoId};
   }
   throw Error('Unexpected POST');
  },
  async del(path,p){calls.push({method:'DELETE',path,p});const idx=algo.findIndex(x=>String(x.algoId)===String(p.algoId));if(idx>=0)algo.splice(idx,1);return {};}
 };
 return {api,calls,algo,normal,position,mode,leverageState};
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
 await service.arm('CHAP NHAN BTC FUTURES');assert.equal(service.snapshot().armed,true);
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
 await service.arm('CHAP NHAN BTC FUTURES');assert.equal(service.snapshot().armed,true);
});
test('Production Auto mock sends MARKET then confirmed STOP and three TP, never opens duplicate',async t=>{
 const dir=tmp(t),fx=fake(),service=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await service.connect(creds);service.saveConfig({marginUSDT:500,leverage:5});
 await service.arm('CHAP NHAN BTC FUTURES');
 await service.signal({side:'LONG',barTime:900000},true);
 const posts=fx.calls.filter(x=>x.method==='POST');
 assert.deepEqual(posts.map(x=>x.path),['/fapi/v1/order','/fapi/v1/algoOrder',
 '/fapi/v1/algoOrder','/fapi/v1/algoOrder','/fapi/v1/algoOrder']);
 assert.equal(posts[1].p.type,'STOP_MARKET');assert.equal(posts[1].p.closePosition,'true');
 assert.equal(service.snapshot().armed,true);
 assert.ok(service.snapshot().protectedPosition);
 await service.signal({side:'SHORT',barTime:1800000},true);
 assert.equal(fx.calls.filter(x=>x.method==='POST').length,5);
 fx.position.qty=0;
 await service.monitor();
 assert.equal(fx.algo.length,0);
 assert.equal(service.snapshot().protectedPosition,null);
 assert.equal(service.snapshot().armed,true);
 service.disarm();
});
test('Live unfinished intent after restart blocks arming until exchange confirmed FLAT',async t=>{
 const dir=tmp(t),fx=fake(),service=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 await service.connect(creds);service.saveConfig({marginUSDT:500,leverage:5});await service.arm('CHAP NHAN BTC FUTURES');
 await service.signal({side:'LONG',barTime:900000},true);
 const again=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api,credentialVault:makeVault(dir)});
 assert.equal(again.snapshot().armed,false);assert.equal(again.snapshot().halted,true);
 await again.connect(creds);
 await assert.rejects(again.arm('CHAP NHAN BTC FUTURES'),/chưa đối soát/);
 await assert.rejects(again.reconcileFlat(),/còn vị thế/);
 fx.position.qty=0;fx.algo.splice(0);
 await again.reconcileFlat();await again.arm('CHAP NHAN BTC FUTURES');
 assert.equal(again.snapshot().armed,true);
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
 await service.arm('CHAP NHAN BTC FUTURES');
 await service.signal({side:'LONG',barTime:900000},true);
 assert.equal(service.snapshot().halted,true);
 assert.equal(service.snapshot().armed,false);
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
 await assert.rejects(service.arm('CHAP NHAN BTC FUTURES'),/đúng đòn bẩy/);
 assert.equal(fx.calls.filter(x=>x.method==='POST').length,0);
 await assert.rejects(service.applyExchangeLeverage({requestedLeverage:5}),/xác nhận/);
 await service.applyExchangeLeverage({requestedLeverage:5,confirmation:'SYNC_BTCUSDT_LEVERAGE'});
 assert.equal(service.snapshot().account.leverage,5);
 assert.equal(fx.leverageState.value,5);
 const updates=fx.calls.filter(x=>x.method==='POST');
 assert.equal(updates.length,1);
 assert.equal(updates[0].path,'/fapi/v1/leverage');
 assert.deepEqual(updates[0].p,{symbol:'BTCUSDT',leverage:5});
 await service.arm('CHAP NHAN BTC FUTURES');assert.equal(service.snapshot().armed,true);
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
