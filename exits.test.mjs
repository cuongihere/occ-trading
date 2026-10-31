import test from 'node:test';
import assert from 'node:assert/strict';
import {OCCEngine,H4,M15} from './engine.mjs';
import {summarize} from './stats.mjs';
const bar=(time,open,close,period=M15)=>({time,open,close,closeTime:time+period-1});
const start=8*H4,seed=Array.from({length:8},(_,i)=>bar(i*H4,100,100,H4));
function setup(config={},side='LONG'){
 const e=new OCCEngine({capital:10000,feeBps:0,slippageBps:0,qtyStep:0.001,...config});
 e.warmup(seed,[bar(start,100,100)],start+M15);e.setHealthy(true);e.setRunning(true);
 const time=start+2*M15;
 const signal=e.onCandle(bar(start+M15,100,side==='LONG'?108:92),{live:true,observedAt:time});
 assert.equal(signal.side,side);
 const opening=e.onTrade({price:1000,time,id:1},true);
 assert.equal(opening.length,1);assert.equal(opening[0].action,'OPEN');assert.equal(e.position.qty,1);
 return {e,time};
}
test('Default new session is always Multi TP v5 (no Classic setup required)',()=>{
 const {e}=setup();
 assert.equal(e.config.exitMode,'Multi TP v5');
 assert.deepEqual(e.position.legs.map(l=>l.id),['TP1','TP2','TP3']);
 assert.equal(e.levels().sl,990);
 assert.deepEqual(e.position.legs.map(l=>l.qty),[0.33,0.33,0.34]);
});
test('Legacy Classic checkpoint can be read without rewriting historical fills',()=>{
 const {e,time}=setup({exitMode:'Classic v3',classicSlPoints:0,classicTpPoints:0});
 const old=OCCEngine.restore(e.serialize());assert.equal(old.config.exitMode,'Classic v3');
 assert.equal(old.levels().sl,null);
 assert.equal(old.onTrade({price:800,time:time+1,id:8},true).length,0);
 assert.equal(old.position.qty,1);
});
test('Pre-exit legacy checkpoint defaults to historical no-SL/TP and cannot silently switch to Multi',()=>{
 const {e,time}=setup({exitMode:'Classic v3',classicSlPoints:0,classicTpPoints:0});
 const saved=e.serialize();delete saved.config.exitMode;delete saved.config.classicSlPoints;delete saved.config.classicTpPoints;
 const reopened=OCCEngine.restore(saved);
 assert.equal(reopened.config.exitMode,'Classic v3');
 assert.equal(reopened.levels().sl,null);
 assert.equal(reopened.onTrade({price:800,time:time+1,id:8},true).length,0);
});

test('Pine Multi TP v5 percent default 1% SL, TP 1/2/3%, 33/33/34 portions',()=>{
 const {e,time}=setup({exitMode:'Multi TP v5'});
 assert.equal(e.levels().sl,990);assert.equal(e.levels().tp1,1010);
 assert.equal(e.levels().tp2,1020);assert.equal(e.levels().tp3,1030);
 assert.deepEqual(e.position.legs.map(l=>l.qty),[0.33,0.33,0.34]);
 const a=e.onTrade({price:1010,time:time+1,id:2},true);
 assert.equal(a.length,1);assert.equal(a[0].reason,'TP1');assert.equal(a[0].qty,0.33);assert.equal(e.position.qty,0.67);
 const b=e.onTrade({price:1020,time:time+2,id:3},true);
 assert.equal(b.length,1);assert.equal(b[0].reason,'TP2');assert.equal(e.position.qty,0.34);
 e.setRunning(false); // new entries paused; protective existing exits remain active
 const c=e.onTrade({price:988,time:time+3,id:4},true);
 assert.equal(c.length,1);assert.equal(c[0].reason,'SL');assert.equal(c[0].qty,0.34);
 assert.equal(c[0].price,988);assert.equal(e.position,null);
 const stats=summarize(e.trades);assert.equal(stats.summary.closed,1);
 assert.equal(stats.positions[0].exits.length,3);
 assert.equal(stats.positions[0].netPnl,0.33*10+0.33*20-0.34*12);
});
test('Multiple TP crosses on one observed tick close each tranche once',()=>{
 const {e,time}=setup({exitMode:'Multi TP v5'});
 const closes=e.onTrade({price:1040,time:time+1,id:2},true);
 assert.deepEqual(closes.map(f=>f.reason),['TP1','TP2','TP3']);
 assert.equal(e.position,null);
 assert.equal(e.onTrade({price:1040,time:time+1,id:2},true).length,0);
 assert.equal(summarize(e.trades).summary.closed,1);
});
test('Multi SHORT Points means raw price difference and supports selective targets',()=>{
 const {e,time}=setup({exitMode:'Multi TP v5',tpMode:'Points',slPercent:2,tp1Val:5,tp2Val:15,tp3Val:25,tp1Qty:50,tp2Qty:25},'SHORT');
 assert.equal(e.levels().sl,1020);assert.equal(e.levels().tp1,995);
 assert.equal(e.levels().tp2,985);assert.equal(e.levels().tp3,975);
 assert.deepEqual(e.position.legs.map(l=>l.qty),[0.5,0.25,0.25]);
 const c=e.onTrade({price:994,time:time+1,id:2},true);
 assert.equal(c.length,1);assert.equal(c[0].price,995);
 assert.equal(e.position.qty,0.5);
});
test('Stop disabled and TP disabled legs remain until opposite signal closes them',()=>{
 const {e,time}=setup({exitMode:'Multi TP v5',slPercent:0,tp1Val:0,tp2Val:0,tp3Val:0});
 assert.equal(e.levels().sl,null);
 assert.equal(e.onTrade({price:500,time:time+1,id:2},true).length,0);
 assert.equal(e.position.qty,1);
});
test('Partial fills survive restart, and a complete position counts only once',()=>{
 const {e,time}=setup({exitMode:'Multi TP v5'});
 e.onTrade({price:1010,time:time+1,id:2},true);
 const before=summarize(e.trades);assert.equal(before.summary.closed,0);assert.equal(before.openPositions[0].remainingQty,0.67);
 const restored=OCCEngine.restore(e.serialize());assert.equal(restored.running,false);
 assert.equal(restored.position.qty,0.67);assert.equal(restored.position.legs.length,2);
 restored.setHealthy(true);
 const fills=restored.onTrade({price:1035,time:time+2,id:3},true);
 assert.deepEqual(fills.map(f=>f.reason),['TP2','TP3']);
 assert.equal(summarize(restored.trades).summary.closed,1);
});
test('Invalid exit settings rejected for both Multi TP and legacy Classic configurations',()=>{
 assert.throws(()=>new OCCEngine({classicSlPoints:1.5}),/settings/);
 assert.throws(()=>new OCCEngine({exitMode:'unknown'}),/settings/);
 assert.throws(()=>new OCCEngine({tpMode:'Ticks'}),/settings/);
 assert.throws(()=>new OCCEngine({slPercent:-1}),/settings/);
});
