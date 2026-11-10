import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LiveStatsLedger,readLiveReport} from './binance-live-stats.mjs';
import {syncOCCLiveHistory,fetchExchangeTrades7Days,fetchWindowedOrderHistory,fetchExchangeTrades30Days} from './futures-live-history.mjs';

const prefix='OCCBTC-0123456789abcd',pathFor=t=>{
 const dir=mkdtempSync(join(tmpdir(),'occ-history-'));
 t.after(()=>rmSync(dir,{force:true,recursive:true}));
 return join(dir,'live.sqlite');
};
const trade=(id,orderId,side,qty,realized,fee,price)=>({
 symbol:'BTCUSDT',id,orderId,side,qty:String(qty),price:String(price),
 realizedPnl:String(realized),commission:String(fee),commissionAsset:'USDT',time:1730000000000+id
});
function reader(){
 const calls=[],fills={
  '101':[trade(1,101,'BUY',.004,0,.15,78000)],
  '202':[trade(2,202,'SELL',.004,-3,.15,77250)]
 };
 return {calls,async get(path,p={}){
  calls.push({path,p});
  if(path==='/fapi/v1/allOrders')return [
   {symbol:'BTCUSDT',orderId:101,clientOrderId:prefix,type:'MARKET',
    positionSide:'BOTH',status:'FILLED',executedQty:'.004',side:'BUY',reduceOnly:false},
   {symbol:'BTCUSDT',orderId:999,clientOrderId:'manual',type:'MARKET',
    positionSide:'BOTH',status:'FILLED',side:'BUY',reduceOnly:false}
  ];
  if(path==='/fapi/v1/allAlgoOrders')return [{
   symbol:'BTCUSDT',positionSide:'BOTH',algoId:201,clientAlgoId:prefix+'-SL',
   actualOrderId:'202',side:'SELL',algoStatus:'FINISHED',orderType:'STOP_MARKET'
  }];
  if(path==='/fapi/v1/order'){
   if(String(p.orderId)==='202')return {symbol:'BTCUSDT',orderId:202,
    side:'SELL',status:'FILLED',executedQty:'.004'};
   throw Error('Unexpected order '+p.orderId);
  }
  if(path==='/fapi/v1/userTrades')return fills[String(p.orderId)]||[];
  throw Error('Unexpected Binance read '+path);
 }};
}
test('Full real OCC Entry and STOP history is backfilled from Binance and durable after restart',async t=>{
 const path=pathFor(t);let ledger=new LiveStatsLedger(path),api=reader();
 const done=await syncOCCLiveHistory(api,ledger);
 assert.equal(done.discovered,2);
 assert.equal(done.newFills,2);
 assert.equal(done.report.summary.closed,1);
 assert.equal(done.report.summary.losses,1);
 assert.ok(Math.abs(done.report.positions[0].netExFundingUSDT-(-3.3))<1e-9);
 assert.deepEqual(done.report.positions[0].exitReasons,['SL']);
 assert.equal(done.report.registeredOrders,2);
 ledger.close();
 const report=readLiveReport(path);
 assert.equal(report.summary.closed,1);
 ledger=new LiveStatsLedger(path);
 api=reader();
 const repeat=await syncOCCLiveHistory(api,ledger);
 assert.equal(repeat.discovered,0);
 assert.equal(repeat.newFills,0);
 ledger.close();
});
test('Unknown manual orders never appear in OCC stats',async t=>{
 const ledger=new LiveStatsLedger(pathFor(t));
 const api=reader();
 await syncOCCLiveHistory(api,ledger);
 assert.equal(ledger.orders().length,2);
 assert.ok(!ledger.orders().some(x=>x.order_id==='999'));
 ledger.close();
});
test('Prior SQLite ledgers without synced_at migrate without losing verified fills',t=>{
 const path=pathFor(t),ledger=new LiveStatsLedger(path);
 ledger.register({orderId:101,groupId:prefix,clientId:prefix,role:'ENTRY',side:'BUY'});
 ledger.ingest([trade(1,101,'BUY',.004,0,.15,78000)]);
 ledger.close();
 const upgraded=new LiveStatsLedger(path);
 assert.equal(upgraded.orders()[0].synced_at,0);
 upgraded.markChecked(101,123456);
 assert.equal(upgraded.orders()[0].synced_at,123456);
 assert.equal(upgraded.report().summary.open,1);
 upgraded.close();
});

