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
