// Optional BTCUSDT LIMIT pullback executor. MARKET remains the default.
// A LIMIT that fills while the app is offline is NOT exchange-side protected
// until OCC receives the fill and installs a verified STOP; document this risk.
import {randomBytes} from 'node:crypto';
import {draftProtectedOrder} from './futures-order-plan.mjs';
import {roundTick} from './futures-sizing.mjs';
import {ProtectionCheckpoint} from './futures-protection-checkpoint.mjs';
import {ProtectionCoordinator} from './futures-protection-orchestrator.mjs';

const completed=new Set(['FILLED','CANCELED','EXPIRED','EXPIRED_IN_MATCH']);
const live=new Set(['NEW','PARTIALLY_FILLED']);
const near=(a,b)=>Number.isFinite(Number(a))&&Number.isFinite(Number(b))&&
 Math.abs(Number(a)-Number(b))<1e-8;
const closeSide=side=>side==='LONG'?'SELL':'BUY';
function checkOrder(o,p){
 if(!o||o.symbol!=='BTCUSDT'||String(o.orderId)!==String(p.orderId)||
  o.clientOrderId!==p.clientId||o.positionSide!=='BOTH'||
  o.type!=='LIMIT'||o.timeInForce!=='GTD'||o.side!==(p.side==='LONG'?'BUY':'SELL')||
  !near(o.price,p.price)||!near(o.origQty,p.qty)||
  !Number.isFinite(Number(o.executedQty))||Number(o.executedQty)<0||
  Number(o.executedQty)>p.qty+1e-8)
  throw Error('Binance LIMIT không đúng orderId/clientId/giá/khối lượng OCC');
 return o;
}
export async function readVerifiedLimit(s,p){
 return checkOrder(await s.api.get('/fapi/v1/order',
  {symbol:'BTCUSDT',orderId:p.orderId}),p);
}
export function installLimitEntry(BrowserFutures){
 BrowserFutures.prototype.submitLimit=async function(signal,account,marketPrice){
  this.limitSubmissionStarted=false;
  const c=this.config,side=signal.side;
  if(this.pendingLimit||this.activeProtection||this.halted||!this.armed)
   throw Error('Có vị thế hoặc LIMIT chưa đối soát');
  if(!['LONG','SHORT'].includes(side))throw Error('Sai chiều LIMIT');
  const basis=Number(c.limitBasis==='M15_CLOSE'?signal.candleClose:
   c.limitBasis==='OCC_TRIGGER'?signal.triggerPrice:signal.crossPrice);
  if(!(basis>0)||!(marketPrice>0))throw Error('Thiếu giá giao cắt OCC/nến M15 xác minh');
  const exactTrigger=c.limitBasis==='OCC_TRIGGER';
  const reference=side==='LONG'?Math.min(basis,marketPrice):Math.max(basis,marketPrice);
  const data=await this.api.get('/fapi/v1/exchangeInfo');
  const symbol=data?.symbols?.find(x=>x.symbol==='BTCUSDT'&&x.status==='TRADING'&&x.contractType==='PERPETUAL');
  const lot=symbol?.filters?.find(x=>x.filterType==='LOT_SIZE');
  const tick=Number(symbol?.filters?.find(x=>x.filterType==='PRICE_FILTER')?.tickSize);
  const minNotional=Number(symbol?.filters?.find(x=>x.filterType==='MIN_NOTIONAL')?.notional)||5;
  if(!(Number(lot?.stepSize)>0&&Number(lot?.minQty)>0&&tick>0))
   throw Error('Không xác minh được LOT_SIZE/PRICE_FILTER Binance');
  // Exact OCC trigger is the BTC price threshold, not the crossing SMMA value.
  const desired=exactTrigger?basis:
   reference*(1+(side==='LONG'?-1:1)*c.limitOffsetPct/100);
  const price=roundTick(desired,tick,side==='LONG'?'down':'up');
  if(!(price>0)||(side==='LONG'&&price>=marketPrice)||
     (side==='SHORT'&&price<=marketPrice))
   throw Error(exactTrigger?'Giá kích hoạt OCC không còn là LIMIT chờ tốt hơn LAST; bỏ qua tín hiệu':
    'LIMIT không còn giá tốt hơn LAST');
  const plan=draftProtectedOrder({side,account,
   filters:{stepSize:Number(lot.stepSize),minQty:Number(lot.minQty),
    minNotional,tickSize:tick},quotePrice:price},c);
  const clientId='OCCBTC-'+randomBytes(7).toString('hex');
  const now=Date.now(),goodTillDate=Math.floor((now+660000)/1000)*1000;
  const p={clientId,side,qty:plan.qtyBTC,price,signalId:signal.id,
   orderId:null,startedAt:now,expiresAt:now+c.limitWaitSeconds*1000,goodTillDate,
   stepSize:Number(lot.stepSize),tickSize:tick};
  // From this durable checkpoint onwards a Binance order may have been sent.
  this.limitSubmissionStarted=true;
  this.saveIntent({phase:'LIMIT_SENDING',...p});
  // Never retry a mutation if ACK is lost.
  const ack=await this.api.post('/fapi/v1/order',{
   symbol:'BTCUSDT',side:side==='LONG'?'BUY':'SELL',positionSide:'BOTH',
   type:'LIMIT',timeInForce:'GTD',quantity:String(plan.qtyBTC),price:String(price),
   goodTillDate,newClientOrderId:clientId,newOrderRespType:'ACK'
  });
  if(!ack?.orderId)throw Error('Binance chưa xác nhận LIMIT Order ID');
  p.orderId=String(ack.orderId);
  this.pendingLimit=p;
  this.saveIntent({phase:'LIMIT_PENDING',...p});
  const o=await readVerifiedLimit(this,p);
  if(!live.has(o.status)&&!completed.has(o.status))
   throw Error('LIMIT Binance trả trạng thái chưa rõ '+o.status);
  this.log('LIMIT_PENDING','LIMIT '+side+' '+plan.qtyBTC+' BTC @'+price+
   ' · đợi '+c.limitWaitSeconds+' giây; GTD dự phòng 11 phút');
  if(completed.has(o.status))await this.finalizeLimit(o);
  return this.snapshot();
 };
 BrowserFutures.prototype.finalizeLimit=async function(raw){
  const p=this.pendingLimit;
  if(!p)throw Error('Thiếu checkpoint LIMIT để xác minh');
  const o=checkOrder(raw,p),qty=Number(o.executedQty);
  if(!completed.has(o.status))throw Error('LIMIT vẫn đang mở; không được dựng STOP');
  const snap=await this.inspect();
  if(snap.openOrders||snap.openAlgos||snap.hasOtherPositions)
   throw Error('Binance còn lệnh khác sau khi LIMIT kết thúc');
  if(qty===0){
   if(snap.positionBTC!==0)throw Error('LIMIT không khớp nhưng còn vị thế BTC');
   this.pendingLimit=null;this.limitCancelUncertain=false;
   this.saveIntent({phase:'CLEARED',at:Date.now()});
   this.log('LIMIT_EXPIRED','LIMIT không khớp; chỉ xét tín hiệu giao cắt tiếp theo');
   return;
  }
  if(Math.sign(snap.positionBTC)!==(p.side==='LONG'?1:-1)||
     !near(Math.abs(snap.positionBTC),qty))
   throw Error('Binance BTC vị thế khác lượng LIMIT đã khớp');
  if(o.status==='FILLED'&&near(qty,p.qty)){
   // The exchange has definitively finished this LIMIT. Persist and clear
   // pending BEFORE protection; failed STOP must not strand an already
   // filled position behind a stale pendingLimit guard.
   this.saveIntent({phase:'LIMIT_FILLED',...p,filledQty:qty});
   this.pendingLimit=null;this.limitCancelUncertain=false;
   const coordinator=new ProtectionCoordinator({api:this.api,
    checkpoint:new ProtectionCheckpoint(this.protectionPath),
    settings:this.config,notify:n=>this.log('CRITICAL',n.reason)});
   const result=await coordinator.protectConfirmedEntry({
    entryOrderId:p.orderId,side:p.side,stepSize:p.stepSize,
    tickSize:p.tickSize,clientPrefix:p.clientId});
   this.saveIntent({phase:'PROTECTED',clientId:p.clientId,orderId:p.orderId});
   this.activeProtection=result;
   // History DB errors must never block the STOP/TP protection path.
   try{this.registerRealOrder({orderId:p.orderId,groupId:p.clientId,
    clientId:p.clientId,role:'ENTRY',side:p.side==='LONG'?'BUY':'SELL'});}
   catch(e){this.log('HISTORY_FAILED','LIMIT đã bảo vệ nhưng chưa ghi lịch sử: '+e.message);}
   this.log('LIMIT_PROTECTED','LIMIT khớp đủ '+qty+' BTC; xác nhận STOP + 3 TP');
   return;
  }
  // If less than intended was filled, close only the verified executed BTC
  // rather than leaving an unprotected sub-lot without sufficient 3 TP.
  const verify=await this.inspect();
  if(!near(Math.abs(verify.positionBTC),qty)||verify.openOrders||verify.openAlgos)
   throw Error('Không thể xác minh vị thế LIMIT khớp một phần trước emergency close');
  const exitId='OCCBTC-'+randomBytes(7).toString('hex');
  this.saveIntent({phase:'LIMIT_PARTIAL_CLOSE_SENDING',...p,
   filledQty:qty,exitId});
  const ack=await this.api.post('/fapi/v1/order',{
   symbol:'BTCUSDT',side:closeSide(p.side),positionSide:'BOTH',
   type:'MARKET',reduceOnly:'true',quantity:String(qty),
   newClientOrderId:exitId,newOrderRespType:'RESULT'});
  if(!ack?.orderId||ack.status!=='FILLED')
   throw Error('Chốt phần LIMIT khớp chưa được Binance xác nhận');
  const v=await this.api.get('/fapi/v1/order',{symbol:'BTCUSDT',orderId:ack.orderId});
  if(v.clientOrderId!==exitId||v.status!=='FILLED'||
    !(v.reduceOnly===true||v.reduceOnly==='true')||!near(v.executedQty,qty))
   throw Error('Binance chốt LIMIT khớp một phần chưa xác minh reduceOnly');
  const flat=await this.inspect();
  if(flat.positionBTC!==0||flat.openOrders||flat.openAlgos)
   throw Error('Binance chưa FLAT sau chốt LIMIT một phần');
  // Persist real Binance exit order ID: P&L must be computed from actual fills,
  // not the LIMIT reference price or an assumed zero-fee close.
  this.registerRealOrder({orderId:ack.orderId,groupId:p.clientId,
   clientId:exitId,role:'CLOSE',side:closeSide(p.side)});
  this.pendingLimit=null;this.limitCancelUncertain=false;
  this.saveIntent({phase:'CLEARED',at:Date.now()});
  this.log('LIMIT_PARTIAL_CLOSED','LIMIT khớp '+qty+' BTC; đã chốt reduceOnly, chờ tín hiệu mới');
 };
 BrowserFutures.prototype.monitorPendingLimit=async function({cancelNow=false}={}){
  if(!this.pendingLimit||!this.api)return;
  const p=this.pendingLimit;
  let mutated=false;
  try{
   let o=await readVerifiedLimit(this,p);
   if(completed.has(o.status))return await this.finalizeLimit(o);
   if(!live.has(o.status))throw Error('Binance LIMIT trạng thái không rõ '+o.status);
   if(this.limitCancelUncertain)
    throw Error('Lần hủy LIMIT trước không rõ kết quả; không gửi hủy lần hai. Kiểm tra và hủy thủ công trên Binance trước khi đối soát.');
   if(!cancelNow&&Date.now()<p.expiresAt&&o.status==='NEW')return;
   // Partial fills also trigger immediate cancellation so the size cannot
   // increase after a STOP is installed.
   this.saveIntent({phase:'LIMIT_CANCEL_SENDING',...p});
   this.limitCancelUncertain=true;
   mutated=true;
   await this.api.del('/fapi/v1/order',{
    symbol:'BTCUSDT',orderId:p.orderId,origClientOrderId:p.clientId});
   o=await readVerifiedLimit(this,p);
   if(!completed.has(o.status))throw Error('LIMIT chưa dừng sau cancel');
   await this.finalizeLimit(o);
  }catch(e){
   this.halted=true;this.armed=false;this.error='LIMIT chưa đối soát: '+e.message;
   this.log('LIMIT_HALTED',this.error+(mutated?' · Không thử gửi hủy lệnh lần hai':''));
   throw e;
  }
 };
 BrowserFutures.prototype.cancelOpenLimit=async function(){
  if(!this.pendingLimit)throw Error('Không có LIMIT OCC đang chờ');
  if(this.busy)throw Error('OCC đang xử lý lệnh LIMIT, không gửi hủy trùng');
  this.busy=true;
  try{return await this.monitorPendingLimit({cancelNow:true});}
  finally{this.busy=false;}
 };
 BrowserFutures.prototype.pollLimit=async function(){
  if(!this.pendingLimit||this.busy||!this.api||this.halted)return;
  this.busy=true;
  try{await this.monitorPendingLimit();}
  catch(e){this.log('LIMIT_MONITOR_ERROR',e.message);}
  finally{this.busy=false;}
 };
}
