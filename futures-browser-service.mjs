// Browser-based BTCUSDT connection; credentials exist only in server memory.
// Demo auto-trade is an opt-in isolated executor; production order placement remains gated.
import {randomBytes} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {FuturesTransport} from './futures-transport.mjs';
import {validateLiveConfig} from './futures-sizing.mjs';
import {draftProtectedOrder} from './futures-order-plan.mjs';
import {ProtectionCoordinator} from './futures-protection-orchestrator.mjs';
import {ProtectionCheckpoint} from './futures-protection-checkpoint.mjs';

const DEFAULT={side:'BOTH',marginUSDT:20,leverage:5,slPercent:1,tpMode:'Percent',
 tp1Val:1,tp2Val:2,tp3Val:3,tp1Qty:33,tp2Qty:33};
const safeJSON=(value)=>JSON.parse(JSON.stringify(value));
export class BrowserFutures{
 constructor({dataDir,transportFactory=null}){
  this.dir=resolve(dataDir);this.path=resolve(this.dir,'futures-browser-settings.json');
  this.intentPath=resolve(this.dir,'futures-demo-intent.json');
  this.protectionPath=resolve(this.dir,'futures-demo-protection.json');
  this.config=validateLiveConfig(existsSync(this.path)?JSON.parse(readFileSync(this.path,'utf8')):DEFAULT);
  this.transportFactory=transportFactory||((params)=>new FuturesTransport(params));
  this.api=null;this.environment=null;this.account=null;this.filters=null;
  this.armed=false;this.busy=false;this.halted=false;this.error=null;this.events=[];this.activeProtection=null;
  const unresolved=existsSync(this.intentPath)?JSON.parse(readFileSync(this.intentPath,'utf8')):null;
  const prior=existsSync(this.protectionPath)?new ProtectionCheckpoint(this.protectionPath).load():null;
  if((unresolved&&unresolved.phase!=='CLEARED')||(prior&&prior.phase!=='IDLE')){
   this.halted=true;this.error='Có lệnh Demo chưa đối soát sau lần chạy trước. Kiểm tra Binance Demo trước khi tạo lệnh mới.';
  }
 }
 log(type,message){this.events.push({at:Date.now(),type,message:String(message).slice(0,400)});this.events=this.events.slice(-50);}
 saveConfig(input){
  if(this.armed||this.busy||this.activeProtection)throw Error('Tắt Auto và đóng hết vị thế Demo đang quản lý trước khi sửa cấu hình');
  this.config=validateLiveConfig(input);
  mkdirSync(this.dir,{recursive:true});
  const temp=this.path+'.tmp';writeFileSync(temp,JSON.stringify(this.config,null,2),{mode:0o600});renameSync(temp,this.path);
  return this.config;
 }
 saveIntent(record){
  mkdirSync(dirname(this.intentPath),{recursive:true});
  const temp=this.intentPath+'.tmp';writeFileSync(temp,JSON.stringify(record,null,2),{mode:0o600});renameSync(temp,this.intentPath);
 }
 snapshot(){
  return {connected:!!this.api,environment:this.environment,armed:this.armed,
   demoOnly:true,halted:this.halted,busy:this.busy,error:this.error,
   protectedPosition:this.activeProtection?{entry:this.activeProtection.entry,stop:this.activeProtection.stop,tps:this.activeProtection.tps}:null,
   config:this.config,account:this.account,events:this.events.slice(-20),
   warning:'LIVE production bị khóa. Demo chỉ dùng vốn thử nghiệm. API Key/Secret không ghi vào file hay trình duyệt.'};
 }
 async inspect(){
  if(!this.api)throw Error('Chưa kết nối API');
  await this.api.syncClock();
  // The V3 positionRisk API deliberately omits symbols without positions/orders.
  // Never treat an absent BTCUSDT row as a failed API connection.
  const [account,mode,config,positions,orders,algos,info]=await Promise.all([
   this.api.get('/fapi/v2/account'),this.api.get('/fapi/v1/positionSide/dual'),
   this.api.get('/fapi/v1/symbolConfig',{symbol:'BTCUSDT'}),
   this.api.get('/fapi/v3/positionRisk',{symbol:'BTCUSDT'}),
   this.api.get('/fapi/v1/openOrders',{symbol:'BTCUSDT'}),
   this.api.get('/fapi/v1/openAlgoOrders',{symbol:'BTCUSDT'}),
   this.api.get('/fapi/v1/exchangeInfo')]);
  if(!account||typeof account!=='object'||!Array.isArray(account.assets))
   throw Error('Binance /fapi/v2/account: thiếu assets; kiểm tra quyền đọc tài khoản Futures');
  if(!mode||typeof mode.dualSidePosition!=='boolean')
   throw Error('Binance /fapi/v1/positionSide/dual: dữ liệu One-way/Hedge không hợp lệ');
  if(!Array.isArray(config))throw Error('Binance /fapi/v1/symbolConfig: phản hồi không phải danh sách');
  const c=config.find(x=>x?.symbol==='BTCUSDT');
  if(!c)throw Error('Binance /fapi/v1/symbolConfig: không có cấu hình BTCUSDT');
  if(!Array.isArray(positions))throw Error('Binance /fapi/v3/positionRisk: phản hồi không phải danh sách');
  if(!Array.isArray(orders))throw Error('Binance /fapi/v1/openOrders: phản hồi không phải danh sách');
  if(!Array.isArray(algos))throw Error('Binance /fapi/v1/openAlgoOrders: phản hồi không phải danh sách');
  if(!info||!Array.isArray(info.symbols))
   throw Error('Binance /fapi/v1/exchangeInfo: thiếu thông tin hợp đồng');
  const symbol=info.symbols.find(x=>x?.symbol==='BTCUSDT'&&x.contractType==='PERPETUAL'&&x.status==='TRADING');
  if(!symbol)throw Error('Binance /fapi/v1/exchangeInfo: BTCUSDT Perpetual chưa ở trạng thái TRADING');
  const f=k=>symbol.filters?.find(x=>x.filterType===k);
  const marketLot=f('MARKET_LOT_SIZE'),regularLot=f('LOT_SIZE');
  const lot=marketLot&&Number(marketLot.stepSize)>0&&Number(marketLot.minQty)>0?marketLot:regularLot;
  this.filters={stepSize:Number(lot?.stepSize),minQty:Number(lot?.minQty),
   minNotional:Number(f('MIN_NOTIONAL')?.notional||0),tickSize:Number(f('PRICE_FILTER')?.tickSize)};
  if(!(this.filters.stepSize>0)||!(this.filters.minQty>0)||!(this.filters.tickSize>0))
   throw Error('Binance /fapi/v1/exchangeInfo: thiếu quy tắc bước khối lượng hoặc giá BTCUSDT');
  const usdt=account.assets.find(x=>x.asset==='USDT');
  if(!usdt)throw Error('Binance /fapi/v2/account: không thấy tài sản USDT Futures');
  const availableUSDT=Number(usdt.availableBalance),walletUSDT=Number(usdt.walletBalance);
  if(!Number.isFinite(availableUSDT)||!Number.isFinite(walletUSDT))
   throw Error('Binance /fapi/v2/account: số dư USDT không hợp lệ');
  const matching=positions.filter(x=>x?.symbol==='BTCUSDT');
  if(matching.some(x=>x.positionSide!=='BOTH')||matching.length>1)
   throw Error('Binance /fapi/v3/positionRisk: vị thế BTCUSDT không ở chế độ One-way');
  const p=matching[0]??null;
  const positionBTC=p?Number(p.positionAmt):0; // An absent V3 record means FLAT.
  if(!Number.isFinite(positionBTC))throw Error('Binance /fapi/v3/positionRisk: số lượng BTC không hợp lệ');
  const leverage=Number(c.leverage);
  if(!Number.isInteger(leverage)||leverage<=0)
   throw Error('Binance /fapi/v1/symbolConfig: đòn bẩy BTCUSDT không hợp lệ');
  this.account={
   symbol:'BTCUSDT',contractType:'PERPETUAL',dualSidePosition:mode.dualSidePosition,
   marginType:c.marginType,leverage,canTrade:account.canTrade===true,
   hasOtherPositions:Array.isArray(account.positions)&&account.positions.some(
    x=>x.symbol!=='BTCUSDT'&&Number(x.positionAmt)!==0),
   hasUnknownOrders:orders.length>0||algos.length>0,
   positionBTC,availableUSDT,walletUSDT,openOrders:orders.length,openAlgos:algos.length
  };
  return this.account;
 }
 async connect({apiKey,apiSecret,environment='demo'}){
  if(this.armed||this.busy)throw Error('Tắt Auto trước khi đổi API');
  if(!['demo','production'].includes(environment))throw Error('Môi trường API không hợp lệ');
  if(typeof apiKey!=='string'||typeof apiSecret!=='string'||apiKey.length<8||apiSecret.length<8)
   throw Error('Nhập đầy đủ API Key và Secret');
  this.api?.close();this.api=null;this.account=null;
  this.environment=environment;
  const connection=this.transportFactory({apiKey,apiSecret,environment,
   ...(environment==='production'?{productionConsent:'I_ACCEPT_LIVE_BTCUSDT'}:{})});
  if(environment==='production'){
   // Production keys can check balances, never mutate exchange orders.
   connection.post=async()=>{throw Error('Production trade API is locked');};
   connection.del=async()=>{throw Error('Production trade API is locked');};
  }
  this.api=connection;
  try{await this.inspect();this.error=null;this.log('CONNECTED','API '+environment+' đã xác minh chỉ bằng GET');}
  catch(e){this.api.close();this.api=null;this.account=null;this.error=e.message;throw e;}
  return this.snapshot();
 }
 async arm(){
  if(!this.api)throw Error('Kết nối API trên trang Binance trước');
  if(this.environment!=='demo')throw Error('Auto tiền thật chưa mở. Chỉ cho phép Binance Demo');
  if(this.halted||this.busy||this.activeProtection)throw Error(this.error||'Lệnh tồn đọng chưa đối soát; không bật Auto');
  const a=await this.inspect();
  if(!a.canTrade||a.dualSidePosition!==false||a.marginType!=='ISOLATED'||
   a.leverage!==this.config.leverage||a.hasUnknownOrders||a.positionBTC!==0)
   throw Error('Yêu cầu BTCUSDT One-way, ISOLATED, đúng đòn bẩy, không có vị thế/lệnh cũ');
  this.armed=true;this.log('AUTO_ON','Chỉ Binance Demo; chờ tín hiệu OCC BTCUSDT mới');return this.snapshot();
 }
 disarm(){this.armed=false;this.log('AUTO_OFF','Không mở lệnh mới; giữ lệnh SL/TP đã đặt trên Demo');return this.snapshot();}
 close(){this.disarm();this.api?.close();this.api=null;this.account=null;}
 async signal(signal,feedHealthy){
  if(!this.armed||this.busy||this.halted||this.activeProtection||this.environment!=='demo'||!feedHealthy||!signal?.side)return;
  this.busy=true;
  try{
   const a=await this.inspect();
   const quote=await this.api.get('/fapi/v1/ticker/price',{symbol:'BTCUSDT'});
   const plan=draftProtectedOrder({side:signal.side,account:a,filters:this.filters,
    quotePrice:Number(quote.price)},this.config);
   const clientId='OCCBTC-'+randomBytes(7).toString('hex');
   this.saveIntent({phase:'ENTRY_SENDING',clientId,side:signal.side,barTime:signal.barTime});
   const response=await this.api.post('/fapi/v1/order',{symbol:'BTCUSDT',
    side:signal.side==='LONG'?'BUY':'SELL',positionSide:'BOTH',type:'MARKET',
    quantity:String(plan.qtyBTC),newClientOrderId:clientId,newOrderRespType:'RESULT'});
   if(!response?.orderId)throw Error('Binance không xác nhận orderId Entry');
   this.saveIntent({phase:'ENTRY_ACK',clientId,orderId:String(response.orderId),side:signal.side});
   const coordinator=new ProtectionCoordinator({api:this.api,
    checkpoint:new ProtectionCheckpoint(this.protectionPath),settings:this.config,
    notify:note=>this.log('CRITICAL',note.reason)});
   const result=await coordinator.protectConfirmedEntry({entryOrderId:response.orderId,side:signal.side,
    stepSize:this.filters.stepSize,tickSize:this.filters.tickSize,clientPrefix:clientId});
   this.saveIntent({phase:'PROTECTED',clientId,orderId:String(response.orderId)});
   this.activeProtection=result; // No new signal while a position is managed.
   this.log('PROTECTED','Demo entry '+response.orderId+' có SL và '+result.tps.length+' TP trên sàn; chờ vị thế đóng');
  }catch(e){
   this.armed=false;this.halted=true;this.error=e.message;
   this.log('HALTED','Không gửi lại lệnh. Kiểm tra BTCUSDT và SL trên Binance Demo: '+e.message);
  }finally{this.busy=false;}
 } 
 // Monitor only the position and orders that OCC placed; never cancel unknown orders.
 async monitor(){
  if(!this.api||this.environment!=='demo'||this.busy||!this.activeProtection||this.halted)return;
  this.busy=true;
  try{
   const rows=await this.api.get('/fapi/v3/positionRisk',{symbol:'BTCUSDT'});
   const p=Array.isArray(rows)?rows.find(x=>x.symbol==='BTCUSDT'&&x.positionSide==='BOTH'):null;
   if(!p||!Number.isFinite(Number(p.positionAmt)))throw Error('Không xác minh được vị thế BTCUSDT Demo');
   const amt=Number(p.positionAmt);
   const algo=await this.api.get('/fapi/v1/openAlgoOrders',{symbol:'BTCUSDT'});
   if(!Array.isArray(algo))throw Error('Không xác minh được danh sách SL/TP');
   const managed=this.activeProtection;
   const ids=new Set([managed.stop.id,...managed.tps.map(x=>x.id)].map(String));
   const ours=algo.filter(o=>ids.has(String(o.algoId)));
   if(amt===0){
    // Position already FLAT: remove OCC-owned stale conditional orders. No new entry until confirmed cleared.
    for(const item of ours)await this.api.del('/fapi/v1/algoOrder',{symbol:'BTCUSDT',algoId:item.algoId});
    const left=await this.api.get('/fapi/v1/openAlgoOrders',{symbol:'BTCUSDT'});
    if(!Array.isArray(left)||left.some(x=>ids.has(String(x.algoId))))throw Error('Còn lệnh SL/TP cũ chưa hủy sau khi vị thế đóng');
    const other=left.length?left.length:0;
    if(other)throw Error('Có lệnh điều kiện ngoài OCC, không mở lệnh mới');
    new ProtectionCheckpoint(this.protectionPath).save({phase:'IDLE',entry:null,stop:null,tps:[],inFlight:null,halted:false});
    this.saveIntent({phase:'CLEARED',at:Date.now()});
    this.activeProtection=null;this.log('FLAT','Đã đóng BTCUSDT Demo, hủy lệnh cũ và xác nhận sạch');
   }else{
    if(Math.sign(amt)!==(managed.entry.side==='LONG'?1:-1)||
       !ours.some(x=>String(x.algoId)===String(managed.stop.id)))
     throw Error('Vị thế BTC đổi chiều hoặc lệnh SL đã mất; cần xử lý trên Binance Demo ngay');
   }
  }catch(e){
   this.halted=true;this.armed=false;this.error=e.message;
   this.log('HALTED','Dừng Auto; cần kiểm tra Binance Demo: '+e.message);
  }finally{this.busy=false;}
 }
 async reconcileFlat(){
  if(!this.api||this.environment!=='demo'||this.busy||this.armed)
   throw Error('Chỉ đối soát khi đã ngắt Auto và có kết nối Demo');
  this.busy=true;
  try{
   const account=await this.inspect();
   if(account.positionBTC!==0||account.openOrders||account.openAlgos)
    throw Error('Binance Demo còn vị thế hoặc lệnh BTCUSDT, không thể xác nhận đã sạch');
   new ProtectionCheckpoint(this.protectionPath).save({phase:'IDLE',entry:null,stop:null,tps:[],inFlight:null,halted:false});
   this.saveIntent({phase:'CLEARED',at:Date.now()});
   this.activeProtection=null;this.halted=false;this.error=null;this.log('RECOVERED','Đã xác minh vị thế và lệnh BTCUSDT Demo hoàn toàn sạch');
   return this.snapshot();
  }finally{this.busy=false;}
 }

}
