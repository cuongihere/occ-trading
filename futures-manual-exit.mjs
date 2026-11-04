// Manual exits are restricted to BTCUSDT positions proven to belong to OCC.
// This module only validates fresh readbacks; it never submits/cancels orders.
import {floorStep} from './futures-sizing.mjs';
const ACTIVE=new Set(['NEW','ACCEPTED','PENDING_NEW']);
const name=/^OCCBTC-[0-9a-f]{14}$/;
const positive=x=>Number.isFinite(Number(x))&&Number(x)>0?Number(x):null;
export function validateManagedExit({managed,account,algos,entryOrder,filters,role=null,expectedRemainingBTC=null,expectedEntryOrderId=null}){
 if(!managed?.entry||!managed?.stop||!Array.isArray(managed.tps)||
   !name.test(String(managed.entry.clientPrefix||''))||!['LONG','SHORT'].includes(managed.entry.side))
  throw Error('Không có checkpoint OCC hợp lệ cho lệnh này');
 const entry=managed.entry,prefix=entry.clientPrefix;
 if(expectedEntryOrderId!==null&&String(expectedEntryOrderId)!==String(entry.orderId))
  throw Error('Lệnh trên màn hình đã thay đổi; cập nhật lại trước khi chốt');
 if(!account||!account.canTrade||account.dualSidePosition!==false||
   account.marginType!=='ISOLATED'||account.hasOtherPositions||account.openOrders!==0)
  throw Error('Binance còn lệnh thường, vị thế ngoài BTC hoặc cấu hình không hợp lệ');
 const amount=Number(account.positionBTC),sign=entry.side==='LONG'?1:-1;
 if(!Number.isFinite(amount)||Math.sign(amount)!==sign||!(Math.abs(amount)>0)||
    Math.abs(amount)>Number(entry.qty)+1e-9)
  throw Error('Không xác minh được vị thế OCC hiện tại trên Binance');
 const qty=Math.abs(amount);
 if(expectedRemainingBTC!==null&&
    Math.abs(Number(expectedRemainingBTC)-qty)>1e-9)
  throw Error('Khối lượng BTC thay đổi; cập nhật vị thế trước khi chốt');
 if(!entryOrder||String(entryOrder.orderId)!==String(entry.orderId)||
    entryOrder.symbol!=='BTCUSDT'||entryOrder.clientOrderId!==prefix||
    entryOrder.side!==(sign===1?'BUY':'SELL')||
    entryOrder.status!=='FILLED'||entryOrder.type!=='MARKET'||entryOrder.positionSide!=='BOTH'||
    !(Number(entryOrder.executedQty)>=qty-1e-9))
  throw Error('Không xác minh được Entry do OCC đặt trên Binance');
 const step=positive(filters?.stepSize),minQty=positive(filters?.minQty);
 if(!step||!minQty||Math.abs(floorStep(qty,step)-qty)>1e-9)
  throw Error('Khối lượng vị thế không hợp lệ theo LOT_SIZE Binance');
 if(!Array.isArray(algos))throw Error('Không đọc được các lệnh SL/TP trên Binance');
 const expected=new Map();
 for(const x of [managed.stop,...managed.tps]){
  if(!x?.id||!x.role||!x.clientId||x.clientId!==prefix+'-'+x.role||
     expected.has(String(x.id)))throw Error('Checkpoint SL/TP thiếu hoặc trùng ID');
  expected.set(String(x.id),x);
 }
 const active=new Map();
 for(const o of algos){
  const saved=expected.get(String(o?.algoId));
  if(!saved||o.symbol!=='BTCUSDT'||o.clientAlgoId!==saved.clientId||
     o.positionSide!=='BOTH'||o.side!==(sign===1?'SELL':'BUY')||
     !ACTIVE.has(String(o.algoStatus)))
   throw Error('Có lệnh Algo không thuộc OCC hoặc trạng thái không rõ; không chốt');
  const isSL=saved.role==='SL';
  if(isSL?(o.orderType!=='STOP_MARKET'||o.closePosition!==true):
     (o.orderType!=='TAKE_PROFIT_MARKET'||o.reduceOnly!==true||
      !positive(o.quantity)||Math.abs(Number(o.quantity)-Number(saved.qty))>1e-9))
   throw Error('Lệnh bảo vệ BTCUSDT không khớp checkpoint đã xác nhận');
  active.set(String(o.algoId),o);
 }
 const stop=active.get(String(managed.stop.id))||null;
 if(role!=='ALL'&&!stop)throw Error('Không còn STOP bảo vệ BTC; không chốt một phần');
 let leg=null,legOrder=null,closeQty=qty;
 if(role!=='ALL'){
  leg=managed.tps.find(x=>x.role===role);
  if(!leg)throw Error(role+' đã chốt hoặc không còn thuộc vị thế hiện tại');
  legOrder=active.get(String(leg.id));
  if(!legOrder)throw Error(role+' không còn đang chờ trên Binance; kiểm tra vị thế');
  closeQty=Number(legOrder.quantity);
  if(closeQty>qty+1e-9||closeQty<minQty||
     Math.abs(floorStep(closeQty,step)-closeQty)>1e-9)
   throw Error(role+' có khối lượng không hợp lệ so với BTC còn lại');
 }
 return {managed,side:entry.side,quantityBTC:qty,closeQty,
   stop,leg,legOrder,active:[...active.values()],remainingBTC:Number((qty-closeQty).toFixed(10))};
}
export function manualExitControls(analysis,managed,{halted=false,intentPhase='PROTECTED',busy=false}={}){
 const unavailable={allowed:false,remainingBTC:analysis?.position?.quantityBTC??null,
  entryOrderId:managed?.entry?.orderId??null,TP1:null,TP2:null,TP3:null,ALL:null};
 if(busy||!analysis||analysis.status!=='open'||!managed?.entry||
    !name.test(String(managed.entry.clientPrefix||''))||
    (halted&&intentPhase!=='PROTECTED')||
    analysis.normalOrderCount!==0||!Array.isArray(analysis.levels)||
    analysis.levels.some(l=>l.origin==='CHƯA_XÁC_MINH'||!l.active))
  return unavailable;
 const levels=new Map(analysis.levels.map(l=>[l.id,l]));
 const stop=levels.get(String(managed.stop?.id));
 const result={...unavailable,allowed:true,ALL:{quantityBTC:analysis.position.quantityBTC}};
 for(const role of ['TP1','TP2','TP3']){
  const leg=managed.tps?.find(x=>x.role===role);
  const row=leg&&levels.get(String(leg.id));
  result[role]=stop?.confirmed&&row?.confirmed&&row.quantityBTC>0&&
   row.quantityBTC<=analysis.position.quantityBTC+1e-9?
    {quantityBTC:row.quantityBTC,price:row.price}:null;
 }
 return result;
}
