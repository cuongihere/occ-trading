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
import {analyzeFuturesPosition} from './futures-position-analysis.mjs';
import {projectCompactSLTP} from './futures-compact-pnl.mjs';
import {validateManagedExit,manualExitControls} from './futures-manual-exit.mjs';
import {LiveStatsLedger} from './binance-live-stats.mjs';
import {syncOCCLiveHistory} from './futures-live-history.mjs';
import {installLimitEntry} from './futures-limit-entry.mjs';

const DEFAULT={side:'BOTH',marginUSDT:20,leverage:5,slPercent:1,tpMode:'Percent',
 tp1Val:1,tp2Val:2,tp3Val:3,tp1Qty:33,tp2Qty:33,reverseOnSignal:false};
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
  this.recoveryStatus='idle';this.lastRecoveryCheck=null;this.restoreTask=null;
  this.pendingLimit=null;
  this.historySyncTask=null;this.lastHistorySync=0;this.lastIncomeSync=0;this.historyError=null;this.historyCount=0;this.lastEntryTiming=null;
  const unresolved=existsSync(this.intentPath)?JSON.parse(readFileSync(this.intentPath,'utf8')):null;
  if(['LIMIT_PENDING','LIMIT_CANCEL_SENDING'].includes(unresolved?.phase))
   this.pendingLimit={...unresolved};
  const prior=existsSync(this.protectionPath)?new ProtectionCheckpoint(this.protectionPath).load():null;
  this.previousProtection=prior&&prior.phase!=='IDLE'?prior:null; // ID reference only, never resume order management.
  if((unresolved&&unresolved.phase!=='CLEARED')||(prior&&prior.phase!=='IDLE')){
   this.halted=true;this.error='Có lệnh Futures thật chưa đối soát sau lần chạy trước. Kiểm tra Binance Futures thật trước khi tạo lệnh mới.';
  }
 }
 log(type,message){this.events.push({at:Date.now(),type,message:String(message).slice(0,400)});this.events=this.events.slice(-50);}
 // Store independently from Paper SQLite; reopening OCC must not reset real fills.
 registerRealOrder({orderId,groupId,clientId,role,side}){
  const path=resolve(this.dir,'binance-live-stats.sqlite');
  mkdirSync(this.dir,{recursive:true});
  const ledger=new LiveStatsLedger(path);
  try{return ledger.register({orderId,groupId,clientId,role,side});}
  finally{ledger.close();}
 }
 async refreshRealHistory({force=false}={}){
  if(!this.api||!this.account)return null;
  if(this.historySyncTask)return this.historySyncTask;
  if(!force&&Date.now()-this.lastHistorySync<60000)return null;
  this.historySyncTask=(async()=>{
   mkdirSync(this.dir,{recursive:true});
   const ledger=new LiveStatsLedger(resolve(this.dir,'binance-live-stats.sqlite'));
   try{
    const intent=existsSync(this.intentPath)?JSON.parse(readFileSync(this.intentPath,'utf8')):null;
    const checkpoint=this.activeProtection||this.previousProtection;
    // Income endpoint has a high Binance request weight; only sample every
    // five minutes, or at an explicit manual refresh/reconnect.
    const syncIncome=force||Date.now()-this.lastIncomeSync>=300000;
    const result=await syncOCCLiveHistory(this.api,ledger,{checkpoint,intent,syncIncome});
    if(result.incomeUpdated)this.lastIncomeSync=Date.now();
    this.historyCount=result.report.summary.closed;
    this.historyError=result.warnings.length?result.warnings.slice(0,2).join(' | '):null;
    this.lastHistorySync=Date.now();
    this.log('HISTORY_SYNC','Đã lưu '+result.newFills+' fill mới; '+this.historyCount+' vị thế OCC đã đóng.');
    return result;
   }catch(e){
    this.historyError='Chưa đồng bộ được lịch sử Binance: '+e.message;
    this.log('HISTORY_FAILED',this.historyError);
    return null;
   }finally{ledger.close();}
  })();
  try{return await this.historySyncTask;}
  finally{this.historySyncTask=null;}
 }
 sizingPreview(input,price){
  if(!this.api||!this.filters)return {status:'unavailable',message:'Kết nối Binance API để xác nhận bước khối lượng BTCUSDT.'};
  return previewLiveSizing(input,this.filters,price,this.account?.availableUSDT);
 }
 setReverseOnSignal(enabled){
  if(typeof enabled!=='boolean')throw Error('Công tắc đảo chiều phải là ON hoặc OFF');
  if(this.busy||this.pendingLimit)throw Error('Đang xử lý/đợi LIMIT OCC, không đổi chế độ đảo chiều lúc này');
  const next=validateLiveConfig({...this.config,reverseOnSignal:enabled});
  mkdirSync(this.dir,{recursive:true});
  const temp=this.path+'.tmp';
  writeFileSync(temp,JSON.stringify(next,null,2),{mode:0o600});renameSync(temp,this.path);
  this.config=next;
  this.log('REVERSE_MODE',enabled?'ĐẢO CHIỀU ON: khi an toàn mới đảo theo tín hiệu OCC.':'ĐẢO CHIỀU OFF: giữ lệnh đến SL/TP.');
  return this.snapshot();
 }
 saveConfig(input){
  if(this.armed||this.busy||this.activeProtection||this.pendingLimit)throw Error('Tắt Auto và xử lý hết LIMIT/vị thế Futures trước khi sửa cấu hình');
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
  return {connected:!!this.api&&!!this.account,environment:this.environment,armed:this.armed,
   realFuturesOnly:true,halted:this.halted,busy:this.busy,error:this.error,
   recoveryStatus:this.recoveryStatus,lastRecoveryCheck:this.lastRecoveryCheck,
   lastHistorySync:this.lastHistorySync,lastIncomeSync:this.lastIncomeSync,
   historyError:this.historyError,historyCount:this.historyCount,
   protectedPosition:this.activeProtection?{entry:this.activeProtection.entry,stop:this.activeProtection.stop,tps:this.activeProtection.tps}:null,
   config:this.config,account:this.account,credentialSaved:this.vault.exists(),lastAccountSync:this.lastAccountSync,
   lastEntryTiming:this.lastEntryTiming,
   pendingLimit:this.pendingLimit?{
    side:this.pendingLimit.side,price:this.pendingLimit.price,qty:this.pendingLimit.qty,
    expiresAt:this.pendingLimit.expiresAt,clientId:this.pendingLimit.clientId,
    orderId:this.pendingLimit.orderId}:null,
   events:this.events.slice(-20),
   warning:'Giao dịch tiền thật có thể mất vốn. API Key/Secret chỉ giữ trong RAM; cần xác nhận mỗi khi bật Auto.'};
 }
 // Read-only exchange inspection works while AUTO is halted after restart.
 // No checkpoint mutation, order placement or inferred fills.
 async positionAnalysis({referencePrice=null}={}){
  if(!this.api)throw Error('Chưa kết nối Binance Futures API');
  if(this.busy)return {status:'syncing',fetchedAt:Date.now(),warnings:['Đang thực hiện giao dịch/đối soát; chờ dữ liệu Binance ổn định.']};
  const [riskRows,algoOrders,openOrders]=await Promise.all([
   this.api.get('/fapi/v3/positionRisk',{symbol:'BTCUSDT'}),
   this.api.get('/fapi/v1/openAlgoOrders',{symbol:'BTCUSDT'}),
   this.api.get('/fapi/v1/openOrders',{symbol:'BTCUSDT'})
  ]);
  const analysis=analyzeFuturesPosition({riskRows,algoOrders,openOrders,
   checkpoint:this.activeProtection||this.previousProtection,
   managed:!!this.activeProtection,leverage:this.account?.leverage,fetchedAt:Date.now()});
  const compact=projectCompactSLTP({position:analysis.position,config:this.config,filters:this.filters,
   referencePrice,availableUSDT:this.account?.availableUSDT});
  const protectedOrder=this.activeProtection||this.previousProtection;
  const intent=existsSync(this.intentPath)?JSON.parse(readFileSync(this.intentPath,'utf8')):null;
  const manual=manualExitControls(analysis,protectedOrder,{
   halted:this.halted,intentPhase:intent?.phase,busy:this.busy});
  return {...analysis,compact,manual,halted:this.halted,armed:this.armed};
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
   this.log('CONNECTED','Đã xác minh Binance Futures thật; Auto mặc định OFF');
   await this.refreshRealHistory({force:true});
   // Only a completed OCC-protected position that is now fully FLAT may
   // clear its stale restart checkpoint automatically. Never auto-arm.
   await this.reconcileClosedAfterReconnect();
  }
  catch(e){this.api.close();this.api=null;this.account=null;this.error=e.message;throw e;}
  return this.snapshot();
 }
 async restoreSavedConnection(){
  if(this.restoreTask)return this.restoreTask;
  if(this.api&&this.account)return this.snapshot();
  if(!this.vault.exists())return this.snapshot();
  this.restoreTask=(async()=>{
   try{
    const creds=this.vault.load();
    await this.connect({...creds,environment:'production',remember:null});
    this.armed=false;
    this.log('RESTORED','Đã kết nối lại API Binance; Auto vẫn OFF');
   }catch(e){
    this.armed=false;this.error='Không thể khôi phục API đã lưu: '+e.message;
    this.log('API_RESTORE_FAILED',this.error);
   }
   return this.snapshot();
  })();
  try{return await this.restoreTask;}
  finally{this.restoreTask=null;}
 }
 // Only a previously verified OCC PROTECTED trade may have its orphaned
 // conditional orders removed. Any foreign order remains untouched and HALTED.
 async reconcileVerifiedClosedPosition(){
  if(!this.api||this.environment!=='production'||this.armed||this.busy||
    this.activeProtection||this.previousProtection?.phase!=='PROTECTED')
   throw Error('Không thể tự dọn SL/TP khi chưa xác minh checkpoint OCC hoặc AUTO còn ON');
  const saved=this.previousProtection,entry=saved.entry;
  const intent=existsSync(this.intentPath)?JSON.parse(readFileSync(this.intentPath,'utf8')):null;
  if(!entry||!saved.stop||!Array.isArray(saved.tps)||!saved.tps.length||
     saved.inFlight||!/^OCCBTC-[a-f0-9]{14}$/.test(String(entry.clientPrefix||''))||
     !['PROTECTED','STALE_ALGO_CANCEL_SENDING'].includes(intent?.phase))
   throw Error('Checkpoint/intent chưa rõ nguồn gốc; không tự hủy lệnh');
  this.busy=true;this.recoveryStatus='checking';this.lastRecoveryCheck=Date.now();
  try{
   // Two independent signed account snapshots before any cancellation.
   for(let i=0;i<2;i++){
    const a=await this.inspect();
    if(a.positionBTC!==0||a.openOrders!==0)
     throw Error('BTCUSDT còn vị thế hoặc lệnh thường; KHÔNG hủy SL/TP');
   }
   const expected=new Map();
   for(const x of [saved.stop,...saved.tps]){
    if(!x?.id||!x.clientId||!['SL','TP1','TP2','TP3'].includes(x.role)||
       x.clientId!==entry.clientPrefix+'-'+x.role||
       expected.has(String(x.id)))
     throw Error('ID Algo không khớp checkpoint OCC; không hủy');
    expected.set(String(x.id),x);
   }
   const algos=await this.api.get('/fapi/v1/openAlgoOrders',{symbol:'BTCUSDT'});
   if(!Array.isArray(algos))throw Error('Không đọc được SL/TP đang treo');
   const active=new Set(['NEW','ACCEPTED','PENDING_NEW']);
   const closeSide=entry.side==='LONG'?'SELL':'BUY';
   const toCancel=[];
   for(const algo of algos){
    const old=expected.get(String(algo.algoId));
    const isStop=old?.role==='SL';
    if(!old||algo.symbol!=='BTCUSDT'||algo.clientAlgoId!==old.clientId||
      algo.side!==closeSide||algo.positionSide!=='BOTH'||
      !active.has(String(algo.algoStatus))||
      (isStop?(algo.orderType!=='STOP_MARKET'||algo.closePosition!==true):
       (algo.orderType!=='TAKE_PROFIT_MARKET'||algo.reduceOnly!==true)))
     throw Error('Có SL/TP ngoài OCC hoặc trạng thái không rõ; không tự hủy');
    toCancel.push({...algo});
   }
   for(const algo of toCancel){
    // Re-verify FLAT before every delete, because Binance is the authority.
    const a=await this.inspect();
    if(a.positionBTC!==0||a.openOrders!==0)
     throw Error('Vị thế mới xuất hiện trong lúc đối soát; dừng hủy SL/TP');
    this.saveIntent({phase:'STALE_ALGO_CANCEL_SENDING',
     oldClientId:entry.clientPrefix,removingAlgoId:String(algo.algoId),at:Date.now()});
    await this.api.del('/fapi/v1/algoOrder',{symbol:'BTCUSDT',algoId:algo.algoId});
    this.log('STALE_ALGO_CANCELLED','Đã yêu cầu hủy SL/TP cũ #'+algo.algoId+' khi BTCUSDT FLAT.');
   }
   const result=await this.inspect();
   if(result.positionBTC!==0||result.openOrders!==0||result.openAlgos!==0)
    throw Error('Binance còn vị thế hoặc lệnh sau hủy; vẫn khóa an toàn');
   // Only after signed Binance confirms FLAT and zero outstanding orders.
   new ProtectionCheckpoint(this.protectionPath).save({
    phase:'IDLE',entry:null,stop:null,tps:[],inFlight:null,halted:false
   });
   this.saveIntent({phase:'CLEARED',at:Date.now()});
   this.activeProtection=null;this.previousProtection=null;this.halted=false;
   this.error=null;this.recoveryStatus='recovered';this.lastRecoveryCheck=Date.now();
   this.log('STALE_ALGO_CLEARED','Binance FLAT, đã dọn '+toCancel.length+
    ' SL/TP OCC còn treo. AUTO vẫn OFF; chờ người dùng bật lại.');
   return true;
  }finally{this.busy=false;}
 }
 async reconcileClosedAfterReconnect(){
  if(!this.api||this.armed||!this.halted||this.activeProtection)return false;
  this.recoveryStatus='checking';this.lastRecoveryCheck=Date.now();
  try{
   await this.reconcileVerifiedClosedPosition();
   return true;
  }catch(e){
   this.recoveryStatus='manual_required';
   this.error='Chưa thể tự đối soát: '+e.message;
   this.log('RECONCILE_REVIEW',this.error);
   return false;
  }
 }
 // Explicit one-click recovery. May reconnect a saved DPAPI key, but may never
 // bypass an open position/order, change Binance orders or auto-enable trades.
 async checkBinanceAndReconcile(){
  if(this.armed)throw Error('Nhấn OFF trước khi đối soát vị thế BTCUSDT');
  if(!this.api||!this.account)await this.restoreSavedConnection();
  if(!this.api||!this.account)throw Error(this.error||'Không kết nối được Binance API; nhập lại API Key hoặc thử lại');
  this.recoveryStatus='checking';this.lastRecoveryCheck=Date.now();
  try{
   if(this.pendingLimit){
    await this.monitorPendingLimit({cancelNow:true});
    if(!this.activeProtection)await this.reconcileFlat();
    else throw Error('LIMIT đã khớp và có STOP/TP; kiểm tra vị thế Binance trước khi bật lại AUTO');
   }else if(this.halted&&this.previousProtection?.phase==='PROTECTED')
    await this.reconcileVerifiedClosedPosition();
   else await this.reconcileFlat();
   await this.refreshRealHistory({force:true});
   this.recoveryStatus='recovered';this.lastRecoveryCheck=Date.now();
   return this.snapshot();
  }catch(e){
   this.recoveryStatus='manual_required';this.lastRecoveryCheck=Date.now();
   this.error='Chưa đối soát được: '+e.message;
   this.log('RECONCILE_BLOCKED',this.error);
   throw e;
  }
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
  if(this.halted||this.busy||this.activeProtection||this.pendingLimit)
    throw Error(this.error||'Lệnh hoặc LIMIT tồn đọng chưa đối soát; không bật Auto');
  const a=await this.inspect();
  if(!a.canTrade||a.hasOtherPositions||a.dualSidePosition!==false||a.marginType!=='ISOLATED'||
   a.leverage!==this.config.leverage||a.hasUnknownOrders||a.positionBTC!==0)
   throw Error('Yêu cầu BTCUSDT One-way, ISOLATED, đúng đòn bẩy, không có vị thế/lệnh cũ');
  // Enforce on the server even if browser-side validation was bypassed.
  const sizing=this.sizingPreview(this.config,marketPrice);
  if(sizing.status!=='valid')throw Error('Chưa thể bật AUTO: '+sizing.message);
  this.armed=true;this.recoveryStatus='idle';this.log('AUTO_ON','BẬT AUTO TIỀN THẬT, chờ tín hiệu BTCUSDT');return this.snapshot();
 }
 disarm(){this.armed=false;this.log('AUTO_OFF','Không mở lệnh mới; giữ lệnh SL/TP đã đặt trên Futures thật');return this.snapshot();}
 close(){this.disarm();this.api?.close();this.api=null;this.account=null;this.recoveryStatus='idle';}
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
 // Explicit operator-only exit. Never open an opposite position or retry
 // a MARKET close whose Binance outcome is unknown. Position/Algo readbacks
 // must be confirmed against the OCC checkpoint on every transition.
 async manualMarketExit({role,confirmation,expectedEntryOrderId,expectedRemainingBTC}={}){
  if(!['TP1','TP2','TP3','ALL'].includes(role))
   throw Error('Chỉ hỗ trợ TP1, TP2, TP3 hoặc Đóng toàn bộ');
  if(confirmation!=='XAC NHAN '+role+' BTCUSDT')
   throw Error('Chưa xác nhận thao tác MARKET tiền thật');
  if(!this.api||!this.account||this.environment!=='production')
   throw Error('Chưa có kết nối Binance Futures thật');
  if(this.busy)throw Error('Bot đang gửi/đối soát lệnh; không thể thao tác cùng lúc');
  if(!Number.isFinite(Number(expectedRemainingBTC))||Number(expectedRemainingBTC)<=0||
      !expectedEntryOrderId)throw Error('Thiếu thông tin vị thế mới nhất; hãy tải lại trạng thái');
  const managed=this.activeProtection||this.previousProtection;
  const intent=existsSync(this.intentPath)?JSON.parse(readFileSync(this.intentPath,'utf8')):null;
  if(!managed?.entry||intent?.phase!=='PROTECTED'||
     (this.halted&&!this.activeProtection&&this.previousProtection?.phase!=='PROTECTED'))
   throw Error('Vị thế chưa được OCC xác minh PROTECTED; cần đối soát Binance trước');
  this.busy=true;
  let mutationStarted=false;
  try{
   const read=async()=>{
    const account=await this.inspect();
    const [algos,entryOrder]=await Promise.all([
     this.api.get('/fapi/v1/openAlgoOrders',{symbol:'BTCUSDT'}),
     this.api.get('/fapi/v1/order',{symbol:'BTCUSDT',orderId:managed.entry.orderId})
    ]);
    return {account,algos,entryOrder};
   };
   const original=await read();
   const options={...original,managed,filters:this.filters,role,
    expectedRemainingBTC,expectedEntryOrderId};
   const pre=validateManagedExit(options);
   const originalAlgos=new Map(pre.active.map(x=>[String(x.algoId),x]));
   const closeId='OCCBTC-'+randomBytes(7).toString('hex');
   if(role!=='ALL'){
    // Cancel selected TP BEFORE reducing the position. This avoids having
    // both the queued TP and the manual MARKET reducing BTC simultaneously.
    mutationStarted=true;
    this.saveIntent({phase:'MANUAL_TP_CANCEL_SENDING',oldClientId:managed.entry.clientPrefix,
     oldEntryId:String(managed.entry.orderId),role,closeId,
     removingAlgoId:String(pre.leg.id),quantity:pre.closeQty,at:Date.now()});
    await this.api.del('/fapi/v1/algoOrder',{symbol:'BTCUSDT',algoId:pre.leg.id});
    const recheck=await read();
    const updated=validateManagedExit({...options,...recheck,role:'ALL'});
    if(Math.abs(updated.quantityBTC-pre.quantityBTC)>1e-9||!updated.stop||
       recheck.algos.some(x=>String(x.algoId)===String(pre.leg.id)))
     throw Error('TP chưa hủy hoặc BTC/SL thay đổi; không gửi MARKET');
    for(const [id] of originalAlgos){
     if(id===String(pre.leg.id))continue;
     if(!recheck.algos.some(x=>String(x.algoId)===id))
      throw Error('Một TP hoặc STOP khác đã thay đổi khi đang hủy; không gửi MARKET');
    }
   }
   // Persist the exact client order ID before POST; it can be investigated
   // by Binance origClientOrderId after a process crash.
   mutationStarted=true;
   this.saveIntent({phase:'MANUAL_MARKET_SENDING',oldClientId:managed.entry.clientPrefix,
    oldEntryId:String(managed.entry.orderId),role,closeId,quantity:pre.closeQty,at:Date.now()});
   const side=pre.side==='LONG'?'SELL':'BUY';
   const order=await this.api.post('/fapi/v1/order',{symbol:'BTCUSDT',positionSide:'BOTH',
    side,type:'MARKET',reduceOnly:'true',quantity:String(pre.closeQty),
    newClientOrderId:closeId,newOrderRespType:'RESULT'});
   if(!order?.orderId||order.status!=='FILLED')throw Error('Binance chưa xác nhận MARKET FILLED');
   const verified=await this.api.get('/fapi/v1/order',{symbol:'BTCUSDT',orderId:order.orderId});
   if(verified?.symbol!=='BTCUSDT'||String(verified.orderId)!==String(order.orderId)||
      verified.clientOrderId!==closeId||verified.side!==side||
      verified.status!=='FILLED'||verified.positionSide!=='BOTH'||
      !(verified.reduceOnly===true||verified.reduceOnly==='true')||
      Math.abs(Number(verified.executedQty)-pre.closeQty)>1e-9)
    throw Error('Không xác minh được lệnh đóng MARKET trên Binance');
   const after=await this.inspect();
   const expected=pre.remainingBTC*(pre.side==='LONG'?1:-1);
   if(Math.abs(after.positionBTC-expected)>1e-9)
    throw Error('BTCUSDT không khớp khối lượng còn lại sau MARKET; cần đối soát');
   // Registration is durable and idempotent; actual P&L is read from userTrades.
   this.registerRealOrder({orderId:order.orderId,groupId:managed.entry.clientPrefix,
    clientId:closeId,role:role==='ALL'?'CLOSE':role,side});
   if(pre.remainingBTC===0){
    const remaining=await this.api.get('/fapi/v1/openAlgoOrders',{symbol:'BTCUSDT'});
    if(!Array.isArray(remaining)||
       remaining.some(o=>!originalAlgos.has(String(o.algoId))||
        o.clientAlgoId!==originalAlgos.get(String(o.algoId))?.clientAlgoId))
     throw Error('Có lệnh mới/không rõ chủ sở hữu sau đóng toàn bộ; không tự hủy');
    for(const o of [...remaining]){
     this.saveIntent({phase:'MANUAL_ALGO_CLEARING',oldClientId:managed.entry.clientPrefix,
      role,closeId,removingAlgoId:String(o.algoId),at:Date.now()});
     await this.api.del('/fapi/v1/algoOrder',{symbol:'BTCUSDT',algoId:o.algoId});
    }
    const clean=await this.inspect();
    if(clean.positionBTC!==0||clean.openOrders!==0||clean.openAlgos!==0)
     throw Error('Binance còn lệnh treo sau khi đóng toàn bộ');
    new ProtectionCheckpoint(this.protectionPath).save({
     phase:'IDLE',entry:null,stop:null,tps:[],inFlight:null,halted:false
    });
    this.saveIntent({phase:'CLEARED',at:Date.now()});
    this.activeProtection=null;this.previousProtection=null;
    this.halted=false;this.error=null;
    this.log('MANUAL_EXIT_ALL','Đã đóng BTCUSDT toàn bộ bằng MARKET và dọn sạch SL/TP OCC.');
   }else{
    const live=await this.api.get('/fapi/v1/openAlgoOrders',{symbol:'BTCUSDT'});
    const ids=new Set(originalAlgos.keys());
    ids.delete(String(pre.leg?.id));
    if(!Array.isArray(live)||!live.some(o=>String(o.algoId)===String(managed.stop.id))||
      live.some(o=>!ids.has(String(o.algoId)))||
      [...ids].some(id=>!live.some(o=>String(o.algoId)===id)))
     throw Error('SL hoặc TP còn lại thay đổi bất ngờ; khóa để kiểm tra');
    const kept={phase:'PROTECTED',entry:managed.entry,stop:managed.stop,
     tps:managed.tps.filter(x=>x.role!==role),inFlight:null,halted:false};
    new ProtectionCheckpoint(this.protectionPath).save(kept);
    this.saveIntent({phase:'PROTECTED',clientId:managed.entry.clientPrefix,
     orderId:String(managed.entry.orderId)});
    if(this.activeProtection)this.activeProtection=kept;
    if(this.previousProtection)this.previousProtection=kept;
    this.error=null;
    this.log('MANUAL_TP','Đã chốt MARKET '+role+' '+pre.closeQty+' BTC; giữ STOP và TP chưa khớp.');
   }
   return {ok:true,role,closedBTC:pre.closeQty,remainingBTC:pre.remainingBTC,
    orderId:String(order.orderId),halted:this.halted,armed:this.armed};
  }catch(e){
   if(mutationStarted){
    this.halted=true;this.error='Chốt MARKET cần đối soát: '+e.message;
    this.log('MANUAL_EXIT_HALTED',this.error+'; không tự thử lại lệnh.');
   }else this.log('MANUAL_EXIT_REJECTED',e.message);
   throw e;
  }finally{this.busy=false;}
 }
 // Reversal may close ONLY an OCC-owned, exchange-verified position.
 // The existing stop remains active until the reduceOnly close is confirmed FLAT.
 async reverseManagedPosition(signal){
  const managed=this.activeProtection;
  if(!managed?.entry||!managed?.stop||!Array.isArray(managed.tps))throw Error('Missing managed position checkpoint');
  const from=managed.entry.side,to=signal.side;
  if(from===to)return false;
  const a=await this.inspect(),amt=a.positionBTC;
  if(a.openOrders||a.hasOtherPositions||a.dualSidePosition!==false||
     a.marginType!=='ISOLATED'||a.leverage!==this.config.leverage)
   throw Error('Unmanaged orders, positions or Binance account config mismatch');
  if(!Number.isFinite(amt)||Math.sign(amt)!==(from==='LONG'?1:-1))
   throw Error('Exchange position no longer matches OCC managed side');
  const qty=floorStep(Math.abs(amt),this.filters.stepSize);
  if(qty<this.filters.minQty||Math.abs(qty-Math.abs(amt))>1e-9||
     qty>Number(managed.entry.qty)+1e-9)throw Error('Invalid remaining reduceOnly BTC quantity');
  const algo=await this.api.get('/fapi/v1/openAlgoOrders',{symbol:'BTCUSDT'});
  if(!Array.isArray(algo))throw Error('Cannot verify open Algo orders');
  const ids=new Set([managed.stop.id,...managed.tps.map(x=>x.id)].map(String));
  const statuses=new Set(['NEW','ACCEPTED','PENDING_NEW']);
  const active=algo.filter(x=>x?.symbol==='BTCUSDT');
  if(active.some(o=>!ids.has(String(o.algoId))||!statuses.has(String(o.algoStatus))))
   throw Error('Unmanaged or unexpected Algo order; reversal blocked');
  const stop=active.find(o=>String(o.algoId)===String(managed.stop.id));
  if(!stop||stop.orderType!=='STOP_MARKET'||stop.closePosition!==true||
     stop.side!==(from==='LONG'?'SELL':'BUY'))
   throw Error('Original close-all STOP is not verified on Binance');
  if(active.some(o=>o!==stop&&(o.orderType!=='TAKE_PROFIT_MARKET'||
    o.reduceOnly!==true||o.side!==stop.side)))
   throw Error('Original TP orders are not verified reduceOnly');
  const closeId='OCCBTC-'+randomBytes(7).toString('hex');
  // Checkpoint BEFORE any network mutation; unknown close or cancel outcome halts.
  this.saveIntent({phase:'REVERSE_CLOSE_SENDING',oldClientId:managed.entry.clientPrefix,
    oldEntryId:String(managed.entry.orderId),closeId,qty,targetSide:to,barTime:signal.barTime,at:Date.now()});
  this.log('REVERSE_CLOSE','Đang đóng '+qty+' BTC '+from+' bằng reduceOnly trước khi đảo sang '+to);
  const ack=await this.api.post('/fapi/v1/order',{symbol:'BTCUSDT',positionSide:'BOTH',
   side:from==='LONG'?'SELL':'BUY',type:'MARKET',reduceOnly:'true',quantity:String(qty),
   newClientOrderId:closeId,newOrderRespType:'RESULT'});
  if(!ack?.orderId||ack.status!=='FILLED')throw Error('Reduce-only close not confirmed FILLED');
  this.registerRealOrder({orderId:ack.orderId,groupId:managed.entry.clientPrefix,
   clientId:closeId,role:'REVERSE',side:from==='LONG'?'SELL':'BUY'});
  const flat=await this.inspect();
  if(flat.positionBTC!==0)throw Error('Binance did not confirm BTCUSDT FLAT');
  const remaining=await this.api.get('/fapi/v1/openAlgoOrders',{symbol:'BTCUSDT'});
  if(!Array.isArray(remaining)||remaining.some(o=>o.symbol!=='BTCUSDT'||!ids.has(String(o.algoId))))
   throw Error('Unrecognized Algo remains after FLAT; do not cancel unknown orders');
  // Snapshot the list: a mock or shared adapter may mutate it on DELETE.
  for(const o of [...remaining]){
   this.saveIntent({phase:'REVERSE_ALGO_CLEARING',closeId,oldClientId:managed.entry.clientPrefix,
    removingAlgoId:String(o.algoId),at:Date.now()});
   await this.api.del('/fapi/v1/algoOrder',{symbol:'BTCUSDT',algoId:o.algoId});
  }
  const clean=await this.inspect();
  if(clean.positionBTC!==0||clean.openOrders!==0||clean.openAlgos!==0)
   throw Error('Old BTCUSDT orders not fully cleared');
  new ProtectionCheckpoint(this.protectionPath).save({
   phase:'IDLE',entry:null,stop:null,tps:[],inFlight:null,halted:false
  });
  this.saveIntent({phase:'CLEARED',at:Date.now()});
  this.activeProtection=null;this.previousProtection=null;
  this.log('REVERSE_FLAT','Đã đóng vị thế cũ và dọn SL/TP; Binance xác nhận FLAT');
  return true;
 }
 async signal(signal,feedHealthy,quoteProvider=null){
  if(!this.armed||this.busy||this.halted||this.pendingLimit||this.environment!=='production'||!feedHealthy||!signal?.side)return;
  const existing=this.activeProtection;
  if(existing&&(!this.config.reverseOnSignal||existing.entry.side===signal.side||
   (this.config.side!=='BOTH'&&this.config.side!==signal.side))){
   this.log('SIGNAL_IGNORED_POSITION','Bỏ qua tín hiệu '+signal.side+': đảo chiều OFF, cùng chiều hoặc bị lọc.');
   return;
  }
this.busy=true;
let reverseAttempted=false,reverseCompleted=false,entrySubmissionPossible=false;
try{
 if(existing){
  reverseAttempted=true;
  const closed=await this.reverseManagedPosition(signal);
  if(!closed)return;
  reverseCompleted=true;
  if(!this.armed||!this.config.reverseOnSignal){
   this.log('REVERSE_STOPPED','Đã đóng vị thế cũ nhưng Auto/đảo chiều đã OFF; không mở vị thế mới.');
   return;
  }
 }
 const a=await this.inspect();
 // Fresh verified aggTrade removes one redundant Binance REST round trip.
 // Fail closed on stale feed rather than using any price from a previous bar.
 let quotePrice;
 if(typeof quoteProvider==='function'){
  const q=quoteProvider();
  const age=Date.now()-Number(q?.lastReceivedAt);
  if(q?.symbol!=='BTCUSDT'||q?.live!==true||
     !Number.isFinite(q?.lastPrice)||q.lastPrice<=0||
     !Number.isFinite(age)||age< -3000||age>5000)
   throw Error('Giá Binance aggTrade đã quá hạn; bỏ qua tín hiệu, không đặt lệnh');
  quotePrice=q.lastPrice;
 }else{
  // Retain compatibility with test/external callers that do not supply live stream.
  const quote=await this.api.get('/fapi/v1/ticker/price',{symbol:'BTCUSDT'});
  quotePrice=Number(quote.price);
 }
 if(this.config.entryMode==='LIMIT_PULLBACK'){
  entrySubmissionPossible=true;
  await this.submitLimit(signal,a,quotePrice);
  return;
 }
 const plan=draftProtectedOrder({side:signal.side,account:a,filters:this.filters,
  quotePrice},this.config);
const clientId='OCCBTC-'+randomBytes(7).toString('hex');
// From this point an entry might be sent; unknown outcomes require a safety halt.
entrySubmissionPossible=true;
this.saveIntent({phase:'ENTRY_SENDING',clientId,side:signal.side,barTime:signal.barTime});
const sentAt=Date.now(),signalTime=Number(signal.time);
this.lastEntryTiming={barTime:signal.barTime,
 signalTime:Number.isFinite(signalTime)?signalTime:null,
 signalObservedAt:Number(signal.observedAt)||null,sentAt,ackAt:null,
 signalToSendMs:Number.isFinite(signalTime)?Math.max(0,sentAt-signalTime):null,
 exchangeAckMs:null};
this.log('ENTRY_REQUEST_TIMING','M15 '+new Date(signal.barTime).toISOString()+
 ' · sau mở nến '+this.lastEntryTiming.signalToSendMs+' ms (gồm kiểm tra Binance)');
   const response=await this.api.post('/fapi/v1/order',{symbol:'BTCUSDT',
    side:signal.side==='LONG'?'BUY':'SELL',positionSide:'BOTH',type:'MARKET',
    quantity:String(plan.qtyBTC),newClientOrderId:clientId,newOrderRespType:'RESULT'});
   if(!response?.orderId)throw Error('Binance không xác nhận orderId Entry');
   const ackAt=Date.now();
   this.lastEntryTiming.ackAt=ackAt;
   this.lastEntryTiming.exchangeAckMs=Math.max(0,ackAt-sentAt);
   this.log('ENTRY_ACK_TIMING','Binance ACK sau '+this.lastEntryTiming.exchangeAckMs+
    ' ms · tổng sau mở nến '+(this.lastEntryTiming.signalToSendMs+
      this.lastEntryTiming.exchangeAckMs)+' ms');
   this.saveIntent({phase:'ENTRY_ACK',clientId,orderId:String(response.orderId),side:signal.side});
   this.registerRealOrder({orderId:response.orderId,groupId:clientId,clientId,
    role:'ENTRY',side:signal.side==='LONG'?'BUY':'SELL'});
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
 if(reverseAttempted&&!reverseCompleted){
  // Unknown close/cancel outcomes: never retry or send an opposite-opening order.
  this.halted=true;this.error='Đảo chiều chưa được xác nhận: '+e.message;
  this.log('REVERSE_HALTED',this.error+' — kiểm tra vị thế và SL/TP trên Binance.');
 }else if(reverseCompleted&&!entrySubmissionPossible){
  // Old position is confirmed flat, but a new entry preflight failed.
  this.halted=true;this.error='Đã đóng lệnh cũ nhưng không thể mở chiều mới: '+e.message;
  this.log('REVERSE_HALTED',this.error);
 }else if(!entrySubmissionPossible){
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
  if(!this.api||this.environment!=='production'||this.busy||this.pendingLimit||!this.activeProtection||this.halted)return;
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
    this.activeProtection=null;this.previousProtection=null;this.log('FLAT','Đã đóng BTCUSDT Futures thật, hủy lệnh cũ và xác nhận sạch');
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
   this.activeProtection=null;this.previousProtection=null;this.halted=false;this.error=null;this.log('RECOVERED','Đã xác minh vị thế và lệnh BTCUSDT Futures thật hoàn toàn sạch');
   return this.snapshot();
  }finally{this.busy=false;}
 }

}

installLimitEntry(BrowserFutures);