test('Crash before ACK registration can recover manual TP2 MARKET order from durable close client id',async t=>{
 const ledger=new LiveStatsLedger(pathFor(t)),api=reader();
 const savedGet=api.get.bind(api);
 const client='OCCBTC-abcdef12345678';
 api.get=async(path,params={})=>{
  if(path==='/fapi/v1/order'&&params.origClientOrderId===client)
   return {symbol:'BTCUSDT',orderId:809,clientOrderId:client,side:'SELL',
    type:'MARKET',positionSide:'BOTH',reduceOnly:true,status:'FILLED',executedQty:'.001'};
  if(path==='/fapi/v1/userTrades'&&String(params.orderId)==='809')
   return [trade(9,809,'SELL',.001,1.2,.03,79200)];
  return savedGet(path,params);
 };
 const out=await syncOCCLiveHistory(api,ledger,{
  intent:{oldClientId:prefix,closeId:client,role:'TP2',phase:'MANUAL_MARKET_SENDING'}
 });
 assert.ok(out.discovered>=3);
 const exit=ledger.orders().find(x=>x.order_id==='809');
 assert.equal(exit.group_id,prefix);
 assert.equal(exit.role,'TP2');
 assert.equal(exit.side,'SELL');
 assert.equal(out.newFills,3);
 ledger.close();
});

test('Binance Income audit calls read-only income endpoint and persists Realized/Commission/Funding separately',async t=>{
 const ledger=new LiveStatsLedger(pathFor(t)),api=reader(),original=api.get.bind(api),now=Date.now();
 api.get=async(path,params={})=>{
  if(path==='/fapi/v1/income'){
   assert.equal(params.symbol,'BTCUSDT');
   assert.equal(params.limit,1000);
   assert.ok(params.endTime-params.startTime<=7*86400000);
   return [
    {symbol:'BTCUSDT',tranId:8121,tradeId:'1',incomeType:'COMMISSION',
      income:'-0.15',asset:'USDT',time:now-2000},
    {symbol:'BTCUSDT',tranId:8122,tradeId:'2',incomeType:'COMMISSION',
      income:'-0.15',asset:'USDT',time:now-1900},
    {symbol:'BTCUSDT',tranId:8123,tradeId:'2',incomeType:'REALIZED_PNL',
      income:'-3',asset:'USDT',time:now-1900},
    {symbol:'BTCUSDT',tranId:8124,tradeId:'',incomeType:'FUNDING_FEE',
      income:'-0.2',asset:'USDT',time:now-1800}
   ];
  }
  return original(path,params);
 };
 const r=await syncOCCLiveHistory(api,ledger,{syncIncome:true});
 assert.equal(r.incomeUpdated,true);
 assert.equal(r.newIncome,4);
 assert.equal(r.report.incomeAudit.fundingUSDT,-.2);
 assert.equal(r.report.summary.closed,1);
 const second=await syncOCCLiveHistory(api,ledger,{syncIncome:true});
 assert.equal(second.newIncome,0);
 ledger.close();
});

test('Terminal partially-filled canceled OCC LIMIT is discovered by actual executed quantity',async t=>{
 const ledger=new LiveStatsLedger(pathFor(t)),base=reader(),old=base.get.bind(base);
 const limitId='OCCBTC-3456789012abcd';
 base.get=async(path,p={})=>{
  if(path==='/fapi/v1/allOrders')return [{
   symbol:'BTCUSDT',orderId:4242,clientOrderId:limitId,type:'LIMIT',
   positionSide:'BOTH',status:'CANCELED',executedQty:'.001',
   origQty:'.004',side:'BUY',reduceOnly:false
  }];
  if(path==='/fapi/v1/userTrades'&&String(p.orderId)==='4242')
   return [trade(42,4242,'BUY',.001,0,.03,77000)];
  return old(path,p);
 };
 const result=await syncOCCLiveHistory(base,ledger);
 assert.ok(result.discovered>=2);
 const order=ledger.orders().find(o=>o.order_id==='4242');
 assert.ok(order);
 assert.equal(order.role,'ENTRY');
 assert.equal(order.group_id,limitId);
 ledger.close();
});

