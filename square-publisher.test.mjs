import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SquarePublisher,squareCaption} from './square-publisher.mjs';
import {renderSquareTradeChart} from './square-chart-render.mjs';
import {inflateSync} from 'node:zlib';

const fakeKlines=Array.from({length:72},(_,i)=>[
 i*900000,'100','106','95',String(100+(i%4)), '10',i*900000+899999
]);
const protectedEntry=()=>({
 entry:{orderId:'45678901',side:'LONG',entryPrice:100,qty:.004,clientPrefix:'OCCBTC-abcdef01234567'},
 stop:{role:'SL',triggerPrice:99,id:'6001'},
 tps:[1,2,3].map((i)=>({role:'TP'+i,triggerPrice:100+i,id:String(6001+i)}))
});
function fixture(t,fetcher){
 const dir=mkdtempSync(join(tmpdir(),'square-post-unit-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 let secret=null;const vault={
  exists:()=>secret!==null,load:()=>secret?{apiKey:secret,apiSecret:'SQUARE-POSTING-ONLY'}:null,
  save:({apiKey})=>{secret=apiKey;},delete:()=>{secret=null;}
 };
 const calls=[];
 const fetchImpl=fetcher||(async(url,p)=>{
  calls.push({url,method:p.method,body:p.body});
  if(String(url).endsWith('/image/presignedUrl'))return {ok:true,status:200,json:async()=>({
   code:'000000',data:{presignedUrl:'https://mock.s3.amazonaws.com/trade.png',fileTicket:'T1'}})};
  if(String(url)==='https://mock.s3.amazonaws.com/trade.png')return {ok:true,status:200};
  if(String(url).endsWith('/image/imageStatus'))return {ok:true,status:200,json:async()=>({
   code:'000000',data:{status:1,imageUrl:'https://static.binance.com/abc.png'}})};
  if(String(url).endsWith('/content/add'))return {ok:true,status:200,json:async()=>({
   code:'000000',data:{id:'998877',shareLink:'https://www.binance.com/square/post/998877'}})};
  throw Error('Unexpected network request');
 });
 const p=new SquarePublisher({dataDir:dir,fetcher:fetchImpl,vault,
  fetchKlines:async()=>fakeKlines,sleep:async()=>{}});
 return {p,dir,calls};
}
test('PNG renderer makes a valid 1200x675 image containing only public candlesticks and trade levels',()=>{
 const image=renderSquareTradeChart({klines:fakeKlines,side:'LONG',entry:100,sl:99,
  tps:[101,102,103],filledAt:Date.UTC(2026,10,14)});
 assert.deepEqual([...image.subarray(0,8)],[137,80,78,71,13,10,26,10]);
 assert.equal(image.readUInt32BE(16),1200);
 assert.equal(image.readUInt32BE(20),675);
 const offset=33,idatLength=image.readUInt32BE(offset);
 assert.equal(image.toString('ascii',offset+4,offset+8),'IDAT');
 const pixels=inflateSync(image.subarray(offset+8,offset+8+idatLength));
 assert.equal(pixels.length,(1200*4+1)*675);
 assert.ok(image.length>2000);
});
test('Captions never expose OCC/SMMA strategy, order ID, account balance or size',()=>{
 const c=squareCaption({side:'SHORT',entry:69000.1,sl:69500.1,tps:[68500,68000,67500]});
 for(const token of ['OCC','SMMA','Strategy','orderId','margin','0.004','API','SMA'])
  assert.equal(c.includes(token),false);
 assert.match(c,/\$BTCUSDT PERPETUAL \| SHORT/);
 for(const token of ['ENTRY:','SL:','TP1:','TP2:','TP3:'])assert.ok(c.includes(token));
});
test('Square auto post only after authenticated new protected entry, deduped across restart',async t=>{
 const h=fixture(t);
 assert.equal(h.p.status().enabled,false);
 assert.deepEqual(await h.p.onProtected(protectedEntry()),{skipped:true});
 assert.equal(h.calls.length,0);
 h.p.connect('Square-openapi-example-key-123456');
 h.p.toggle(true);
 const result=await h.p.onProtected(protectedEntry());
 assert.equal(result.status,'SENT');
 assert.match(result.url,/\/square\/post\/998877$/);
 assert.deepEqual(await h.p.onProtected(protectedEntry()),{duplicate:true});
 assert.equal(h.calls.filter(x=>String(x.url).endsWith('/content/add')).length,1);
 const body=JSON.parse(h.calls.find(x=>String(x.url).endsWith('/content/add')).body);
 assert.equal(body.contentType,1);
 assert.equal(body.imageList.length,1);
 assert.doesNotMatch(body.bodyTextOnly,/OCC|SMMA|0\.004/);
 assert.equal(h.p.status().keyStored,true);
 assert.doesNotMatch(JSON.stringify(h.p.status()),/Square-openapi-example/);
 assert.deepEqual([...h.p.latestImage().subarray(0,4)],[137,80,78,71]);
 const state=JSON.parse(readFileSync(join(h.dir,'square-publisher.json'),'utf8'));
 assert.equal(state.posts.length,1);
 assert.equal(state.posts[0].status,'SENT');
});
test('Square 504 is ambiguous, recorded for manual review and never resent',async t=>{
 const h=fixture(t,async(url,p)=>{
  h.calls.push({url,method:p.method});
  if(String(url).endsWith('/image/presignedUrl'))return {ok:true,status:200,
   json:async()=>({code:'000000',data:{presignedUrl:'https://mock.s3.amazonaws.com/trade.png',fileTicket:'T'}})};
  if(String(url)==='https://mock.s3.amazonaws.com/trade.png')return {ok:true,status:200};
  if(String(url).endsWith('/image/imageStatus'))return {ok:true,status:200,
   json:async()=>({code:'000000',data:{status:1,imageUrl:'https://static.binance.com/a.png'}})};
  return {ok:false,status:504};
 });
 h.p.connect('Square-openapi-example-key-123456');h.p.toggle(true);
 const result=await h.p.onProtected(protectedEntry());
 assert.equal(result.status,'REVIEW_REQUIRED');
 assert.deepEqual(await h.p.onProtected(protectedEntry()),{duplicate:true});
 assert.equal(h.calls.filter(x=>String(x.url).endsWith('/content/add')).length,1);
});
test('Invalid or unverified Binance SL/TP cannot generate a post',async t=>{
 const h=fixture(t);h.p.connect('Square-openapi-example-key-123456');h.p.toggle(true);
 const bad=protectedEntry();bad.tps.length=2;
 await assert.rejects(()=>h.p.onProtected(bad),/xác minh/);
 assert.equal(h.calls.length,0);
});
test('Square result rejected without a publishing-only API key and publishing stays off',t=>{
 const {p}=fixture(t);
 assert.throws(()=>p.toggle(true),/Square OpenAPI key/);
 assert.equal(p.status().enabled,false);
});
