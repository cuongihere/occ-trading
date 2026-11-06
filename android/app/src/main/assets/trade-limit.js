'use strict';
// Pullback LIMIT entry is opt-in. Exchange GTD is the last-resort expiry,
// while the foreground app cancels earlier. Never retry unknown order mutations.
(function(){
const p=OCCMobileTrade.prototype;
const same=(a,b)=>String(a)===String(b);
const near=(a,b)=>Number.isFinite(Number(a))&&Number.isFinite(Number(b))&&
 Math.abs(Number(a)-Number(b))<=1e-8;
const terminal=new Set(['FILLED','CANCELED','EXPIRED','EXPIRED_IN_MATCH']);
p.limitEntryPrice=function(side,signalPrice,marketPrice,tick){
 const pct=this.cp.config.limitOffsetPct;
 if(!['LONG','SHORT'].includes(side)||!(signalPrice>0&&marketPrice>0&&tick>0))
  throw Error('Không đủ giá để đặt LIMIT');
 // Anchor to the M15 signal close, but never chase beyond the current LAST.
 const reference=side==='LONG'?Math.min(signalPrice,marketPrice):Math.max(signalPrice,marketPrice);
 const target=reference*(1+(side==='LONG'?-1:1)*pct/100);
 const price=occTick(target,tick,side==='SHORT');
 if(!(price>0)||(side==='LONG'&&price>=marketPrice)||
    (side==='SHORT'&&price<=marketPrice))
  throw Error('LIMIT không còn ở phía giá tốt hơn; bỏ qua tín hiệu');
 return price;
};
p.verifyLimitOrder=function(order,pending){
 if(!order||order.symbol!=='BTCUSDT'||order.positionSide!=='BOTH'||
   order.type!=='LIMIT'||order.timeInForce!=='GTD'||!same(order.orderId,pending.orderId)||
   order.clientOrderId!==pending.clientId||order.side!==(pending.side==='LONG'?'BUY':'SELL')||
   !near(order.origQty,pending.qty)||!near(order.price,pending.price)||
   !Number.isFinite(Number(order.executedQty))||Number(order.executedQty)<0||
   Number(order.executedQty)>pending.qty+1e-8)
  throw Error('LIMIT trên Binance không khớp checkpoint OCC');
 return order;
};
p.queryLimit=async function(pending){
 const o=await this.signed('GET','/fapi/v1/order',
  {symbol:'BTCUSDT',orderId:pending.orderId});
 return this.verifyLimitOrder(o,pending);
};
p.placeLimit=async function(side,marketPrice,signal){
 return this.locked(async()=>{
  if(!this.auto||this.cp.halted||this.cp.phase!=='IDLE'||
     !['LONG','SHORT'].includes(side)||
     (this.cp.config.side!=='BOTH'&&this.cp.config.side!==side))return false;
  let submitted=false;
  try{
   const [snapshot,rules]=await Promise.all([this.getSnapshot(),this.getRules()]);
   this.verifyFlat(snapshot);
   // Pine crossPrice = (closeSeriesAlt + openSeriesAlt) / 2.
   // The optional candle-close basis is closer to actual traded market prices.
   const signalPrice=Number(this.cp.config.limitBasis==='OCC_CROSS'?
     signal?.crossPrice:signal?.candleClose);
   if(!(signalPrice>0))throw Error('Thiếu giá tham chiếu OCC của nến tín hiệu');
   const limitPrice=this.limitEntryPrice(side,signalPrice,marketPrice,rules.tick);
   const plan=this.plan(snapshot,limitPrice,rules);
   const clientId=this.newId();
   if(!occValidId(clientId))throw Error('Không tạo được Client Order ID');
   // Binance GTD requires >600 seconds ahead, even though OCC cancels locally sooner.
   const goodTillDate=Math.floor((Date.now()+660000)/1000)*1000;
   const expiresAt=Date.now()+this.cp.config.limitWaitSeconds*1000;
   this.cp.phase='LIMIT_SENDING';
   this.cp.intent={kind:'LIMIT_ENTRY',side,clientId,qty:plan.qty,
    price:limitPrice,goodTillDate,sent:false};
   this.persist();submitted=true;
   const sentAt=Date.now(),signalTime=Number(signal?.time);
   this.lastEntryTiming={signalTime:Number.isFinite(signalTime)?signalTime:null,
    sentAt,ackAt:null,signalToSendMs:Math.max(0,sentAt-signalTime),exchangeAckMs:null};
   const ack=await this.signed('POST','/fapi/v1/order',{
    symbol:'BTCUSDT',positionSide:'BOTH',side:side==='LONG'?'BUY':'SELL',
    type:'LIMIT',timeInForce:'GTD',quantity:String(plan.qty),price:String(limitPrice),
    goodTillDate,newClientOrderId:clientId,newOrderRespType:'ACK'
   });
   if(!ack?.orderId)throw Error('Binance chưa xác nhận LIMIT Order ID');
   const ackAt=Date.now();
   this.lastEntryTiming.ackAt=ackAt;
   this.lastEntryTiming.exchangeAckMs=Math.max(0,ackAt-sentAt);
   const pending={orderId:String(ack.orderId),clientId,side,qty:plan.qty,price:limitPrice,
    signalId:signal?.id||null,createdAt:sentAt,expiresAt,goodTillDate};
   this.cp.pendingLimit=pending;this.cp.phase='LIMIT_PENDING';
   this.cp.intent=null;this.persist();
   const order=await this.queryLimit(pending);
   if(!['NEW','PARTIALLY_FILLED','FILLED','CANCELED','EXPIRED','EXPIRED_IN_MATCH']
    .includes(order.status))throw Error('Trạng thái LIMIT chưa rõ: '+order.status);
   this.event('LIMIT '+side+' '+plan.qty+' BTC @'+limitPrice+
    ' · chờ tối đa '+this.cp.config.limitWaitSeconds+' giây');
   if(order.status!=='NEW')await this.processPendingLimit(order);
   return true;
  }catch(e){
   if(submitted)this.halt('LIMIT chưa rõ kết quả; kiểm tra lệnh chờ Binance: '+e.message);
   else this.event('Bỏ qua LIMIT: '+e.message);
   throw e;
  }
 });
};
p.cancelPendingLimit=async function(){
 const pending=this.cp.pendingLimit;
 if(!pending||this.cp.phase!=='LIMIT_PENDING')throw Error('Không có LIMIT OCC đang chờ');
 const before=await this.queryLimit(pending);
 if(terminal.has(before.status))return this.processPendingLimit(before);
 // Partial fills are canceled before placing any SL/TP to prevent new entry behind STOP.
 if(!['NEW','PARTIALLY_FILLED'].includes(before.status))
  throw Error('Trạng thái LIMIT không an toàn để hủy: '+before.status);
 this.cp.phase='LIMIT_CANCEL_SENDING';
 this.cp.intent={kind:'LIMIT_CANCEL',clientId:pending.clientId,
  orderId:pending.orderId,sent:false};
 this.persist();
 await this.signed('DELETE','/fapi/v1/order',{
  symbol:'BTCUSDT',orderId:pending.orderId,origClientOrderId:pending.clientId
 });
 const after=await this.queryLimit(pending);
 if(!terminal.has(after.status))throw Error('Binance chưa xác nhận LIMIT đã đóng/hủy');
 this.cp.phase='LIMIT_PENDING';this.cp.intent=null;this.persist();
 return this.processPendingLimit(after);
};
p.processPendingLimit=async function(order){
 const pending=this.cp.pendingLimit;
 if(!pending||this.cp.phase!=='LIMIT_PENDING')throw Error('LIMIT không có checkpoint');
 this.verifyLimitOrder(order,pending);
 if(!terminal.has(order.status)){
  if(order.status==='NEW'&&Date.now()<pending.expiresAt)return false;
  return this.cancelPendingLimit();
 }
 const qty=Number(order.executedQty);
 if(qty===0){
  const s=await this.getSnapshot();
  if(s.side||s.openOrders.length||s.algos.length)throw Error('LIMIT không khớp nhưng Binance còn vị thế/lệnh');
  this.cp.phase='IDLE';this.cp.pendingLimit=null;this.cp.intent=null;
  this.cp.halted=false;this.cp.error=null;
  this.persist();this.event('LIMIT không khớp, đã kết thúc · chờ tín hiệu mới');
  return false;
 }
 if(!(Number(order.avgPrice)>0))throw Error('LIMIT có BTC đã khớp nhưng chưa xác nhận giá trung bình');
 const state=await this.getSnapshot();
 if(state.side!==pending.side||!near(state.qty,qty)||state.openOrders.length||
    state.algos.length||state.otherPositions.length)
  throw Error('LIMIT đã khớp nhưng vị thế Binance không đúng hoặc còn lệnh chờ');
 const rules=await this.getRules();
 this.cp.phase='LIMIT_FILLED';this.cp.intent=null;
 // Allows protective STOP placement only after exact terminal fill readback.
 this.cp.halted=false;this.cp.error=null;this.persist();
 // Exchange order is terminal, and position must match before STOP can be submitted.
 try{
  const result=await this.activateFilledEntry({order,side:pending.side,
   clientId:pending.clientId,signalId:pending.signalId,rules});
  return result;
 }catch(e){this.halt('LIMIT khớp nhưng chưa xác minh STOP/TP: '+e.message);throw e;}
};
p.monitorPendingLimit=async function(){
 if(this.cp.phase!=='LIMIT_PENDING'||!this.cp.pendingLimit)return;
 const pending=this.cp.pendingLimit;
 try{
  const order=await this.queryLimit(pending);
  if(order.status==='NEW'&&Date.now()<pending.expiresAt)return;
  await this.processPendingLimit(order);
 }catch(e){this.halt('LIMIT chờ có lỗi đối soát: '+e.message);}
};
})();
