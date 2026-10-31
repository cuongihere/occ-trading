import test from 'node:test';
import assert from 'node:assert/strict';
import {protectionRequests} from './futures-protection-plan.mjs';
test('STOP close-all excludes quantity/reduceOnly, then three TP market orders reserve exact BTC legs',()=>{
 const a=protectionRequests({side:'LONG',entryPrice:77000,filledQty:.032,stepSize:.001,
 tickSize:.1,clientPrefix:'OCCBTC-test001'},{slPercent:1,tp1Qty:33,tp2Qty:33});
 assert.equal(a.stop.closePosition,'true');
 assert.equal(a.stop.type,'STOP_MARKET');
 assert.equal(a.stop.quantity,undefined);
 assert.equal(a.stop.reduceOnly,undefined);
 assert.equal(a.tps.length,3);
 assert.ok(a.tps.every(x=>x.reduceOnly==='true'&&x.type==='TAKE_PROFIT_MARKET'));
 assert.deepEqual(a.qtys,[.01,.01,.012]);
 assert.ok(Number(a.stop.triggerPrice)<77000);
 assert.ok(a.tps.every(x=>Number(x.triggerPrice)>77000));
});
test('rejects tiny real BTC fill that cannot support three TP steps',()=>{
 assert.throws(()=>protectionRequests({side:'SHORT',entryPrice:77000,filledQty:.001,
 stepSize:.001,tickSize:.1,clientPrefix:'OCCBTC-tiny'},{tp1Qty:33,tp2Qty:33}),/step size/);
});
test('SHORT stop above entry and targets below entry',()=>{
 const a=protectionRequests({side:'SHORT',entryPrice:77000,filledQty:.032,stepSize:.001,
 tickSize:.1,clientPrefix:'OCCBTC-test002'},{slPercent:1,tp1Val:1,tp2Val:2,tp3Val:3});
 assert.equal(a.stop.side,'BUY');
 assert.ok(Number(a.stop.triggerPrice)>77000);
 assert.ok(a.tps.every(x=>Number(x.triggerPrice)<77000));
});
