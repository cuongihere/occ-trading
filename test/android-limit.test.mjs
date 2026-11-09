import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const read=file=>readFileSync(new URL('../android/app/src/main/assets/'+file,import.meta.url),'utf8');
function fixture(saved=''){
 const ctx={window:{},console,Date,Math,Set,Number,Error,JSON};
 for(const file of ['trade-core.js','trade-execution.js','trade-recovery.js','trade-limit.js'])
  runInNewContext(read(file),ctx,{filename:file});
 const calls=[],algos=[],closed=[],state={qty:0,side:null,entry:78000},index={value:0};
 let pending=null,store=saved;
 const api=async(method,path,p={})=>{
  calls.push({method,path,p:{...p}});
  if(method==='GET'){
   if(path==='/fapi/v2/account')return {canTrade:true,assets:[{asset:'USDT',availableBalance:'800'}]};
   if(path==='/fapi/v3/positionRisk')return state.qty?[{symbol:'BTCUSDT',positionSide:'BOTH',
    positionAmt:String(state.side==='LONG'?state.qty:-state.qty),entryPrice:String(state.entry)}]:[];
   if(path==='/fapi/v1/openOrders')return pending&&['NEW','PARTIALLY_FILLED'].includes(pending.status)?[{...pending}]:[];
   if(path==='/fapi/v1/openAlgoOrders')return algos.map(x=>({...x}));
   if(path==='/fapi/v1/positionSide/dual')return {dualSidePosition:false};
   if(path==='/fapi/v1/symbolConfig')return [{symbol:'BTCUSDT',marginType:'ISOLATED',leverage:5}];
   if(path==='/fapi/v1/order')return pending&&String(p.orderId)===String(pending.orderId)?
    {...pending}:closed.find(x=>String(x.orderId)===String(p.orderId))||Promise.reject(Error('No order'));
   throw Error('Unknown GET '+path);
  }
  if(method==='POST'&&path==='/fapi/v1/order'&&p.type==='LIMIT'){
   pending={symbol:'BTCUSDT',orderId:'5123',clientOrderId:p.newClientOrderId,
    side:p.side,positionSide:'BOTH',type:'LIMIT',status:'NEW',
    timeInForce:p.timeInForce,origQty:p.quantity,executedQty:'0',
    avgPrice:'0',price:p.price};
   return {orderId:5123,clientOrderId:p.newClientOrderId};
  }
  if(method==='DELETE'&&path==='/fapi/v1/order'){
   if(!pending||String(p.orderId)!==String(pending.orderId))throw Error('Wrong pending');
   pending.status='CANCELED';
   return {...pending};
  }
  if(method==='POST'&&path==='/fapi/v1/algoOrder'){
   const o={...p,algoId:String(6000+algos.length),algoStatus:'NEW',
    orderType:p.type,closePosition:p.closePosition==='true',
    reduceOnly:p.reduceOnly==='true'};
   algos.push(o);return {algoId:o.algoId,clientAlgoId:p.clientAlgoId};
  }
  throw Error('Unexpected '+method+' '+path);
 };
 const bot=new ctx.window.OCCMobileTrade({signed:api,publicGet:async()=>({
  symbols:[{symbol:'BTCUSDT',status:'TRADING',contractType:'PERPETUAL',
  filters:[{filterType:'MARKET_LOT_SIZE',stepSize:'.001',minQty:'.001'},
           {filterType:'LOT_SIZE',stepSize:'.001',minQty:'.001'},
           {filterType:'PRICE_FILTER',tickSize:'.1'},
           {filterType:'MIN_NOTIONAL',notional:'5'}]}]}),
  load:()=>store,save:s=>(store=s,true),
  newId:()=> 'OCCBTC-'+String(++index.value).padStart(14,'0'),
  report:()=>{}});
 bot.connected=true;
 if(bot.cp.phase==='IDLE')bot.setConfig({marginUSDT:70,entryMode:'LIMIT_PULLBACK',
    limitOffsetPct:0.05,limitWaitSeconds:90});
 const fill=(qty,full=false)=>{
  assert.ok(pending);
  pending.executedQty=String(qty);pending.avgPrice=String(Number(pending.price));
  pending.status=full?'FILLED':'PARTIALLY_FILLED';
  state.qty=qty;state.side=pending.side==='BUY'?'LONG':'SHORT';
  state.entry=Number(pending.price);
 };
 const signal={id:'occsignal-1',barTime:900000,time:1800000,side:'LONG',
  eligible:true,candleClose:78000,crossPrice:78000};
 return {bot,calls,algos,signal,fill,state,get pending(){return pending},
  get saved(){return store}};
}
test('LONG pullback is below both signal candle and market, SHORT above both',()=>{
 const h=fixture(),bot=h.bot;
 assert.ok(bot.limitEntryPrice('LONG',78000,78100,.1)<78000);
 assert.ok(bot.limitEntryPrice('SHORT',78000,77900,.1)>78000);
 assert.equal(bot.cp.config.entryMode,'LIMIT_PULLBACK');
 assert.equal(bot.cp.config.limitOffsetPct,.05);
});
test('Exact OCC BTC trigger LIMIT uses triggerPrice without the old 0.05% offset',async()=>{
 const h=fixture();h.bot.setConfig({marginUSDT:70,entryMode:'LIMIT_PULLBACK',
  limitBasis:'OCC_TRIGGER',limitOffsetPct:0.05});
 await h.bot.arm({price:78000,healthy:true,confirmation:'CHAP NHAN BTC FUTURES'});
 const signal={...h.signal,triggerPrice:77500,crossPrice:78500,candleClose:77900};
 await h.bot.placeLimit('LONG',78000,signal);
 assert.equal(Number(h.pending.price),77500);
 assert.equal(h.bot.cp.phase,'LIMIT_PENDING');
 assert.equal(h.calls.filter(x=>x.method==='POST'&&x.path==='/fapi/v1/order').length,1);
});

