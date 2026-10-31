import test from 'node:test';
import assert from 'node:assert/strict';
import {sizeBTC,validateLiveConfig,roundTick,liveTargets} from './futures-sizing.mjs';
test('margin times leverage and BTC step sizing',()=>{
 const config=validateLiveConfig({marginUSDT:500,leverage:5});
 const result=sizeBTC({entry:77000,availableUSDT:800,step:.001,minQty:.001,minNotional:100},config);
 assert.equal(result.notional,2500);assert.equal(result.qty,.032);
 assert.deepEqual(result.legs,[.01,.01,.012]);
});
test('small margin fails when it cannot produce three valid TP legs',()=>{
 assert.throws(()=>sizeBTC({entry:77000,availableUSDT:400,step:.001,minQty:.001,minNotional:100},{marginUSDT:20,leverage:5}));
});
test('risk boundaries and LONG SHORT levels',()=>{
 assert.throws(()=>validateLiveConfig({leverage:5.5}));
 assert.equal(roundTick(1000.07,.1,'up'),1000.1);
 const config=validateLiveConfig({tpMode:'Points',tp1Val:5,tp2Val:10,tp3Val:20});
 assert.equal(liveTargets(1000,'SHORT',config).tp1,995);
});
