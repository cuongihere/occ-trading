import test from 'node:test';
import assert from 'node:assert/strict';
import {startState,recoverState,transition} from './futures-lifecycle.mjs';
test('STOP must be verified before any of three TP acknowledgements',()=>{
 let s=transition(startState(),{type:'ARM',preflightPassed:true});
 s=transition(s,{type:'SIGNAL',side:'LONG',clientId:'OCCBTC-safe001'});
 assert.throws(()=>transition(s,{type:'TP_ACK',algoId:'11'}),/SL must|Stop|before/);
 s=transition(s,{type:'ENTRY_FILLED',orderId:'100'});
 assert.throws(()=>transition(s,{type:'TP_ACK',algoId:'11'}),/SL must|Stop|before/);
 s=transition(s,{type:'STOP_ACK',algoId:'10'});
 for(const id of ['11','12','13'])s=transition(s,{type:'TP_ACK',algoId:id});
 assert.equal(s.phase,'MANAGED');assert.equal(s.tpIds.length,3);
 assert.throws(()=>transition(s,{type:'TP_ACK',algoId:'14'}),/excess/);
 s=transition(s,{type:'CLOSE_PENDING'});
 assert.throws(()=>transition(s,{type:'FLAT_VERIFIED',noOpenOrders:false}),/FLAT/);
 s=transition(s,{type:'FLAT_VERIFIED',noOpenOrders:true});assert.equal(s.phase,'IDLE');
});
test('uncertain exchange entry blocks duplicate orders and restart auto-arming',()=>{
 let s=transition(startState(),{type:'ARM',preflightPassed:true});
 s=transition(s,{type:'SIGNAL',side:'SHORT',clientId:'OCCBTC-safe002'});
 s=transition(s,{type:'ENTRY_UNKNOWN'});
 assert.equal(s.armed,false);assert.equal(s.phase,'ENTRY_UNKNOWN');
 assert.throws(()=>transition(s,{type:'SIGNAL',side:'SHORT',clientId:'OCCBTC-safe003'}));
 const restart=recoverState(s);assert.equal(restart.phase,'HALTED');
 assert.equal(restart.armed,false);
 assert.throws(()=>transition(restart,{type:'ARM',preflightPassed:true}));
});
test('recovery of managed position requires reconciliation',()=>{
 let s=transition(startState(),{type:'ARM',preflightPassed:true});
 s=transition(s,{type:'SIGNAL',side:'LONG',clientId:'OCCBTC-safe004'});
 s=transition(s,{type:'ENTRY_FILLED',orderId:'200'});
 s=transition(s,{type:'STOP_ACK',algoId:'300'});
 assert.equal(recoverState(s).phase,'HALTED');
});
