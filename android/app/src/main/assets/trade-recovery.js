'use strict';
(function(){
const p=OCCMobileTrade.prototype;
const same=(a,b)=>String(a)===String(b);
const near=(a,b)=>Math.abs(Number(a)-Number(b))<=1e-8;
p.validateProtected=async function(s){
 const cp=this.cp;
 if(!cp.entry||!cp.stop||cp.phase!=='PROTECTED')throw Error('Chưa xác minh PROTECTED');
 await this.verifyOwnership();
 if(s.side!==cp.entry.side||s.qty>cp.entry.qty+1e-8||
    s.openOrders.length||s.otherPositions.length)throw Error('Vị thế hoặc lệnh ngoài OCC');
 const known=[cp.stop,...cp.tps];
 if(s.algos.some(x=>!known.some(k=>same(k.id,x.algoId)&&k.clientId===x.clientAlgoId)))
  throw Error('Có Algo không thuộc checkpoint OCC');
 const stop=s.algos.find(x=>same(x.algoId,cp.stop.id));
 if(!stop||stop.clientAlgoId!==cp.stop.clientId||!OCC_ACTIVE.has(stop.algoStatus)||
    stop.orderType!=='STOP_MARKET'||!occTrue(stop.closePosition)||
    stop.side!==(s.side==='LONG'?'SELL':'BUY'))
  throw Error('STOP OCC không hoạt động trên Binance');
 for(const a of s.algos.filter(x=>x!==stop)){
  if(a.orderType!=='TAKE_PROFIT_MARKET'||!occTrue(a.reduceOnly)||
     !OCC_ACTIVE.has(a.algoStatus))throw Error('TP OCC không còn trạng thái an toàn');
 }
 return s;
};
p.cleanFlat=async function(){
 const a=await this.getSnapshot(),b=await this.getSnapshot();
 if(a.side||b.side||a.openOrders.length||b.openOrders.length||
   a.otherPositions.length||b.otherPositions.length)
  throw Error('Binance chưa xác minh BTCUSDT FLAT hai lần');
 const known=[this.cp.stop,...this.cp.tps].filter(Boolean);
 if(b.algos.some(x=>!known.some(k=>same(k.id,x.algoId)&&k.clientId===x.clientAlgoId)))
  throw Error('Có Algo không rõ nguồn gốc khi BTC FLAT');
 for(const algo of [...b.algos]){
  const match=known.find(k=>same(k.id,algo.algoId));
  if(!match||!OCC_ACTIVE.has(String(algo.algoStatus)))throw Error('Algo cũ chưa xác minh');
  this.cp.phase='CLEANUP_SENDING';
  this.cp.intent={kind:'CANCEL',algoId:String(algo.algoId),sent:false};
  this.persist();
  await this.signed('DELETE','/fapi/v1/algoOrder',{symbol:'BTCUSDT',algoId:algo.algoId});
  const remaining=await this.getSnapshot();
  if(remaining.algos.some(x=>same(x.algoId,algo.algoId))||remaining.side)
   throw Error('Không xác nhận hủy Algo cũ hoặc vị thế mới xuất hiện');
 }
 const last=await this.getSnapshot();
 if(last.side||last.openOrders.length||last.algos.length)throw Error('Chưa dọn sạch BTCUSDT');
 this.cp.phase='IDLE';this.cp.entry=null;this.cp.stop=null;this.cp.tps=[];
 this.cp.intent=null;this.cp.halted=false;this.cp.error=null;this.persist();
 this.event('Binance xác nhận FLAT; đã dọn SL/TP cũ');
};
p.manualClose=async function(role,{automaticReversal=false}={}){
 return this.locked(async()=>{
  if(!['TP1','TP2','TP3','ALL'].includes(role)||this.cp.phase!=='PROTECTED'||this.cp.halted)
   throw Error('Không có vị thế OCC xác minh để đóng MARKET');
  let mutation=false;
  try{
   const start=await this.validateProtected(await this.getSnapshot());
   const leg=role==='ALL'?null:this.cp.tps.find(t=>t.role===role);
   if(role!=='ALL'&&!leg)throw Error('TP không nằm trong checkpoint');
   let qty=role==='ALL'?start.qty:leg.qty;
   if(!(qty>0&&qty<=start.qty+1e-8))throw Error('Khối lượng chốt không hợp lệ');
   if(leg){
    const live=start.algos.find(x=>same(x.algoId,leg.id));
    if(!live||live.clientAlgoId!==leg.clientId||!OCC_ACTIVE.has(live.algoStatus)||
      !occTrue(live.reduceOnly)||!near(live.quantity,leg.qty))
     throw Error('TP đã khớp/hủy, không gửi MARKET thêm');
    this.cp.phase='TP_CANCEL_SENDING';
    this.cp.intent={kind:'CANCEL',algoId:leg.id,role,sent:false};this.persist();
    mutation=true;
    await this.signed('DELETE','/fapi/v1/algoOrder',{symbol:'BTCUSDT',algoId:leg.id});
    const checked=await this.getSnapshot();
    if(checked.algos.some(x=>same(x.algoId,leg.id))||
      !near(checked.qty,start.qty)||checked.side!==start.side)
     throw Error('TP chưa hủy hoặc BTC đã thay đổi; không gửi MARKET');
    this.cp.tps=this.cp.tps.filter(t=>t.id!==leg.id);
    this.cp.phase='TP_CANCELLED';this.cp.intent=null;this.persist();
   }
   const closeId=this.newId();
   if(!occValidId(closeId))throw Error('Không tạo được mã chốt lệnh');
   this.cp.phase='MANUAL_SENDING';
   this.cp.intent={kind:'CLOSE',clientId:closeId,qty,role,sent:false};
   this.persist();mutation=true;
   const result=await this.signed('POST','/fapi/v1/order',{
     symbol:'BTCUSDT',positionSide:'BOTH',side:start.side==='LONG'?'SELL':'BUY',
     type:'MARKET',reduceOnly:'true',quantity:String(qty),newClientOrderId:closeId,
     newOrderRespType:'RESULT'
   });
   if(!result?.orderId||result.status!=='FILLED')throw Error('Kết quả MARKET không rõ');
   const check=await this.signed('GET','/fapi/v1/order',{symbol:'BTCUSDT',orderId:result.orderId});
   if(check.symbol!=='BTCUSDT'||!same(check.orderId,result.orderId)||
      check.clientOrderId!==closeId||check.status!=='FILLED'||
      !occTrue(check.reduceOnly)||!near(check.executedQty,qty))
    throw Error('Không xác minh được MARKET giảm vị thế');
   const after=await this.getSnapshot();
   if(!near(after.qty,start.qty-qty)||
      (after.qty>1e-9&&after.side!==start.side))throw Error('BTC sau chốt lệch Binance');
   if(after.qty<=1e-9){
    await this.cleanFlat();
   }else{
    this.cp.phase='PROTECTED';this.cp.intent=null;this.persist();
    await this.validateProtected(after);
   }
   this.event('Chốt '+role+' '+qty+' BTC qua MARKET · đã xác minh');
   return {role,qty,remaining:after.qty};
  }catch(e){if(mutation)this.halt(e.message+' · đối soát Binance trước khi thao tác lại');throw e;}
 });
};
p.monitor=async function(){
 if(!this.connected||this.busy)return;
 try{
  return await this.locked(async()=>{
   const s=await this.getSnapshot();
   if(this.cp.halted)return s;
   if(this.cp.phase==='IDLE'){
    if(this.auto&&(s.side||s.openOrders.length||s.algos.length||s.otherPositions.length))
     this.halt('Phát hiện vị thế/lệnh ngoài OCC khi AUTO ON');
   }else if(this.cp.phase==='PROTECTED'){
    try{
     if(!s.side)await this.cleanFlat();
     else await this.validateProtected(s);
    }catch(e){this.halt(e.message);}
   }
   return s;
  });
 }catch(e){this.event('Đối soát lỗi: '+e.message);}
};
p.reconcile=async function(){
 return this.locked(async()=>{
  if(this.auto)throw Error('Tắt AUTO trước khi đối soát');
  const s=await this.getSnapshot();
  if(this.cp.phase==='PROTECTED'){
   if(s.side){
    await this.validateProtected(s);
    this.cp.halted=false;this.cp.error=null;this.persist();
    this.event('Vị thế và STOP/TP thuộc OCC đã xác minh; AUTO vẫn OFF');
   }else{
    await this.cleanFlat();
   }
  }else if(this.cp.phase==='IDLE'){
   this.verifyFlat(s,{leverage:false});
   this.cp.halted=false;this.cp.error=null;this.persist();
   this.event('BTC FLAT; AUTO vẫn OFF');
  }else{
   throw Error('Kết quả lệnh trước chưa rõ; kiểm tra Binance thủ công, không thử lại');
  }
 });
};
})();
