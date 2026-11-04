import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeFuturesPosition} from './futures-position-analysis.mjs';

const risk=(qty='.004',entry='78000',mark='78275')=>[{
 symbol:'BTCUSDT',positionSide:'BOTH',positionAmt:qty,entryPrice:entry,markPrice:mark,
 liquidationPrice:'62705.45',unRealizedProfit:'1.10',positionInitialMargin:'62.4'
}];
const sl=(id=1,price='77376',side='SELL')=>({
 symbol:'BTCUSDT',algoId:id,clientAlgoId:'OCCBTC-test-SL',algoStatus:'NEW',
 orderType:'STOP_MARKET',triggerPrice:price,side,closePosition:true
});
const tp=(id,price,quantity,side='SELL')=>({
 symbol:'BTCUSDT',algoId:id,clientAlgoId:'OCCBTC-test-TP'+id,algoStatus:'NEW',
 orderType:'TAKE_PROFIT_MARKET',triggerPrice:String(price),quantity:String(quantity),side,reduceOnly:'true'
});
const algos=()=>[sl(),tp(2,79170,.001),tp(3,80340,.001),tp(4,81900,.002)];
const analyze=(overrides={})=>analyzeFuturesPosition({riskRows:risk(),algoOrders:algos(),openOrders:[],
 checkpoint:{stop:{id:'1',clientId:'OCCBTC-test-SL'},tps:[{id:'2',clientId:'OCCBTC-test-TP2'},
  {id:'3',clientId:'OCCBTC-test-TP3'},{id:'4',clientId:'OCCBTC-test-TP4'}]},
 managed:true,fetchedAt:1000,leverage:5,
 ...overrides});
const nearly=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,'Expected '+a+' close to '+b);

test('Long position reads actual SL and each TP; gross USDT for all four paths',()=>{
 const x=analyze();assert.equal(x.status,'open');assert.equal(x.position.side,'LONG');
 assert.equal(x.position.quantityBTC,.004);assert.equal(x.position.unrealizedUSDT,1.1);
 assert.equal(x.position.roiPercent,Number((1.1/62.4*100).toFixed(8)));
 assert.equal(x.slProtected,true);assert.equal(x.ownershipVerified,true);
 assert.deepEqual(x.levels.map(l=>l.role),['SL','TP','TP','TP']);
 assert.deepEqual(x.levels.map(l=>l.grossUSDT),[-2.496,1.17,2.34,7.8]);
 assert.deepEqual(x.scenarios.map(s=>s.label),[
  'SL ngay','Đạt TP1 → SL','Đạt TP1 + TP2 → SL','Đạt TP1 + TP2 + TP3 (đóng hết)']);
 x.scenarios.forEach((s,i)=>nearly(s.grossUSDT,[-2.496,-.702,2.262,11.31][i]));
 assert.equal(x.scenarios.at(-1).remainingBTC,0);
 assert.match(x.disclaimer,/chưa trừ phí/);
});

test('Short position reverses profitable trigger direction and honors close-all SL',()=>{
 const orders=[sl(11,78624,'BUY'),tp(12,76830,.001,'BUY'),tp(13,75660,.001,'BUY'),tp(14,74100,.002,'BUY')];
 const x=analyze({riskRows:risk('-.004','78000','77750'),algoOrders:orders});
 assert.equal(x.position.side,'SHORT');assert.equal(x.slProtected,true);
 assert.deepEqual(x.levels.map(l=>l.role),['SL','TP','TP','TP']);
 assert.deepEqual(x.levels.map(l=>l.grossUSDT),[-2.496,1.17,2.34,7.8]);
 assert.equal(x.ownershipVerified,false);
});

test('Partial TP filled earlier: only remaining BTC, live unfilled algo orders are included',()=>{
 const remaining=analyze({riskRows:risk('.002','78000','78500'),algoOrders:[
  sl(),tp(3,80340,.001),tp(4,81900,.001)]});
 assert.equal(remaining.position.quantityBTC,.002);
 assert.equal(remaining.scenarios[0].grossUSDT,-1.248);
 assert.equal(remaining.scenarios.at(-1).grossUSDT,6.24);
 assert.equal(remaining.scenarios.at(-1).remainingBTC,0);
 assert.equal(remaining.scenarios.length,3);
});

