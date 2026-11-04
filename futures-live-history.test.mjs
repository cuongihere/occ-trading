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
    positionSide:'BOTH',status:'FILLED',side:'BUY',reduceOnly:false},
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
