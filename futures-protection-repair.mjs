// Explicit operator-approved restoration of missing SL/TP for an OCC-owned
// BTCUSDT Futures position. Never infer ownership from matching margin alone.
// All measurements and order acknowledgements are signed Binance readbacks.
import {existsSync,readFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {ProtectionCheckpoint} from './futures-protection-checkpoint.mjs';
import {ProtectionCoordinator} from './futures-protection-orchestrator.mjs';
import {protectionRequests} from './futures-protection-plan.mjs';

const ROOT=/^OCCBTC-[0-9a-f]{14}$/;
const near=(a,b,tol=1e-8)=>Number.isFinite(Number(a))&&
 Number.isFinite(Number(b))&&Math.abs(Number(a)-Number(b))<=tol;
const qtyToSide=amount=>amount>0?'LONG':amount<0?'SHORT':null;
const sideToBinance=side=>side==='LONG'?'BUY':'SELL';

export function installProtectionRepair(BrowserFutures){
 BrowserFutures.prototype.inspectProtectionRepair=async function({internalLock=false}={}){
  if(!this.api||this.environment!=='production')throw Error('Kết nối Binance Futures thật trước khi khôi phục SL/TP');
  if(this.busy&&!internalLock)throw Error('OCC đang xử lý giao dịch; không thể kiểm tra khôi phục');
  if(this.pendingLimit)throw Error('Vẫn có LIMIT OCC đang chờ; không thể khôi phục SL/TP');
  // A healthy managed trade must not get a second protection group.
  // If monitor HALTED because the old group vanished, continue only through
  // the full canceled-Algo history audit below.
  if(this.activeProtection&&!this.halted)
   throw Error('OCC đã có checkpoint vị thế đang quản lý. Không tạo bộ SL/TP thứ hai.');
  const [a,b]=await Promise.all([this.inspect(),this.inspect()]);
  if(!a.canTrade||a.dualSidePosition!==false||a.marginType!=='ISOLATED'||
    a.leverage!==this.config.leverage||a.hasOtherPositions||a.openOrders!==0||
    a.openAlgos!==0||b.openOrders!==0||b.openAlgos!==0)
   throw Error('Chỉ khôi phục khi Binance One-way, ISOLATED, đúng leverage và không có lệnh thường/SL/TP khác');
  if(!near(a.positionBTC,b.positionBTC)||!near(a.entryPrice,b.entryPrice))
   throw Error('Vị thế Binance thay đổi giữa hai lần kiểm tra; không gửi lệnh');
  const qty=Math.abs(a.positionBTC),side=qtyToSide(a.positionBTC);
  if(!side||!(qty>0)||!(a.entryPrice>0))
   throw Error('Không có vị thế BTCUSDT và giá Entry thực tế hợp lệ trên Binance');
  if(this.config.side!=='BOTH'&&this.config.side!==side)
   throw Error('Vị thế Binance không đúng chiều được phép trong cấu hình OCC');
  const checkpoint=existsSync(this.protectionPath)?
   new ProtectionCheckpoint(this.protectionPath).load():null;
  const intent=existsSync(this.intentPath)?JSON.parse(readFileSync(this.intentPath,'utf8')):null;
  // An in-flight mutation can have reached the exchange. Never resend
  // that ambiguous Algo regardless of what openAlgoOrders currently shows.
  if(checkpoint?.inFlight||['SL_SENDING','TP_SENDING'].includes(checkpoint?.phase))
   throw Error('Checkpoint có SL/TP đã gửi nhưng ACK chưa rõ; không thử gửi trùng');

  const orders=await this.api.get('/fapi/v1/allOrders',{symbol:'BTCUSDT',limit:500});
  if(!Array.isArray(orders)||orders.length>=500)
   throw Error('Không kiểm chứng được đầy đủ danh sách Order ID gần nhất của Binance');
  const matches=orders.filter(o=>{
   const price=Number(o.avgPrice),filled=Number(o.executedQty);
   return o.symbol==='BTCUSDT'&&ROOT.test(String(o.clientOrderId||''))&&
    o.positionSide==='BOTH'&&o.status==='FILLED'&&
    ['MARKET','LIMIT'].includes(o.type)&&
    o.side===sideToBinance(side)&&near(filled,qty)&&
    price>0&&Math.abs(price-a.entryPrice)<=Math.max(this.filters.tickSize,price*0.000005);
  });
  if(matches.length!==1)
   throw Error(matches.length?'Nhiều Entry OCC cùng khớp vị thế; cần kiểm tra thủ công':
    'Không xác minh được Entry OCC duy nhất theo Order ID, khối lượng và giá khớp thực tế trên Binance');
  const chosen=matches[0],clientId=String(chosen.clientOrderId);
  const order=await this.api.get('/fapi/v1/order',{symbol:'BTCUSDT',orderId:chosen.orderId});
  if(order.symbol!=='BTCUSDT'||String(order.orderId)!==String(chosen.orderId)||
    order.clientOrderId!==clientId||order.status!=='FILLED'||
    order.side!==sideToBinance(side)||order.positionSide!=='BOTH'||
    !near(order.executedQty,qty)||!near(order.avgPrice,chosen.avgPrice,this.filters.tickSize))
   throw Error('Binance Entry readback không khớp Order ID OCC, không nhận diện vị thế');
  if(checkpoint?.entry){
   const e=checkpoint.entry;
   if(String(e.orderId)!==String(order.orderId)||e.clientPrefix!==clientId||
      e.side!==side||!near(e.qty,qty))
    throw Error('Entry trên Binance không khớp checkpoint OCC cũ; không thay thế checkpoint');
  }
  if(intent?.clientId&&ROOT.test(String(intent.clientId))&&intent.clientId!==clientId&&
     !['CLEARED','PROTECTED'].includes(intent.phase))
   throw Error('Intent cũ thuộc Entry OCC khác chưa đối soát; không khôi phục lệnh mới');
  const history=await this.api.get('/fapi/v1/allAlgoOrders',{symbol:'BTCUSDT',limit:500});
  if(!Array.isArray(history)||history.length>=500)
   throw Error('Không kiểm tra được lịch sử Algo Binance đầy đủ');
  const priorAlgos=history.filter(x=>String(x.clientAlgoId||'').startsWith(clientId+'-'));
  // A canceled/expired old protection group may be replaced, but with a
  // fresh unique Algo prefix. FINISHED/active/unrecognized history blocks.
  const inert=new Set(['CANCELED','CANCELLED','REJECTED','EXPIRED']);
  if(priorAlgos.some(x=>!inert.has(String(x.algoStatus||'').toUpperCase())||
    !/^OCCBTC-[0-9a-f]{14}-(SL|TP[123])$/.test(String(x.clientAlgoId||''))))
   throw Error('SL/TP cũ có thể đã kích hoạt hoặc trạng thái chưa rõ; không đặt trùng');
  const recorded=[checkpoint?.stop,...(checkpoint?.tps||[])].filter(Boolean);
  for(const old of recorded){
   if(!old.id||!old.clientId||old.clientId!==clientId+'-'+old.role||
     !priorAlgos.some(x=>String(x.algoId)===String(old.id)&&
      x.clientAlgoId===old.clientId&&inert.has(String(x.algoStatus||'').toUpperCase())))
    throw Error('SL/TP cũ trong checkpoint chưa được Binance xác nhận đã hủy; không đặt bộ mới');
  }
  const useFreshAlgoPrefix=priorAlgos.length>0;
  const requests=protectionRequests({
   side,entryPrice:a.entryPrice,filledQty:qty,
   stepSize:this.filters.stepSize,tickSize:this.filters.tickSize,clientPrefix:clientId
  },this.config);
  const latest=await this.inspect();
  if(!near(latest.positionBTC,a.positionBTC)||!near(latest.entryPrice,a.entryPrice)||
    latest.openOrders||latest.openAlgos)
   throw Error('Binance vị thế hoặc SL/TP thay đổi khi kiểm tra; không gửi lệnh');

  return {symbol:'BTCUSDT',side,orderId:String(order.orderId),
   clientId,qty,entryPrice:a.entryPrice,leverage:a.leverage,
   useFreshAlgoPrefix,
   stopPrice:Number(requests.stop.triggerPrice),tps:requests.tps.map((x,i)=>({
    role:'TP'+(i+1),price:Number(x.triggerPrice),qty:Number(x.quantity)
   })),status:'VERIFIED_OCC_UNPROTECTED',checkedAt:Date.now()};
 };
 BrowserFutures.prototype.repairMissingProtection=async function({
  confirmation,expectedOrderId,expectedQty,expectedEntryPrice,expectedSide
 }={}){
  if(confirmation!=='KHOI PHUC SL TP BTCUSDT')
   throw Error('Chưa xác nhận đặt SL/TP bằng tiền thật');
  if(this.busy)throw Error('OCC đang gửi/đối soát một lệnh khác');
  this.busy=true;
  this.armed=false; // Never continue Auto while recovering an unprotected entry.
  this.recoveryStatus='checking';
  let mayHaveMutated=false;
  try{
   // Preserve the operator lock across all signed readbacks and mutations.
   const preview=await this.inspectProtectionRepair({internalLock:true});
   if(String(expectedOrderId)!==preview.orderId||
      !near(expectedQty,preview.qty)||!near(expectedEntryPrice,preview.entryPrice,
       Math.max(this.filters.tickSize,0.00000001))||
      expectedSide!==preview.side)
    throw Error('Vị thế Binance đã khác lúc xác nhận; không đặt SL/TP');

   // Durable intent precedes the first potential exchange mutation.
   const algoPrefix=preview.useFreshAlgoPrefix?
    'OCCBTC-'+randomBytes(7).toString('hex'):preview.clientId;
   this.saveIntent({phase:'PROTECTION_REPAIR_START',clientId:preview.clientId,
    algoPrefix,orderId:preview.orderId,side:preview.side,qty:preview.qty,
    entryPrice:preview.entryPrice,at:Date.now()});
   mayHaveMutated=true;
   const disk=new ProtectionCheckpoint(this.protectionPath);
   // The previous HALTED checkpoint was read and audited above. The coordinator
   // starts a fresh, one-shot recovery, never resending previously attempted Algo IDs.
   const isolated={load:()=>null,save:state=>disk.save(state)};
   const coordinator=new ProtectionCoordinator({api:this.api,checkpoint:isolated,
    settings:this.config,notify:event=>this.log('CRITICAL',event.reason)});
   const result=await coordinator.protectConfirmedEntry({
    entryOrderId:preview.orderId,side:preview.side,
    stepSize:this.filters.stepSize,tickSize:this.filters.tickSize,
    clientPrefix:preview.clientId,algoPrefix});
   this.registerRealOrder({orderId:preview.orderId,groupId:preview.clientId,
    clientId:preview.clientId,role:'ENTRY',side:sideToBinance(preview.side)});
   this.saveIntent({phase:'PROTECTED',clientId:preview.clientId,
    orderId:preview.orderId,repair:true,at:Date.now()});
   this.activeProtection=result;this.previousProtection=null;
   this.halted=false;this.error=null;this.armed=false;
   this.recoveryStatus='recovered';this.lastRecoveryCheck=Date.now();
   this.log('PROTECTION_REPAIRED','Binance xác nhận '+preview.qty+' BTC Entry '+preview.entryPrice+
    ' · STOP '+preview.stopPrice+' · TP1/2/3 đã được xác minh; Auto OFF');
   return {ok:true,auto:false,position:preview,protected:true};
  }catch(error){
   if(mayHaveMutated){
    this.halted=true;this.armed=false;
    this.error='KHÔI PHỤC SL/TP CHƯA XÁC MINH: '+error.message+
     ' · không tự thử lại; kiểm tra trực tiếp Binance ngay.';
    this.log('REPAIR_HALTED',this.error);
   }
   this.recoveryStatus='manual_required';this.lastRecoveryCheck=Date.now();
   throw error;
  }finally{this.busy=false;}
 };
}
