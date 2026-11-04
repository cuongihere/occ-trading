import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LiveStatsLedger,readLiveReport,syncKnownOrderFills,emptyLiveReport} from './binance-live-stats.mjs';
const pathFor=t=>{const folder=mkdtempSync(join(tmpdir(),'occ-real-stats-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));return join(folder,'real.sqlite');};
const order=(id,role,side,groupId='groupA')=>({orderId:id,groupId,clientId:'OCCBTC-'+id,role,side});
const fill=(id,orderId,side,qty,price,pnl,fee=1,asset='USDT')=>
 ({id,orderId,symbol:'BTCUSDT',side,qty:String(qty),price:String(price),
  realizedPnl:String(pnl),commission:String(fee),commissionAsset:asset,time:1000+id});
test('Multi TP actual Binance fills form ONE completed real position, net of both entry and exit fees',t=>{
 const ledger=new LiveStatsLedger(pathFor(t));
 assert.equal(ledger.register(order(100,'ENTRY','BUY')),true);
 for(const [i,r]of [[101,'TP1'],[102,'TP2'],[103,'SL']])ledger.register(order(i,r,'SELL'));
 const data=[fill(1,100,'BUY',1,10000,0,4),
  fill(2,101,'SELL',.33,10100,33,1),
  fill(3,102,'SELL',.33,10200,66,1),
  fill(4,103,'SELL',.34,9900,-34,1)];
 assert.equal(ledger.ingest(data),4);
 assert.equal(ledger.ingest(data),0);
 const r=ledger.report();
 assert.equal(r.summary.closed,1);assert.equal(r.summary.wins,1);assert.equal(r.summary.losses,0);
 assert.equal(r.summary.winRate,100);assert.equal(r.summary.grossRealizedUSDT,65);
 assert.equal(r.summary.usdtFees,7);assert.equal(r.summary.netExFundingUSDT,58);
 assert.equal(r.positions[0].fills,4);assert.equal(r.positions[0].result,'WIN');
 assert.deepEqual(r.positions[0].exitReasons,['TP1','TP2','SL']);
 assert.equal(r.curve[0].cumulative,58);
 ledger.close();
});
test('Open position and partial TP never inflate win rate or closed PnL',t=>{
 const ledger=new LiveStatsLedger(pathFor(t));ledger.register(order(100,'ENTRY','BUY'));
 ledger.register(order(101,'TP1','SELL'));
 ledger.ingest([fill(1,100,'BUY',1,10000,0,4),fill(2,101,'SELL',.33,10100,33,1)]);
 const r=ledger.report();assert.equal(r.summary.open,1);assert.equal(r.summary.closed,0);
 assert.equal(r.summary.winRate,null);assert.equal(r.summary.netExFundingUSDT,0);
 assert.ok(Math.abs(r.openPositions[0].remaining-.67)<1e-9);ledger.close();
});
test('Non-bot Binance fills and other symbols are never attributed to bot',t=>{
 const ledger=new LiveStatsLedger(pathFor(t));ledger.register(order(100,'ENTRY','BUY'));
 assert.equal(ledger.ingest([fill(1,999,'BUY',2,10000,500,1),
  {...fill(2,100,'BUY',1,10000,0,1),symbol:'ETHUSDT'}]),0);
 assert.equal(ledger.report().summary.closed,0);
 assert.throws(()=>ledger.register({orderId:123,groupId:'test',clientId:'MANUAL-order',role:'ENTRY',side:'BUY'}),/registration/);
 ledger.close();
});
test('Real fills persist SQLite and can be read after restart without API secrets',t=>{
 const path=pathFor(t);let ledger=new LiveStatsLedger(path);
 ledger.register(order(100,'ENTRY','BUY'));ledger.register(order(101,'CLOSE','SELL'));
 ledger.ingest([fill(1,100,'BUY',1,10000,0,2),fill(2,101,'SELL',1,10010,10,2)]);
 ledger.close();
 const report=readLiveReport(path);
 assert.equal(report.summary.closed,1);assert.equal(report.summary.netExFundingUSDT,6);
 ledger=new LiveStatsLedger(path);assert.equal(ledger.ingest([fill(1,100,'BUY',1,10000,0,2)]),0);ledger.close();
});
test('Fees in non-USDT are NOT silently counted as USDT',t=>{
 const ledger=new LiveStatsLedger(pathFor(t));
 ledger.register(order(100,'ENTRY','BUY'));ledger.register(order(101,'CLOSE','SELL'));
 ledger.ingest([fill(1,100,'BUY',1,10000,0,1,'BNB'),fill(2,101,'SELL',1,10010,10,1)]);
 const r=ledger.report();assert.equal(r.summary.closed,1);
 assert.equal(r.summary.incomplete,1);assert.equal(r.positions[0].netExFundingUSDT,null);
 assert.equal(r.summary.winRate,null);ledger.close();
});
test('Only registered order IDs are queried from Binance, with no trading endpoint',async t=>{
 const ledger=new LiveStatsLedger(pathFor(t));ledger.register(order(100,'ENTRY','BUY'));
 const calls=[];
 const reader={get:async(path,params)=>{calls.push({path,params});return [fill(1,100,'BUY',.25,10000,0,.5)]}};
 const s=await syncKnownOrderFills(reader,ledger);assert.equal(s.tracked,1);assert.equal(s.newFills,1);
 assert.equal(calls[0].path,'/fapi/v1/userTrades');
 assert.deepEqual(calls[0].params,{symbol:'BTCUSDT',orderId:'100',limit:1000});
 ledger.close();
});
test('Empty report explicitly distinguishes no real trades from zero win rate',()=>{
 const r=emptyLiveReport();assert.equal(r.summary.closed,0);assert.equal(r.summary.winRate,null);
 assert.equal(r.registeredOrders,0);
});
import {readFileSync} from 'node:fs';
test('Real stats endpoint and UI are independent of paper report and do not arm live trading',()=>{
 const r=path=>readFileSync(new URL('./'+path,import.meta.url),'utf8');
 const server=r('server.mjs'),ui=r('BINANCE_UI_PREVIEW.html'),build=r('BUILD_PORTABLE.ps1');
 assert.match(server,/\/api\/binance\/live-report/);
 assert.match(server,/readLiveReport/);
 assert.match(ui,/id="realHistory"/);assert.match(ui,/id="realCurve"/);
 assert.match(ui,/id="realNet"/);assert.match(ui,/realStats/);
 assert.match(ui,/id="enabled" type="checkbox"/);
 assert.match(build,/'binance-live-stats\.mjs'/);
});

test('Binance Income tradeId matches OCC fill fee/PnL; funding and unknown trades are separate, never misattributed',t=>{
 const path=pathFor(t),ledger=new LiveStatsLedger(path),now=Date.now();
 ledger.register(order(100,'ENTRY','BUY'));ledger.register(order(101,'SL','SELL'));
 const source=[fill(1,100,'BUY',.004,78000,0,.15),
  fill(2,101,'SELL',.004,77375,-2.5,.16)];
 source.forEach(x=>x.time=now-60000+x.id);
 ledger.ingest(source);
 const income=(tranId,tradeId,incomeType,income)=>({
  symbol:'BTCUSDT',tranId,tradeId,incomeType,income:String(income),asset:'USDT',time:now-50000+tranId
 });
 const events=[income(3001,'1','COMMISSION',-.15),
  income(3002,'2','COMMISSION',-.16),income(3003,'2','REALIZED_PNL',-2.5),
  income(3004,'','FUNDING_FEE',-.12),
  income(3005,'999','REALIZED_PNL',-4.2)];
 assert.equal(ledger.ingestIncome(events),5);
 assert.equal(ledger.ingestIncome(events),0);
 const x=ledger.report(),p=x.positions[0];
 assert.equal(p.auditStatus,'MATCHED');
 assert.equal(p.netBinanceUSDT,-2.81);
 assert.equal(p.netExFundingUSDT,-2.81);
 assert.equal(x.summary.binanceAuditedClosed,1);
 assert.equal(x.incomeAudit.fundingUSDT,-.12);
 assert.equal(x.incomeAudit.unmatchedTradeEvents,1);
 assert.equal(x.incomeAudit.unmatchedTradeIncomeUSDT,-4.2);
 assert.equal(x.incomeAudit.matchedTradeIncomeUSDT,-2.81);
 assert.equal(x.incomeAudit.matchedTradeEvents,3);
 assert.equal(Number((x.incomeAudit.matchedTradeIncomeUSDT+x.incomeAudit.unmatchedTradeIncomeUSDT+
  x.incomeAudit.fundingUSDT).toFixed(8)),x.incomeAudit.totalUSDT);
 assert.equal(x.incomeAudit.totalUSDT,-7.13);
 ledger.close();
 const stored=readLiveReport(path);
 assert.equal(stored.positions[0].netBinanceUSDT,-2.81);
 assert.equal(stored.incomeAudit.fundingUSDT,-.12);
 assert.equal(stored.incomeAudit.matchedTradeIncomeUSDT,-2.81);
});
test('Missing or disagreeing Binance Income never produces a falsely audited Net',t=>{
 const ledger=new LiveStatsLedger(pathFor(t)),now=Date.now();
 ledger.register(order(100,'ENTRY','BUY'));ledger.register(order(101,'SL','SELL'));
 const row1=fill(1,100,'BUY',.004,78000,0,.15),row2=fill(2,101,'SELL',.004,77375,-2.5,.16);
 row1.time=now-1000;row2.time=now-900;
 ledger.ingest([row1,row2]);
 const event=(tranId,tradeId,incomeType,income)=>({
  symbol:'BTCUSDT',tranId,tradeId,incomeType,income:String(income),asset:'USDT',time:now-700
 });
 ledger.ingestIncome([event(4001,'1','COMMISSION',-.15),event(4002,'2','REALIZED_PNL',-2.5)]);
 let x=ledger.report();
 assert.equal(x.positions[0].auditStatus,'PENDING');
 assert.equal(x.positions[0].netBinanceUSDT,null);
 ledger.ingestIncome([event(4003,'2','COMMISSION',-.26)]);
 x=ledger.report();
 assert.equal(x.positions[0].auditStatus,'MISMATCH');
 assert.equal(x.positions[0].netBinanceUSDT,null);
 assert.equal(x.summary.binanceAuditedClosed,0);
 ledger.close();
});
test('Income from another symbol is never part of BTCUSDT account comparison',t=>{
 const ledger=new LiveStatsLedger(pathFor(t));
 assert.equal(ledger.ingestIncome([{
  symbol:'ETHUSDT',tranId:5001,tradeId:'1',incomeType:'REALIZED_PNL',
  income:'-100',asset:'USDT',time:Date.now()}]),0);
 assert.equal(ledger.report().incomeAudit.available,false);
 ledger.close();
});
