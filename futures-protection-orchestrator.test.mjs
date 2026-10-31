import test from 'node:test';
import assert from 'node:assert/strict';
import {ProtectionCoordinator} from './futures-protection-orchestrator.mjs';
const settings={slPercent:1,tp1Qty:33,tp2Qty:33,tp1Val:1,tp2Val:2,tp3Val:3};
function fixture({failPost=null,orderStatus='FILLED',position=.032,mutateStop=null}={}){
 const actions=[],saved=[],alerts=[],active=[];
 const api={
  async get(path,params){
   actions.push({method:'GET',path,params});
   if(path==='/fapi/v1/order')return {symbol:'BTCUSDT',orderId:101,
    side:'BUY',status:orderStatus,positionSide:'BOTH',executedQty:'.032',avgPrice:'77000'};
   if(path==='/fapi/v3/positionRisk')return [{symbol:'BTCUSDT',positionSide:'BOTH',positionAmt:String(position)}];
   if(path==='/fapi/v1/openAlgoOrders')return active;
   throw Error('Unexpected GET '+path);
  },
  async post(path,params){
   actions.push({method:'POST',path,params});
   if(failPost===params.clientAlgoId)throw Error('network outcome unknown');
   const algoId=200+active.length,record={algoId,clientAlgoId:params.clientAlgoId,
    symbol:'BTCUSDT',algoStatus:'NEW',orderType:params.type,
    side:params.side,triggerPrice:params.triggerPrice,
    quantity:params.quantity||'',reduceOnly:params.reduceOnly==='true',
    closePosition:params.closePosition==='true'};
   active.push(mutateStop?.(record)||record);
   return {algoId,clientAlgoId:params.clientAlgoId};
  }
 };
 const checkpoint={save(s){saved.push(JSON.parse(JSON.stringify(s)));}};
 const c=new ProtectionCoordinator({api,checkpoint,settings,notify:x=>alerts.push(x)});
 return {c,actions,active,saved,alerts};
}
const input={entryOrderId:101,side:'LONG',stepSize:.001,tickSize:.1,clientPrefix:'OCCBTC-t001'};
test('after verified Entry: SL exchange ack/readback first, then TP1/TP2/TP3, all saved',async()=>{
 const {c,actions,saved,alerts}=fixture();
 const result=await c.protectConfirmedEntry(input);
 assert.equal(c.state.phase,'PROTECTED');
 assert.equal(result.stop.role,'SL');assert.deepEqual(result.tps.map(x=>x.role),['TP1','TP2','TP3']);
 const posts=actions.filter(x=>x.method==='POST');
 assert.deepEqual(posts.map(x=>x.params.type),[
  'STOP_MARKET','TAKE_PROFIT_MARKET','TAKE_PROFIT_MARKET','TAKE_PROFIT_MARKET']);
 assert.equal(posts[0].params.closePosition,'true');
 assert.equal(posts[0].params.reduceOnly,undefined);
 assert.equal(posts[0].params.quantity,undefined);
 assert.ok(posts.slice(1).every(x=>x.params.reduceOnly==='true'&&Number(x.params.quantity)>0));
 assert.deepEqual(posts.slice(1).map(x=>Number(x.params.quantity)),[.01,.01,.012]);
 assert.ok(saved.some(x=>x.inFlight?.role==='SL'));
 assert.ok(saved.some(x=>x.phase==='STOP_ACTIVE'&&x.stop?.id==='200'));
 assert.ok(saved.some(x=>x.phase==='PROTECTED'));
 assert.equal(alerts.length,0);
});
test('no API call to place STOP/TP before fully verified Entry FILLED',async()=>{
 const f=fixture({orderStatus:'PARTIALLY_FILLED'});
 await assert.rejects(f.c.protectConfirmedEntry(input),/fully filled/);
 assert.equal(f.actions.filter(x=>x.method==='POST').length,0);
 assert.equal(f.c.state.phase,'HALTED');
});
test('failure at SL preserves pending ID, halts and never places TP or blindly retries',async()=>{
 const f=fixture({failPost:'OCCBTC-t001-SL'});
 await assert.rejects(f.c.protectConfirmedEntry(input),/network outcome unknown/);
 assert.equal(f.c.state.halted,true);
 assert.equal(f.c.state.inFlight.clientAlgoId,'OCCBTC-t001-SL');
 assert.equal(f.actions.filter(x=>x.method==='POST').length,1);
 await assert.rejects(f.c.protectConfirmedEntry(input),/Cannot protect/);
 assert.equal(f.actions.filter(x=>x.method==='POST').length,1);
 assert.equal(f.alerts[0].level,'CRITICAL');
});
test('TP2 error leaves confirmed STOP on exchange, halts without TP3',async()=>{
 const f=fixture({failPost:'OCCBTC-t001-TP2'});
 await assert.rejects(f.c.protectConfirmedEntry(input),/network outcome unknown/);
 assert.ok(f.c.state.stop);assert.equal(f.c.state.tps.length,1);
 assert.equal(f.actions.filter(x=>x.method==='POST').length,3);
 assert.equal(f.c.state.phase,'HALTED');
});
test('readback mismatch on STOP never authorizes TP orders',async()=>{
 const f=fixture({mutateStop:x=>x.clientAlgoId.endsWith('-SL')?{...x,closePosition:false}:x});
 await assert.rejects(f.c.protectConfirmedEntry(input),/closePosition/);
 assert.equal(f.actions.filter(x=>x.method==='POST').length,1);
 assert.equal(f.c.state.halted,true);
});
test('readback missing on exchange after acknowledgement halts',async()=>{
 const f=fixture();
 f.c.api.get=async(path,params)=>{
  if(path==='/fapi/v1/order')return {symbol:'BTCUSDT',orderId:101,side:'BUY',
   status:'FILLED',positionSide:'BOTH',executedQty:'.032',avgPrice:'77000'};
  if(path==='/fapi/v3/positionRisk')return [{symbol:'BTCUSDT',positionSide:'BOTH',positionAmt:'.032'}];
  if(path==='/fapi/v1/openAlgoOrders')return [];
  throw Error('Unexpected GET');
 };
 await assert.rejects(f.c.protectConfirmedEntry(input),/did not confirm active/);
 assert.equal(f.c.state.phase,'HALTED');
});

test('restart from STOP / TP checkpoint remains halted and cannot place duplicates',async()=>{
 const f=fixture();
 await f.c.protectConfirmedEntry(input);
 const snapshot=JSON.parse(JSON.stringify(f.c.state));
 const alerts=[];
 const restored=new ProtectionCoordinator({api:f.c.api,
  checkpoint:{load:()=>snapshot,save(){}},settings,notify:x=>alerts.push(x)});
 assert.equal(restored.state.phase,'HALTED');assert.equal(restored.state.halted,true);
 await assert.rejects(restored.protectConfirmedEntry(input),/Cannot protect/);
 assert.equal(f.actions.filter(x=>x.method==='POST').length,4);
 assert.equal(alerts[0].level,'CRITICAL');
});
