import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OccSquareScanner,parseWatchlist,signalProposal,SCANNER_DISCLAIMER} from './occ-square-scanner.mjs';
import {M15,H4} from './occ-signal-engine.mjs';

const base=16*H4;
const seedH4=Array.from({length:16},(_,i)=>[i*H4,'100','110','90','100','10',i*H4+H4-1]);
const row=(t,close=100)=>[t,'100','112','88',String(close),'1000',t+M15-1];
function rig(t){
 const dir=mkdtempSync(join(tmpdir(),'square-scopes-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 let now=base+3*M15+61000;
 const calls=[],posts=[],changes=new Map();
 const symbols=['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT'];
 const marketGet=async(path,p={})=>{
  calls.push({path,p});
  if(path==='/fapi/v1/exchangeInfo')return {symbols:symbols.map(symbol=>({
   symbol,marginAsset:'USDT',quoteAsset:'USDT',contractType:'PERPETUAL',status:'TRADING'
  }))};
  if(path==='/fapi/v1/ticker/24hr')return symbols.map((symbol,i)=>({
   symbol,quoteVolume:String(80000000-i*5000000)
  }));
  if(path==='/fapi/v1/klines'&&p.interval==='4h')return seedH4;
  if(path==='/fapi/v1/klines'&&p.interval==='15m'){
   const last=Math.floor((now-1)/M15)*M15-M15;
   return Array.from({length:Number(p.limit)},(_,i)=>{
    const at=last-(Number(p.limit)-i-1)*M15;
    return row(at,changes.get(at)??100);
   });
  }
  throw Error('Unexpected endpoint '+path);
 };
 const publisher={posts,keyExists:()=>true,async onSignal(p,channel){
  if(posts.some(x=>x.key===p.key))return {duplicate:true};
  posts.push({key:p.key,channel,at:p.at,status:'SENT',symbol:p.symbol,isExecuted:p.isExecuted});
  return {status:'SENT'};
 }};
 const clock=()=>now;
 const list=new OccSquareScanner({dataDir:dir,publisher,scope:'WATCHLIST',marketGet,clock,concurrency:2});
 const all=new OccSquareScanner({dataDir:dir,publisher,scope:'ALL',marketGet,clock,concurrency:2,
  excludeSymbols:()=>new Set(list.config.symbols)});
 return {list,all,posts,calls,dir,marketGet,clock,
  advance(close){now+=M15;const last=Math.floor((now-1)/M15)*M15-M15;changes.set(last,close);}
 };
}
test('Comma-separated WATCHLIST normalizes symbols and excludes BTC trade channel',()=>{
 assert.deepEqual(parseWatchlist('eth, SOLUSDT, ethusdt, bnb'),['ETHUSDT','SOLUSDT','BNBUSDT']);
 assert.throws(()=>parseWatchlist('ETH,BTC'),/BTCUSDT/);
 assert.throws(()=>parseWatchlist('ETH,INVALID-PAIR'),/hợp lệ/);
 const proposal=signalProposal({symbol:'SOLUSDT',barTime:base,
  side:'LONG',candleClose:100,triggerPrice:101});
 assert.equal(proposal.isExecuted,false);
 assert.match(SCANNER_DISCLAIMER,/chưa phải giao dịch đã khớp/);
});
test('List 1 and ALL have independent daily and per-scan budgets with no duplicated coins',async t=>{
 const h=rig(t);
 h.list.configure({symbols:'ETH, ETHUSDT',enabled:true,maxDailyPosts:1,maxPerCycle:1});
 h.all.configure({enabled:true,maxDailyPosts:1,maxPerCycle:1});
 await h.list.tick({force:true});await h.all.tick({force:true});
 assert.deepEqual(h.list.status().config.symbols,['ETHUSDT']);
 assert.equal(h.list.status().tracked,1);
 assert.equal(h.all.status().tracked,2,'BTC and watchlist must be excluded from ALL');
 assert.equal(h.posts.length,0,'Warmup cannot publish past signals');
 h.advance(110);
 await h.list.tick({force:true});await h.all.tick({force:true});
 assert.equal(h.posts.length,2);
 assert.equal(h.posts.find(x=>x.channel==='WATCHLIST').symbol,'ETHUSDT');
 assert.notEqual(h.posts.find(x=>x.channel==='ALL').symbol,'ETHUSDT');
 assert.equal(h.list.status().dailyUsed,1);
 assert.equal(h.all.status().dailyUsed,1);
 assert.equal(h.list.status().dailyRemaining,0);
 assert.equal(h.all.status().dailyRemaining,0);
 h.advance(90);
 await h.list.tick({force:true});await h.all.tick({force:true});
 assert.equal(h.posts.length,2,'Independent daily caps must hold');
 assert.ok(h.calls.every(x=>!/(order|positionRisk|account|leverage|userTrades|algo)/i.test(x.path)));
});
test('Restart retains separate scanner settings without automatically publishing history',async t=>{
 const h=rig(t);
 h.list.configure({symbols:'SOL, BNB',enabled:true,maxDailyPosts:7,maxPerCycle:2});
 h.all.configure({enabled:false,maxDailyPosts:12,maxPerCycle:3});
 await h.list.tick({force:true});
 const list=new OccSquareScanner({dataDir:h.dir,publisher:h.list.publisher,scope:'WATCHLIST',
  marketGet:h.marketGet,clock:h.clock});
 const all=new OccSquareScanner({dataDir:h.dir,publisher:h.all.publisher,scope:'ALL',
  marketGet:h.marketGet,clock:h.clock});
 assert.equal(list.config.maxDailyPosts,7);
 assert.deepEqual(list.config.symbols,['SOLUSDT','BNBUSDT']);
 assert.equal(all.config.enabled,false);
 assert.equal(all.config.maxDailyPosts,12);
 assert.equal(list.status().recentSignals.length,0);
 const saved=JSON.parse(readFileSync(join(h.dir,'occ-square-watchlist.json'),'utf8'));
 assert.equal(saved.config.maxPerCycle,2);
});
test('Enabling scanner requires Square key; limits must be valid',t=>{
 const h=rig(t);
 h.list.publisher.keyExists=()=>false;
 assert.throws(()=>h.list.configure({symbols:'ETH',enabled:true}),/Square OpenAPI key/);
 assert.equal(h.list.config.enabled,false);
 assert.throws(()=>h.all.configure({maxPerCycle:4}),/Số bài\/chu kỳ/);
 assert.throws(()=>h.all.configure({maxDailyPosts:21}),/Số bài\/ngày/);
});
