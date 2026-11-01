import test from 'node:test';
import assert from 'node:assert/strict';
import {sizeBTC,validateLiveConfig,roundTick,liveTargets,previewLiveSizing} from './futures-sizing.mjs';
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

test('live sizing preview warns before order and computes smallest supported cent margin',()=>{
 const filters={stepSize:.001,minQty:.001,minNotional:100};
 const small=previewLiveSizing({marginUSDT:20,leverage:5},filters,78118,800);
 assert.equal(small.status,'invalid');
 assert.ok(small.minimumMarginUSDT>20);
 assert.match(small.message,/Ký quỹ.*quá nhỏ/);
 const exact=previewLiveSizing({marginUSDT:small.minimumMarginUSDT,leverage:5},filters,78118,800);
 assert.equal(exact.status,'valid');
 assert.equal(exact.legsBTC.length,3);
 assert.ok(exact.legsBTC.every(x=>x>=filters.minQty));
 const justBelow=previewLiveSizing({marginUSDT:small.minimumMarginUSDT-.01,leverage:5},filters,78118,800);
 assert.equal(justBelow.status,'invalid');
});
test('live sizing preview shows unavailable without fresh price or exchange lot filters',()=>{
 const config={marginUSDT:100,leverage:5};
 assert.equal(previewLiveSizing(config,null,78000,800).status,'unavailable');
 assert.equal(previewLiveSizing(config,{stepSize:.001,minQty:.001,minNotional:100},null,800).status,'unavailable');
});
test('live sizing preview rejects insufficient wallet and unsuitable TP weights',()=>{
 const f={stepSize:.001,minQty:.001,minNotional:100};
 const lowWallet=previewLiveSizing({marginUSDT:150,leverage:5},f,78000,25);
 assert.equal(lowWallet.status,'invalid');
 assert.match(lowWallet.message,/Số dư khả dụng/);
 const weights=previewLiveSizing({marginUSDT:100,leverage:5,tp1Qty:.001,tp2Qty:49},f,78000,800);
 assert.equal(weights.status,'invalid');
 assert.match(weights.message,/Không thể chia đủ 3 TP/);
});
