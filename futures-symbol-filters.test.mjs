import test from 'node:test';
import assert from 'node:assert/strict';
import {commonQuantityStep,symbolExecutionFilters} from './futures-symbol-filters.mjs';
import {draftProtectedOrder} from './futures-order-plan.mjs';
const f=(filterType,config)=>({filterType,...config});
const symbol=(marketStep='.01',lotStep='.001')=>({symbol:'SOLUSDT',filters:[
 f('MARKET_LOT_SIZE',{stepSize:marketStep,minQty:marketStep,maxQty:'100'}),
 f('LOT_SIZE',{stepSize:lotStep,minQty:lotStep,maxQty:'120'}),
 f('PRICE_FILTER',{tickSize:'.01'}),f('MIN_NOTIONAL',{notional:'5'})
]});
test('Combined market and protective LOT_SIZE uses common multiple, not smaller market-only steps',()=>{
 assert.equal(commonQuantityStep('0.001','0.01'),0.01);
 assert.equal(commonQuantityStep('0.02','0.03'),0.06);
 const filters=symbolExecutionFilters(symbol(),{strict:true});
 assert.equal(filters.stepSize,0.01);
 assert.equal(filters.minQty,0.01);
 assert.equal(filters.maxQty,100);
 assert.equal(filters.minNotional,5);
 assert.equal(filters.tickSize,0.01);
});
test('Unknown filter/unsupported contract quantity fails closed BEFORE sending entry',()=>{
 assert.throws(()=>symbolExecutionFilters({filters:[]},{strict:true}),/LOT_SIZE/);
 const bad=symbol();
 bad.filters=bad.filters.filter(x=>x.filterType!=='MIN_NOTIONAL');
 assert.throws(()=>symbolExecutionFilters(bad,{strict:true}),/MIN_NOTIONAL/);
 assert.throws(()=>commonQuantityStep(0,0.001),/missing step/);
});
test('Order plan rejects maxQty and any of three TP legs below symbol min notional',()=>{
 const account={symbol:'SOLUSDT',contractType:'PERPETUAL',
  dualSidePosition:false,marginType:'ISOLATED',leverage:5,canTrade:true,
  hasOtherPositions:false,hasUnknownOrders:false,positionBTC:0,availableUSDT:1000};
 const filters={stepSize:0.01,minQty:0.01,maxQty:5,minNotional:5,tickSize:0.01};
 const plan=draftProtectedOrder({side:'LONG',account,filters,quotePrice:100},
  {marginUSDT:100,leverage:5});
 assert.equal(plan.symbol,'SOLUSDT');
 assert.ok(plan.legsBTC.every(x=>x>0));
 assert.throws(()=>draftProtectedOrder({side:'LONG',account,filters:{...filters,maxQty:1},quotePrice:100},
  {marginUSDT:100,leverage:5}),/maximum quantity/);
 assert.throws(()=>draftProtectedOrder({side:'LONG',account,filters:{...filters,minNotional:170},quotePrice:100},
  {marginUSDT:100,leverage:5}),/TP leg|minimum notional/);
});
