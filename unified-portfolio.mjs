// One-screen, per-symbol OCC trade coordinator. Reuses the same BrowserFutures,
// OCCSignalEngine, LIMIT, reversal and exchange-side protection as BTCUSDT.
// All futures mutations remain opt-in, symbol-scoped and fail-closed.
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {resolve} from 'node:path';
import {BrowserFutures} from './futures-browser-service.mjs';
import {OCCSignalEngine,M15} from './occ-signal-engine.mjs';
import {validateLiveConfig} from './futures-sizing.mjs';

const MARKET='https://fapi.binance.com';
export const validSymbol=s=>typeof s==='string'&&/^[A-Z0-9]{2,20}USDT$/.test(s);
const MAX_ADDITIONAL_SYMBOLS=12;
const inertVault=()=>({exists:()=>false,load:()=>null,save:()=>{},delete:()=>{}});
export class UnifiedPortfolio{
 constructor({dataDir,btc,clock=Date.now,publicGet=null}){
  if(!btc||!btc.symbol||btc.symbol!=='BTCUSDT')throw Error('Canonical BTC executor required');
  this.dir=resolve(dataDir);this.file=resolve(this.dir,'unified-symbols.json');
  this.btc=btc;this.clock=clock;
  this.publicGet=publicGet||this.fetchMarket.bind(this);
  this.peers=new Map();this.engines=new Map();this.marketCache=null;this.marketAt=0;
  this.lock=Promise.resolve();this.busy=false;this.scanning=false;this.monitoring=false;
  this.lastScanAt=null;this.events=[];this.configError=null;
  const saved=existsSync(this.file)?JSON.parse(readFileSync(this.file,'utf8')):{symbols:[]};
  if(!Array.isArray(saved.symbols)||saved.symbols.length>MAX_ADDITIONAL_SYMBOLS)
   throw Error('Invalid unified symbols file: manual review required');
  this.rows=[];this.btcSelected=saved.btcSelected===true;
  for(const row of saved.symbols){
   if(!validSymbol(row.symbol)||row.symbol==='BTCUSDT'||this.rows.some(x=>x.symbol===row.symbol))
    throw Error('Invalid or duplicate unified symbol: '+row.symbol);
   this.rows.push({symbol:row.symbol,selected:row.selected===true});
  }
  for(const row of this.rows)this.createPeer(row.symbol);
  btc.managedOtherSymbols=()=>this.approvedOthers('BTCUSDT');
 }
 log(symbol,type,message){
  this.events.push({at:this.clock(),symbol,type,message:String(message).slice(0,180)});
  this.events=this.events.slice(-40);
 }
 approvedOthers(except){
  const list=[];
  for(const [symbol,s] of this.sessions()){
   if(symbol===except)continue;
   const cp=s.activeProtection||s.previousProtection;
   if(!s.halted&&(!cp?.phase||cp.phase==='PROTECTED')&&cp?.entry?.symbol===symbol&&
      cp?.stop&&!cp?.inFlight)list.push(symbol);
  }
  return list;
 }
 sessions(){return new Map([['BTCUSDT',this.btc],...this.peers]);}
 get(symbol){
  if(symbol==='BTCUSDT')return this.btc;
  return this.peers.get(symbol)||null;
 }
 createPeer(symbol){
  const peer=new BrowserFutures({
   dataDir:this.dir,symbol,credentialVault:inertVault(),
   managedOtherSymbols:()=>this.approvedOthers(symbol)
  });
  this.peers.set(symbol,peer);
  return peer;
 }
 persist(){
  mkdirSync(this.dir,{recursive:true,mode:0o700});
  const temp=this.file+'.pending';
  writeFileSync(temp,JSON.stringify({symbols:this.rows,btcSelected:this.btcSelected},null,2),{mode:0o600});
  renameSync(temp,this.file);
 }
 async fetchMarket(path,params={}){
  if(!['/fapi/v1/exchangeInfo','/fapi/v1/klines','/fapi/v1/ticker/price'].includes(path))
   throw Error('Only public Futures market reads permitted');
  const url=MARKET+path+'?'+new URLSearchParams(params);
  const response=await fetch(url,{signal:AbortSignal.timeout(12000),cache:'no-store'});
  if(!response.ok)throw Error('Binance public market '+response.status);
  return response.json();
 }
 async exchangeInfo(){
  if(!this.marketCache||this.clock()-this.marketAt>3600000){
   const value=await this.publicGet('/fapi/v1/exchangeInfo');
   if(!Array.isArray(value?.symbols))throw Error('Binance exchangeInfo invalid');
   this.marketCache=value;this.marketAt=this.clock();
  }
  return this.marketCache;
 }
 async verifyContract(symbol){
  if(!validSymbol(symbol))throw Error('Mã Futures USDT không hợp lệ');
  const info=await this.exchangeInfo();
  const market=info.symbols.find(row=>row.symbol===symbol&&row.contractType==='PERPETUAL'&&
    row.status==='TRADING'&&row.quoteAsset==='USDT'&&row.marginAsset==='USDT');
  if(!market)throw Error(symbol+' không phải USDT Perpetual đang giao dịch trên Binance');
  return market;
 }
 async add(symbol){
  symbol=String(symbol||'').trim().toUpperCase();
  if(!validSymbol(symbol)||symbol==='BTCUSDT')throw Error('Nhập mã USDT Perpetual khác BTCUSDT');
  if(this.peers.has(symbol))return this.status();
  if(this.rows.length>=MAX_ADDITIONAL_SYMBOLS)throw Error('Tối đa '+MAX_ADDITIONAL_SYMBOLS+' coin bổ sung để kiểm soát Binance rate limit');
  await this.verifyContract(symbol);
  const peer=this.createPeer(symbol);
  peer.saveConfig({...this.btc.config}); // Clone strategy settings, not trade/account state.
  this.rows.push({symbol,selected:false});this.persist();
  this.log(symbol,'ADDED','Đã thêm coin; AUTO mặc định OFF');
  return this.status();
 }
 async remove(symbol){
  const s=this.peers.get(symbol);
  if(!s)throw Error('Không có coin trong danh sách');
  if(s.armed||s.busy||s.pendingLimit||s.activeProtection||s.previousProtection||s.halted)
   throw Error('Coin có vị thế hoặc checkpoint chưa đối soát; không được xóa');
  if(!s.api)throw Error('Phải kết nối và xác minh Binance trước khi xóa coin');
  // Never infer FLAT from a stale account snapshot. Read real exchange twice.
  const first=await s.inspect(),second=await s.inspect();
  if([first,second].some(a=>a.positionBTC!==0||a.openOrders!==0||a.openAlgos!==0))
   throw Error('Binance còn vị thế hoặc STOP/TP '+symbol+'; không xóa');
  s.close();this.peers.delete(symbol);this.engines.delete(symbol);
  this.rows=this.rows.filter(x=>x.symbol!==symbol);this.persist();
  this.log(symbol,'REMOVED','Đã xác minh Binance FLAT và sạch lệnh; giữ dữ liệu kiểm toán trên ổ đĩa');
  return this.status();
 }
  select(symbol,yes){
  if(typeof yes!=='boolean')throw Error('AUTO coin phải là ON hoặc OFF');
  if(symbol==='BTCUSDT'){this.btcSelected=yes;this.persist();if(!yes)this.btc.disarm();
   return this.status();}
  if(!this.peers.has(symbol))throw Error('Coin chưa được thêm');
  const row=this.rows.find(x=>x.symbol===symbol);
  row.selected=yes;this.persist();
  if(!yes)this.get(symbol).disarm();
  this.log(symbol,'AUTO_SELECTED',yes?'Đã chọn cho AUTO tổng':'Bỏ chọn AUTO; bảo vệ SL/TP giữ nguyên');
  return this.status();
 }
 configure(symbol,config){
  const s=this.get(symbol);
  if(!s||symbol==='BTCUSDT')throw Error('Sử dụng cài đặt BTC gốc cho BTCUSDT');
  const allowed=['side','marginUSDT','leverage','slPercent','tpMode','tp1Val',
   'tp2Val','tp3Val','tp1Qty','tp2Qty','reverseOnSignal','entryMode','limitBasis',
   'limitOffsetPct','limitWaitSeconds'];
  if(!config||typeof config!=='object'||Object.keys(config).some(k=>!allowed.includes(k)))
   throw Error('Cấu hình coin có trường không hợp lệ');
  s.saveConfig(validateLiveConfig({...s.config,...config}));
  this.log(symbol,'CONFIG_SAVED','Thông số ký quỹ, leverage, SL/TP và OCC riêng đã được lưu');
  return this.status();
 }
 // No simultaneous order mutations across symbols. Each execution reads a
 // fresh account balance after the previous one has completed.
 serial(fn){
  const task=this.lock.then(async()=>{this.busy=true;
   try{return await fn();}finally{this.busy=false;}});
  this.lock=task.catch(()=>{});
  return task;
 }
 async connectPeers(){
  const source=this.btc.api;
  if(!source?.key||!source?.secret)throw Error('Kết nối API Futures trên BTC trước');
  for(const peer of this.peers.values()){
   if(peer.api&&peer.api.key===source.key&&peer.api.secret===source.secret)continue;
   if(peer.armed||peer.busy||peer.pendingLimit)throw Error(peer.symbol+' chưa thể đổi kết nối API');
   await peer.connect({apiKey:source.key,apiSecret:source.secret,
    environment:'production',remember:null});
  }
 }
 async inspectPeers(except){
  // Only peers with an OCC-owned PROTECTED checkpoint may be present
  // elsewhere in the same Futures account. Verify their orders on Binance.
  const active=[...this.sessions()].filter(([symbol,s])=>symbol!==except&&
    (s.activeProtection||s.previousProtection));
  for(const [symbol,s] of active){
   if(s.halted||!s.canResumeManagedPosition())throw Error(symbol+' có checkpoint chưa xác minh; chặn lệnh mới');
   await s.verifyManagedPositionForResume();
  }
 }
 async quote(symbol){
  const q=await this.publicGet('/fapi/v1/ticker/price',{symbol});
  const p=Number(q?.price);
  if(q?.symbol!==symbol||!(p>0))throw Error('Giá '+symbol+' chưa được Binance xác minh');
  return p;
 }
 async enable(symbol,confirmation,marketPrice=null){
  const s=this.get(symbol);
  if(!s)throw Error('Coin chưa được thêm');
  if(symbol!=='BTCUSDT')await this.connectPeers();
  if(symbol==='BTCUSDT'&&confirmation!=='CHAP NHAN BTC FUTURES'||
     symbol!=='BTCUSDT'&&confirmation!=='CHAP NHAN '+symbol+' FUTURES')
   throw Error('Chưa xác nhận giao dịch thật '+symbol);
  await this.inspectPeers(symbol);
  await s.arm('CHAP NHAN BTC FUTURES',marketPrice??await this.quote(symbol));
  this.log(symbol,'AUTO_ON','Đang theo dõi giao cắt OCC mới');
  return this.status();
 }
 async disable(symbol){
  const s=this.get(symbol);
  if(!s)throw Error('Coin chưa được thêm');
  s.disarm();
  if(s.pendingLimit)await s.cancelOpenLimit();
  this.log(symbol,'AUTO_OFF','Dừng Entry mới; SL/TP trên Binance được giữ nguyên');
  return this.status();
 }
 async enableSelected(confirmation,btcPrice=null){
  if(confirmation!=='CHAP NHAN AUTO TAT CA')throw Error('Cần xác nhận AUTO nhiều coin bằng tiền thật');
  const chosen=[...(this.btcSelected?['BTCUSDT']:[]),...this.rows.filter(r=>r.selected).map(r=>r.symbol)];
  if(!chosen.length)throw Error('Chưa bật AUTO cho coin nào trong danh sách');
  const newly=[];
  try{
   await this.connectPeers();
   for(const symbol of chosen){
    const session=this.get(symbol);
    if(session.armed)continue;
    await this.enable(symbol,symbol==='BTCUSDT'?'CHAP NHAN BTC FUTURES':'CHAP NHAN '+symbol+' FUTURES',btcPrice&&symbol==='BTCUSDT'?btcPrice:null);
    newly.push(symbol);
   }
   return this.status();
  }catch(e){
   for(const symbol of newly)this.get(symbol)?.disarm();
   throw e;
  }
 }
 async disableAll(){
  const issues=[];
  for(const [symbol,s] of this.sessions()){
   s.disarm();
   if(s.pendingLimit)try{await s.cancelOpenLimit();}catch(e){issues.push(symbol+': '+e.message);}
  }
  if(issues.length)throw Error(issues.join(' | '));
  return this.status();
 }
 async handleSignal(symbol,signal,feedHealthy,quoteProvider=null){
  return this.serial(async()=>{
   const s=this.get(symbol);
   if(!s||!s.armed||s.halted||!feedHealthy)return;
   if(this.clock()-Number(signal?.time)>10*60*1000)return;
   await this.inspectPeers(symbol);
   return s.signal(signal,feedHealthy,quoteProvider);
  });
 }
 async warmup(symbol){
  const [h4,m15]=await Promise.all([
   this.publicGet('/fapi/v1/klines',{symbol,interval:'4h',limit:36}),
   this.publicGet('/fapi/v1/klines',{symbol,interval:'15m',limit:50})
  ]);
  const engine=new OCCSignalEngine({symbol});
  engine.warmup(h4,m15,this.clock());engine.setHealthy(true);engine.setRunning(true);
  this.engines.set(symbol,engine);
 }
 async tick(){
  if(this.scanning||this.busy)return;
  this.scanning=true;this.lastScanAt=this.clock();
  try{
   for(const [symbol,s] of this.peers){
    if(!s.armed||s.halted)continue;
    try{
     let engine=this.engines.get(symbol);
     if(!engine){await this.warmup(symbol);continue;}
     const now=this.clock();
     const bars=await this.publicGet('/fapi/v1/klines',{symbol,interval:'15m',limit:5});
     const recent=bars.filter(b=>Number(b?.[6])<now&&Number(b[0])>engine.lastCandleTime)
      .sort((a,b)=>Number(a[0])-Number(b[0]));
     if(recent.length>1||(recent.length===1&&Number(recent[0][0])!==engine.lastCandleTime+M15)){
      this.engines.delete(symbol);this.log(symbol,'RESYNC','Bỏ tín hiệu quá khứ sau khi mất nến');continue;
     }
     if(recent.length===1){
      const signal=engine.onCandle(recent[0],{live:true,observedAt:now});
      if(signal?.eligible&&now>=signal.time&&now-signal.time<=10*60*1000)
       await this.handleSignal(symbol,signal,true);
     }
    }catch(e){this.engines.delete(symbol);this.log(symbol,'SCAN_ERROR',e.message);}
   }
  }finally{this.scanning=false;}
 }
 async monitor(){
  if(this.monitoring)return;
  this.monitoring=true;
  try{
   for(const [symbol,s] of this.peers){
    if(!s.api)continue;
    await s.monitor().catch(e=>this.log(symbol,'MONITOR_ERROR',e.message));
    await s.pollLimit().catch(e=>this.log(symbol,'LIMIT_ERROR',e.message));
    await s.refreshAccountOverview().catch(e=>this.log(symbol,'ACCOUNT_ERROR',e.message));
   }
  }finally{this.monitoring=false;}
 }
 async detach(){
  const blocked=[...this.peers.values()].filter(s=>s.pendingLimit);
  if(blocked.length)throw Error('Có LIMIT chưa đối soát: '+blocked.map(x=>x.symbol).join(', '));
  for(const s of this.peers.values()){s.disarm();s.close();}
  this.engines.clear();
 }
 status(){
  const rows=[{symbol:'BTCUSDT',selected:this.btcSelected},...this.rows].map(row=>{
   const s=this.get(row.symbol);const snapshot=s.snapshot();
   return {symbol:row.symbol,selected:row.selected,
    armed:s.armed,connected:snapshot.connected,halted:s.halted,busy:s.busy,
    error:s.error,config:s.config,
    pendingLimit:snapshot.pendingLimit,protectedPosition:snapshot.protectedPosition,
    canResumeManaged:snapshot.canResumeManaged,account:s.account?{
     positionQty:s.account.positionBTC,entryPrice:s.account.entryPrice,
     markPrice:s.account.markPrice,unrealizedUSDT:s.account.btcUnrealizedUSDT,
     leverage:s.account.leverage,marginType:s.account.marginType,
     openOrders:s.account.openOrders,openAlgos:s.account.openAlgos,
     availableUSDT:s.account.availableUSDT
    }:null};
  });
  return {rows,anyAuto:rows.some(x=>x.armed),armedCount:rows.filter(x=>x.armed).length,
   openPositions:rows.filter(x=>Math.abs(Number(x.account?.positionQty||0))>0).length,
   connected:!!this.btc.api,lastScanAt:this.lastScanAt,
   scanning:this.scanning,busy:this.busy,events:this.events.slice(-15),
   disclaimer:'AUTO mặc định OFF; các vị thế chưa xác minh không được tự nhận quyền quản lý.'};
 }
}
