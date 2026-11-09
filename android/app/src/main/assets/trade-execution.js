'use strict';
// Actual Binance Futures live execution. One-shot mutations, verified ACKs, no retry.
(function(){
const p=OCCMobileTrade.prototype;
const eq=(a,b)=>String(a)===String(b);
const closeSide=s=>s==='LONG'?'SELL':'BUY';
const plus=(a,b)=>Math.abs(a-b)<=1e-8;
function roleTarget(entry,side,value,mode){
 return mode==='Percent'?entry*(1+(side==='LONG'?1:-1)*value/100):
  entry+(side==='LONG'?1:-1)*value;
}
p.verifyOwnership=async function(){
 const cp=this.cp,e=cp.entry;
 if(!e||!occValidId(e.clientId)||!e.orderId)throw Error('Thiếu Entry OCC đã xác minh');
 const order=await this.signed('GET','/fapi/v1/order',{symbol:'BTCUSDT',orderId:e.orderId});
 if(order.symbol!=='BTCUSDT'||!eq(order.orderId,e.orderId)||order.clientOrderId!==e.clientId||
   order.side!==(e.side==='LONG'?'BUY':'SELL')||order.positionSide!=='BOTH'||
   !['MARKET','LIMIT'].includes(order.type)||order.type!==(e.type||'MARKET')||
   (order.type==='MARKET'?order.status!=='FILLED':
     !['FILLED','CANCELED','EXPIRED','EXPIRED_IN_MATCH'].includes(order.status))||
   !(Number(order.executedQty)>0)||!plus(Number(order.executedQty),e.qty))
  throw Error('Entry Binance khác checkpoint OCC');
 return order;
};
p.verifyAlgo=async function(record){
 const current=await this.signed('GET','/fapi/v1/openAlgoOrders',{symbol:'BTCUSDT'});
 if(!Array.isArray(current))throw Error('Binance Open Algo không hợp lệ');
 const a=current.find(x=>eq(x.algoId,record.id));
 if(!a||a.clientAlgoId!==record.clientId||a.side!==record.side||
    !OCC_ACTIVE.has(String(a.algoStatus))||!plus(Number(a.triggerPrice),record.price))
  throw Error('Algo '+record.role+' chưa được Binance xác minh');
 if(record.role==='SL'){
  if(a.orderType!=='STOP_MARKET'||!occTrue(a.closePosition))
   throw Error('SL không đóng toàn bộ vị thế');
 }else if(a.orderType!=='TAKE_PROFIT_MARKET'||!occTrue(a.reduceOnly)||
   !plus(Number(a.quantity),record.qty))throw Error('TP không reduceOnly/đúng BTC');
 return a;
};
p.sendAlgo=async function(request,record){
 this.cp.phase='PROTECTION_SENDING';
 this.cp.intent={kind:'ALGO',role:record.role,clientId:record.clientId,sent:false};
 this.persist();
 const ack=await this.signed('POST','/fapi/v1/algoOrder',request);
 if(!ack?.algoId||ack.clientAlgoId!==record.clientId)throw Error('Binance Algo ACK không chắc chắn');
 record.id=String(ack.algoId);
 await this.verifyAlgo(record);
 if(record.role==='SL')this.cp.stop=record;else this.cp.tps.push(record);
 this.cp.intent=null;this.persist();
 return record;
};
p.emergencyClose=async function(){
 const entry=this.cp.entry;
 if(!entry||this.cp.stop)throw Error('Không xác minh được vị thế thiếu STOP');
 await this.verifyOwnership();
 const first=await this.getSnapshot(),second=await this.getSnapshot();
 for(const s of [first,second]){
  if(s.side!==entry.side||!plus(s.qty,entry.qty)||s.openOrders.length||
     s.otherPositions.length||s.algos.length)
    throw Error('Có STOP/lệnh khác hoặc vị thế đổi; không tự đóng mù');
 }
 const clientId=this.newId();
 if(!occValidId(clientId))throw Error('Không tạo được mã emergency');
 this.cp.phase='EMERGENCY_SENDING';
 this.cp.intent={kind:'CLOSE',clientId,qty:entry.qty,role:'EMERGENCY',sent:false};
 this.persist();
 const ack=await this.signed('POST','/fapi/v1/order',{
  symbol:'BTCUSDT',positionSide:'BOTH',side:closeSide(entry.side),type:'MARKET',
  reduceOnly:'true',quantity:String(entry.qty),newClientOrderId:clientId,newOrderRespType:'RESULT'
 });
 if(!ack?.orderId||ack.status!=='FILLED')throw Error('Emergency MARKET chưa xác nhận FILLED');
 const read=await this.signed('GET','/fapi/v1/order',{symbol:'BTCUSDT',orderId:ack.orderId});
 if(read.clientOrderId!==clientId||read.status!=='FILLED'||!occTrue(read.reduceOnly)||
    !plus(Number(read.executedQty),entry.qty))
  throw Error('Không xác nhận được emergency reduceOnly');
 const flat=await this.getSnapshot();
 if(flat.side||flat.algos.length||flat.openOrders.length)throw Error('Emergency chưa FLAT');
 this.cp.phase='IDLE';this.observeExistingOnly=false;this.cp.entry=null;this.cp.intent=null;this.cp.stop=null;
 this.cp.tps=[];this.persist();
 this.event('EMERGENCY: đã đóng BTC không có STOP, cần kiểm tra Binance');
};
p.activateFilledEntry=async function({order,side,clientId,signalId,rules}){
 const qty=Number(order.executedQty),avg=Number(order.avgPrice);
 if(!(avg>0&&qty>0)||!Number.isFinite(qty))throw Error('Binance Entry không có khớp hợp lệ');
 const live=await this.getSnapshot();
 if(live.side!==side||!plus(live.qty,qty)||live.openOrders.length)
  throw Error('Vị thế Binance không trùng lượng Entry đã khớp / vẫn còn lệnh chờ');
 this.cp.entry={orderId:String(order.orderId),clientId,side,qty,avg,signalId,
  type:order.type};
 this.cp.pendingLimit=null;
 this.cp.phase='ENTRY_VERIFIED';this.cp.intent=null;this.persist();
 const c=this.cp.config,isLong=side==='LONG',out=closeSide(side);
 const common={algoType:'CONDITIONAL',symbol:'BTCUSDT',positionSide:'BOTH',
  side:out,workingType:'CONTRACT_PRICE'};
 const slPrice=occTick(avg*(1+(isLong?-1:1)*c.slPercent/100),rules.tick,!isLong);
 await this.sendAlgo({...common,type:'STOP_MARKET',closePosition:'true',
  triggerPrice:String(slPrice),clientAlgoId:clientId+'-SL'},
  {role:'SL',clientId:clientId+'-SL',price:slPrice,qty,side:out});
 const parts=[occFloor(qty*c.tp1Qty/100,rules.step),occFloor(qty*c.tp2Qty/100,rules.step)];
 parts.push(occRound(qty-parts[0]-parts[1]));
 if(parts.some(q=>q<rules.min)){
  // Partially filled LIMIT can be too small for 3 Binance TP legs.
  // Keep the verified exchange-side close-all STOP and let the user close.
  this.cp.phase='PROTECTED';this.cp.intent=null;this.cp.halted=false;
  this.auto=false;this.persist();
  this.event('LIMIT khớp một phần '+qty+' BTC: đã đặt STOP, không đủ lot cho 3 TP; AUTO OFF.');
  return true;
 }
 for(let i=0;i<3;i++){
  const role='TP'+(i+1),target=occTick(
   roleTarget(avg,side,c['tp'+(i+1)+'Val'],c.tpMode),rules.tick,isLong);
  await this.sendAlgo({...common,type:'TAKE_PROFIT_MARKET',reduceOnly:'true',
   quantity:String(parts[i]),triggerPrice:String(target),clientAlgoId:clientId+'-'+role},
   {role,clientId:clientId+'-'+role,price:target,qty:parts[i],side:out});
 }
 this.cp.phase='PROTECTED';this.cp.intent=null;this.cp.halted=false;this.persist();
 this.event('Đã xác nhận '+side+' '+qty+' BTC, SL và TP1/TP2/TP3');
 return true;
};
p.enter=async function(side,price,signalId,signalTime=null){
 return this.locked(async()=>{
  if(!this.auto||this.cp.halted||this.cp.phase!=='IDLE'||
    !['LONG','SHORT'].includes(side)||
    (this.cp.config.side!=='BOTH'&&side!==this.cp.config.side))return false;
  let started=false;
  try{
   // Independent read-only checks run in parallel; FLAT/ISOLATED/lot checks unchanged.
   const [s,rules]=await Promise.all([this.getSnapshot(),this.getRules()]);
   this.verifyFlat(s);
   const plan=this.plan(s,price,rules);
   const clientId=this.newId();
   if(!occValidId(clientId))throw Error('Không tạo được Client ID giao dịch');
   this.cp.phase='ENTRY_SENDING';
   this.cp.intent={kind:'ENTRY',clientId,qty:plan.qty,side,signalId,sent:false};
   this.persist();started=true;
   const sentAt=Date.now(),targetTime=Number(signalTime);
   this.lastEntryTiming={signalTime:Number.isFinite(targetTime)&&targetTime>0?targetTime:null,
    sentAt,ackAt:null,signalToSendMs:Number.isFinite(targetTime)&&targetTime>0?
     Math.max(0,sentAt-targetTime):null,exchangeAckMs:null};
   const ack=await this.signed('POST','/fapi/v1/order',{
    symbol:'BTCUSDT',positionSide:'BOTH',side:side==='LONG'?'BUY':'SELL',
    type:'MARKET',quantity:String(plan.qty),newClientOrderId:clientId,newOrderRespType:'RESULT'
   });
   if(!ack?.orderId)throw Error('Không nhận được Entry Order ID');
   const ackAt=Date.now();this.lastEntryTiming.ackAt=ackAt;
   this.lastEntryTiming.exchangeAckMs=Math.max(0,ackAt-sentAt);
   this.event('Entry sau mở M15 '+(this.lastEntryTiming.signalToSendMs??'—')+
    ' ms · Binance ACK thêm '+this.lastEntryTiming.exchangeAckMs+' ms');
   const order=await this.signed('GET','/fapi/v1/order',{symbol:'BTCUSDT',orderId:ack.orderId});
   if(order.symbol!=='BTCUSDT'||order.clientOrderId!==clientId||!eq(order.orderId,ack.orderId)||
      order.status!=='FILLED'||order.positionSide!=='BOTH'||order.type!=='MARKET'||
      order.side!==(side==='LONG'?'BUY':'SELL'))throw Error('Entry ACK/readback không khớp');
   const qty=Number(order.executedQty),avg=Number(order.avgPrice);
   if(!(avg>0)||!plus(qty,plan.qty))throw Error('Entry khớp sai lượng hoặc giá');
   // Await inside this try block so failed STOP/TP readback enters the HALT path.
   return await this.activateFilledEntry({order,side,clientId,signalId,rules});
  }catch(e){
   if(started){
    let extra='';
    if(this.cp.entry&&!this.cp.stop){
     try{await this.emergencyClose();extra=' · emergency MARKET đã FLAT';}
     catch(err){extra=' · emergency không xác minh: '+err.message;}
    }
    this.halt(e.message+extra+' · KIỂM TRA BINANCE');
   }else this.event('Bỏ qua tín hiệu: '+e.message);
   throw e;
  }
 });
};
p.onSignal=async function(signal,price,healthy){
 if(!this.auto||!healthy||this.busy||this.cp.halted||!signal?.eligible||
    !['LONG','SHORT'].includes(signal.side))return false;
 // Do not replay prior closed candles or queued events after reconnect.
 if(this.lastSignalTime!=null&&signal.barTime<=this.lastSignalTime)return false;
 this.lastSignalTime=signal.barTime;
 if(this.cp.phase==='PROTECTED'){
  // Resumed positions must never reverse or open overlapping entries.
  if(this.observeExistingOnly)return false;
  if(!this.cp.config.reverseOnSignal||this.cp.entry?.side===signal.side)return false;
  const expected=this.cp.entry;
  try{
   await this.manualClose('ALL',{automaticReversal:true});
   if(this.cp.phase==='IDLE'&&this.auto&&!this.cp.halted)
    return this.cp.config.entryMode==='LIMIT_PULLBACK'?
     this.placeLimit(signal.side,price,signal):
     this.enter(signal.side,price,signal.id,signal.time);
  }catch(e){this.event('Không đảo chiều: '+e.message);}
  return false;
 }
 if(this.cp.phase!=='IDLE')return false;
 return this.cp.config.entryMode==='LIMIT_PULLBACK'?
     this.placeLimit(signal.side,price,signal):
     this.enter(signal.side,price,signal.id,signal.time);
};
})();
