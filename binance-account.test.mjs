import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {BinanceAccountReader} from './binance-account.mjs';
test('read-only client signs Binance account GET and limits BTCUSDT',async()=>{
 const calls=[];
 const client=new BinanceAccountReader({apiKey:'local-test',apiSecret:'test-secret',clock:()=>50000,
  fetchFn:async(url,opts)=>{calls.push({url,opts});const path=new URL(url).pathname;
   return {ok:true,status:200,json:async()=>path.endsWith('/time')?{serverTime:50000}:
    path.endsWith('/account')?{canTrade:true,multiAssetsMargin:false,assets:[{asset:'USDT',walletBalance:'50',availableBalance:'45'}]}:
    path.endsWith('/dual')?{dualSidePosition:false}:
    path.endsWith('/symbolConfig')?[{symbol:'BTCUSDT',marginType:'ISOLATED',leverage:1}]:
    path.endsWith('/positionRisk')?[{symbol:'BTCUSDT',positionSide:'BOTH',positionAmt:'0',entryPrice:'0'}]:[]};}});
 const result=await client.connect();assert.equal(result.symbol,'BTCUSDT');assert.equal(result.oneWay,true);
 assert.equal(result.walletUSDT,50);assert.equal(result.orderSubmissionEnabled,false);
 assert.ok(calls.every(c=>c.opts.method==='GET'));
 const signed=new URL(calls.find(c=>new URL(c.url).pathname.endsWith('/account')).url).searchParams;
 const copy=new URLSearchParams(signed);copy.delete('signature');
 assert.equal(signed.get('signature'),createHmac('sha256','test-secret').update(copy.toString()).digest('hex'));
 await assert.rejects(client.get('/fapi/v1/order'),/allowlisted/);
 await assert.rejects(client.get('/fapi/v3/positionRisk',{symbol:'ETHUSDT'}),/Only BTCUSDT/);
});