test('Exact trigger refuses marketable LIMIT without any Binance mutation',async()=>{
 const h=fixture();h.bot.setConfig({marginUSDT:70,entryMode:'LIMIT_PULLBACK',
  limitBasis:'OCC_TRIGGER'});
 await h.bot.arm({price:78000,healthy:true,confirmation:'CHAP NHAN BTC FUTURES'});
 await assert.rejects(h.bot.placeLimit('LONG',78000,{...h.signal,triggerPrice:78100}),
  /LIMIT không còn/);
 assert.equal(h.bot.cp.phase,'IDLE');
 assert.equal(h.calls.filter(x=>x.method!=='GET').length,0);
});

test('Filled exact-trigger LIMIT places STOP before TP1/TP2/TP3 from Binance avgPrice',async()=>{
 const h=fixture();h.bot.setConfig({marginUSDT:70,entryMode:'LIMIT_PULLBACK',
  limitBasis:'OCC_TRIGGER',limitWaitSeconds:90});
 await h.bot.arm({price:78000,healthy:true,confirmation:'CHAP NHAN BTC FUTURES'});
 await h.bot.placeLimit('LONG',78000,{...h.signal,triggerPrice:77500});
 h.fill(.004,true);
 await h.bot.monitor();
 assert.equal(h.bot.cp.phase,'PROTECTED');
 assert.equal(h.bot.cp.pendingLimit,null);
 const posts=h.calls.filter(x=>x.method==='POST');
 assert.deepEqual(posts.map(x=>x.p.type),
  ['LIMIT','STOP_MARKET','TAKE_PROFIT_MARKET','TAKE_PROFIT_MARKET','TAKE_PROFIT_MARKET']);
 assert.equal(h.bot.cp.entry.avg,77500);
 assert.equal(h.bot.cp.stop.price,76725);
});

