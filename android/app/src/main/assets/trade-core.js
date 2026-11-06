'use strict';
// OCC Android: persistent, fail-closed Binance Futures controller.
// Auto intent always OFF after process restart; no replay of stale signals.
const OCC_ACTIVE = new Set(['NEW','ACCEPTED','PENDING_NEW']);
const OCC_DEFAULT = {side:'BOTH',marginUSDT:20,leverage:5,slPercent:1,
 tpMode:'Percent',tp1Val:1,tp2Val:2,tp3Val:3,tp1Qty:33,tp2Qty:33,reverseOnSignal:false,
 entryMode:'MARKET',limitOffsetPct:0.05,limitWaitSeconds:90};
const occNumber = value => value===null||value===undefined||value===''?NaN:Number(value);
const occRound = (v,d=10) => Number(v.toFixed(d));
const occFloor = (v,step) => occRound(Math.floor(v/step+1e-9)*step);
const occTick = (v,tick,up) => occRound((up?Math.ceil(v/tick-1e-9):Math.floor(v/tick+1e-9))*tick);
const occTrue = v => v===true||v==='true';
const occExitSide = side => side==='LONG'?'SELL':'BUY';
const occValidId = id => /^OCCBTC-[0-9a-f]{14}$/.test(String(id||''));
function occValidateConfig(raw){
 const c={...OCC_DEFAULT,...raw};
 for(const key of ['marginUSDT','leverage','slPercent','tp1Val','tp2Val','tp3Val','tp1Qty','tp2Qty','limitOffsetPct','limitWaitSeconds'])
  c[key]=occNumber(c[key]);
 if(!['BOTH','LONG','SHORT'].includes(c.side)||!['Percent','Points'].includes(c.tpMode)||
    !['MARKET','LIMIT_PULLBACK'].includes(c.entryMode)||
    !Number.isFinite(c.limitOffsetPct)||c.limitOffsetPct<0.01||c.limitOffsetPct>1||
    !Number.isInteger(c.limitWaitSeconds)||c.limitWaitSeconds<30||c.limitWaitSeconds>180||
    typeof c.reverseOnSignal!=='boolean'||!Number.isInteger(c.leverage)||c.leverage<1||
    c.leverage>20||!(c.marginUSDT>0&&c.marginUSDT<=1000)||!(c.slPercent>0&&c.slPercent<=10)||
    ['tp1Val','tp2Val','tp3Val','tp1Qty','tp2Qty'].some(k=>!(c[k]>0))||
    c.tp1Qty+c.tp2Qty>=100) throw Error('Cấu hình Auto không hợp lệ');
 return c;
}
class OCCMobileTrade {
 constructor({signed,publicGet,load,save,newId,report}){
  Object.assign(this,{signed,publicGet,load,save,newId,report});
  let stored={};
  try{stored=JSON.parse(load()||'{}')}catch{}
  this.cp={phase:'IDLE',entry:null,stop:null,tps:[],intent:null,halted:false,
   config:OCC_DEFAULT,...stored,config:occValidateConfig(stored.config||{})};
  this.auto=false;this.busy=false;this.connected=false;this.lastSnapshot=null;this.lastError='';
  // A process crash or app exit never resumes submitting live orders.
  if(this.cp.phase!=='IDLE')this.cp.halted=true;
  this.persist();
 }
 persist(){
  if(!this.save(JSON.stringify(this.cp))){this.auto=false;this.cp.halted=true;
   throw Error('Không ghi được checkpoint; khóa giao dịch');}
 }
 event(message){this.lastError=String(message);this.report?.(this.lastError);}
 halt(message){
  this.auto=false;this.cp.halted=true;this.cp.error=String(message);
  try{this.persist()}catch{}
  this.event('KHÓA AN TOÀN: '+message);
 }
 async locked(fn){
  if(this.busy)throw Error('OCC đang đối soát lệnh');this.busy=true;
  try{return await fn()}finally{this.busy=false;}
 }
 setConfig(config){
  if(this.auto||this.busy||this.cp.phase!=='IDLE'||this.cp.halted)
   throw Error('Chỉ sửa cấu hình khi Auto OFF và không có lệnh OCC');
  this.cp.config=occValidateConfig(config);this.persist();return this.cp.config;
 }
 async getSnapshot(){
  const [acc,risk,openOrders,algos,mode,settings]=await Promise.all([
   this.signed('GET','/fapi/v2/account'),
   this.signed('GET','/fapi/v3/positionRisk',{symbol:'BTCUSDT'}),
   this.signed('GET','/fapi/v1/openOrders',{symbol:'BTCUSDT'}),
   this.signed('GET','/fapi/v1/openAlgoOrders',{symbol:'BTCUSDT'}),
   this.signed('GET','/fapi/v1/positionSide/dual'),
   this.signed('GET','/fapi/v1/symbolConfig',{symbol:'BTCUSDT'})
  ]);
  if(!Array.isArray(acc?.assets)||!Array.isArray(risk)||!Array.isArray(openOrders)||
    !Array.isArray(algos)||!Array.isArray(settings)||mode?.dualSidePosition!==false)
   throw Error('Dữ liệu Futures không hợp lệ hoặc chưa ở One-way');
  const current=risk.filter(p=>p.symbol==='BTCUSDT');
  if(current.length>1||current.some(x=>x.positionSide!=='BOTH'))
   throw Error('BTCUSDT có nhiều vị thế hoặc không ở One-way');
  const p=current[0]||null,rawAmount=p?occNumber(p.positionAmt):0;
  if(!Number.isFinite(rawAmount))throw Error('Binance positionAmt không hợp lệ');
  const amount=rawAmount;
  const symbol=settings.find(x=>x.symbol==='BTCUSDT');
  const usdt=acc.assets.find(x=>x.asset==='USDT');
  if(!symbol||!usdt||acc.canTrade!==true)throw Error('Thiếu USDT hoặc quyền Futures');
  const snap={side:amount>0?'LONG':amount<0?'SHORT':null,qty:Math.abs(amount),
   amount,entryPrice:occNumber(p?.entryPrice),markPrice:occNumber(p?.markPrice),
   position:p,openOrders,algos,
   otherPositions:risk.filter(x=>x.symbol!=='BTCUSDT'&&Math.abs(occNumber(x.positionAmt)||0)>1e-9),
   marginType:String(symbol.marginType).toUpperCase(),
   leverage:Number(symbol.leverage),availableUSDT:occNumber(usdt.availableBalance),at:Date.now()};
  this.lastSnapshot=snap;return snap;
 }
 verifyFlat(s,{leverage=true}={}){
  if(s.side)throw Error('Binance đang có vị thế BTCUSDT '+s.side+' '+s.qty+
   ' BTC; chỉ bật AUTO khi đã FLAT để tránh lệnh trùng.');
  if(s.openOrders.length||s.algos.length)
   throw Error('Binance còn '+s.openOrders.length+' lệnh thường và '+s.algos.length+
    ' SL/TP Algo; phải xử lý trên Binance trước khi bật AUTO.');
  if(s.otherPositions.length)
   throw Error('Tài khoản Futures còn '+s.otherPositions.length+' vị thế khác; chỉ bật AUTO khi không có vị thế khác.');
  if(s.marginType!=='ISOLATED')
   throw Error('BTCUSDT Binance đang '+s.marginType+'; cần ISOLATED. Đổi chế độ ký quỹ trên Binance khi FLAT.');
  if(leverage&&s.leverage!==this.cp.config.leverage)
   throw Error('Đòn bẩy không khớp: Binance '+s.leverage+'x, Auto '+this.cp.config.leverage+
    'x. Khi FLAT bấm Đặt leverage Binance.');
 }
 async getRules(){
  const info=await this.publicGet('/fapi/v1/exchangeInfo');
  const symbol=info.symbols?.find(x=>x.symbol==='BTCUSDT'&&x.status==='TRADING'&&x.contractType==='PERPETUAL');
  if(!symbol)throw Error('Không xác minh được BTCUSDT perpetual');
  const filter=k=>symbol.filters?.find(x=>x.filterType===k);
  const lot=filter('MARKET_LOT_SIZE'),limitLot=filter('LOT_SIZE'),price=filter('PRICE_FILTER'),minimum=filter('MIN_NOTIONAL');
  const useLimit=this.cp.config.entryMode==='LIMIT_PULLBACK';
  const size=useLimit?limitLot:lot;
  const rules={step:occNumber(size?.stepSize),min:occNumber(size?.minQty),
   tick:occNumber(price?.tickSize),minNotional:occNumber(minimum?.notional)||5};
  if(!(rules.step>0&&rules.min>0&&rules.tick>0))throw Error('Thiếu filter Binance');
  return rules;
 }
 minMarginForThreeTP(price,rules){
  const c=this.cp.config;
  if(!(price>0&&rules.step>0&&rules.min>0&&c.leverage>0))return null;
  const minimumLots=Math.max(3*Math.ceil(rules.min/rules.step-1e-8),
   Math.ceil(rules.minNotional/(price*rules.step)-1e-8));
  for(let lots=minimumLots;lots<minimumLots+10000;lots++){
   const qty=occRound(lots*rules.step);
   const a=occFloor(qty*c.tp1Qty/100,rules.step);
   const b=occFloor(qty*c.tp2Qty/100,rules.step);
   const remainder=occRound(qty-a-b);
   if([a,b,remainder].every(v=>v>=rules.min-1e-9)&&
      qty*price>=rules.minNotional-1e-8)
    return Math.ceil(qty*price/c.leverage*1.02*100)/100;
  }
  return null;
 }
 plan(s,price,rules){
  const c=this.cp.config;
  if(!Number.isFinite(price)||price<=0)
   throw Error('Chưa có giá BTCUSDT Futures hợp lệ');
  if(!Number.isFinite(s.availableUSDT))
   throw Error('Binance không xác nhận USDT khả dụng');
  if(s.availableUSDT<c.marginUSDT)
   throw Error('USDT khả dụng thấp hơn ký quỹ '+c.marginUSDT+' USDT');
  const qty=occFloor(c.marginUSDT*c.leverage/price,rules.step);
  const a=occFloor(qty*c.tp1Qty/100,rules.step),b=occFloor(qty*c.tp2Qty/100,rules.step);
  const parts=[a,b,occRound(qty-a-b)];
  if(qty<rules.min||qty*price<rules.minNotional||
     parts.some(v=>v<rules.min)||Math.abs(parts.reduce((x,y)=>x+y,0)-qty)>1e-8){
   const minimum=this.minMarginForThreeTP(price,rules);
   throw Error('Ký quỹ '+c.marginUSDT+' USDT ở '+c.leverage+
     'x không đủ chia 3 TP theo Binance'+
     (minimum==null?'.':'; cần khoảng '+minimum+' USDT hoặc hơn. Mở Cấu hình Auto để chỉnh.'));
  }
  return {qty,parts};
 }
 async preflight({price,healthy}){
  if(!this.connected)throw Error('Chưa kết nối Binance Futures API');
  if(this.cp.halted)throw Error('OCC đang khóa an toàn: '+(this.cp.error||'cần đối soát Binance'));
  if(this.cp.phase!=='IDLE')throw Error('OCC còn lệnh/checkpoint: '+this.cp.phase);
  if(!healthy)throw Error('Giá BTCUSDT chưa LIVE hoặc quá hạn');
  const snap=await this.getSnapshot();
  this.verifyFlat(snap);
  const rules=await this.getRules();
  const plan=this.plan(snap,price,rules);
  return {quantityBTC:plan.qty,legsBTC:plan.parts,availableUSDT:snap.availableUSDT,
   marginUSDT:this.cp.config.marginUSDT,leverage:this.cp.config.leverage,
   markPrice:price,checkedAt:Date.now()};
 }
 async arm({price,healthy,confirmation}){
  return this.locked(async()=>{
   if(confirmation!=='CHAP NHAN BTC FUTURES')throw Error('Chưa xác nhận giao dịch Futures tiền thật');
   const check=await this.preflight({price,healthy});
   // Keep Binance checks read-only until the explicit confirmation has been given.
   this.auto=true;this.event('AUTO ON · BTC '+check.quantityBTC+' · chờ tín hiệu M15 mới');
   return true;
  });
 }
 disarm(){this.auto=false;this.event('AUTO OFF · giữ lệnh bảo vệ trên Binance');}
 async setLeverage(value){
  return this.locked(async()=>{
   if(this.auto||this.cp.phase!=='IDLE'||this.cp.halted)
    throw Error('Tắt Auto và xử lý vị thế trước khi đổi leverage');
   const s=await this.getSnapshot();this.verifyFlat(s,{leverage:false});
   if(!Number.isInteger(value)||value<1||value>20||value!==this.cp.config.leverage)
    throw Error('Leverage khác cấu hình');
   this.cp.phase='LEVERAGE_SENDING';this.cp.intent={value,clientId:null,sent:false};
   this.persist();
   try{
    await this.signed('POST','/fapi/v1/leverage',{symbol:'BTCUSDT',leverage:value});
    const confirmed=await this.getSnapshot();
    if(confirmed.leverage!==value)throw Error('Binance chưa xác nhận leverage');
    this.cp.phase='IDLE';this.cp.intent=null;this.persist();return true;
   }catch(e){this.halt(e.message);throw e;}
  });
 }
}
window.OCCMobileTrade=OCCMobileTrade;
