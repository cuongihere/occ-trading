import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {FuturesTransport} from './futures-transport.mjs';
test('HMAC signature, BTC-only API path, and no automatic order retries',async()=>{
 const calls=[];
 const transport=new FuturesTransport({apiKey:'fixture-key',apiSecret:'fixture-secret',clock:()=>10000,
  fetchFn:async(url,opts)=>{calls.push({url,opts});return {ok:true,status:200,json:async()=>({serverTime:10000})};}});
 await transport.get('/fapi/v2/account');
 const u=new URL(calls[0].url),params=new URLSearchParams(u.searchParams);
 const signature=params.get('signature');params.delete('signature');
 assert.equal(signature,createHmac('sha256','fixture-secret').update(params.toString()).digest('hex'));
 await assert.rejects(transport.get('/fapi/v3/positionRisk',{symbol:'ETHUSDT'}),/Only BTCUSDT/);
 await assert.rejects(transport.get('/not-an-endpoint'),/not allowed/);
 transport.close();
});

test('demo environment is default and production requires explicit consent',async()=>{
 const demo=new FuturesTransport({apiKey:'fixture-key',apiSecret:'fixture-secret',
  fetchFn:async(url)=>{assert.ok(url.startsWith('https://demo-fapi.binance.com/'));
   return {ok:true,status:200,json:async()=>({serverTime:1000})};},clock:()=>1000});
 await demo.get('/fapi/v1/time');demo.close();
 assert.throws(()=>new FuturesTransport({apiKey:'key',apiSecret:'secret',environment:'production'}),/consent/);
});
test('conditional stop cannot contain closePosition and quantity simultaneously',async()=>{
 const t=new FuturesTransport({apiKey:'key',apiSecret:'secret',
  fetchFn:async()=>{throw Error('Must not reach Binance');}});
 await assert.rejects(t.post('/fapi/v1/algoOrder',{symbol:'BTCUSDT',type:'STOP_MARKET',
  algoType:'CONDITIONAL',closePosition:'true',quantity:'0.001'}),/cannot combine/);
 t.close();
});

test('BTCUSDT leverage update is signed, strict and never sent to other markets',async()=>{
 const calls=[];
 const t=new FuturesTransport({apiKey:'test-key',apiSecret:'test-secret',environment:'production',
  productionConsent:'I_ACCEPT_LIVE_BTCUSDT',clock:()=>10000,
  fetchFn:async(url,opts)=>{calls.push({url,opts});return {ok:true,status:200,json:async()=>({symbol:'BTCUSDT',leverage:5})};}});
 const result=await t.post('/fapi/v1/leverage',{symbol:'BTCUSDT',leverage:5});
 assert.equal(result.leverage,5);
 assert.equal(calls.length,1);
 assert.equal(calls[0].opts.method,'POST');
 assert.equal(new URL(calls[0].url).pathname,'/fapi/v1/leverage');
 const params=new URLSearchParams(calls[0].opts.body);
 const sig=params.get('signature');params.delete('signature');
 assert.equal(sig,createHmac('sha256','test-secret').update(params.toString()).digest('hex'));
 await assert.rejects(t.post('/fapi/v1/leverage',{symbol:'ETHUSDT',leverage:5}),/Only BTCUSDT/);
 await assert.rejects(t.post('/fapi/v1/leverage',{symbol:'BTCUSDT',leverage:150}),/integer between 1x and 20x/);
 await assert.rejects(t.post('/fapi/v1/leverage',{symbol:'BTCUSDT',leverage:5,positionSide:'LONG'}),/integer between 1x and 20x/);
 assert.equal(calls.length,1);
 t.close();
});

test('Binance -1021 automatically resyncs by server time and retries ONLY signed GET once',async()=>{
 const start=1000000,serverTime=start+120000,seen=[];
 const transport=new FuturesTransport({apiKey:'key',apiSecret:'secret',
  environment:'production',productionConsent:'I_ACCEPT_LIVE_BTCUSDT',
  clock:()=>start,
  fetchFn:async url=>{
   const u=new URL(url),params=u.searchParams;
   seen.push({path:u.pathname,timestamp:params.get('timestamp'),
    recvWindow:params.get('recvWindow')});
   if(u.pathname==='/fapi/v1/time')return {ok:true,status:200,
    json:async()=>({serverTime})};
   if(u.pathname==='/fapi/v2/account'){
    const valid=Math.abs(Number(params.get('timestamp'))-serverTime)<1000;
    return valid?{ok:true,status:200,json:async()=>({assets:[{asset:'USDT'}]})}:
     {ok:false,status:400,json:async()=>({code:-1021,msg:'Timestamp outside recvWindow'})};
   }
   throw Error('Unexpected '+u.pathname);
  }});
 const result=await transport.get('/fapi/v2/account');
 assert.equal(result.assets[0].asset,'USDT');
 assert.deepEqual(seen.map(x=>x.path),[
  '/fapi/v2/account','/fapi/v1/time','/fapi/v2/account']);
 assert.equal(Number(seen.at(-1).timestamp),serverTime);
 assert.equal(seen[0].recvWindow,'10000');
 assert.equal(transport.offset,120000);
 assert.equal(transport.clockSyncVersion,1);
 transport.close();
});

