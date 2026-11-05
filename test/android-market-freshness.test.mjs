import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../android/app/src/main/assets/'+p,import.meta.url),'utf8');
const Feed=new Function('window',read('server-feed.js')+'\nreturn window.BinanceFeed;')({});
function setup(){
 let now=1731000000000,shown=[];
 const feed=new Feed({clock:()=>now,onTrade:q=>shown.push(q)});
 feed.state='live';
 feed.offset=0;feed.lastTradeId=10;
 feed.lastMarketTime=now-100;
 feed.lastReceive=now-100;
 feed.lastTradeTime=now-100;
 feed.lastDeliveredTradeAt=now-100;
 return {feed,shown,get now(){return now},advance:ms=>now+=ms};
}
test('Auto feed is LIVE only when a unique aggTrade reached the UI recently',()=>{
 const x=setup();
 assert.equal(x.feed.healthy(),true);
 x.advance(11000);
 // New mark/kline and duplicate aggTrade cannot renew the UI's LAST price.
 x.feed.consume({e:'markPriceUpdate',s:'BTCUSDT',E:x.now,p:'80514',r:'0',T:x.now+3600000},true,x.now);
 x.feed.consume({e:'kline',s:'BTCUSDT',E:x.now,k:{i:'15m',x:false}},true,x.now);
 x.feed.consume({e:'aggTrade',s:'BTCUSDT',E:x.now,a:10,T:x.now,p:'80509.4'},true,x.now);
 assert.equal(x.feed.healthy(),false);
 assert.equal(x.feed.tradeAgeMs(),11100);
 assert.equal(x.shown.length,0);
 x.feed.consume({e:'aggTrade',s:'BTCUSDT',E:x.now,a:11,T:x.now,p:'80509.5'},true,x.now);
 assert.equal(x.feed.healthy(),true);
 assert.equal(x.feed.tradeAgeMs(),0);
 assert.equal(x.shown.length,1);
 assert.equal(x.shown[0].price,80509.5);
});
test('Warmup/backfill trades never enable Auto before a fresh live trade',()=>{
 const x=setup();
 x.feed.lastDeliveredTradeAt=0;
 x.feed.lastTradeTime=0;
 x.feed.consume({e:'aggTrade',s:'BTCUSDT',E:x.now,a:11,T:x.now,p:'80000'},false,x.now);
 assert.equal(x.feed.healthy(),false);
 assert.equal(x.shown.length,0);
 x.feed.consume({e:'aggTrade',s:'BTCUSDT',E:x.now,a:12,T:x.now,p:'80001'},true,x.now);
 assert.equal(x.feed.healthy(),true);
 assert.equal(x.shown.length,1);
});
test('Freshness gate and reconnect control prevent stale LAST from looking LIVE',()=>{
 const ui=read('app.js'),html=read('index.html'),feed=read('server-feed.js');
 assert.match(ui,/function quoteIsFresh\(\)/);
 assert.match(ui,/feed\?\.tradeAgeMs\?\.\(\)/);
 assert.match(ui,/if\(!quoteIsFresh\(\)\)/);
 assert.match(ui,/GIÁ CŨ/);
 assert.match(ui,/lastTrade=0;lastTradePrice=null/);
 assert.match(html,/id="priceReconnect"/);
 assert.match(feed,/this\.lastDeliveredTradeAt=receivedAt/);
 assert.doesNotThrow(()=>new Function(ui));
 assert.doesNotThrow(()=>new Function(feed));
});
