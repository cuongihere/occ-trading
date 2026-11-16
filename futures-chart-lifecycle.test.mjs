import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {buildVerifiedTradeSequences} from './futures-chart-lifecycle.mjs';
const A='OCCBTC-aaaaaaaaaaaaaa',B='OCCBTC-bbbbbbbbbbbbbb',C='OCCBTC-cccccccccccccc';
const group=(id,side,at,entry,status='CLOSED')=>({
 groupId:id,side,entryTime:at,entryPrice:entry,entryOrderId:id===A?'101':id===B?'201':'301',
 status,netExFundingUSDT:side==='LONG'?-2.5:5.2,
 signalStatus:'HISTORICAL_SIGNAL_UNVERIFIED'
});
const fill=(id,order,role,side,time,price,qty=.004,realized=0,fee=.1)=>({
 groupId:id,orderId:String(order),fillId:String(order),role,
 side,time,price,qty,realized,fee,asset:'USDT'
});
test('LONG ENTRY → actual SL fill → later SHORT Entry is drawn without inventing automatic reverse',()=>{
 const time=1_800_000_000_000;
 const gs=[group(A,'LONG',time,74505),group(B,'SHORT',time+3_600_000,75087)];
 const fs=[
  fill(A,101,'ENTRY','BUY',time,74505),
  fill(A,102,'SL','SELL',time+20*60_000,73909,.004,-2.4),
  fill(B,201,'ENTRY','SELL',time+3_600_000,75087),
  fill(B,202,'TP1','BUY',time+4_200_000,73500,.004,6.3)
 ];
 const sequence=buildVerifiedTradeSequences(gs,fs);
 assert.equal(sequence.length,2);
 assert.deepEqual(sequence[0].events.map(x=>x.role),['ENTRY','SL']);
 assert.equal(sequence[0].events[0].label,'LONG ENTRY');
 assert.equal(sequence[0].events[1].label,'SL HIT');
 assert.equal(sequence[1].events[0].label,'SHORT ENTRY');
 assert.equal(sequence[0].transitions[0].kind,'SL_THEN_LATER_OPPOSITE_ENTRY');
 assert.equal(sequence[0].transitions[0].verifiedOrders,true);
 assert.equal(sequence[0].transitions[0].verifiedReversalCausality,false);
 assert.equal(sequence[0].exits[0].orderId,'102');
 assert.equal(sequence[1].exits[0].role,'TP1');
});
test('REVERSE role followed by promptly verified opposite Entry is labeled as execution sequence, not signal proof',()=>{
 const time=1_800_000_000_000,gs=[group(A,'LONG',time,74500),group(B,'SHORT',time+90_000,74950)];
 const rows=[
  fill(A,101,'ENTRY','BUY',time,74500),
  fill(A,112,'REVERSE','SELL',time+60_000,74945),
  fill(B,201,'ENTRY','SELL',time+90_000,74950)
 ];
 const out=buildVerifiedTradeSequences(gs,rows);
 assert.equal(out[0].exits[0].label,'REVERSE CLOSE');
 assert.equal(out[0].transitions[0].kind,'REVERSE_CLOSE_THEN_OPPOSITE_ENTRY');
 assert.equal(out[0].transitions[0].verifiedReversalCausality,false);
 assert.equal(out[1].transitions[0].toGroupId,B);
});
test('Partial TP fills of one Binance Order ID are combined by quantity-weighted fill price',()=>{
 const t=1_800_000_000_000,gs=[group(A,'LONG',t,74500)];
 const fs=[
  fill(A,101,'ENTRY','BUY',t,74500),
  fill(A,102,'TP1','SELL',t+5000,75200,.001,.7,.03),
  fill(A,102,'TP1','SELL',t+5100,75300,.001,.8,.03),
  fill(A,103,'SL','SELL',t+10_000,73900,.002,-1.2,.05)
 ];
 const out=buildVerifiedTradeSequences(gs,fs);
 assert.equal(out[0].exits.length,2);
 assert.equal(out[0].exits.find(x=>x.role==='TP1').qtyBTC,.002);
 assert.equal(out[0].exits.find(x=>x.role==='TP1').price,75250);
 assert.equal(out[0].exits.find(x=>x.role==='TP1').realizedUSDT,1.5);
});
test('Never draw unregistered or invalid fills as an OCC event',()=>{
 const t=1_800_000_000_000,gs=[group(A,'LONG',t,74500)];
 const fs=[
  fill(A,101,'ENTRY','BUY',t,74500),
  fill(A,'manual-id','SL','SELL',t+1000,74000),
  fill('MANUAL',111,'SL','SELL',t+1100,74100),
  {...fill(A,555,'SL','SELL',t+1200,74000),qty:0}
 ];
 const out=buildVerifiedTradeSequences(gs,fs);
 assert.equal(out.length,1);
 assert.equal(out[0].events.length,1);
 assert.equal(out[0].transitions.length,0);
});
test('One-screen chart exposes large readable selected-order inspector and trade-chain label hits',()=>{
 const html=readFileSync(new URL('./OCC_COMPARE.html',import.meta.url),'utf8');
 const server=readFileSync(new URL('./server.mjs',import.meta.url),'utf8');
 const comparison=readFileSync(new URL('./futures-chart-compare.mjs',import.meta.url),'utf8');
 for(const id of ['tradeInspector','inspectorContent','inspectorMode',
   'inspectorFocus','inspectorClear','chartHistory','historyGroups','execution'])
  assert.match(html,new RegExp('id="'+id+'"'));
 for(const keyword of ['REVERSE CLOSE','SL HIT','SAU SL','LỆNH TIẾP THEO',
  'Order ID','BTC khớp','TÍN HIỆU OCC','Giá khớp','CHUỖI LỆNH BINANCE'])
  assert.ok(html.includes(keyword),keyword);
 assert.match(html,/html\.embed\.realonly \.grid\{display:grid!important/);
 assert.match(html,/function renderInspector\(/);
 assert.match(html,/function hitFor|const hitFor=/);
 assert.match(html,/markerHits\.push\(point\)/);
 assert.match(html,/focusAt=hit\.event\.time/);
 assert.match(comparison,/tradeSequences:buildVerifiedTradeSequences/);
 assert.match(server,/readVerifiedChartHistory/);
 const scripts=[...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)];
 assert.ok(scripts.length>=2);
 for(const m of scripts)assert.doesNotThrow(()=>new Function(m[1]));
});
