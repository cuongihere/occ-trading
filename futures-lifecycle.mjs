// Pure fail-closed state machine for BTCUSDT trade lifecycle. No Binance API calls.
export const startState=()=>({phase:'IDLE',armed:false,clientId:null,orderId:null,stopId:null,tpIds:[],side:null,reason:null});
const phases=new Set(['IDLE','ENTRY_PENDING','ENTRY_UNKNOWN','AWAIT_STOP','STOP_CONFIRMED','MANAGED','CLOSING','HALTED']);
export function recoverState(previous){
 if(!previous||!phases.has(previous.phase))throw Error('Corrupt live checkpoint');
 return {...previous,armed:false,phase:previous.phase==='IDLE'?'IDLE':'HALTED',
  reason:previous.phase==='IDLE'?null:'Unresolved position requires Binance reconciliation'};
}
export function transition(state,event){
 if(!state||!phases.has(state.phase)||typeof event?.type!=='string')throw Error('Invalid trade state/event');
 const s={...state,tpIds:[...(state.tpIds||[])]};
 if(event.type==='DISARM')return {...s,armed:false};
 if(event.type==='HALT')return {...s,phase:'HALTED',armed:false,reason:event.reason||'Manual review required'};
 if(event.type==='ARM'){
  if(s.phase!=='IDLE'||s.armed||event.preflightPassed!==true)throw Error('Verified flat account required to ARM');
  return {...s,armed:true};
 }
 if(event.type==='SIGNAL'){
  if(s.phase!=='IDLE'||!s.armed)throw Error('Cannot open with pending or existing position');
  if(!['LONG','SHORT'].includes(event.side)||!/^OCCBTC-[A-Za-z0-9_-]{1,25}$/.test(event.clientId||''))
   throw Error('Invalid BTCUSDT signal/client ID');
  return {...s,phase:'ENTRY_PENDING',clientId:event.clientId,side:event.side};
 }
 if(event.type==='ENTRY_UNKNOWN'){
  if(s.phase!=='ENTRY_PENDING')throw Error('Unexpected entry uncertainty');
  return {...s,armed:false,phase:'ENTRY_UNKNOWN',reason:'Exchange outcome unknown; do not retry'};
 }
 if(event.type==='ENTRY_FILLED'){
  if(s.phase!=='ENTRY_PENDING'||!event.orderId)throw Error('Confirmed order required');
  return {...s,phase:'AWAIT_STOP',orderId:String(event.orderId)};
 }
 if(event.type==='STOP_ACK'){
  if(s.phase!=='AWAIT_STOP'||!event.algoId)throw Error('Stop confirmation must follow entry');
  return {...s,phase:'STOP_CONFIRMED',stopId:String(event.algoId)};
 }
 if(event.type==='TP_ACK'){
  if(!['STOP_CONFIRMED','MANAGED'].includes(s.phase)||!s.stopId||!event.algoId)
   throw Error('SL must be acknowledged before TP');
  const id=String(event.algoId);
  if(s.tpIds.includes(id)||s.tpIds.length>=3)throw Error('Duplicate or excess TP leg');
  s.tpIds.push(id);s.phase=s.tpIds.length===3?'MANAGED':'STOP_CONFIRMED';return s;
 }
 if(event.type==='CLOSE_PENDING'){
  if(!['STOP_CONFIRMED','MANAGED'].includes(s.phase))throw Error('No protected position to close');
  return {...s,phase:'CLOSING',armed:false};
 }
 if(event.type==='FLAT_VERIFIED'){
  if(!['CLOSING','STOP_CONFIRMED','MANAGED'].includes(s.phase)||event.noOpenOrders!==true)
   throw Error('Exchange FLAT and no-open-orders confirmation required');
  return startState();
 }
 throw Error('Unknown transition');
}
