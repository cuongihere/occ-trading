import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const read=p=>readFileSync(new URL('../android/app/src/main/assets/'+p,import.meta.url),'utf8');
function harness(initial=null,options={}){
 const context={window:{},console,Date,Math,Set,Number,Error,JSON};
 for(const name of ['trade-core.js','trade-execution.js','trade-recovery.js'])
  runInNewContext(read(name),context,{filename:name});
 let persistent=initial||'',index=0;
 const calls=[],orders=[],algos=[],finished=[],pos={qty:0,entry:78000,side:null},cfg={leverage:5};
 const api=async(method,path,params={})=>{
  calls.push({method,path,params:{...params}});
  if(method==='GET'){
   if(path==='/fapi/v2/account')return {canTrade:true,assets:[{asset:'USDT',
     availableBalance:'800'}]};
   if(path==='/fapi/v3/positionRisk')return pos.qty?[{symbol:'BTCUSDT',
     positionSide:'BOTH',positionAmt:String(pos.side==='LONG'?pos.qty:-pos.qty),
     entryPrice:String(pos.entry)}]:[];
   if(path==='/fapi/v1/openOrders')return [];
   if(path==='/fapi/v1/openAlgoOrders')return algos.map(x=>({...x}));
   if(path==='/fapi/v1/positionSide/dual')return {dualSidePosition:false};
   if(path==='/fapi/v1/symbolConfig')return [{symbol:'BTCUSDT',marginType:'ISOLATED',
      leverage:cfg.leverage}];
   if(path==='/fapi/v1/algoOrder'){
    const a=finished.find(x=>String(x.algoId)===String(params.algoId));
    if(!a)throw Error('Algo not finished');return {...a};
   }
   if(path==='/fapi/v1/order'){
    const order=orders.find(x=>String(x.orderId)===String(params.orderId));
    if(!order)throw Error('Unknown order');return {...order};
   }
   throw Error('Unexpected GET '+path);
  }
  if(method==='POST'&&path==='/fapi/v1/leverage'){
   cfg.leverage=params.leverage;return {leverage:cfg.leverage};
  }
  if(method==='POST'&&path==='/fapi/v1/order'){
   if(options.failEntry)throw Error('Entry ACK ambiguous');
   const close=params.reduceOnly==='true';
   const qty=Number(params.quantity),id=String(2000+orders.length);
   if(close){pos.qty=Number((pos.qty-qty).toFixed(8));if(pos.qty===0)pos.side=null;}
   else {pos.side=params.side==='BUY'?'LONG':'SHORT';pos.qty=qty;pos.entry=78000;}
   const item={symbol:'BTCUSDT',orderId:id,clientOrderId:params.newClientOrderId,
    side:params.side,positionSide:'BOTH',type:'MARKET',status:'FILLED',
    executedQty:params.quantity,avgPrice:'78000',reduceOnly:close};
   orders.push(item);return {...item};
  }
  if(method==='POST'&&path==='/fapi/v1/algoOrder'){
   if(options.failStop&&params.type==='STOP_MARKET')throw Error('STOP ACK ambiguous');
   const item={...params,algoId:String(3000+algos.length),algoStatus:'NEW',
    orderType:params.type,closePosition:params.closePosition==='true',
    reduceOnly:params.reduceOnly==='true'};
   algos.push(item);return {algoId:item.algoId,clientAlgoId:item.clientAlgoId};
  }
  if(method==='DELETE'&&path==='/fapi/v1/algoOrder'){
   const i=algos.findIndex(x=>String(x.algoId)===String(params.algoId));
   if(i<0)throw Error('Algo not found');algos.splice(i,1);return {};
  }
  throw Error('Unexpected mutation '+method+' '+path);
 };
 const bot=new context.window.OCCMobileTrade({signed:api,publicGet:async()=>({
  symbols:[{symbol:'BTCUSDT',contractType:'PERPETUAL',status:'TRADING',filters:[
   {filterType:'MARKET_LOT_SIZE',stepSize:'.001',minQty:'.001'},
   {filterType:'PRICE_FILTER',tickSize:'.1'},
   {filterType:'MIN_NOTIONAL',notional:'5'}]}]
 }),load:()=>persistent,save:v=>(persistent=v,true),
 newId:()=> 'OCCBTC-'+String(++index).padStart(14,'0'),
 report:()=>{}});
 bot.connected=true;
 if(bot.cp.phase==='IDLE')bot.setConfig({marginUSDT:70});
 return {bot,calls,algos,finished,pos,orders,getSaved:()=>JSON.parse(persistent)};
}
async function ready(h){
 await h.bot.arm({price:78000,healthy:true,confirmation:'CHAP NHAN BTC FUTURES'});
 await h.bot.enter('LONG',78000,'signal-1');
}
test('Auto never restores ON after restart, including when exchange checkpoint is PROTECTED',async()=>{
 const h=harness();await ready(h);
 assert.equal(h.bot.cp.phase,'PROTECTED');
 const again=harness(JSON.stringify(h.getSaved()));
 assert.equal(again.bot.auto,false);assert.equal(again.bot.cp.halted,true);
});
test('Verified Entry first, STOP second, and three TP conditional orders; no duplicate signal',async()=>{
 const h=harness();await ready(h);
 assert.equal(h.bot.cp.phase,'PROTECTED');assert.equal(h.bot.cp.stop.role,'SL');
 assert.deepEqual(Array.from(h.bot.cp.tps,x=>x.role),['TP1','TP2','TP3']);
 assert.deepEqual(h.calls.filter(x=>x.method==='POST').map(x=>x.path),
  ['/fapi/v1/order',...Array(4).fill('/fapi/v1/algoOrder')]);
 assert.equal(await h.bot.onSignal({side:'LONG',eligible:true,barTime:900000},78000,true),false);
 assert.equal(h.calls.filter(x=>x.path==='/fapi/v1/order'&&x.method==='POST').length,1);
});
test('Ambiguous STOP response locks executor without replay or further TP placement',async()=>{
 const h=harness(null,{failStop:true});
 await h.bot.arm({price:78000,healthy:true,confirmation:'CHAP NHAN BTC FUTURES'});
 await assert.rejects(h.bot.enter('LONG',78000,'signal-2'),/STOP ACK ambiguous/);
 assert.equal(h.bot.cp.halted,true);assert.equal(h.bot.auto,false);
 assert.equal(h.calls.filter(x=>x.method==='POST'&&x.path==='/fapi/v1/algoOrder').length,1);
 assert.equal(h.calls.filter(x=>x.method==='POST'&&x.path==='/fapi/v1/order').length,2);
 assert.equal(h.pos.qty,0);
 assert.equal(h.calls.filter(x=>x.method==='POST'&&x.path==='/fapi/v1/order')
  .at(-1).params.reduceOnly,'true');
});
test('Manual TP1 cancels verified Algo before MARKET reduce-only; keeps STOP and other TP',async()=>{
 const h=harness();await ready(h);
 const before=h.calls.length,closed=await h.bot.manualClose('TP1');
 assert.equal(closed.qty,.001);assert.equal(closed.remaining,.003);
 assert.equal(h.bot.cp.phase,'PROTECTED');assert.equal(h.bot.cp.tps.length,2);
 const ops=h.calls.slice(before).filter(x=>x.method!=='GET').map(x=>x.method+' '+x.path);
 assert.deepEqual(ops,['DELETE /fapi/v1/algoOrder','POST /fapi/v1/order']);
 assert.equal(h.algos.some(x=>x.orderType==='STOP_MARKET'),true);
});
test('Manual ALL verifies FLAT, cancels owned old Algo only and clears checkpoint',async()=>{
 const h=harness();await ready(h);
 const result=await h.bot.manualClose('ALL');
 assert.equal(result.remaining,0);assert.equal(h.pos.qty,0);
 assert.equal(h.algos.length,0);assert.equal(h.bot.cp.phase,'IDLE');
 assert.equal(h.bot.cp.entry,null);
});
test('Foreign Algo blocks manual close before any mutation',async()=>{
 const h=harness();await ready(h);
 h.algos.push({symbol:'BTCUSDT',algoId:'999999',clientAlgoId:'external',
   orderType:'STOP_MARKET',side:'SELL',algoStatus:'NEW',closePosition:true});
 const mutations=h.calls.filter(x=>x.method!=='GET').length;
 await assert.rejects(h.bot.manualClose('ALL'),/Algo/);
 assert.equal(h.calls.filter(x=>x.method!=='GET').length,mutations);
});
test('TP1 exchange execution is verified before remaining BTC is recognized',async()=>{
 const h=harness();await ready(h);
 const leg=h.bot.cp.tps.find(x=>x.role==='TP1');
 const idx=h.algos.findIndex(x=>String(x.algoId)===leg.id);
 const algo=h.algos.splice(idx,1)[0];
 const childId='7001';
 h.orders.push({symbol:'BTCUSDT',orderId:childId,clientOrderId:'BINANCE-TP1',
  status:'FILLED',type:'MARKET',side:'SELL',positionSide:'BOTH',
  executedQty:String(leg.qty),reduceOnly:true});
 h.finished.push({...algo,algoStatus:'FINISHED',actualOrderId:childId});
 h.pos.qty=Number((h.pos.qty-leg.qty).toFixed(8));
 await h.bot.monitor();
 assert.equal(h.bot.cp.halted,false);
 assert.equal(h.bot.cp.phase,'PROTECTED');
 assert.equal(h.bot.cp.tps.length,2);
 assert.equal(h.bot.cp.fills[0].role,'TP1');
 assert.equal(h.bot.cp.fills[0].qty,leg.qty);
});