test('LIMIT sits NEW without Binance STOP until actual execution; never sends MARKET fallback',async()=>{
 const h=fixture();await h.bot.arm({price:78000,healthy:true,
  confirmation:'CHAP NHAN BTC FUTURES'});
 await h.bot.placeLimit('LONG',78000,h.signal);
 assert.equal(h.bot.cp.phase,'LIMIT_PENDING');
 assert.ok(Number(h.pending.price)<78000);
 assert.equal(h.pending.timeInForce,'GTD');
 assert.equal(h.algos.length,0);
 assert.deepEqual(h.calls.filter(x=>x.method==='POST').map(x=>x.p.type),['LIMIT']);
 assert.equal(h.bot.cp.pendingLimit.expiresAt>h.bot.cp.pendingLimit.createdAt,true);
 await h.bot.monitor();
 assert.equal(h.bot.cp.phase,'LIMIT_PENDING');
});
test('Timed-out untouched LIMIT is cancelled before next signal with no live position',async()=>{
 const h=fixture();
 await h.bot.arm({price:78000,healthy:true,confirmation:'CHAP NHAN BTC FUTURES'});
 await h.bot.placeLimit('LONG',78000,h.signal);
 h.bot.cp.pendingLimit.expiresAt=Date.now()-1;
 await h.bot.monitor();
 assert.equal(h.bot.cp.phase,'IDLE');
 assert.equal(h.bot.cp.pendingLimit,null);
 assert.equal(h.calls.filter(x=>x.method==='DELETE'&&x.path==='/fapi/v1/order').length,1);
 assert.equal(h.algos.length,0);
});
test('Fully FILLED LIMIT must pass terminal readback before verified STOP and 3 TP orders',async()=>{
 const h=fixture();await h.bot.arm({price:78000,healthy:true,confirmation:'CHAP NHAN BTC FUTURES'});
 await h.bot.placeLimit('LONG',78000,h.signal);
 h.fill(.004,true);
 await h.bot.monitor();
 assert.equal(h.bot.cp.phase,'PROTECTED');
 assert.equal(h.bot.cp.entry.type,'LIMIT');
 assert.equal(h.bot.cp.stop.role,'SL');
 assert.deepEqual(Array.from(h.bot.cp.tps,x=>x.role),['TP1','TP2','TP3']);
 assert.equal(h.calls.filter(x=>x.method==='POST'&&x.path==='/fapi/v1/order'&&x.p.type==='MARKET').length,0);
});
test('PARTIALLY_FILLED LIMIT cancels remainder first; small fill gets only STOP, AUTO OFF',async()=>{
 const h=fixture();await h.bot.arm({price:78000,healthy:true,confirmation:'CHAP NHAN BTC FUTURES'});
 await h.bot.placeLimit('LONG',78000,h.signal);
 h.fill(.001,false);
 await h.bot.monitor();
 const mutation=h.calls.filter(x=>x.method!=='GET');
 assert.equal(mutation[1].method,'DELETE');
 assert.equal(mutation[1].path,'/fapi/v1/order');
 assert.equal(mutation[2].p.type,'STOP_MARKET');
 assert.equal(h.bot.cp.phase,'PROTECTED');
 assert.equal(h.bot.cp.stop.role,'SL');
 assert.equal(h.bot.cp.tps.length,0);
 assert.equal(h.bot.auto,false);
});
test('Wrong Binance order client ID halts, never cancels unknown order or installs STOP',async()=>{
 const h=fixture();await h.bot.arm({price:78000,healthy:true,confirmation:'CHAP NHAN BTC FUTURES'});
 await h.bot.placeLimit('LONG',78000,h.signal);
 h.pending.clientOrderId='FOREIGN';
 await h.bot.monitor();
 assert.equal(h.bot.cp.halted,true);
 assert.equal(h.bot.auto,false);
 assert.equal(h.calls.filter(x=>x.method==='DELETE').length,0);
 assert.equal(h.algos.length,0);
});
test('Restart with pending LIMIT keeps Auto OFF, reconciliation cancels order without opening a new one',async()=>{
 const h=fixture();await h.bot.arm({price:78000,healthy:true,confirmation:'CHAP NHAN BTC FUTURES'});
 await h.bot.placeLimit('LONG',78000,h.signal);
 const restored=fixture(h.saved);
 assert.equal(restored.bot.auto,false);
 assert.equal(restored.bot.cp.halted,true);
 // Restore mock exchange state as though the Binance order is still waiting.
 // This test checks that the app refuses auto re-arm before explicit reconcile.
 await assert.rejects(restored.bot.arm({price:78000,healthy:true,
  confirmation:'CHAP NHAN BTC FUTURES'}),/khóa an toàn/i);
 assert.equal(restored.calls.some(x=>x.method==='POST'),false);
});
test('Android native lease authorizes only GTD LIMIT entry and checkpoint-matched cancel',()=>{
 const java=readFileSync(new URL('../android/app/src/main/java/com/occtrading/mobile/MainActivity.java',import.meta.url),'utf8');
 assert.match(java,/LIMIT_SENDING".equals\(phase\).*"LIMIT_ENTRY".equals\(kind\)/);
 assert.match(java,/GTD".equals\(p.optString\("timeInForce"\)\)/);
 assert.match(java,/goodTillDate>System.currentTimeMillis\(\)\+600000/);
 assert.match(java,/LIMIT_CANCEL_SENDING".equals\(phase\)/);
 assert.match(java,/origClientOrderId/);
});
