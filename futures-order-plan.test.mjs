import test from 'node:test';
import assert from 'node:assert/strict';
import {draftProtectedOrder,validateExchangeState} from './futures-order-plan.mjs';
const account={symbol:'BTCUSDT',contractType:'PERPETUAL',dualSidePosition:false,
 marginType:'ISOLATED',leverage:5,canTrade:true,hasOtherPositions:false,
 hasUnknownOrders:false,positionBTC:0,availableUSDT:800};
const filters={stepSize:.001,minQty:.001,minNotional:100,tickSize:.1};
test('drafts BTC-only stop-first execution plan with three TP quantities',()=>{
 const p=draftProtectedOrder({side:'LONG',account,filters,quotePrice:77000},{marginUSDT:500,leverage:5});
 assert.equal(p.notionalUSDT,2500);assert.equal(p.qtyBTC,.032);
 assert.deepEqual(p.legsBTC,[.01,.01,.012]);
 assert.ok(p.stopPrice<77000);assert.ok(p.tpPrices.every(x=>x>77000));
});
test('preflight rejects unsafe leverage, hedge mode, and occupied account',()=>{
 assert.throws(()=>validateExchangeState({...account,leverage:10},{leverage:5}),/mismatch/);
 assert.throws(()=>validateExchangeState({...account,dualSidePosition:true},{leverage:5}),/One-way/);
 assert.throws(()=>validateExchangeState({...account,positionBTC:.001},{leverage:5}),/flat/);
});
test('preflight rejects small 20 USDT position with invalid three TP legs',()=>{
 assert.throws(()=>draftProtectedOrder({side:'LONG',account,filters,quotePrice:77000},{marginUSDT:20,leverage:5}));
});
