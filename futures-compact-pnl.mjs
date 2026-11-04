// Informational four-line SL/TP estimate. Uses the exact BTCUSDT lot rounding
// and tick rules as the live order planner. Does not place or confirm orders.
import {validateLiveConfig,sizeBTC,floorStep,roundTick,liveTargets} from './futures-sizing.mjs';
const finitePositive=x=>x!=null&&Number.isFinite(Number(x))&&Number(x)>0?Number(x):null;
const round=x=>Number(x.toFixed(8));
export function projectCompactSLTP({position=null,config,filters,referencePrice=null,availableUSDT=null}){
 const c=validateLiveConfig(config);
 const step=finitePositive(filters?.stepSize),tick=finitePositive(filters?.tickSize),
  minQty=finitePositive(filters?.minQty);
 if(!step||!tick||!minQty)return {status:'unavailable',reason:'Chưa đọc được quy tắc khối lượng Binance.'};
 const open=!!position&&['LONG','SHORT'].includes(position.side)&&Number(position.quantityBTC)>0;
 const side=open?position.side:c.side==='SHORT'?'SHORT':'LONG';
 const entry=open?finitePositive(position.entryPrice):finitePositive(referencePrice);
 if(!entry)return {status:'unavailable',reason:open?'Chưa có giá Entry hợp lệ.':'Chưa có giá BTC trực tiếp để ước tính.'};
 let qty,legs;
 if(open){
  qty=Number(position.quantityBTC);
  const q1=floorStep(qty*c.tp1Qty/100,step),q2=floorStep(qty*c.tp2Qty/100,step);
  legs=[q1,q2,round(qty-q1-q2)];
 }else{
  try{
   const plan=sizeBTC({entry,availableUSDT:Number(availableUSDT),step,
    minQty,minNotional:Number(filters?.minNotional||0)},c);
   qty=plan.qty;legs=plan.legs;
  }catch(e){return {status:'unavailable',reason:'Chưa đủ khối lượng hợp lệ để tính ba TP: '+e.message};}
 }
 if(legs.some(x=>!Number.isFinite(x)||x<minQty)||Math.abs(legs.reduce((a,b)=>a+b,0)-qty)>1e-8)
  return {status:'unavailable',reason:'BTC còn lại quá nhỏ để chia đủ TP1/TP2/TP3 theo bước lot Binance.'};
 const direction=side==='LONG'?1:-1,targets=liveTargets(entry,side,c);
 const prices=[
  roundTick(targets.stop,tick,side==='LONG'?'down':'up'),
  ...[targets.tp1,targets.tp2,targets.tp3].map(x=>
   roundTick(x,tick,side==='LONG'?'up':'down'))
 ];
 const requested=[100,c.tp1Qty,c.tp2Qty,100-c.tp1Qty-c.tp2Qty];
 const rows=prices.map((price,i)=>{
  const part=i===0?qty:legs[i-1],gross=round(direction*(price-entry)*part);
  return {role:i===0?'SL':'TP'+i,price,quantityBTC:part,grossUSDT:gross,
   configuredSharePercent:requested[i],effectiveSharePercent:round(part/qty*100)};
 });
 return {status:'ready',basis:open?'open':'illustration',side,entryPrice:entry,quantityBTC:qty,
  rows,allocationRounded:rows.slice(1).some(x=>Math.abs(x.configuredSharePercent-x.effectiveSharePercent)>0.01),
  note:open?
   'Dự kiến theo cấu hình cho BTC còn lại; không xác nhận giá/SL/TP đã đặt trên Binance.':
   'Minh họa '+side+' theo giá BTC hiện tại, chưa có lệnh. Giá Entry và khối lượng khi đặt có thể khác.'};
}
