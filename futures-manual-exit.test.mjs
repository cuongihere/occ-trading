import test from 'node:test';
import assert from 'node:assert/strict';
import {validateManagedExit,manualExitControls} from './futures-manual-exit.mjs';
const prefix='OCCBTC-0123456789abcd';
const managed={entry:{side:'LONG',orderId:'100',clientPrefix:prefix,qty:.032},
 stop:{role:'SL',id:'200',clientId:prefix+'-SL'},
 tps:[...['TP1','TP2','TP3'].map((role,i)=>({
  role,id:String(201+i),clientId:prefix+'-'+role,qty:[.01,.01,.012][i]
 }))]};
const acct={canTrade:true,dualSidePosition:false,marginType:'ISOLATED',
 hasOtherPositions:false,openOrders:0,positionBTC:.032};
const entryOrder={orderId:100,symbol:'BTCUSDT',side:'BUY',
 positionSide:'BOTH',clientOrderId:prefix,status:'FILLED',type:'MARKET',executedQty:'.032'};
const algos=[
 {symbol:'BTCUSDT',positionSide:'BOTH',algoId:200,clientAlgoId:prefix+'-SL',
  side:'SELL',orderType:'STOP_MARKET',closePosition:true,algoStatus:'NEW'},
 ...managed.tps.map((t,i)=>({symbol:'BTCUSDT',positionSide:'BOTH',algoId:Number(t.id),
  clientAlgoId:t.clientId,side:'SELL',orderType:'TAKE_PROFIT_MARKET',
  reduceOnly:true,quantity:String(t.qty),algoStatus:'NEW'}))
];
const opts={managed,account:acct,algos,entryOrder,
 filters:{stepSize:.001,minQty:.001},role:'TP2',expectedRemainingBTC:.032,
 expectedEntryOrderId:100};
test('TP2 manually closes only the exact pending Binance TP quantity and keeps stop/others',()=>{
 const result=validateManagedExit(opts);
 assert.equal(result.closeQty,.01);
 assert.equal(result.remainingBTC,.022);
 assert.equal(result.leg.role,'TP2');
 assert.equal(result.stop.clientAlgoId,prefix+'-SL');
 assert.equal(result.active.length,4);
});
test('ALL closes remaining BTC even when stop is missing, only if every other Algo is OCC-owned',()=>{
 const state=validateManagedExit({...opts,role:'ALL',
  algos:algos.filter(x=>x.orderType!=='STOP_MARKET')});
 assert.equal(state.closeQty,.032);
 assert.equal(state.remainingBTC,0);
});
test('Reject foreign Algo IDs and stale UI quantities before any exchange writes',()=>{
 assert.throws(()=>validateManagedExit({...opts,expectedRemainingBTC:.031}),/khối lượng BTC thay đổi|Khối lượng BTC thay đổi/);
 assert.throws(()=>validateManagedExit({...opts,expectedEntryOrderId:200}),/màn hình đã thay đổi/);
 assert.throws(()=>validateManagedExit({...opts,algos:[...algos,{...algos[1],algoId:333}]}),/không thuộc OCC/);
 assert.throws(()=>validateManagedExit({...opts,algos:algos.filter(x=>x.algoId!==200)}),/STOP bảo vệ/);
 assert.throws(()=>validateManagedExit({...opts,entryOrder:{...entryOrder,clientOrderId:'manual'}}),/Entry do OCC/);
});
test('Buttons only enable actual verified pending TP and a managed BTC position',()=>{
 const levels=algos.map(x=>({id:String(x.algoId),role:x.orderType==='STOP_MARKET'?'SL':'TP',
  active:true,confirmed:true,origin:'BOT_ĐANG_QUẢN_LÝ',quantityBTC:Number(x.quantity||.032),price:78000}));
 const data={status:'open',normalOrderCount:0,position:{quantityBTC:.032},levels};
 const controls=manualExitControls(data,managed);
 assert.equal(controls.allowed,true);
 assert.equal(controls.TP1.quantityBTC,.01);
 assert.equal(controls.ALL.quantityBTC,.032);
 const missing=manualExitControls({...data,levels:levels.filter(x=>x.id!=='202')},managed);
 assert.equal(missing.TP2,null);
 assert.equal(missing.TP1.quantityBTC,.01);
 assert.equal(manualExitControls(data,managed,{halted:true,intentPhase:'MANUAL_MARKET_SENDING'}).allowed,false);
 assert.equal(manualExitControls({...data,status:'flat'},managed).allowed,false);
 assert.equal(manualExitControls({...data,normalOrderCount:1},managed).allowed,false);
});