test('Missing or unsafe SL cannot produce invented SL-loss or after-TP scenarios',()=>{
 const x=analyze({algoOrders:[tp(2,79170,.001),tp(3,80340,.001),tp(4,81900,.002)]});
 assert.equal(x.slProtected,false);
 assert.ok(x.warnings.some(w=>w.includes('Không xác minh được lệnh SL')));
 assert.equal(x.scenarios.length,3);
 assert.equal(x.scenarios[0].grossUSDT,null);
 assert.equal(x.scenarios.at(-1).grossUSDT,11.31);
 const unsafe=analyze({algoOrders:[sl(1,77376,'BUY'),...algos().slice(1)]});
 assert.equal(unsafe.slProtected,false);
 assert.ok(unsafe.warnings.some(w=>w.includes('thiếu giá, sai chiều')));
});

test('Unverified external Algo orders show price but are never labeled OCC verified',()=>{
 const x=analyze({checkpoint:null,managed:false});
 assert.equal(x.ownershipVerified,false);
 assert.ok(x.levels.every(l=>l.origin==='CHƯA_XÁC_MINH'));
 assert.ok(x.warnings.some(w=>w.includes('Client Algo ID')));
});

test('Algo ID match without matching Binance clientAlgoId is never treated as confirmed OCC order',()=>{
 const x=analyze({algoOrders:[{...sl(),clientAlgoId:'external-SL'},...algos().slice(1)]});
 const stop=x.levels.find(l=>l.role==='SL');
 assert.equal(stop.origin,'CHƯA_XÁC_MINH');
 assert.equal(x.ownershipVerified,false);
 assert.ok(x.warnings.some(w=>w.includes('Client Algo ID')));
});
test('Checkpoint missing clientAlgoId must fail closed, not certify an algo by ID alone',()=>{
 const x=analyze({checkpoint:{stop:{id:'1'},tps:[{id:'2'},{id:'3'},{id:'4'}]}});
 assert.ok(x.levels.every(l=>l.origin==='CHƯA_XÁC_MINH'));
});
test('Flat position still shows orphaned algo protection as warning, never PnL scenario',()=>{
 const x=analyze({riskRows:[],checkpoint:null});
 assert.equal(x.status,'flat');assert.equal(x.position,null);assert.equal(x.scenarios.length,0);
 assert.equal(x.levels.length,4);assert.ok(x.levels.every(l=>l.grossUSDT===null));
 assert.ok(x.warnings[0].includes('còn lệnh đang mở'));
});

test('Unknown statuses or inconsistent TP sum do not silently promise protection',()=>{
 const a=algos();a[1].algoStatus='CANCELED';
 const x=analyze({algoOrders:a});
 assert.equal(x.levels[1].confirmed,false);
 assert.ok(x.warnings.some(w=>w.includes('chưa phủ hết vị thế')));
 const oversize=analyze({algoOrders:[sl(),tp(2,79170,.002),tp(3,80340,.002),tp(4,81900,.002)]});
 assert.ok(oversize.warnings.some(w=>w.includes('vượt vị thế')));
 assert.equal(oversize.scenarios.at(-1).remainingBTC,0);
 assert.equal(oversize.scenarios.at(-1).closedBTC,.004);
});

test('Invalid or ambiguous Binance risk snapshots fail closed',()=>{
 assert.throws(()=>analyze({riskRows:null}),/Không xác minh/);
 assert.throws(()=>analyze({riskRows:risk('invalid')}),/khối lượng/);
 assert.throws(()=>analyze({riskRows:risk('.004','0')}),/giá vào/);
 assert.throws(()=>analyze({riskRows:[...risk(),...risk()]}),/One-way/);
});