test('Concurrent Binance GET -1021 errors share a single automatic /time synchronization',async()=>{
 let resolveTime;
 let calls=0,syncCalls=0,now=1000000,offset=90000;
 const gate=new Promise(r=>resolveTime=r);
 const t=new FuturesTransport({apiKey:'key',apiSecret:'secret',clock:()=>now,
  fetchFn:async url=>{
   const u=new URL(url);
   if(u.pathname==='/fapi/v1/time'){
    syncCalls++;await gate;
    return {ok:true,status:200,json:async()=>({serverTime:now+offset})};
   }
   if(u.pathname==='/fapi/v2/account'||u.pathname==='/fapi/v3/positionRisk'){
    calls++;
    const valid=Number(u.searchParams.get('timestamp'))===now+offset;
    return valid?{ok:true,status:200,json:async()=>({valid:true})}:
     {ok:false,status:400,json:async()=>({code:-1021,msg:'Timestamp mismatch'})};
   }
   throw Error('Unexpected '+u.pathname);
  }});
 const a=t.get('/fapi/v2/account'),b=t.get('/fapi/v3/positionRisk',{symbol:'BTCUSDT'});
 await Promise.resolve();resolveTime();
 const result=await Promise.all([a,b]);
 assert.equal(syncCalls,1);
 assert.equal(calls,4);
 assert.ok(result.every(x=>x.valid));
});

test('Repeated GET -1021 after resync stops after one retry; no infinite loop',async()=>{
 let reads=0,clockCalls=0;
 const t=new FuturesTransport({apiKey:'key',apiSecret:'secret',clock:()=>1000000,
  fetchFn:async url=>{
   const path=new URL(url).pathname;
   if(path==='/fapi/v1/time'){
    clockCalls++;return {ok:true,status:200,json:async()=>({serverTime:1090000})};
   }
   reads++;return {ok:false,status:400,json:async()=>({code:-1021,msg:'Timestamp mismatch'})};
  }});
 await assert.rejects(t.get('/fapi/v2/account'),/code -1021/);
 assert.equal(reads,2);assert.equal(clockCalls,1);
});

test('A Binance POST timestamp rejection is NEVER automatically resent',async()=>{
 let orderCalls=0,timeCalls=0;
 const t=new FuturesTransport({apiKey:'key',apiSecret:'secret',clock:()=>1000000,
  environment:'production',productionConsent:'I_ACCEPT_LIVE_BTCUSDT',
  fetchFn:async url=>{
   const path=new URL(url).pathname;
   if(path==='/fapi/v1/time')timeCalls++;
   if(path==='/fapi/v1/order')orderCalls++;
   return {ok:false,status:400,json:async()=>({code:-1021,msg:'Timestamp mismatch'})};
  }});
 await assert.rejects(t.post('/fapi/v1/order',{symbol:'BTCUSDT',positionSide:'BOTH',
  side:'BUY',type:'MARKET',quantity:'.004',newClientOrderId:'OCCBTC-11223344556677',
  newOrderRespType:'RESULT'}),/code -1021/);
 assert.equal(orderCalls,1);
 assert.equal(timeCalls,0);
});

test('Binance server-time response must be valid before any GET retry',async()=>{
 let reads=0;
 const t=new FuturesTransport({apiKey:'key',apiSecret:'secret',clock:()=>1000000,
  fetchFn:async url=>{
   const path=new URL(url).pathname;
   if(path==='/fapi/v1/time')return {ok:true,status:200,json:async()=>({serverTime:'invalid'})};
   reads++;return {ok:false,status:400,json:async()=>({code:-1021,msg:'Timestamp mismatch'})};
  }});
 await assert.rejects(t.get('/fapi/v2/account'),/Không thể xác minh giờ Binance/);
 assert.equal(reads,1);
});
