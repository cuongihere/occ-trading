// Browser-based BTCUSDT connection; credentials exist only in server memory.
// Futures thật auto-trade is an opt-in isolated executor; production order placement remains gated.
import {randomBytes} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync,mkdirSync,renameSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {FuturesTransport} from './futures-transport.mjs';
import {validateLiveConfig,floorStep,previewLiveSizing} from './futures-sizing.mjs';
import {draftProtectedOrder} from './futures-order-plan.mjs';
import {ProtectionCoordinator} from './futures-protection-orchestrator.mjs';
import {ProtectionCheckpoint} from './futures-protection-checkpoint.mjs';
import {WindowsCredentialVault} from './futures-credential-vault.mjs';

const DEFAULT={side:'BOTH',marginUSDT:20,leverage:5,slPercent:1,tpMode:'Percent',
 tp1Val:1,tp2Val:2,tp3Val:3,tp1Qty:33,tp2Qty:33};
const safeJSON=(value)=>JSON.parse(JSON.stringify(value));
export class BrowserFutures{
 constructor({dataDir,transportFactory=null,credentialVault=null}){
  this.dir=resolve(dataDir);this.path=resolve(this.dir,'futures-browser-settings.json');
  this.intentPath=resolve(this.dir,'futures-live-intent.json');
  this.protectionPath=resolve(this.dir,'futures-live-protection.json');
  this.config=validateLiveConfig(existsSync(this.path)?JSON.parse(readFileSync(this.path,'utf8')):DEFAULT);
  this.transportFactory=transportFactory||((params)=>new FuturesTransport(params));
  this.vault=credentialVault||new WindowsCredentialVault(resolve(this.dir,'futures-api.dpapi.json'));
  this.lastAccountSync=null;
  this.api=null;this.environment=null;this.account=null;this.filters=null;
  this.armed=false;this.busy=false;this.halted=false;this.error=null;this.events=[];this.activeProtection=null;
  const unresolved=existsSync(this.intentPath)?JSON.parse(readFileSync(this.intentPath,'utf8')):null;
  const prior=existsSync(this.protectionPath)?new ProtectionCheckpoint(this.protectionPath).load():null;
  if((unresolved&&unresolved.phase!=='CLEARED')||(prior&&prior.phase!=='IDLE')){
   this.halted=true;this.error='Có lệnh Futures thật chưa đối soát sau lần chạy trước. Kiểm tra Binance Futures thật trước khi tạo lệnh mới.';
  }
 }
 log(type,message){this.events.push({at:Date.now(),type,message:String(message).slice(0,400)});this.events=this.events.slice(-50);}
 sizingPreview(input,price){
  if(!this.api||!this.filters)return {status:'unavailable',message:'Kết nối Binance API để xác nhận bước khối lượng BTCUSDT.'};
  return previewLiveSizing(input,this.filters,price,this.account?.availableUSDT);
 }
 saveConfig(input){
  if(this.armed||this.busy||this.activeProtection)throw Error('Tắt Auto và đóng hết vị thế Futures thật đang quản lý trước khi sửa cấu hình');
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
   realFuturesOnly:true,halted:this.halted,busy:this.busy,error:this.error,
   protectedPosition:this.activeProtection?{entry:this.activeProtection.entry,stop:this.activeProtection.stop,tps:this.activeProtection.tps}:null,
   config:this.config,account:this.account,credentialSaved:this.vault.exists(),lastAccountSync:this.lastAccountSync,
   events:this.events.slice(-20),
   warning:'Giao dịch tiền thật có thể mất vốn. API Key/Secret chỉ giữ trong RAM; cần xác nhận mỗi khi bật Auto.'};
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
  const totalWallet=Number(account.totalWalletBalance),totalMargin=Number(account.totalMarginBalance),
   totalUnrealized=Number(account.totalUnrealizedProfit),initialMargin=Number(account.totalInitialMargin);
  const unrealizedBTC=p?Number(p.unRealizedProfit??p.unrealizedProfit??0):0;
  const markPrice=p?Number(p.markPrice??0):null;
  const liquidationPrice=p?Number(p.liquidationPrice??0):null;
  this.account={
   symbol:'BTCUSDT',contractType:'PERPETUAL',dualSidePosition:mode.dualSidePosition,
   marginType:c.marginType,leverage,canTrade:account.canTrade===true,
   hasOtherPositions:Array.isArray(account.positions)&&account.positions.some(
    x=>x.symbol!=='BTCUSDT'&&Number(x.positionAmt)!==0),
   hasUnknownOrders:orders.length>0||algos.length>0,
   positionBTC,entryPrice:p?Number(p.entryPrice)||0:0,availableUSDT,walletUSDT,
   totalWalletUSDT:Number.isFinite(totalWallet)?totalWallet:walletUSDT,
   equityUSDT:Number.isFinite(totalMargin)?totalMargin:walletUSDT+(Number.isFinite(totalUnrealized)?totalUnrealized:0),
   unrealizedUSDT:Number.isFinite(totalUnrealized)?totalUnrealized:unrealizedBTC,
   initialMarginUSDT:Number.isFinite(initialMargin)?initialMargin:0,
   btcUnrealizedUSDT:unrealizedBTC,
   markPrice:Number.isFinite(markPrice)&&markPrice>0?markPrice:null,
   liquidationPrice:Number.isFinite(liquidationPrice)&&liquidationPrice>0?liquidationPrice:null,
   openOrders:orders.length,openAlgos:algos.length
  };
  this.lastAccountSync=Date.now();
  return this.account;
 }
 async connect({apiKey,apiSecret,environment='production',remember=true}){
  if(this.armed||this.busy||this.activeProtection)throw Error('Tắt Auto và xử lý vị thế đang quản lý trước khi đổi API');
  if(environment!=='production')throw Error('Chỉ sử dụng Binance Futures thật');
  if(typeof apiKey!=='string'||typeof apiSecret!=='string'||apiKey.length<8||apiSecret.length<8)
   throw Error('Nhập đầy đủ API Key và Secret');
  this.api?.close();this.api=null;this.account=null;this.environment='production';
  const connection=this.transportFactory({apiKey,apiSecret,environment:'production',
   productionConsent:'I_ACCEPT_LIVE_BTCUSDT'});
  this.api=connection;
  try{await this.inspect();this.error=this.halted?this.error:null;
   if(remember===true)this.vault.save({apiKey,apiSecret});
   else if(remember===false&&this.vault.exists())this.vault.delete();
   this.log('CONNECTED','Đã xác minh Binance Futures thật; Auto mặc định OFF');}
  catch(e){this.api.close();this.api=null;this.account=null;this.error=e.message;throw e;}
  return this.snapshot();
 }
 async restoreSavedConnection(){
  if(this.api||!this.vault.exists())return this.snapshot();
  try{
   const creds=this.vault.load();
   await this.connect({...creds,environment:'production',remember:null});
   this.armed=false;
   this.log('RESTORED','API được giải mã theo tài khoản Windows; Auto vẫn OFF');
  }catch(e){
   this.armed=false;this.error='Không thể khôi phục API đã lưu: '+e.message;
   this.log('API_RESTORE_FAILED',this.error);
  }
  return this.snapshot();
 }
 forgetSavedCredentials(){
  if(this.armed||this.busy)throw Error('Tắt Auto trước khi xóa thông tin API');
  this.vault.delete();this.close();return this.snapshot();
 }
 async refreshAccountOverview(){
  if(!this.api||this.busy)return this.account;
  const [account,positions]=await Promise.all([
   this.api.get('/fapi/v2/account'),this.api.get('/fapi/v3/positionRisk',{symbol:'BTCUSDT'})]);
  if(!account||!Array.isArray(account.assets)||!Array.isArray(positions))throw Error('Không đọc được số dư/vị thế Binance');
  const usdt=account.assets.find(x=>x.asset==='USDT');
  if(!usdt)throw Error('Tài khoản Futures không có tài sản USDT');
  const btc=positions.find(x=>x.symbol==='BTCUSDT'&&x.positionSide==='BOTH');
  const numberOr=(a,b)=>Number.isFinite(Number(a))?Number(a):b;
  const wallet=numberOr(usdt.walletBalance,this.account?.walletUSDT??0);
  const unrealized=numberOr(account.totalUnrealizedProfit,numberOr(btc?.unRealizedProfit,0));
  this.account={...this.account,
   walletUSDT:wallet,availableUSDT:numberOr(usdt.availableBalance,0),
   totalWalletUSDT:numberOr(account.totalWalletBalance,wallet),
   equityUSDT:numberOr(account.totalMarginBalance,wallet+unrealized),
   unrealizedUSDT:unrealized,initialMarginUSDT:numberOr(account.totalInitialMargin,0),
   positionBTC:numberOr(btc?.positionAmt,0),entryPrice:numberOr(btc?.entryPrice,0),btcUnrealizedUSDT:numberOr(btc?.unRealizedProfit,0),
   markPrice:numberOr(btc?.markPrice,0)||null,
   liquidationPrice:numberOr(btc?.liquidationPrice,0)||null};
  this.lastAccountSync=Date.now();
  return this.account;
 }
 async applyExchangeLeverage({requestedLeverage,confirmation}={}){
  if(!this.api||this.environment!=='production')throw Error('Cần kết nối Binance Futures thật');
  if(this.armed||this.busy||this.halted||this.activeProtection)
   throw Error('Tắt Auto và xử lý hết lệnh/vị thế BTC trước khi thay đòn bẩy');
  const requested=Number(requestedLeverage);
  if(confirmation!=='SYNC_BTCUSDT_LEVERAGE'||!Number.isInteger(requested)||
     requested!==this.config.leverage||requested<1||requested>20)
   throw Error('Cần xác nhận áp dụng đúng đòn bẩy đã lưu cho BTCUSDT');
  this.busy=true;
  try{
   const before=await this.inspect();
   if(!before.canTrade||before.dualSidePosition!==false||before.marginType!=='ISOLATED'||
      before.hasOtherPositions||before.positionBTC!==0||before.openOrders!==0||before.openAlgos!==0)
    throw Error('Không thể thay đòn bẩy khi còn vị thế/lệnh hoặc cấu hình tài khoản không phù hợp');
   if(before.leverage===requested){
    this.log('LEVERAGE_MATCH','Binance BTCUSDT đã ở '+requested+'x');
    this.error=null;return this.snapshot();
   }
   this.log('LEVERAGE_CHANGE_REQUEST','Yêu cầu thay BTCUSDT '+before.leverage+'x → '+requested+'x');
   // Never retry a leverage POST on unknown network outcome; inspect before further actions.
   const acknowledgement=await this.api.post('/fapi/v1/leverage',{symbol:'BTCUSDT',leverage:requested});
   if(acknowledgement?.symbol!=='BTCUSDT'||Number(acknowledgement.leverage)!==requested)
    throw Error('Binance chưa xác nhận thay đòn bẩy BTCUSDT');
   const verified=await this.inspect();
   if(verified.leverage!==requested)
    throw Error('Binance chưa báo đòn bẩy mới khi đọc lại tài khoản BTCUSDT');
   this.log('LEVERAGE_APPLIED','Binance xác nhận BTCUSDT đã chuyển thành '+requested+'x');
   this.error=null;
   return this.snapshot();
  }catch(e){
   this.log('LEVERAGE_ERROR',e.message);
   this.error='Đổi đòn bẩy chưa được xác nhận: '+e.message;
   throw e;
  }finally{this.busy=false;}
 }
 async arm(acceptance,marketPrice){
  if(!this.api)throw Error('Kết nối API trên trang Binance trước');
  if(this.environment!=='production')throw Error('Chỉ sử dụng Binance Futures thật');
  if(acceptance!=='CHAP NHAN BTC FUTURES')throw Error('Chưa xác nhận giao dịch tiền thật');
  if(this.halted||this.busy||this.activeProtection)throw Error(this.error||'Lệnh tồn đọng chưa đối soát; không bật Auto');
  const a=await this.inspect();
  if(!a.canTrade||a.hasOtherPositions||a.dualSidePosition!==false||a.marginType!=='ISOLATED'||
   a.leverage!==this.config.leverage||a.hasUnknownOrders||a.positionBTC!==0)
   throw Error('Yêu cầu BTCUSDT One-way, ISOLATED, đúng đòn bẩy, không có vị thế/lệnh cũ');
  // Enforce on the server even if browser-side validation was bypassed.
  const sizing=this.sizingPreview(this.config,marketPrice);
  if(sizing.status!=='valid')throw Error('Chưa thể bật AUTO: '+sizing.message);
  this.armed=true;this.log('AUTO_ON','BẬT AUTO TIỀN THẬT, chờ tín hiệu BTCUSDT');return this.snapshot();
 }
 disarm(){this.armed=false;this.log('AUTO_OFF','Không mở lệnh mới; giữ lệnh SL/TP đã đặt trên Futures thật');return this.snapshot();}
 close(){this.disarm();this.api?.close();this.api=null;this.account=null;}
 // On failed exchange-side STOP, reduce-only MARKET can close a confirmed unprotected BTC position.
 // Never retry an ambiguous order and never submit opposite-opening quantity.
 async emergencyCloseIfUnprotected(){
  if(!this.api||this.environment!=='production')return;
  const risk=await this.api.get('/fapi/v3/positionRisk',{symbol:'BTCUSDT'});
  if(!Array.isArray(risk))throw Error('Cannot verify position');
  const row=risk.find(x=>x.symbol==='BTCUSDT'&&x.positionSide==='BOTH');
  const amt=row?Number(row.positionAmt):0;
  if(!Number.isFinite(amt))throw Error('Unknown BTC position amount');
  if(amt===0){this.log('EMERGENCY_FLAT','Vị thế BTCUSDT đã đóng');return;}
  const intent=existsSync(this.intentPath)?JSON.parse(readFileSync(this.intentPath,'utf8')):null;
  if(!intent?.clientId)throw Error('Missing recorded entry client ID');
  const ownEntry=await this.api.get('/fapi/v1/order',{symbol:'BTCUSDT',origClientOrderId:intent.clientId});
  if(ownEntry?.symbol!=='BTCUSDT'||ownEntry.clientOrderId!==intent.clientId||
     !['FILLED','PARTIALLY_FILLED'].includes(ownEntry.status)||
     ownEntry.side!==(amt>0?'BUY':'SELL')||!(Number(ownEntry.executedQty)>0)||
     Math.abs(amt)>Number(ownEntry.executedQty)+1e-9)
   throw Error('Cannot prove this BTC position belongs to OCC entry; manual review required');

  const orders=await this.api.get('/fapi/v1/openAlgoOrders',{symbol:'BTCUSDT'});
  if(!Array.isArray(orders))throw Error('Cannot verify exchange stop');
  if(orders.some(o=>o.clientAlgoId===intent.clientId+'-SL'&&
    ['NEW','ACCEPTED','PENDING_NEW'].includes(o.algoStatus))){
   this.log('STOP_STILL_ACTIVE','Đã xác minh SL đang có trên sàn; không đóng cưỡng bức');return;
  }
  const qty=floorStep(Math.abs(amt),this.filters.stepSize);
  if(qty<this.filters.minQty)throw Error('BTC remaining below exchange minQty; manual action required');
  const closeId='OCCBTC-'+randomBytes(7).toString('hex');
  this.saveIntent({...intent,phase:'EMERGENCY_CLOSE_SENDING',closeId,qty,at:Date.now()});
  const result=await this.api.post('/fapi/v1/order',{symbol:'BTCUSDT',positionSide:'BOTH',
   side:amt>0?'SELL':'BUY',type:'MARKET',reduceOnly:'true',quantity:String(qty),
   newClientOrderId:closeId,newOrderRespType:'RESULT'});
  if(!result?.orderId)throw Error('Emergency close response unknown');
  const resultRows=await this.api.get('/fapi/v3/positionRisk',{symbol:'BTCUSDT'});
  if(!Array.isArray(resultRows)||Number(resultRows.find(x=>x.symbol==='BTCUSDT'&&x.positionSide==='BOTH')?.positionAmt??0)!==0)
   throw Error('Emergency close not verified FLAT');
  this.log('EMERGENCY_CLOSED','Đã xác minh giảm vị thế BTCUSDT về 0');
 }
 async signal(signal,feedHealthy){
  if(!this.armed||this.busy||this.halted||this.environment!=='production'||!feedHealthy||!signal?.side)return;
  if(this.activeProtection){
   this.log('SIGNAL_IGNORED_POSITION','Bỏ qua tín hiệu '+signal.side+': vị thế BTCUSDT còn mở, tiếp tục giữ SL/TP.');
   return;
  }
this.busy=true;
let entrySubmissionPossible=false;
try{
 const a=await this.inspect();
 const quote=await this.api.get('/fapi/v1/ticker/price',{symbol:'BTCUSDT'});
   const plan=draftProtectedOrder({side:signal.side,account:a,filters:this.filters,
    quotePrice:Number(quote.price)},this.config);
const clientId='OCCBTC-'+randomBytes(7).toString('hex');
// From this point an entry might be sent; unknown outcomes require a safety halt.
entrySubmissionPossible=true;
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
this.error=null;
this.log('PROTECTED','Futures thật entry '+response.orderId+' có SL và '+result.tps.length+' TP trên sàn; chờ vị thế đóng');
}catch(e){
 if(!entrySubmissionPossible){
  // No entry was sent: transient preflight/quote errors must not toggle Auto OFF.
  this.error='Bỏ qua tín hiệu trước khi đặt lệnh: '+e.message;
  this.log('SIGNAL_SKIPPED','Auto vẫn ON, chưa đặt lệnh: '+e.message);
 }else{
  // Keep the switch ON but fail closed until manual OFF + reconciliation.
  this.halted=true;this.error=e.message;
  this.log('HALTED','Auto vẫn ON nhưng khóa giao dịch để kiểm tra Binance: '+e.message);
  try{await this.emergencyCloseIfUnprotected();}
  catch(recovery){this.log('CRITICAL','Không thể xác nhận đóng vị thế thiếu SL: '+recovery.message);}
  this.error+=' — Kiểm tra BTCUSDT và SL/TP trực tiếp trên Binance.';
 }
  }finally{this.busy=false;}
 } 
 // Monitor only the position and orders that OCC placed; never cancel unknown orders.
 async monitor(){
  if(!this.api||this.environment!=='production'||this.busy||!this.activeProtection||this.halted)return;
  this.busy=true;
  try{
   const rows=await this.api.get('/fapi/v3/positionRisk',{symbol:'BTCUSDT'});
   const p=Array.isArray(rows)?rows.find(x=>x.symbol==='BTCUSDT'&&x.positionSide==='BOTH'):null;
   if(!Array.isArray(rows)||(p&&!Number.isFinite(Number(p.positionAmt))))throw Error('Không xác minh được vị thế BTCUSDT');
   const amt=p?Number(p.positionAmt):0;
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
    this.activeProtection=null;this.log('FLAT','Đã đóng BTCUSDT Futures thật, hủy lệnh cũ và xác nhận sạch');
   }else{
    if(Math.sign(amt)!==(managed.entry.side==='LONG'?1:-1)||
       !ours.some(x=>String(x.algoId)===String(managed.stop.id)))
     throw Error('Vị thế BTC đổi chiều hoặc lệnh SL đã mất; cần xử lý trên Binance Futures thật ngay');
   }
  }catch(e){
// Preserve explicit Auto ON selection, but block further entries while safety is unknown.
this.halted=true;this.error=e.message;
this.log('HALTED','Auto vẫn ON nhưng khóa giao dịch; cần kiểm tra Binance Futures thật: '+e.message);
   try{await this.emergencyCloseIfUnprotected();}
   catch(recovery){this.log('CRITICAL','Không thể xác nhận đã bảo vệ vị thế: '+recovery.message);}
  }finally{this.busy=false;}
 }
 async reconcileFlat(){
  if(!this.api||this.environment!=='production'||this.busy||this.armed)
   throw Error('Chỉ đối soát khi đã ngắt Auto và có kết nối Futures thật');
  this.busy=true;
  try{
   const account=await this.inspect();
   if(account.positionBTC!==0||account.openOrders||account.openAlgos)
    throw Error('Binance Futures thật còn vị thế hoặc lệnh BTCUSDT, không thể xác nhận đã sạch');
   new ProtectionCheckpoint(this.protectionPath).save({phase:'IDLE',entry:null,stop:null,tps:[],inFlight:null,halted:false});
   this.saveIntent({phase:'CLEARED',at:Date.now()});
   this.activeProtection=null;this.halted=false;this.error=null;this.log('RECOVERED','Đã xác minh vị thế và lệnh BTCUSDT Futures thật hoàn toàn sạch');
   return this.snapshot();
  }finally{this.busy=false;}
 }

}
