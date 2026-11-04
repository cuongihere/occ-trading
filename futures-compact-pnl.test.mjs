import test from 'node:test';
import assert from 'node:assert/strict';
import {projectCompactSLTP} from './futures-compact-pnl.mjs';
const filters={stepSize:.001,minQty:.001,minNotional:5,tickSize:.1};
const config={marginUSDT:70,leverage:5,side:'BOTH',slPercent:.8,tpMode:'Percent',
 tp1Val:1.5,tp2Val:3,tp3Val:5,tp1Qty:33,tp2Qty:33,reverseOnSignal:false};
const open={side:'LONG',entryPrice:78000,quantityBTC:.004};
test('four compact levels use actual Binance lot rounding, not displayed configured shares',()=>{
 const r=projectCompactSLTP({position:open,config,filters});
 assert.equal(r.status,'ready');assert.equal(r.basis,'open');
 assert.deepEqual(r.rows.map(x=>x.role),['SL','TP1','TP2','TP3']);
 assert.deepEqual(r.rows.map(x=>x.price),[77376,79170,80340,81900]);
 assert.deepEqual(r.rows.map(x=>x.quantityBTC),[.004,.001,.001,.002]);
 assert.deepEqual(r.rows.map(x=>x.grossUSDT),[-2.496,1.17,2.34,7.8]);
 assert.deepEqual(r.rows.map(x=>x.configuredSharePercent),[100,33,33,34]);
 assert.deepEqual(r.rows.map(x=>x.effectiveSharePercent),[100,25,25,50]);
 assert.equal(r.allocationRounded,true);
});
test('flat account shows clearly marked illustrative long using live BTC price and 70 USDT margin',()=>{
 const r=projectCompactSLTP({config,filters,referencePrice:78000,availableUSDT:271.52});
 assert.equal(r.status,'ready');assert.equal(r.basis,'illustration');
 assert.equal(r.side,'LONG');assert.equal(r.quantityBTC,.004);
 assert.equal(r.rows[1].grossUSDT,1.17);
 assert.match(r.note,/chưa có lệnh/);
});
test('explicit short mode flips the PnL correctly with tick rounding',()=>{
 const short=projectCompactSLTP({position:{side:'SHORT',entryPrice:78000,quantityBTC:.004},
  config:{...config,side:'SHORT'},filters});
 assert.deepEqual(short.rows.map(x=>x.price),[78624,76830,75660,74100]);
 assert.deepEqual(short.rows.map(x=>x.grossUSDT),[-2.496,1.17,2.34,7.8]);
});
test('Points TP mode follows exact absolute-price distances instead of percentages',()=>{
 const r=projectCompactSLTP({position:open,config:{...config,tpMode:'Points',tp1Val:500,tp2Val:1000,tp3Val:1500},filters});
 assert.deepEqual(r.rows.map(x=>x.price),[77376,78500,79000,79500]);
 assert.deepEqual(r.rows.map(x=>x.grossUSDT),[-2.496,.5,1,3]);
});
test('missing quote or too small live position displays unavailable, never invented PnL',()=>{
 assert.equal(projectCompactSLTP({config,filters,referencePrice:null,availableUSDT:200}).status,'unavailable');
 assert.equal(projectCompactSLTP({position:{...open,quantityBTC:.002},config,filters}).status,'unavailable');
 assert.equal(projectCompactSLTP({config,filters:null,referencePrice:78000,availableUSDT:200}).status,'unavailable');
});
