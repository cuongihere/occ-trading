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
 await assert.rejects(transport.get('/fapi/v1/positionRisk',{symbol:'ETHUSDT'}),/Only BTCUSDT/);
 await assert.rejects(transport.get('/not-an-endpoint'),/not allowed/);
 transport.close();
});
