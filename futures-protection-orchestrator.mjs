// POST-FILL exchange-side protection coordinator, for a future dedicated live worker.
// Neither the paper app nor the current Binance preview imports or starts this class.
import {protectionRequests} from './futures-protection-plan.mjs';
const active=new Set(['NEW','ACCEPTED','PENDING_NEW']);
function equalId(a,b){return String(a)===String(b);}
export class ProtectionCoordinator {
 constructor({api,checkpoint,settings,notify=()=>{}}){
  if(!api||typeof api.get!=='function'||typeof api.post!=='function'||
     !checkpoint||typeof checkpoint.save!=='function')throw Error('Exchange and durable checkpoint required');
  this.api=api;this.checkpoint=checkpoint;this.settings=settings;this.notify=notify;
  const persisted=checkpoint.load?.();
  this.state=persisted?{...persisted,phase:persisted.phase==='IDLE'?'IDLE':'HALTED',
    halted:persisted.phase!=='IDLE'||Boolean(persisted.halted)}:
    {phase:'IDLE',entry:null,stop:null,tps:[],inFlight:null,halted:false};
  // Never auto-resubmit an entry or SL/TP after process restart.
  if(persisted&&persisted.phase!=='IDLE')this.notify({level:'CRITICAL',
    reason:'Existing BTCUSDT protection checkpoint requires exchange reconciliation',entry:this.state.entry});

 }
 persist(patch){
  this.state={...this.state,...patch};
  this.checkpoint.save(this.state); // Must be atomic/durable before network mutation.
  return this.state;
 }
 halt(reason){
  this.persist({halted:true,phase:'HALTED'});
  this.notify({level:'CRITICAL',reason,entry:this.state.entry,stop:this.state.stop,
   message:'Do not retry orders automatically. Verify BTC position and protective orders on Binance.'});
 }
 async verifiedPosition(side,qty){
  const rows=await this.api.get('/fapi/v3/positionRisk',{symbol:'BTCUSDT'});
  const p=Array.isArray(rows)?rows.find(x=>x.symbol==='BTCUSDT'&&x.positionSide==='BOTH'):null;
  if(!p)throw Error('BTCUSDT One-way position not found');
  const amount=Number(p.positionAmt);
  if(!Number.isFinite(amount)||Math.sign(amount)!==(side==='LONG'?1:-1))
   throw Error('Exchange position has wrong side or is flat');
  if(Math.abs(Math.abs(amount)-qty)>Math.max(qty*1e-7,1e-9))
   throw Error('Exchange position differs from confirmed entry quantity');
  return p;
 }
 async openAlgo(clientId){
  const rows=await this.api.get('/fapi/v1/openAlgoOrders',{symbol:'BTCUSDT'});
  if(!Array.isArray(rows))throw Error('Invalid Binance openAlgoOrders response');
  return rows.find(o=>o.symbol==='BTCUSDT'&&o.clientAlgoId===clientId&&
    active.has(o.algoStatus))||null;
 }
 async submitAndVerify(role,params){
  // Do not start another mutation with an in-flight or unknown predecessor.
  if(this.state.inFlight)throw Error('An earlier order outcome is unresolved');
  this.persist({inFlight:{role,clientAlgoId:params.clientAlgoId,at:Date.now()},
    phase:role==='SL'?'SL_SENDING':'TP_SENDING'});
  const ack=await this.api.post('/fapi/v1/algoOrder',params);
  if(!ack?.algoId||ack.clientAlgoId!==params.clientAlgoId)
   throw Error('Binance algo acknowledgement does not match order');
  this.persist({inFlight:{...this.state.inFlight,algoId:String(ack.algoId)}});
  const live=await this.openAlgo(params.clientAlgoId);
  if(!live||!equalId(live.algoId,ack.algoId)||
      String(live.orderType||live.type)!==params.type||
      String(live.side)!==params.side||
      Number(live.triggerPrice)!==Number(params.triggerPrice))
   throw Error('Binance did not confirm active protective order '+role);
  if(role==='SL'&&live.closePosition!==true)
   throw Error('Binance stop must be closePosition=true');
  if(role!=='SL'&&(Number(live.quantity)!==Number(params.quantity)||
     live.reduceOnly!==true))
   throw Error('TP order quantity or reduceOnly differs from request');
  const order={role,id:String(live.algoId),clientId:live.clientAlgoId,
   type:params.type,triggerPrice:Number(live.triggerPrice),
   qty:role==='SL'?null:Number(live.quantity)};
  if(role==='SL')this.persist({stop:order,inFlight:null,phase:'STOP_ACTIVE'});
  else this.persist({tps:[...this.state.tps,order],inFlight:null,phase:'TP_ACTIVE'});
  return order;
 }
 // Caller MUST provide the order ID from a prior MARKET Entry; do not place entry here.
 async protectConfirmedEntry({entryOrderId,side,stepSize,tickSize,clientPrefix}){
  if(this.state.phase!=='IDLE'||this.state.halted||this.state.inFlight)
   throw Error('Cannot protect a second trade or resume uncertain state automatically');
  if(!['LONG','SHORT'].includes(side)||!/^OCCBTC-[A-Za-z0-9_-]{1,25}$/.test(clientPrefix||''))
   throw Error('Invalid BTCUSDT position request');
  try{
   const o=await this.api.get('/fapi/v1/order',{symbol:'BTCUSDT',orderId:entryOrderId});
   if(o.symbol!=='BTCUSDT'||o.status!=='FILLED'||
      o.side!==(side==='LONG'?'BUY':'SELL')||o.positionSide!=='BOTH'||
      !Number.isFinite(Number(o.executedQty))||Number(o.executedQty)<=0||
      !Number.isFinite(Number(o.avgPrice))||Number(o.avgPrice)<=0)
    throw Error('Entry order has not been fully filled and verified');
   const qty=Number(o.executedQty),entryPrice=Number(o.avgPrice);
   await this.verifiedPosition(side,qty);
   const request=protectionRequests({side,entryPrice,filledQty:qty,
     stepSize,tickSize,clientPrefix},this.settings);
   this.persist({phase:'ENTRY_VERIFIED',entry:{orderId:String(entryOrderId),side,
     qty,entryPrice,clientPrefix},tps:[],stop:null});
   await this.submitAndVerify('SL',request.stop);
   for(let i=0;i<request.tps.length;i++){
    await this.verifiedPosition(side,qty); // Reject position mutation while constructing TP group.
    await this.submitAndVerify('TP'+(i+1),request.tps[i]);
   }
   this.persist({phase:'PROTECTED'});
   return {entry:this.state.entry,stop:this.state.stop,tps:this.state.tps};
  }catch(error){
   this.halt(error.message);
   throw error;
  }
 }
}
