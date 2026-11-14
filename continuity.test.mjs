import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OCCEngine,M15,H4} from './engine.mjs';
import {Store} from './store.mjs';
import {summarize} from './stats.mjs';
const bar=(time,open,close,period=M15)=>({time,open,close,closeTime:time+period-1});
function simulatedPosition(){
 const e=new OCCEngine({capital:10000,slippageBps:0,feeBps:0});
 const seed=Array.from({length:8},(_,i)=>bar(i*H4,100,100,H4));
 const start=8*H4;e.warmup(seed,[bar(start,100,100)],start+M15);
 e.setHealthy(true);e.setRunning(true);e.tradingEnabled=true;
 e.onCandle(bar(start+M15,100,108),{live:true,observedAt:start+2*M15});
 e.onTrade({price:1000,time:start+2*M15,id:1},true);
 return e;
}
function fixture(t){const folder=mkdtempSync(join(tmpdir(),'occ-continuity-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));return join(folder,'db.sqlite');}
const record=(store,type,payload,e,at)=>store.commit({type,payload,receivedAt:at,exchangeAt:null},e.serialize());
test('Configure Multi TP without wiping capital, session, fees, existing fills or signals',()=>{
 const e=simulatedPosition();const id=e.sessionId,opening=e.trades.length;
 assert.throws(()=>e.configure({slPercent:2}),/Tạm dừng/);
 e.setRunning(false);
 assert.throws(()=>e.configure({slPercent:2}),/đóng hết vị thế/);
 e.onTrade({price:1035,time:8*H4+2*M15+1000,id:2},true);
 assert.equal(e.position,null);
 const before={balance:e.balance,fees:e.fees,trades:JSON.stringify(e.trades),signals:JSON.stringify(e.signals)};
 e.configure({slPercent:2,tp1Val:1.5,tp2Val:3,tp3Val:5,tp1Qty:25,tp2Qty:25,feeBps:4});
 assert.equal(e.sessionId,id);assert.equal(e.balance,before.balance);assert.equal(e.fees,before.fees);
 assert.equal(JSON.stringify(e.trades),before.trades);assert.equal(JSON.stringify(e.signals),before.signals);
 assert.equal(e.config.slPercent,2);assert.equal(e.config.tp1Qty,25);assert.equal(e.config.feeBps,4);
 assert.ok(e.trades.length>opening);
});
test('After Ctrl+C shutdown, SQLite resume preserves intent and PnL but pauses pending entry until data warmup',t=>{
 const path=fixture(t);let store=new Store(path),e=simulatedPosition(),start=1000000;
 record(store,'process_start',{initialState:e.serialize(),activity:{running:true}},e,start++);
 const originalId=e.sessionId,oldTrade=e.trades.length,oldEquity=e.snapshot().equity;
 record(store,'process_stop',{activity:{running:false},tradingEnabled:true},e,start++);
 e.setRunning(false);
 record(store,'shutdown_checkpoint',{},e,start++);store.close();
 store=new Store(path);const raw=store.load(),restored=OCCEngine.restore(raw);
 assert.equal(raw.tradingEnabled,true);
 assert.equal(restored.tradingEnabled,true);assert.equal(restored.running,false);
 assert.equal(restored.position.qty,e.position.qty);
 assert.equal(restored.sessionId,originalId);assert.equal(restored.snapshot().equity,oldEquity);
 assert.equal(restored.trades.length,oldTrade);
 record(store,'offline_interval',{from:start,to:start+5000,reason:'shutdown',approximate:false},restored,start+5000);
 record(store,'process_start',{initialState:restored.serialize(),activity:{running:false}},restored,start+5000);
 assert.equal(store.sessions().length,1);
 const activity=store.activity();assert.ok(activity.some(x=>x.kind==='app_offline'&&x.from===start));
 store.close();
});
test('Offline duration and pause ledger summarize intervals including active pause',t=>{
 const store=new Store(fixture(t)),e=new OCCEngine();const base=200000;
 record(store,'process_start',{initialState:e.serialize(),activity:{running:false,reason:'startup'}},e,base);
 record(store,'user_start',{activity:{running:true,reason:'user resumed'}},e,base+2000);
 record(store,'status',{activity:{running:false,reason:'feed disconnected'}},e,base+8000);
 record(store,'process_stop',{activity:{running:false,reason:'shutdown'}},e,base+9000);
 record(store,'offline_interval',{from:base+9000,to:base+30000,reason:'Ứng dụng đã tắt',approximate:false},e,base+30000);
 record(store,'process_start',{initialState:e.serialize(),activity:{running:false,reason:'resync'}},e,base+30000);
 record(store,'status',{activity:{running:true,reason:'synced'}},e,base+32000);
 const all=store.activity(),offline=all.find(x=>x.kind==='app_offline');
 assert.deepEqual({from:offline.from,to:offline.to}, {from:base+9000,to:base+30000});
 const paused=all.filter(x=>x.kind==='trading_paused');
 assert.ok(paused.some(x=>x.from===base&&x.to===base+2000));
 assert.ok(paused.some(x=>x.from===base+8000&&x.to===base+32000));
 store.close();
});
test('An unfinished pause is displayed with no ending timestamp',t=>{
 const store=new Store(fixture(t)),e=new OCCEngine();record(store,'process_start',{initialState:e.serialize(),activity:{running:false,reason:'sync'}},e,100);
 assert.equal(store.activity()[0].to,null);store.close();
});
test('Legacy Paper journal remains offline and cannot be served by the Futures-only app',()=>{
 const dashboard=readFileSync(new URL('./dashboard.html',import.meta.url),'utf8');
 const server=readFileSync(new URL('./server.mjs',import.meta.url),'utf8');
 assert.match(dashboard,/<option value="all" selected>/);
 assert.match(dashboard,/id="activity"/);
 assert.match(dashboard,/control\('configure'/);
 assert.doesNotMatch(dashboard,/control\('reset'/);
 assert.doesNotMatch(server,/\/api\/activity/);
 assert.doesNotMatch(server,/type==='process_stop'/);
 assert.doesNotMatch(server,/tradingEnabled/);
 assert.doesNotMatch(server,/const selected=url\.searchParams\.get\('session'\)\|\|'all'/);
});