test('Full seven-day userTrades scan partitions saturated Binance pages and never loses yesterday losses',async t=>{
 const now=Date.now(),start=now-7*86400000+1000;
 const trades=Array.from({length:1450},(_,i)=>({
  symbol:'BTCUSDT',id:100000+i,orderId:900000+i,side:'SELL',
  qty:'.001',price:'75000',realizedPnl:i===1449?'-2.4':'0',
  commission:'.04',commissionAsset:'USDT',
  time:start+Math.floor((6*86400000*i)/1450)
 }));
 const calls=[],api={async get(endpoint,p={}){
  calls.push({endpoint,p});
  if(endpoint==='/fapi/v1/userTrades'){
   if(p.orderId)return trades.filter(x=>String(x.orderId)===String(p.orderId));
   return trades.filter(x=>x.time>=p.startTime&&x.time<=p.endTime).slice(0,1000);
  }
  if(endpoint==='/fapi/v1/allOrders'||endpoint==='/fapi/v1/allAlgoOrders')return [];
  throw Error('Unexpected '+endpoint);
 }};
 const ledger=new LiveStatsLedger(pathFor(t));
 const result=await syncOCCLiveHistory(api,ledger,{syncExchangeTrades:true});
 assert.equal(result.exchangeTradesUpdated,true);
 assert.equal(result.newExchangeFills,1450);
 assert.ok(result.accountRequests>=3);
 assert.equal(ledger.exchangeFills().length,1450);
 assert.equal(ledger.report().exchangeHistory.unmatchedRealizedOrderCount,1);
 assert.equal(ledger.report().exchangeHistory.unmatchedRealizedOrders[0].realizedUSDT,-2.4);
 assert.equal(ledger.report().summary.closed,0);
 assert.equal(calls.filter(x=>x.endpoint==='/fapi/v1/userTrades'&&x.p.startTime!=null)
  .every(x=>x.p.endTime-x.p.startTime<=7*86400000),true);
 ledger.close();
});

test('A truncated or inconsistent account scan does not publish partial Binance audit',async t=>{
 const ledger=new LiveStatsLedger(pathFor(t));
 const api={async get(path,p={}){
  if(path==='/fapi/v1/allOrders'||path==='/fapi/v1/allAlgoOrders')return [];
  if(path==='/fapi/v1/userTrades'&&p.startTime!==undefined)
   return [{symbol:'BTCUSDT',id:1,orderId:33,side:'SELL',qty:'.001',
    price:'75000',realizedPnl:'-1',commission:'.1',commissionAsset:'USDT',time:p.endTime+5}];
  throw Error('unexpected '+path);
 }};
 const result=await syncOCCLiveHistory(api,ledger,{syncExchangeTrades:true});
 assert.equal(result.exchangeTradesUpdated,false);
 assert.equal(ledger.exchangeCheckedAt(),null);
 assert.equal(ledger.exchangeFills().length,0);
 assert.ok(result.warnings.some(x=>x.includes('userTrades 30 ngày')));
 ledger.close();
});

