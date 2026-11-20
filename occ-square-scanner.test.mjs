import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OccSquareScanner,SCANNER_DISCLAIMER,signalProposal} from './occ-square-scanner.mjs';
import {M15,H4} from './occ-signal-engine.mjs';

const base=16*H4;
const seedH4=Array.from({length:16},(_,i)=>[
 i*H4,'100','110','90','100','10',i*H4+H4-1
]);
const row=(t,close=100)=>[t,'100','112','88',String(close),'1000',t+M15-1];
function rig(t,{volume=45000000,coins=['ETHUSDT','SOLUSDT'],publisherOn=true}={}){
 const dir=mkdtempSync(join(tmpdir(),'occ-square-scan-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 let now=base+3*M15+61000;
 const calls=[],posts=[],published=[],changes=new Map();
 const marketGet=async(path,p={})=>{
  calls.push({path,p});
  if(path==='/fapi/v1/exchangeInfo')return {symbols:coins.map(symbol=>({
   symbol,quoteAsset:'USDT',contractType:'PERPETUAL',status:'TRADING'
  })).concat([{symbol:'DOGEUSDT',quoteAsset:'USDT',contractType:'CURRENT_QUARTER',status:'TRADING'}])};
  if(path==='/fapi/v1/ticker/24hr')return coins.map((symbol,i)=>({
   symbol,quoteVolume:String(volume-i*2000000)
  }));
  if(path==='/fapi/v1/klines'&&p.interval==='4h')return seedH4;
  if(path==='/fapi/v1/klines'&&p.interval==='15m'){
   const last=Math.floor((now-1)/M15)*M15-M15;
   const count=Number(p.limit);
   return Array.from({length:count},(_,i)=>{
    const at=last-(count-i-1)*M15;
    return row(at,changes.get(at)??100);
   });
  }
  throw Error('Unapproved market-only path '+path);
 };
 const publisher={
  posts,keyExists:()=>publisherOn,
  async onSignal(p){
   published.push(p);posts.push({at:p.at,status:'SENT',kind:'SIGNAL',key:p.key});
   return {status:'SENT'};
  }
 };
 const scanner=new OccSquareScanner({dataDir:dir,publisher,marketGet,clock:()=>now,concurrency:2});
 return {scanner,calls,posts,published,changes,dir,
  advance(close){now+=M15;const last=Math.floor((now-1)/M15)*M15-M15;changes.set(last,close);},
  now:()=>now};
}
test('proposal uses closed M15 market price, not MA crossing; SL/TP directional',()=>{
 const signal={symbol:'ETHUSDT',side:'LONG',barTime:base,
  candleClose:2500,triggerPrice:2520};
 const p=signalProposal(signal);
 assert.equal(p.entry,2500);
 assert.equal(p.triggerPrice,2520);
 assert.equal(p.sl,2480);assert.deepEqual(p.tps,[2537.5,2575,2625]);
 assert.equal(p.isExecuted,false);
 assert.match(SCANNER_DISCLAIMER,/chưa phải giao dịch đã khớp/);
 assert.throws(()=>signalProposal({...signal,symbol:'BTCUSD_PERP'}),/Tín hiệu OCC/);
});
test('scan ALL eligible perpetual symbols, baseline never publishes historical crossings',async t=>{
 const h=rig(t);h.scanner.configure({enabled:true,autoPublish:true,maxDailyPosts:5});
 await h.scanner.tick({force:true});
 const status=h.scanner.status();
 assert.equal(status.tracked,2);
 assert.equal(status.warmed,2);
 assert.equal(status.scanned,2);
 assert.equal(status.detected,0);
 assert.equal(h.published.length,0);
 assert.equal(h.calls.some(x=>/order|positionRisk|account|algo|leverage|userTrades/i.test(x.path)),false);
 assert.equal(h.calls.filter(x=>x.p?.interval==='4h').length,2);
});
test('new confirmed M15 crossover posts once with exact contract and no Futures trade requests',async t=>{
 const h=rig(t);h.scanner.configure({enabled:true,autoPublish:true,maxDailyPosts:1,maxPerCycle:1});
 await h.scanner.tick({force:true});
 h.advance(110);
 await h.scanner.tick({force:true});
 assert.equal(h.scanner.status().detected,2);
 assert.equal(h.published.length,1);
 assert.equal(h.published[0].symbol,'ETHUSDT');
 assert.equal(h.published[0].side,'LONG');
 assert.equal(h.published[0].entry,110);
 assert.equal(h.published[0].isExecuted,false);
 assert.equal(h.scanner.status().dailyRemaining,0);
 await h.scanner.tick({force:true});
 assert.equal(h.published.length,1);
 h.advance(90);
 await h.scanner.tick({force:true});
 assert.equal(h.scanner.status().detected,2);
 assert.equal(h.published.length,1,'Daily cap suppresses further posts');
 assert.equal(h.calls.some(c=>/\/fapi\/v1\/(order|algoOrder|leverage)/.test(c.path)),false);
 const persisted=JSON.parse(readFileSync(join(h.dir,'occ-square-scanner.json'),'utf8'));
 assert.ok(persisted.seen.some(x=>x.includes('ETHUSDT:M15:')));
});
test('Scanner retains separate ON/OFF state, no publishing without opt-in',async t=>{
 const h=rig(t);
 await h.scanner.tick({force:true});
 assert.equal(h.calls.length,0);
 h.scanner.configure({enabled:true});
 await h.scanner.tick({force:true});h.advance(110);
 await h.scanner.tick({force:true});
 assert.equal(h.published.length,0);
 assert.equal(h.scanner.status().recentSignals.length,2);
 const restored=new OccSquareScanner({dataDir:h.dir,publisher:{...h.scanner.publisher},marketGet:async()=>{throw Error('no scan');},clock:h.now});
 assert.equal(restored.config.enabled,true);
 assert.equal(restored.config.autoPublish,false);
 assert.equal(restored.status().recentSignals.length,2);
});
test('Missing Square key blocks autoPublish but read-only scanning can continue',async t=>{
 const h=rig(t,{publisherOn:false});
 h.scanner.configure({enabled:true});
 assert.throws(()=>h.scanner.configure({autoPublish:true}),/Square OpenAPI key/);
 assert.equal(h.scanner.config.enabled,true);
 assert.equal(h.scanner.config.autoPublish,false);
});
