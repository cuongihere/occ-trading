import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {LiveStatsLedger} from './binance-live-stats.mjs';
import {buildOCCChartComparison,readVerifiedChartHistory} from './futures-chart-compare.mjs';
const M15=900000,H4=14400000,group='OCCBTC-aabbccddeeff12';
const raw=(at,open,close,period)=>[
 at,String(open),String(Math.max(open,close)+3),String(Math.min(open,close)-3),
 String(close),'10',at+period-1,'0','0','0','0','0'];
function dataset(n=3100){
 const first=20*H4,now=first+(n+1)*M15;
 const h4=Array.from({length:260},(_,i)=>raw(i*H4,100,100,H4));
 const m15=Array.from({length:n},(_,i)=>raw(first+i*M15,100,
  i%22<11?101:99,M15));
 return {h4,m15,now,first};
}
test('OCC 30-day timeline keeps MA/crosses beyond the old 1200 sample cap',()=>{
 const d=dataset(),r=buildOCCChartComparison(d);
 assert.equal(r.candles.length,3100);
 assert.equal(r.series.length,3100);
 assert.ok(r.signals.length>70);
 assert.ok(r.signals.some(x=>x.time<d.first+(3100-1200)*M15));
 assert.ok(r.signals.every(x=>x.triggerBTC>0&&x.crossMA>0));
 assert.ok(r.signals.some(x=>x.h4Provisional===true));
});
test('Verified Binance Entry Order ID ties precisely to its original OCC crossover and exit fills',t=>{
 const folder=mkdtempSync(join(tmpdir(),'occ-chart-audit-'));
 t.after(()=>rmSync(folder,{recursive:true,force:true}));
 const db=join(folder,'binance-live-stats.sqlite'),d=dataset();
 const reference=buildOCCChartComparison(d);
 const cross=reference.signals.find(x=>x.side==='LONG'&&x.time>d.first+1600*M15);
 assert.ok(cross);
 const ledger=new LiveStatsLedger(db);
 ledger.register({orderId:70101,groupId:group,clientId:group,role:'ENTRY',side:'BUY'});
 ledger.register({orderId:70102,groupId:group,clientId:group+'-SL',role:'SL',side:'SELL'});
 ledger.ingest([
  {symbol:'BTCUSDT',id:90001,orderId:70101,side:'BUY',qty:'.004',
   price:'100.5',realizedPnl:'0',commission:'.03',commissionAsset:'USDT',
   time:cross.confirmAt+500},
  {symbol:'BTCUSDT',id:90002,orderId:70102,side:'SELL',qty:'.004',
   price:'99',realizedPnl:'-0.006',commission:'.025',commissionAsset:'USDT',
   time:cross.confirmAt+M15*4}
 ]);
 assert.equal(ledger.recordEntrySignal({
  groupId:group,orderId:'70101',side:'LONG',barTime:cross.time,
  confirmAt:cross.confirmAt,signalClose:cross.signalClose,
  triggerPrice:cross.triggerBTC,crossMA:cross.crossMA
 }),true);
 assert.equal(ledger.recordEntrySignal({
  groupId:group,orderId:'70101',side:'LONG',barTime:cross.time,
  confirmAt:cross.confirmAt,signalClose:cross.signalClose,
  triggerPrice:cross.triggerBTC,crossMA:cross.crossMA
 }),false);
 assert.throws(()=>ledger.recordEntrySignal({
  groupId:group,orderId:'70101',side:'SHORT',barTime:cross.time,
  confirmAt:cross.confirmAt,signalClose:cross.signalClose,
  triggerPrice:cross.triggerBTC,crossMA:cross.crossMA
 }),/Binance Entry|Conflicting/);
 ledger.close();
 const rows=readVerifiedChartHistory(db,0);
 const model=buildOCCChartComparison({...d,...rows});
 assert.equal(rows.signalLinks.length,1);
 assert.equal(model.historyGroups.length,1);
 const g=model.historyGroups[0];
 assert.equal(g.signalStatus,'VERIFIED_ORDER_SIGNAL');
 assert.equal(g.signalAt,cross.confirmAt);
 assert.equal(g.entryOrderId,'70101');
 assert.deepEqual(g.exitOrderIds,['70102']);
 assert.equal(g.status,'CLOSED');
 assert.equal(g.realizedUSDT,-.006);
 assert.equal(g.feesUSDT,.055);
 assert.equal(g.netExFundingUSDT,-.061);
 const entry=model.comparisons.find(x=>x.role==='ENTRY');
 assert.equal(entry.attribution,'VERIFIED_ORDER_SIGNAL');
 assert.equal(entry.triggerBTC,cross.triggerBTC);
 assert.equal(entry.binancePrice,100.5);
 assert.equal(entry.delaySeconds,.5);
});
test('Old Binance fills without exact signal audit remain explicitly unverified',t=>{
 const folder=mkdtempSync(join(tmpdir(),'occ-chart-unlinked-'));
 t.after(()=>rmSync(folder,{recursive:true,force:true}));
 const db=join(folder,'stats.sqlite'),d=dataset(140),ledger=new LiveStatsLedger(db);
 const oldGroup='OCCBTC-bbccddeeff0011';
 ledger.register({orderId:50001,groupId:oldGroup,clientId:oldGroup,role:'ENTRY',side:'BUY'});
 ledger.ingest([{symbol:'BTCUSDT',id:21,orderId:50001,side:'BUY',
  qty:'.002',price:'100',realizedPnl:'0',commission:'.01',
  commissionAsset:'USDT',time:d.first+85*M15}]);
 ledger.close();
 const source=readVerifiedChartHistory(db,0);
 const model=buildOCCChartComparison({...d,...source});
 assert.equal(model.historyGroups[0].signalStatus,'HISTORICAL_SIGNAL_UNVERIFIED');
 assert.equal(model.historyGroups[0].signalAt,null);
 assert.equal(model.historyGroups[0].status,'OPEN_OR_UNMATCHED_EXIT');
 assert.ok(model.comparisons[0].attribution!=='VERIFIED_ORDER_SIGNAL');
});
test('One-chart UI includes OCC/cross/real fills filters, 30-day history and focus controls',()=>{
 const html=readFileSync(new URL('./OCC_COMPARE.html',import.meta.url),'utf8');
 const server=readFileSync(new URL('./server.mjs',import.meta.url),'utf8');
 for(const id of ['showMA','showCross','showFills','showLevels','chartHistory',
  'historySearch','historyGroups','historyClear','historyToggle','panPrev','panNext']){
  assert.match(html,new RegExp('id="'+id+'"'));
 }
 assert.match(html,/function focusGroup\(groupId\)/);
 assert.match(html,/focusAt=group.entryTime/);
 assert.match(html,/refresh\(30\)/);
 assert.match(html,/exactLinkedSignal\(group\)/);
 assert.match(html,/ctx\.arc\(xx,yy,4/);
 assert.match(html,/selectedGroupId/);
 assert.match(server,/getComparisonCandles\(days=7\)/);
 assert.match(server,/readVerifiedChartHistory/);
 assert.match(server,/chartDaysParam\(range\)/);
 const js=[...html.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)];
 assert.ok(js.length>=2);
 for(const m of js)assert.doesNotThrow(()=>new Function(m[1]));
});