test('Ten-day old BTC losing STOP is automatically recovered via explicit 30-day Algo/Entry history',async t=>{
 const now=Date.now(),old=now-10*86400000,group='OCCBTC-fedcba98765432';
 const income=(tranId,tradeId,incomeType,value)=>({
  symbol:'BTCUSDT',tranId,tradeId,incomeType,income:String(value),asset:'USDT',time:old+90000
 });
 const calls=[];
 const api={async get(path,p={}){
  calls.push({path,p});
  if(path==='/fapi/v1/allOrders'){
   return p.startTime<=old&&old<=p.endTime?[{
    symbol:'BTCUSDT',orderId:81001,clientOrderId:group,type:'MARKET',
    positionSide:'BOTH',status:'FILLED',executedQty:'.004',side:'BUY',reduceOnly:false
   }]:[];
  }
  if(path==='/fapi/v1/allAlgoOrders'){
   return p.startTime<=old&&old<=p.endTime?[{
    symbol:'BTCUSDT',algoId:91001,clientAlgoId:group+'-SL',
    positionSide:'BOTH',side:'SELL',algoStatus:'FINISHED',
    actualOrderId:'81002',orderType:'STOP_MARKET',createTime:old
   }]:[];
  }
  if(path==='/fapi/v1/order'&&String(p.orderId)==='81002')return {
   symbol:'BTCUSDT',orderId:81002,side:'SELL',positionSide:'BOTH',
   status:'FILLED',executedQty:'.004'
  };
  if(path==='/fapi/v1/userTrades'&&p.orderId)return String(p.orderId)==='81001'?
   [{symbol:'BTCUSDT',id:101001,orderId:81001,side:'BUY',qty:'.004',
     price:'75000',realizedPnl:'0',commission:'.12',commissionAsset:'USDT',time:old+2000}]:
   [{symbol:'BTCUSDT',id:101002,orderId:81002,side:'SELL',qty:'.004',
     price:'74200',realizedPnl:'-3.2',commission:'.14',commissionAsset:'USDT',time:old+60000}];
  if(path==='/fapi/v1/userTrades'&&p.startTime!=null){
   return p.startTime<=old+2000&&old+2000<=p.endTime?[
    {symbol:'BTCUSDT',id:101001,orderId:81001,side:'BUY',qty:'.004',
     price:'75000',realizedPnl:'0',commission:'.12',commissionAsset:'USDT',time:old+2000},
    {symbol:'BTCUSDT',id:101002,orderId:81002,side:'SELL',qty:'.004',
     price:'74200',realizedPnl:'-3.2',commission:'.14',commissionAsset:'USDT',time:old+60000}
   ]:[];
  }
  if(path==='/fapi/v1/income')return p.startTime<=old&&old<=p.endTime?[
   income(201001,'101001','COMMISSION',-.12),
   income(201002,'101002','COMMISSION',-.14),
   income(201003,'101002','REALIZED_PNL',-3.2)
  ]:[];
  throw Error('Unexpected mock Binance endpoint '+path);
 }};
 const ledger=new LiveStatsLedger(pathFor(t));
 const result=await syncOCCLiveHistory(api,ledger,{syncIncome:true,syncExchangeTrades:true});
 assert.equal(result.discovered,2);
 assert.equal(result.report.summary.closed,1);
 assert.equal(result.report.summary.losses,1);
 assert.equal(result.report.summary.open,0);
 assert.equal(result.report.positions[0].entryOrderId,'81001');
 assert.deepEqual(result.report.positions[0].exitOrderIds,['81002']);
 assert.equal(result.report.positions[0].auditStatus,'MATCHED');
 assert.equal(result.report.incomeAudit30.complete30d,true);
 assert.ok(Math.abs(result.report.incomeAudit30.totalUSDT+3.46)<1e-8);
 assert.equal(result.report.incomeAudit.available,false);
 assert.ok(calls.some(x=>x.path==='/fapi/v1/allAlgoOrders'&&
  x.p.startTime<=old&&old<=x.p.endTime));
 assert.ok(calls.filter(x=>x.path==='/fapi/v1/allAlgoOrders')
  .every(x=>x.p.endTime-x.p.startTime<7*86400000));
 ledger.close();
});

test('Historical order pagination scans older BTC stop and rejects any saturated unsplittable page',async()=>{
 const now=Date.now(),target=now-12*86400000;
 const api={async get(path,p){
  if(path==='/fapi/v1/allAlgoOrders')return p.startTime<=target&&target<=p.endTime?[{
   symbol:'BTCUSDT',algoId:77,clientAlgoId:'OCCBTC-00112233445566-SL',
   actualOrderId:'88',positionSide:'BOTH',side:'SELL'
  }]:[];
  throw Error('Unexpected');
 }};
 const response=await fetchWindowedOrderHistory(api,'/fapi/v1/allAlgoOrders',{now});
 assert.equal(response.rows.length,1);
 assert.equal(response.rows[0].actualOrderId,'88');
 assert.ok(response.calls>=5);
});
