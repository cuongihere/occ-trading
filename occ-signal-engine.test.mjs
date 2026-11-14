import test from 'node:test';
import assert from 'node:assert/strict';
import {OCCSignalEngine,M15,H4} from './occ-signal-engine.mjs';
import {OCCEngine} from './engine.mjs';
const bar=(time,o,c,period)=>({time,open:o,close:c,closeTime:time+period-1});
function warm(){
 const h4=Array.from({length:10},(_,i)=>bar(i*H4,100,100,H4));
 const start=10*H4;
 const m15=[bar(start,100,100,M15)];
 return {h4,m15,now:start+M15,first:start};
}
test('Production-only signal engine preserves causal SMMA H4 reference exactly',()=>{
 const w=warm(),a=new OCCSignalEngine(),b=new OCCEngine();
 a.warmup(w.h4,w.m15,w.now);b.warmup(w.h4,w.m15,w.now);
 assert.deepEqual(a.history,b.history);
 a.setHealthy(true);a.setRunning(true);
 b.setHealthy(true);b.setRunning(true);
 const closes=[103,107,98,101,104,96,95,108,92,110,100,99,101,106];
 for(let k=0;k<closes.length;k++){
  const input=bar(w.first+(k+1)*M15,100,closes[k],M15),opts={live:true,observedAt:input.closeTime+10};
  const m=a.onCandle(input,opts),n=b.onCandle(input,opts);
  assert.deepEqual(a.history.at(-1),b.history.at(-1));
  assert.equal(m?.side,n?.side);
  assert.equal(m?.candleClose,n?.candleClose);
  assert.equal(m?.crossPrice,n?.crossPrice);
  assert.equal(m?.triggerPrice,n?.triggerPrice);
  assert.equal(m?.eligible,n?.eligible);
 }
 assert.equal('trades' in a,false);
 assert.equal('balance' in a,false);
 assert.equal('onTrade' in a,false);
 assert.equal('makeLegs' in a,false);
 assert.equal('exitTrigger' in a,false);
});
