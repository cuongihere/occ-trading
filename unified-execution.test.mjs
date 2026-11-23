import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BrowserFutures} from './futures-browser-service.mjs';
import {LiveStatsLedger} from './binance-live-stats.mjs';

const vault=()=>({exists:()=>false,load:()=>null,save:()=>{},delete:()=>{}});
function mock(symbol='ETHUSDT'){
 const calls=[],orders=new Map(),algos=[],state={qty:0,price:100,nextId:101,nextAlgo:201};
 const filters=[{filterType:'LOT_SIZE',stepSize:'.01',minQty:'.01',maxQty:'1000'},
  {filterType:'MARKET_LOT_SIZE',stepSize:'.01',minQty:'.01',maxQty:'1000'},
  {filterType:'PRICE_FILTER',tickSize:'.01'},{filterType:'MIN_NOTIONAL',notional:'5'}];
 const api={key:'unit-key',secret:'unit-secret',
  close(){},async syncClock(){},
  async get(path,p={}){
   calls.push({method:'GET',path,p});
   if(path==='/fapi/v2/account')return {canTrade:true,assets:[
    {asset:'USDT',availableBalance:'1000',walletBalance:'1000'}
   ],positions:[{symbol,positionAmt:String(state.qty)}]};
   if(path==='/fapi/v1/positionSide/dual')return {dualSidePosition:false};
   if(path==='/fapi/v1/symbolConfig')return [{symbol,marginType:'ISOLATED',leverage:5}];
   if(path==='/fapi/v3/positionRisk')return state.qty?[{
    symbol,positionSide:'BOTH',positionAmt:String(state.qty),
    entryPrice:String(state.price),markPrice:String(state.price),unRealizedProfit:'0'
   }]:[];
   if(path==='/fapi/v1/openOrders')return [];
   if(path==='/fapi/v1/openAlgoOrders')return algos.slice();
   if(path==='/fapi/v1/exchangeInfo')return {symbols:[{
    symbol,contractType:'PERPETUAL',status:'TRADING',
    quoteAsset:'USDT',marginAsset:'USDT',filters
   }]};
   if(path==='/fapi/v1/order')return orders.get(String(p.orderId||''))||null;
   if(path==='/fapi/v1/ticker/price')return {symbol,price:'100'};
   throw Error('Unexpected Binance GET '+path);
  },
  async post(path,p={}){
   calls.push({method:'POST',path,p});
   if(path==='/fapi/v1/order'){
    const orderId=state.nextId++;
    if(p.reduceOnly==='true')state.qty=0;
    else state.qty=Number(p.quantity)*(p.side==='BUY'?1:-1);
    const order={orderId,symbol,side:p.side,positionSide:'BOTH',status:'FILLED',
     type:'MARKET',avgPrice:'100',executedQty:String(p.quantity),
     clientOrderId:p.newClientOrderId,reduceOnly:p.reduceOnly==='true'};
    orders.set(String(orderId),order);
    return {orderId,status:'FILLED'};
   }
   if(path==='/fapi/v1/algoOrder'){
    const algoId=state.nextAlgo++;
    algos.push({algoId,symbol,side:p.side,positionSide:'BOTH',
     clientAlgoId:p.clientAlgoId,algoStatus:'NEW',orderType:p.type,
     triggerPrice:p.triggerPrice,closePosition:p.closePosition==='true',
     reduceOnly:p.reduceOnly==='true',quantity:p.quantity});
    return {algoId,clientAlgoId:p.clientAlgoId};
   }
   throw Error('Unexpected Binance POST '+path);
  },
  async del(path,p){
   calls.push({method:'DELETE',path,p});
   if(path!=='/fapi/v1/algoOrder')throw Error('Unexpected delete');
   const i=algos.findIndex(a=>String(a.algoId)===String(p.algoId));
   if(i<0)throw Error('Cannot delete unverified Algo');
   algos.splice(i,1);return {};
  }};
 return {api,calls,orders,algos,state};
}
const setup=t=>{
 const dir=mkdtempSync(join(tmpdir(),'occ-alt-executor-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;
};
test('Real-money ETH executor reuses protected MARKET Entry, STOP before 3 TP, with zero Square posts',async t=>{
 const dir=setup(t),fx=mock();
 const s=new BrowserFutures({dataDir:dir,symbol:'ETHUSDT',credentialVault:vault(),transportFactory:()=>fx.api});
 await s.connect({apiKey:'fake-key-123',apiSecret:'fake-secret-123',environment:'production'});
 s.saveConfig({marginUSDT:100,leverage:5});
 await s.arm('CHAP NHAN BTC FUTURES',100);
 let posts=0;s.setSquarePublisher({onProtected:()=>{posts++;}});
 await s.signal({side:'LONG',barTime:900000},true);
 const mutations=fx.calls.filter(x=>x.method==='POST');
 assert.deepEqual(mutations.map(x=>x.path),[
  '/fapi/v1/order','/fapi/v1/algoOrder','/fapi/v1/algoOrder',
  '/fapi/v1/algoOrder','/fapi/v1/algoOrder']);
 assert.equal(mutations[0].p.symbol,'ETHUSDT');
 assert.match(mutations[0].p.newClientOrderId,/^OCCM-[0-9a-f]{14}$/);
 assert.equal(mutations[1].p.type,'STOP_MARKET');
 assert.equal(mutations[1].p.closePosition,'true');
 assert.deepEqual(mutations.slice(2).map(x=>x.p.type),
  ['TAKE_PROFIT_MARKET','TAKE_PROFIT_MARKET','TAKE_PROFIT_MARKET']);
 assert.ok(mutations.slice(2).every(x=>x.p.reduceOnly==='true'&&x.p.symbol==='ETHUSDT'));
 assert.equal(fx.algos.length,4);
 assert.equal(s.snapshot().protectedPosition.entry.symbol,'ETHUSDT');
 assert.equal(posts,0,'Square must never post any non-BTC trade');
 assert.ok(existsSync(s.ledgerPath));
 const ledger=new LiveStatsLedger(s.ledgerPath,{symbol:'ETHUSDT'});
 assert.equal(ledger.orders().length,1);
 ledger.close();
 await s.monitor();
 assert.equal(s.halted,false);
 await s.signal({side:'SHORT',barTime:1800000},true);
 assert.equal(fx.calls.filter(x=>x.method==='POST').length,5,'Reverse OFF must not stack');
 s.disarm();
});
test('ETH persisted protected checkpoint refuses blind resubmission after crash/restart',async t=>{
 const dir=setup(t),fx=mock();
 const s=new BrowserFutures({dataDir:dir,symbol:'ETHUSDT',credentialVault:vault(),transportFactory:()=>fx.api});
 await s.connect({apiKey:'fake-key-123',apiSecret:'fake-secret-123',environment:'production'});
 s.saveConfig({marginUSDT:100,leverage:5});
 await s.arm('CHAP NHAN BTC FUTURES',100);
 await s.signal({side:'SHORT',barTime:900000},true);
 const originalCount=fx.calls.filter(x=>x.method==='POST').length;
 const next=new BrowserFutures({dataDir:dir,symbol:'ETHUSDT',credentialVault:vault(),transportFactory:()=>fx.api});
 assert.equal(next.armed,false);
 assert.equal(next.halted,true);
 assert.equal(next.canResumeManagedPosition(),true);
 await next.connect({apiKey:'fake-key-123',apiSecret:'fake-secret-123',environment:'production'});
 assert.equal(next.armed,false);
 await next.arm('CHAP NHAN BTC FUTURES',100);
 assert.equal(next.armed,true);
 assert.equal(next.activeProtection?.entry?.symbol,'ETHUSDT');
 assert.equal(fx.calls.filter(x=>x.method==='POST').length,originalCount);
});
