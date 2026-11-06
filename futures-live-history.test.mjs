import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LiveStatsLedger,readLiveReport} from './binance-live-stats.mjs';
import {syncOCCLiveHistory} from './futures-live-history.mjs';

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
