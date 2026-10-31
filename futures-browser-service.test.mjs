import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BrowserFutures} from './futures-browser-service.mjs';
const tmp=t=>{const p=mkdtempSync(join(tmpdir(),'occ-browser-live-'));t.after(()=>rmSync(p,{force:true,recursive:true}));return p;};
function fake(){
 const calls=[],algo=[],normal=[],position={qty:0},mode={dualSidePosition:false};
 const api={
  close(){calls.push('closed');},
  async syncClock(){calls.push('time');},
  async get(path,p={}){
   calls.push({method:'GET',path,p});
   if(path==='/fapi/v2/account')return {canTrade:true,assets:[{asset:'USDT',walletBalance:'800',availableBalance:'800'}]};
   if(path==='/fapi/v1/positionSide/dual')return mode;
   if(path==='/fapi/v1/symbolConfig')return [{symbol:'BTCUSDT',marginType:'ISOLATED',leverage:5}];
   if(path==='/fapi/v3/positionRisk')return [{symbol:'BTCUSDT',positionSide:'BOTH',positionAmt:String(position.qty)}];
   if(path==='/fapi/v1/openOrders')return normal;
   if(path==='/fapi/v1/openAlgoOrders')return algo;
   if(path==='/fapi/v1/exchangeInfo')return {symbols:[{symbol:'BTCUSDT',contractType:'PERPETUAL',
    status:'TRADING',filters:[{filterType:'MARKET_LOT_SIZE',stepSize:'.001',minQty:'.001'},
    {filterType:'PRICE_FILTER',tickSize:'.1'},{filterType:'MIN_NOTIONAL',notional:'5'}]}]};
   if(path==='/fapi/v1/ticker/price')return {symbol:'BTCUSDT',price:'77000'};
   if(path==='/fapi/v1/order')return {symbol:'BTCUSDT',side:'BUY',positionSide:'BOTH',
    status:'FILLED',executedQty:'.032',avgPrice:'77000',orderId:100};
   throw Error('Unexpected GET '+path);
  },
  async post(path,p){
   calls.push({method:'POST',path,p});
   if(path==='/fapi/v1/order'){position.qty=.032;return {orderId:100,status:'FILLED'};}
   if(path==='/fapi/v1/algoOrder'){
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
const creds={apiKey:'dummy-api-key',apiSecret:'dummy-secret',environment:'demo'};
test('UI backend accepts credentials in memory, stores only harmless configuration, restarts OFF',async t=>{
 const dir=tmp(t),fx=fake(),service=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api});
 await service.connect(creds);
 assert.equal(service.snapshot().connected,true);
 assert.equal(service.snapshot().environment,'demo');
 service.saveConfig({marginUSDT:500,leverage:5});
 const content=readFileSync(join(dir,'futures-browser-settings.json'),'utf8');
 assert.doesNotMatch(content,/dummy-api-key|dummy-secret/);
 await service.arm();assert.equal(service.snapshot().armed,true);
 service.disarm();assert.equal(service.snapshot().armed,false);
 const again=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api});
 assert.equal(again.snapshot().armed,false);
 assert.equal(again.snapshot().config.marginUSDT,500);
 assert.equal(existsSync(join(dir,'futures-demo-intent.json')),false);
});
test('Production connection is read-only and cannot ARM',async t=>{
 const service=new BrowserFutures({dataDir:tmp(t),transportFactory:()=>fake().api});
 await service.connect({...creds,environment:'production'});
 await assert.rejects(service.arm(),/Chỉ cho phép Binance Demo/);
});
test('Demo Auto sends MARKET then confirmed STOP and three TP, never opens duplicate',async t=>{
 const dir=tmp(t),fx=fake(),service=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api});
 await service.connect(creds);service.saveConfig({marginUSDT:500,leverage:5});
 await service.arm();
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
test('Unfinished intent after restart blocks arming until exchange confirmed FLAT',async t=>{
 const dir=tmp(t),fx=fake(),service=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api});
 await service.connect(creds);service.saveConfig({marginUSDT:500,leverage:5});await service.arm();
 await service.signal({side:'LONG',barTime:900000},true);
 const again=new BrowserFutures({dataDir:dir,transportFactory:()=>fx.api});
 assert.equal(again.snapshot().armed,false);assert.equal(again.snapshot().halted,true);
 await again.connect(creds);
 await assert.rejects(again.arm(),/chưa đối soát/);
 await assert.rejects(again.reconcileFlat(),/còn vị thế/);
 fx.position.qty=0;fx.algo.splice(0);
 await again.reconcileFlat();await again.arm();
 assert.equal(again.snapshot().armed,true);
});
