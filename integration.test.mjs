// Deliberately synthetic unit-test fixtures only; never used by the production feed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OCCEngine,H4,M15} from './engine.mjs';
import {Store} from './store.mjs';
const bar=(time,open,close,period=M15)=>({time,open,close,closeTime:time+period-1});
const start=8*H4,h4=Array.from({length:8},(_,i)=>bar(i*H4,100,100,H4));
const warmup={h4,m15:[bar(start,100,100)],now:start+M15};
function setup(t){const dir=mkdtempSync(join(tmpdir(),'occ-integration-fixture-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return join(dir,'state.sqlite');}
function apply(engine,event){const p=event.payload;if(event.type==='warmup')engine.warmup(p.h4,p.m15,p.now);else if(event.type==='running'){engine.setHealthy(p.healthy);engine.setRunning(p.running);}else if(event.type==='candle')engine.onCandle(p.bar,p.opts);else if(event.type==='trade')engine.onTrade(p.trade,p.healthy);}
function stream(store,engine){let sequence=0;return(type,payload)=>{const e={type,payload,receivedAt:start+ ++sequence,exchangeAt:null};apply(engine,e);store.commit(e,engine.serialize());return e;};}
const candle=(offset,close)=>({bar:bar(start+offset*M15,100,close),opts:{live:true,observedAt:start+(offset+1)*M15}});
const trade=(offset,price,id)=>({trade:{price,time:start+(offset+1)*M15,id},healthy:true});
test('warmup full inputs and checkpoint consistent; collect-only never fills',t=>{const s=new Store(setup(t)),e=new OCCEngine();const send=stream(s,e);send('warmup',warmup);assert.deepEqual(s.allEvents()[0].payload,warmup);assert.deepEqual(s.load(),e.serialize());send('running',{healthy:true,running:false});send('candle',candle(1,108));send('trade',trade(1,108,1));assert.equal(s.snapshotRecords().signals.length,1);assert.equal(s.snapshotRecords().signals[0].eligible,false);assert.equal(s.snapshotRecords().fills.length,0);assert.equal(s.load().balance,10000);s.close();});
test('restart preserves fills and stable IDs; duplicate input creates no extra fill',t=>{const path=setup(t),s=new Store(path),e=new OCCEngine({slippageBps:0}),send=stream(s,e);send('warmup',warmup);send('running',{healthy:true,running:true});send('candle',candle(1,108));send('trade',trade(1,108,1));const before=e.snapshot();s.close();const reopened=new Store(path),restored=OCCEngine.restore(reopened.load());assert.equal(restored.running,false);const resumed=stream(reopened,restored);resumed('running',{healthy:true,running:true});resumed('candle',candle(1,108));resumed('trade',trade(1,108,1));assert.deepEqual(restored.snapshot().trades,before.trades);assert.equal(reopened.snapshotRecords().fills.length,1);assert.equal(restored.balance,before.balance);reopened.close();});
test('replay journaled relevant inputs reproduces all fills and exact balance',t=>{const s=new Store(setup(t)),e=new OCCEngine({feeBps:5,slippageBps:2});const initial=e.serialize();s.commit({type:'process_start',receivedAt:start,exchangeAt:null,payload:{initialState:initial,simulate:true}},initial);const send=stream(s,e);send('warmup',warmup);send('running',{healthy:true,running:true});send('candle',candle(1,108));send('trade',trade(1,108,1));send('candle',candle(2,92));send('trade',trade(2,92,2));const events=s.allEvents(),replayed=OCCEngine.restore(events[0].payload.initialState);for(const event of events.slice(1))apply(replayed,event);assert.deepEqual(replayed.trades,e.trades);assert.equal(replayed.balance,e.balance);assert.deepEqual(replayed.position,e.position);assert.equal(replayed.fees,e.fees);assert.equal(s.snapshotRecords().checkpointSeq,events.at(-1).seq);s.close();});
