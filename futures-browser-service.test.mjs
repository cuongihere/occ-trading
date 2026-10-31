import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BrowserFutures} from './futures-browser-service.mjs';
const tmp=t=>{const p=mkdtempSync(join(tmpdir(),'occ-browser-live-'));t.after(()=>rmSync(p,{force:true,recursive:true}));return p;};
function fake({flatRiskRows=false,brokenConfig=false,failStop=false}={}){
 const calls=[],algo=[],normal=[],position={qty:0},mode={dualSidePosition:false};
 const api={
  close(){calls.push('closed');},
  async syncClock(){calls.push('time');},
  async get(path,p={}){
   calls.push({method:'GET',path,p});
   if(path==='/fapi/v2/account')return {canTrade:true,assets:[{asset:'USDT',walletBalance:'800',availableBalance:'800'}]};
   if(path==='/fapi/v1/positionSide/dual')return mode;
   if(path==='/fapi/v1/symbolConfig')return brokenConfig?[]:[{symbol:'BTCUSDT',marginType:'ISOLATED',leverage:5}];
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
 return {api,calls,algo,normal,position,mode};
}
const creds={apiKey:'dummy-api-key',apiSecret:'dummy-secret',environment:'production'};
test('UI backend accepts credentials in memory, stores only harmless configuration, restarts OFF',async t=>{
 const dir=tmp(t),fx=fake(),service=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api});
 await service.connect(creds);
 assert.equal(service.snapshot().connected,true);
 assert.equal(service.snapshot().environment,'production');
 service.saveConfig({marginUSDT:500,leverage:5});
 const content=readFileSync(join(dir,'futures-browser-settings.json'),'utf8');
 assert.doesNotMatch(content,/dummy-api-key|dummy-secret/);
 await service.arm('CHAP NHAN BTC FUTURES');assert.equal(service.snapshot().armed,true);
 service.disarm();assert.equal(service.snapshot().armed,false);
 const again=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api});
 assert.equal(again.snapshot().armed,false);
 assert.equal(again.snapshot().config.marginUSDT,500);
 assert.equal(existsSync(join(dir,'futures-live-intent.json')),false);
});
test('Production Auto requires explicit confirmation and rejects missing consent',async t=>{
 const service=new BrowserFutures({dataDir:tmp(t),transportFactory:()=>fake().api});
 await service.connect({...creds,environment:'production'});
 await assert.rejects(service.arm(),/Chưa xác nhận giao dịch tiền thật/);
 await service.arm('CHAP NHAN BTC FUTURES');assert.equal(service.snapshot().armed,true);
});
test('Production Auto mock sends MARKET then confirmed STOP and three TP, never opens duplicate',async t=>{
 const dir=tmp(t),fx=fake(),service=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api});
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
 const dir=tmp(t),fx=fake(),service=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api});
 await service.connect(creds);service.saveConfig({marginUSDT:500,leverage:5});await service.arm('CHAP NHAN BTC FUTURES');
 await service.signal({side:'LONG',barTime:900000},true);
 const again=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api});
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
 const service=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api});
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
 const service=new BrowserFutures({dataDir:tmp(t),transportFactory:()=>fx.api});
 await assert.rejects(service.connect({...creds,environment:'production'}),/\/fapi\/v1\/symbolConfig/);
 assert.equal(service.snapshot().connected,false);
});

test('Demo connections are rejected by production-only application',async t=>{
 const svc=new BrowserFutures({dataDir:tmp(t),transportFactory:()=>fake().api});
 await assert.rejects(svc.connect({...creds,environment:'demo'}),/Chỉ sử dụng Binance Futures thật/);
});

test('Real BTCUSDT entry failure to establish STOP triggers one reduce-only emergency close and HALT',async t=>{
 const fx=fake({failStop:true}),service=new BrowserFutures({dataDir:tmp(t),transportFactory:()=>fx.api});
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
