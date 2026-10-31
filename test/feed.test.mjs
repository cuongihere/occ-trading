import test from 'node:test';
import assert from 'node:assert/strict';
import {BinanceFeed} from '../server-feed.mjs';
// Controlled test fixtures only. No network access and no fixture path in production.
const BASE = 1800000900000;
function fixture() {
  let now=BASE;
  const seen={trades:[],candles:[],states:[],marks:[]};
  const feed=new BinanceFeed({clock:()=>now,onTrade:x=>seen.trades.push(x),onCandle:(x,o)=>seen.candles.push([x,o]),onStatus:x=>seen.states.push(x),onMark:x=>seen.marks.push(x)});
  feed.lastClosed=BASE-1800000;
  const trade=(id=1,t=now)=>({e:'aggTrade',E:t,T:t,s:'BTCUSDT',a:id,p:'50000'});
  const kline=(closed=false)=>({e:'kline',E:now,s:'BTCUSDT',k:{i:'15m',x:closed,t:BASE-900000,T:BASE-1,o:'50000',c:'50001'}});
  return {feed,seen,trade,kline,advance:ms=>now+=ms};
}
test('buffered history never becomes a trade; live trade dedup and audit timestamps',()=>{
  const {feed,seen,trade,kline}=fixture();
  feed.consume(kline()); feed.consume(trade(1),false,BASE-1);
  assert.equal(seen.trades.length,0);
  feed.consume(trade(2),true,BASE);
  assert.equal(seen.trades.length,1);assert.equal(seen.trades[0].receivedAt,BASE);assert.equal(seen.trades[0].exchangeAt,BASE);
  feed.consume(trade(2));assert.equal(seen.trades.length,1);assert.equal(feed.healthy(),true);
});
test('closed candles are deduplicated and backfill is explicitly not live',()=>{
  const {feed,seen,trade,kline}=fixture();feed.consume(kline());feed.consume(trade());
  feed.consume(kline(true),false,BASE);feed.consume(kline(true),true,BASE);
  assert.equal(seen.candles.length,1);assert.equal(seen.candles[0][1].live,false);
  assert.equal(seen.candles[0][1].receivedAt,BASE);assert.equal(seen.candles[0][1].exchangeAt,BASE);
});
test('stale event cannot fill and health expires on controlled clock',()=>{
  const {feed,seen,trade,kline,advance}=fixture();feed.consume(kline());feed.consume(trade());advance(11000);
  assert.equal(feed.healthy(),false);feed.consume(trade(2,BASE));assert.equal(seen.trades.length,1);
});
test('wrong contract is rejected and gap does not emit a candle',()=>{
  const {feed,seen,kline}=fixture();assert.throws(()=>feed.consume({...kline(),s:'ETHUSDT'}),/Sai hợp đồng/);
  const d=kline(true);d.k.t+=900000;feed.consume(d);assert.equal(seen.candles.length,0);
});
test('HTTP 451 is visibly blocked and terminal without automatic regional bypass',async()=>{
  const original=globalThis.fetch;let requests=0;
  globalThis.fetch=async url=>{requests++;assert.equal(url,'https://fapi.binance.com/fapi/v1/time');return {ok:false,status:451};};
  const {feed,seen}=fixture();
  try {await feed.connect();assert.equal(requests,1);assert.equal(feed.state,'blocked');assert.equal(feed.manual,true);assert.equal(feed.retry,undefined);assert.match(seen.states.at(-1).message,/451/);}
  finally {feed.disconnect();globalThis.fetch=original;}
});
test('transient failure schedules bounded backoff and disconnect cancels retry',async()=>{
  const original=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('temporary test failure');};
  const {feed}=fixture();
  try {await feed.connect();assert.equal(feed.state,'stale');assert.ok(feed.retry);assert.equal(feed.failures,1);feed.disconnect();assert.equal(feed.manual,true);assert.equal(feed.state,'disconnected');}
  finally {feed.disconnect();globalThis.fetch=original;}
});
test('WebSocket envelope is audited before downstream trade callback',async()=>{
  const oldFetch=globalThis.fetch,oldWS=globalThis.WebSocket;const order=[];let socket;
  globalThis.fetch=async url=>({ok:true,json:async()=>url.endsWith('/time')?{serverTime:BASE}:url.endsWith('/exchangeInfo')?{symbols:[{symbol:'BTCUSDT',contractType:'PERPETUAL',status:'TRADING',filters:[{filterType:'LOT_SIZE',stepSize:'0.001',minQty:'0.001'},{filterType:'MIN_NOTIONAL',notional:'100'},{filterType:'PRICE_FILTER',tickSize:'0.10'}]}]}:[[BASE-900000,'50000','50001','49999','50000','1',BASE-1]]});
  globalThis.WebSocket=class {constructor(url){assert.match(url,/^wss:\/\/fstream\.binance\.com\/market\/stream\?/);socket=this;queueMicrotask(()=>this.onopen?.());}close(){}};
  const f=new BinanceFeed({clock:()=>BASE,onRaw:x=>{order.push('raw');assert.equal(x.receivedAt,BASE);assert.equal(x.exchangeAt,BASE);},onTrade:()=>order.push('trade')});
  try {await f.connect();socket.onmessage({data:JSON.stringify({data:{e:'kline',E:BASE,s:'BTCUSDT',k:{i:'15m',x:false}}})});socket.onmessage({data:JSON.stringify({data:{e:'aggTrade',E:BASE,T:BASE,s:'BTCUSDT',a:4,p:'50000'}})});assert.deepEqual(order,['raw','raw','trade']);}
  finally {f.disconnect();globalThis.fetch=oldFetch;globalThis.WebSocket=oldWS;}
});
