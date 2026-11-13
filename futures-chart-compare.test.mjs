import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LiveStatsLedger} from './binance-live-stats.mjs';
import {buildOCCChartComparison,readVerifiedChartFills} from './futures-chart-compare.mjs';

const M15=900000,H4=14400000,root='OCCBTC-0123456789abcd';
const raw=(time,open,high,low,close,period)=>[
 time,String(open),String(high),String(low),String(close),'100',time+period-1,'0',0,'0','0','0'
];
function fixture(nowShift=0){
 const h4=Array.from({length:16},(_,i)=>raw(i*H4,100,115,85,100,H4));
 const t0=11*H4;
 const m15=Array.from({length:60},(_,i)=>{
  const price=i<8?99:i<25?101:i<41?99:101;
  return raw(t0+i*M15,100,103,97,price,M15);
 });
 return {h4,m15,now:t0+61*M15+nowShift};
}

test('Read-only M15/H4 OCC engine emits causal crosses with distinct BTC trigger and MA reference',()=>{
 const {h4,m15,now}=fixture();
 const data=buildOCCChartComparison({h4,m15,now,fills:[]});
 assert.equal(data.candles.length,60);
 assert.ok(data.signals.some(s=>s.side==='LONG'));
 assert.ok(data.signals.some(s=>s.side==='SHORT'));
 assert.ok(data.series.length===data.candles.length);
 assert.ok(data.signals.every(s=>s.source==='OCC_ENGINE_CAUSAL_SMMA8'));
 assert.equal(data.comparisons.length,0);
 assert.match(data.note,/Not actual TradingView Pine/);
});

test('Binance filled ENTRY and real SL/TP are plotted from ledger, not simulated prices',t=>{
 const dir=mkdtempSync(join(tmpdir(),'occ-compare-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'binance-live-stats.sqlite');
 const l=new LiveStatsLedger(path);
 l.register({orderId:701,groupId:root,clientId:root,role:'ENTRY',side:'BUY'});
 l.register({orderId:702,groupId:root,clientId:root,role:'TP1',side:'SELL'});
 const {h4,m15,now}=fixture();
 const baseline=buildOCCChartComparison({h4,m15,now});
 const long=baseline.signals.find(s=>s.side==='LONG');
 assert.ok(long);
 const filledAt=long.confirmAt+3500;
 l.ingest([
  {id:101,orderId:701,symbol:'BTCUSDT',side:'BUY',qty:'.004',price:'100.6',
   realizedPnl:'0',commission:'.02',commissionAsset:'USDT',time:filledAt},
  {id:102,orderId:702,symbol:'BTCUSDT',side:'SELL',qty:'.001',price:'103.5',
   realizedPnl:'.0029',commission:'.005',commissionAsset:'USDT',time:filledAt+1600000}
 ]);
 l.close();
 const fills=readVerifiedChartFills(path,0);
 const data=buildOCCChartComparison({h4,m15,now,fills,settings:{
  slPercent:.8,tp1Val:1.5,tp2Val:3,tp3Val:5,tpMode:'Percent'}});
 assert.equal(data.fills.length,2);
 assert.equal(data.fills[0].role,'ENTRY');
 assert.equal(data.fills[0].price,100.6);
 assert.equal(data.fills[1].role,'TP1');
 assert.equal(data.comparisons.length,2);
 assert.equal(data.comparisons[0].role,'TP1');
 const entry=data.comparisons.find(x=>x.role==='ENTRY');
 assert.equal(entry.binancePrice,100.6);
 assert.equal(entry.attribution,'NEAREST_PRECEDING_SIGNAL_NOT_PROVEN');
 assert.equal(entry.delaySeconds,3.5);
 assert.equal(entry.signalTime,long.confirmAt);
 assert.equal(entry.referencePrice,long.signalClose);
 assert.equal(readVerifiedChartFills(join(dir,'missing.sqlite')).length,0);
});

test('Unattributed Binance account trades never appear as OCC verified chart markers',t=>{
 const dir=mkdtempSync(join(tmpdir(),'occ-compare-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const path=join(dir,'stats.sqlite'),l=new LiveStatsLedger(path),{h4,m15,now}=fixture();
 l.ingestExchange([{id:900,orderId:888,symbol:'BTCUSDT',side:'SELL',qty:'.002',
  price:'99',realizedPnl:'-2',commission:'.01',commissionAsset:'USDT',time:now-1000}],now);
 l.close();
 const fills=readVerifiedChartFills(path,0),view=buildOCCChartComparison({h4,m15,now,fills});
 assert.equal(fills.length,0);
 assert.equal(view.fills.length,0);
});

test('Windows routes use no API keys and render two comparison charts with isolated TradingView widget',()=>{
 const files={
  server:readFileSync(new URL('./server.mjs',import.meta.url),'utf8'),
  page:readFileSync(new URL('./OCC_COMPARE.html',import.meta.url),'utf8'),
  widget:readFileSync(new URL('./OCC_TV_WIDGET.html',import.meta.url),'utf8'),
  portable:readFileSync(new URL('./BUILD_PORTABLE.ps1',import.meta.url),'utf8'),
  main:readFileSync(new URL('./BINANCE_UI_PREVIEW.html',import.meta.url),'utf8')
 };
 assert.match(files.server,/req\.url==='\/api\/binance\/occ-chart-compare'/);
 assert.match(files.server,/req\.url==='\/occ-compare'/);
 assert.match(files.server,/req\.url==='\/occ-tradingview-widget'/);
 assert.match(files.server,/readVerifiedChartFills/);
 assert.match(files.page,/id="reference"/);
 assert.match(files.page,/id="execution"/);
 assert.match(files.page,/id="rows"/);
 assert.match(files.page,/id="tvFrame"[^>]+sandbox="allow-scripts allow-popups allow-forms"/);
 assert.match(files.page,/NO_MATCHING_SIGNAL/);
 assert.match(files.widget,/embed-widget-advanced-chart\.js/);
 assert.match(files.main,/href="\/occ-compare"/);
 assert.match(files.portable,/'futures-chart-compare\.mjs'/);
 assert.match(files.portable,/'OCC_COMPARE\.html'/);
 assert.match(files.portable,/'OCC_TV_WIDGET\.html'/);
 const inline=files.page.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(inline);
 assert.doesNotThrow(()=>new Function(inline));
});
