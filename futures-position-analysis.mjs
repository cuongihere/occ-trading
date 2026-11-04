// Read-only BTCUSDT Futures position/risk analysis. Inputs are exchange readbacks,
// never current bot settings. No order is submitted, changed, cancelled or inferred.
const finite=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
const positive=v=>{const n=finite(v);return n!==null&&n>0?n:null;};
const isTrue=v=>v===true||v==='true';
const activeStatus=new Set(['NEW','ACCEPTED','PENDING_NEW']);
const round=n=>Number(n.toFixed(8));
const gain=(direction,entry,price,qty)=>round(direction*(price-entry)*qty);
export function analyzeFuturesPosition({riskRows,algoOrders,openOrders,checkpoint=null,managed=false,leverage=null,fetchedAt=Date.now()}){
 if(!Array.isArray(riskRows)||!Array.isArray(algoOrders)||!Array.isArray(openOrders))
  throw Error('Không xác minh được vị thế hoặc danh sách lệnh Binance');
 const matches=riskRows.filter(r=>r?.symbol==='BTCUSDT');
 if(matches.some(x=>x.positionSide!=='BOTH')||matches.length>1)
  throw Error('Vị thế BTCUSDT không ở chế độ One-way hoặc có nhiều kết quả');
 const p=matches[0]||null,amount=finite(p?.positionAmt);
 if(p&&amount===null)throw Error('Binance trả về khối lượng BTCUSDT không hợp lệ');
 const amt=amount||0,qty=Math.abs(amt),side=amt>0?'LONG':amt<0?'SHORT':null,
  direction=amt>0?1:-1,entry=positive(p?.entryPrice),mark=positive(p?.markPrice),
  liq=positive(p?.liquidationPrice);
 if(side&&!entry)throw Error('Không có giá vào lệnh hợp lệ từ Binance');
 const warnings=[],known=new Map();
 // An algoId alone does not prove ownership: verify the exchange clientAlgoId
 // against the exact SL/TP record previously acknowledged and checkpointed.
 for(const x of [checkpoint?.stop,...(checkpoint?.tps||[])])
  if(x?.id!=null&&x?.clientId)known.set(String(x.id),String(x.clientId));
 const orders=algoOrders.filter(o=>o?.symbol==='BTCUSDT').map(o=>{
  const kind=String(o.orderType||o.type||'UNKNOWN').toUpperCase();
  const price=positive(o.triggerPrice),quantity=positive(o.quantity);
  const status=String(o.algoStatus||o.status||'UNKNOWN').toUpperCase();
  const reverseSide=side==='LONG'?'SELL':'BUY';
  const rightSide=side&&o.side===reverseSide;
  const active=activeStatus.has(status);
  const role=kind==='STOP_MARKET'?'SL':kind==='TAKE_PROFIT_MARKET'?'TP':'OTHER';
  const validStop=role==='SL'&&active&&rightSide&&isTrue(o.closePosition)&&!!price;
  const validTp=role==='TP'&&active&&rightSide&&!!price&&
   (isTrue(o.reduceOnly)&&!!quantity||isTrue(o.closePosition));
  const effectiveQty=validTp?(isTrue(o.closePosition)?qty:quantity):quantity;
  const id=o.algoId!=null?String(o.algoId):null;
  return {id,clientId:String(o.clientAlgoId||''),role,status,active,side:String(o.side||''),
   price,quantity:effectiveQty,closeAll:isTrue(o.closePosition),
   reduceOnly:isTrue(o.reduceOnly),workingType:String(o.workingType||''),
   origin:id&&known.get(id)===String(o.clientAlgoId||'')?
    (managed?'BOT_ĐANG_QUẢN_LÝ':'KHỚP_CHECKPOINT'):'CHƯA_XÁC_MINH',
   validStop:!!validStop,validTp:!!validTp};
 });
 const normalCount=openOrders.filter(o=>o?.symbol==='BTCUSDT').length;
 const snapshot={status:side?'open':'flat',fetchedAt,position:side?{
   side,quantityBTC:qty,entryPrice:entry,markPrice:mark,liquidationPrice:liq,
   notionalUSDT:round(qty*(mark||entry)),unrealizedUSDT:finite(p?.unRealizedProfit??p?.unrealizedProfit)??(mark?gain(direction,entry,mark,qty):null),
   initialMarginUSDT:positive(p?.positionInitialMargin)??positive(p?.initialMargin)??
    (positive(leverage)?round(qty*entry/Number(leverage)):null)
  }:null,normalOrderCount:normalCount,algoCount:orders.length,levels:[],scenarios:[],
  coverageBTC:null,slProtected:false,ownershipVerified:false,warnings,
  disclaimer:'Lãi/lỗ GROSS ước tính tại giá kích hoạt; chưa trừ phí mở/đóng, funding, trượt giá hoặc các TP đã khớp trước ảnh chụp. Kích hoạt không đảm bảo khớp đúng giá.'};
 if(!side){
  // Surface orphaned protection after a fully closed position instead of hiding it.
  // Without a position there is no meaningful quantity share or PnL projection.
  snapshot.levels=orders.map(o=>({...o,label:o.role,quantityBTC:o.quantity,
   sharePercent:null,priceMovePercent:null,grossUSDT:null,confirmed:false}));
  if(orders.length||normalCount)warnings.push('Không có vị thế BTCUSDT nhưng còn lệnh đang mở: cần kiểm tra Binance trước khi bật lại AUTO.');
  return snapshot;
 }
 if(normalCount)warnings.push('Có '+normalCount+' lệnh thường trên Binance; kịch bản bên dưới không tính các lệnh này.');
 const stops=orders.filter(o=>o.validStop),tps=orders.filter(o=>o.validTp)
  .sort((a,b)=>direction*(a.price-b.price));
 if(stops.length!==1)warnings.push(stops.length===0?
  'Không xác minh được lệnh SL close-all đang hoạt động cho vị thế này. Kiểm tra Binance ngay.':
  'Có nhiều lệnh SL hợp lệ: không thể xác định một mức SL duy nhất.');
 const stop=stops.length===1?stops[0]:null;
 snapshot.slProtected=!!stop;
 const usedLevels=[];
 for(const o of orders){
  let role=o.role,valid=o.validStop||o.validTp;
  const level={...o,label:role,quantityBTC:o.validStop?qty:o.quantity,
   sharePercent:o.validStop?100:o.quantity!=null?round(o.quantity/qty*100):null,
   priceMovePercent:o.price!=null?round(direction*(o.price-entry)/entry*100):null,
   grossUSDT:valid&&o.price!=null&&(o.validStop||o.quantity!=null)?
    gain(direction,entry,o.price,Math.min(qty,o.validStop?qty:o.quantity)):null,
   confirmed:valid};
  usedLevels.push(level);
  if(!valid)warnings.push('Lệnh #'+(o.id||'?')+' ('+role+') thiếu giá, sai chiều, chưa active hoặc chưa xác minh reduce-only/close-all.');
 }
 snapshot.levels=usedLevels.sort((a,b)=>{
  if(a.role==='SL')return -1;if(b.role==='SL')return 1;
  if(a.role==='TP'&&b.role!=='TP')return -1;if(a.role!=='TP'&&b.role==='TP')return 1;
  return direction*((a.price??0)-(b.price??0));
 });
 if(orders.some(o=>o.origin==='CHƯA_XÁC_MINH'))
  warnings.push('Một số lệnh Binance không khớp cả Algo ID và Client Algo ID trong checkpoint OCC; không xác nhận thuộc bot.');
 if(stops.some(o=>o.origin==='CHƯA_XÁC_MINH'))
  warnings.push('SL đang hiện trên Binance nhưng chưa khớp ID của OCC; cần đối soát thủ công.');
 const totalTpQty=tps.reduce((a,o)=>a+(o.quantity||0),0);
 snapshot.coverageBTC=round(Math.min(qty,totalTpQty));
 if(totalTpQty>qty+1e-8)warnings.push('Tổng khối lượng TP vượt vị thế còn lại; kịch bản được giới hạn theo vị thế hiện tại.');
 else if(totalTpQty<qty-1e-8)warnings.push('Các TP đang mở chưa phủ hết vị thế; phần còn lại chỉ có thể đóng qua SL hoặc thao tác khác.');
 if(mark&&snapshot.position.initialMarginUSDT)
  snapshot.position.roiPercent=round(snapshot.position.unrealizedUSDT/snapshot.position.initialMarginUSDT*100);
 const slPnl=stop?gain(direction,entry,stop.price,qty):null;
 if(stop)snapshot.scenarios.push({label:'SL ngay',exitPrice:stop.price,grossUSDT:slPnl,
  closedBTC:qty,remainingBTC:0,source:'Giả định toàn bộ vị thế còn lại chạm SL'});
 let remaining=qty,acc=0,idx=0;
 for(const tp of tps){
  const take=Math.min(remaining,tp.quantity||0);
  if(take<=0)break;
  idx++;acc=round(acc+gain(direction,entry,tp.price,take));
  remaining=round(Math.max(0,remaining-take));
  const label='Đạt '+Array.from({length:idx},(_,i)=>'TP'+(i+1)).join(' + ');
  snapshot.scenarios.push({label:remaining>1e-8?label+' → SL':label+' (đóng hết)',
   exitPrice:stop?.price??null, grossUSDT:remaining<=1e-8?acc:stop?round(acc+gain(direction,entry,stop.price,remaining)):null,
   closedBTC:round(qty-remaining),remainingBTC:remaining,source:remaining<=1e-8?'TP đạt đầy đủ':'Các TP đã khớp, phần còn lại giả định chạm SL'});
 }
 if(remaining>1e-8&&tps.length&&!stop)warnings.push('Không có SL xác minh: không thể tính kịch bản sau khi chốt một phần TP.');
 snapshot.ownershipVerified=orders.length>0&&orders.every(o=>o.origin!=='CHƯA_XÁC_MINH');
 return snapshot;
}
