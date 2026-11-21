// Multi-symbol OCC USDT perpetual auto-trading for Windows PC.
// LIVE MARKET only: no replay after restart, no blind mutation retries.
// Each symbol owns its own durable intent + STOP/TP checkpoint.
import {randomBytes} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync,renameSync} from 'node:fs';
import {resolve} from 'node:path';
import {OCCSignalEngine,M15} from './occ-signal-engine.mjs';
import {FuturesTransport} from './futures-transport.mjs';
import {ProtectionCheckpoint} from './futures-protection-checkpoint.mjs';
import {ProtectionCoordinator} from './futures-protection-orchestrator.mjs';
import {validateMultiConfig,resolveUsdtMarkets,planMultiMargin,calculateMinimumMargin} from './multi-auto-sizing.mjs';
const ROOT='https://fapi.binance.com';
const goodAlgo=new Set(['NEW','ACCEPTED','PENDING_NEW']);
const safeRead=p=>existsSync(p)?JSON.parse(readFileSync(p,'utf8')):null;
const same=(a,b)=>String(a)===String(b);
const near=(a,b)=>Math.abs(Number(a)-Number(b))<=Math.max(1e-8,Number(b)*1e-7);

export class MultiAutoWorker{
 constructor({dataDir,legacy,publicGet=null,transportFactory=null,clock=Date.now}){
  this.dir=resolve(dataDir);mkdirSync(this.dir,{recursive:true});
  this.file=resolve(this.dir,'multi-auto-settings.json');
  this.legacy=legacy;this.clock=clock;
  this.publicGet=publicGet||this.binanceGet.bind(this);
  this.transportFactory=transportFactory||((p)=>new FuturesTransport(p));
  this.config=safeRead(this.file)?.symbols||[];
  this.config=this.config.length?validateMultiConfig(this.config):[];
  this.markets=new Map();this.engines=new Map();this.active=new Map();
  this.api=null;this.apiSource=null;this.armed=false;this.busy=false;this.halted=false;this.error=null;this.stopRequested=false;
  this.lastScanAt=null;this.lastTrade=null;this.lastCalculated=null;this.events=[];
  this.marketCache=null;this.marketFetchedAt=0;this.running=null;this.monitoring=null;
  // A restart NEVER automatically arms trading. Stored positions are retained.
  for(const name of readdirSync(this.dir)){
   const match=/^multi-protection-([A-Z0-9]{2,20}USDT)\.json$/.exec(name);
   if(!match)continue;
   const cp=new ProtectionCheckpoint(resolve(this.dir,name)).load();
   if(cp?.phase!=='IDLE')this.active.set(match[1],cp);
  }
  for(const name of readdirSync(this.dir)){
   const match=/^multi-intent-([A-Z0-9]{2,20}USDT)\.json$/.exec(name);
   if(!match)continue;
   const intent=safeRead(resolve(this.dir,name));
   if(intent?.phase&&!['CLEARED','PROTECTED'].includes(intent.phase)){
    this.halted=true;this.error='Có lệnh '+match[1]+' chưa đối soát sau khi khởi động lại';
   }
  }
 }
 intentFile(symbol){return resolve(this.dir,'multi-intent-'+symbol+'.json');}
 protectionFile(symbol){return resolve(this.dir,'multi-protection-'+symbol+'.json');}
 intent(symbol,record){
  const file=this.intentFile(symbol),tmp=file+'.pending';
  writeFileSync(tmp,JSON.stringify({...record,symbol,at:this.clock()},null,2),{mode:0o600});
  renameSync(tmp,file);
 }
 log(symbol,type,description){
  this.events.push({at:this.clock(),symbol,type,message:String(description).slice(0,220)});
  this.events=this.events.slice(-75);
 }
 status(){
  return {armed:this.armed,connected:!!this.api,halted:this.halted,busy:this.busy,
   error:this.error,symbols:this.config.map(row=>({...row,
    symbol:this.markets.get(row.base)?.symbol||row.base+'USDT',
    managed:this.active.has(this.markets.get(row.base)?.symbol||row.base+'USDT'),
    checkpointPhase:this.active.get(this.markets.get(row.base)?.symbol||row.base+'USDT')?.phase||'IDLE',
    lastTrade:this.lastTrade?.symbol===this.markets.get(row.base)?.symbol?this.lastTrade:null,
    warmed:this.engines.has(this.markets.get(row.base)?.symbol||row.base+'USDT')})),
   lastTrade:this.lastTrade,lastCalculated:this.lastCalculated,lastScanAt:this.lastScanAt,
   events:this.events.slice(-20)};
 }
 async binanceGet(path,params={}){
  if(!['/fapi/v1/exchangeInfo','/fapi/v1/klines','/fapi/v1/ticker/price'].includes(path))
   throw Error('Multi worker chỉ đọc dữ liệu thị trường công khai');
  const url=ROOT+path+'?'+new URLSearchParams(params);
  const r=await fetch(url,{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(12000)});
  if(!r.ok)throw Error('Binance '+path+' HTTP '+r.status);
  return r.json();
 }
 async loadMarkets(){
  if(!this.marketCache||this.clock()-this.marketFetchedAt>3600000){
   this.marketCache=await this.publicGet('/fapi/v1/exchangeInfo');this.marketFetchedAt=this.clock();
  }
  const mapped=resolveUsdtMarkets(this.config,this.marketCache);
  this.markets=new Map(mapped.map(x=>[x.base,
   this.marketCache.symbols.find(m=>m.symbol===x.symbol)]));
  return mapped;
 }
 configure(rows){
  if(this.armed||this.busy||this.active.size)
   throw Error('Tắt AUTO và đợi các vị thế cũ FLAT trước khi sửa danh sách coin');
  const normalized=validateMultiConfig(rows);
  const temp=this.file+'.pending';
  writeFileSync(temp,JSON.stringify({symbols:normalized},null,2),{mode:0o600});
  renameSync(temp,this.file);
  this.config=normalized;this.markets.clear();this.engines.clear();
  return this.status();
 }
 async preview(){
  const mapped=await this.loadMarkets(),out=[];
  for(const row of mapped){
   try{
    const market=this.markets.get(row.base);
    const quote=await this.publicGet('/fapi/v1/ticker/price',{symbol:row.symbol});
    const price=Number(quote?.price);
    if(quote?.symbol!==row.symbol||!(price>0))throw Error('Giá Binance không hợp lệ');
    const lev=this.legacy.config.leverage;
    const result=calculateMinimumMargin({market,price,leverage:lev,
     settings:{...this.legacy.config,marginUSDT:20,entryMode:'MARKET'}});
    const effective=Math.max(row.marginUSDT,result.minimumMarginUSDT);
    out.push({symbol:row.symbol,desired:row.marginUSDT,minimum:result.minimumMarginUSDT,
     effective,autoRaised:effective>row.marginUSDT,price,leverage:lev,
     balanceEnough:this.legacy.account?this.legacy.account.availableUSDT>=effective+Math.max(0.1,effective*0.01):null});
   }catch(error){out.push({symbol:row.symbol,desired:row.marginUSDT,error:String(error.message).slice(0,180)});}
  }
  return {at:this.clock(),rows:out,warning:'Tối thiểu chỉ là dự kiến theo giá/lot hiện tại; sẽ tính lại trước lệnh MARKET thật.'};
 }
 async attach(){
  const source=this.legacy?.api;
  if(!source?.key||!source?.secret){if(this.api){this.api.close();this.api=null;}this.apiSource=null;return false;}
  if(this.api&&this.apiSource===source)return true;
  if(this.api)this.api.close();
  const all=new Set([...this.config.map(x=>x.base+'USDT'),...this.active.keys()]);
  // Actual symbols are finalized after loadMarkets() and are checked again at arm.
  this.api=this.transportFactory({apiKey:source.key,apiSecret:source.secret,
   environment:'production',productionConsent:'I_ACCEPT_LIVE_BTCUSDT',
   allowedSymbols:[...all]});
  this.apiSource=source;
  await this.api.syncClock();
  return true;
 }
 async marketAndTransport(){
  const mapped=await this.loadMarkets();
  // Reject rare symbols whose correct Binance symbol isn't BASE+USDT.
  const actual=new Set([...mapped.map(x=>x.symbol),...this.active.keys()]);
  const old=this.api;
  const source=this.legacy?.api;
  if(!source?.key||!source?.secret)throw Error('Kết nối Binance Futures API trước khi dùng Auto');
  if(!old||this.apiSource!==source||[...actual].some(s=>!old.allowedSymbols?.has(s))){
   if(old)old.close();
   this.api=this.transportFactory({apiKey:source.key,apiSecret:source.secret,
    environment:'production',productionConsent:'I_ACCEPT_LIVE_BTCUSDT',allowedSymbols:[...actual]});
   this.apiSource=source;await this.api.syncClock();
  }
  return mapped;
 }
 async inspect(symbol){
  if(!this.api)throw Error('Không có Binance Futures API');
  const [account,mode,config,risk,orders,algos]=await Promise.all([
   this.api.get('/fapi/v2/account'),
   this.api.get('/fapi/v1/positionSide/dual'),
   this.api.get('/fapi/v1/symbolConfig',{symbol}),
   this.api.get('/fapi/v3/positionRisk',{symbol}),
   this.api.get('/fapi/v1/openOrders',{symbol}),
   this.api.get('/fapi/v1/openAlgoOrders',{symbol})
  ]);
  if(!Array.isArray(account?.assets)||!Array.isArray(config)||!Array.isArray(risk)||
     !Array.isArray(orders)||!Array.isArray(algos))
   throw Error('Binance không cung cấp đủ dữ liệu đối soát '+symbol);
  const usdt=account.assets.find(x=>x.asset==='USDT');
  const c=config.find(x=>x.symbol===symbol);
  const positions=risk.filter(x=>x.symbol===symbol);
  if(!usdt||!c||positions.length>1||positions.some(p=>p.positionSide!=='BOTH')||
   mode?.dualSidePosition!==false||account.canTrade!==true)
   throw Error(symbol+' yêu cầu One-way, quyền Futures và dữ liệu tài khoản hợp lệ');
  const amt=positions.length?Number(positions[0].positionAmt):0;
  const available=Number(usdt.availableBalance);
  if(!Number.isFinite(amt)||!Number.isFinite(available))throw Error('Vị thế '+symbol+'/USDT khả dụng không hợp lệ');
  return {symbol,positionBTC:amt,availableUSDT:available,marginType:c.marginType,
   leverage:Number(c.leverage),orders,algos,canTrade:true,positionPrice:positions.length?
    Number(positions[0].entryPrice):0};
 }
 async verifiedManaged(symbol,checkpoint){
  const st=await this.inspect(symbol),entry=checkpoint?.entry;
  if(checkpoint?.phase!=='PROTECTED'||!entry||entry.symbol!==symbol||
     !['LONG','SHORT'].includes(entry.side)||
     !Number.isFinite(st.positionBTC)||Math.sign(st.positionBTC)!==(entry.side==='LONG'?1:-1)||
     Math.abs(st.positionBTC)>entry.qty+1e-8||st.orders.length)
   throw Error(symbol+' không trùng vị thế OCC đã bảo vệ');
  const [order,live]=await Promise.all([
   this.api.get('/fapi/v1/order',{symbol,orderId:entry.orderId}),
   this.api.get('/fapi/v1/openAlgoOrders',{symbol})
  ]);
  if(!same(order?.orderId,entry.orderId)||order?.clientOrderId!==entry.clientPrefix||
   order?.status!=='FILLED'||order?.symbol!==symbol||order?.positionSide!=='BOTH')
   throw Error(symbol+' Entry Order ID không khớp Binance');
  const known=new Map([checkpoint.stop,...checkpoint.tps].filter(Boolean)
   .map(x=>[String(x.id),x]));
  if(!checkpoint.stop||!Array.isArray(checkpoint.tps)||live.some(x=>{
   const old=known.get(String(x.algoId));
   return !old||x.clientAlgoId!==old.clientId||!goodAlgo.has(x.algoStatus);
  }))throw Error(symbol+' có Algo không trùng checkpoint');
  const sl=live.find(o=>same(o.algoId,checkpoint.stop.id));
  if(!sl||sl.orderType!=='STOP_MARKET'||sl.closePosition!==true||
   sl.side!==(entry.side==='LONG'?'SELL':'BUY'))
   throw Error(symbol+' chưa xác minh STOP close-all trên Binance');
  return st;
 }
 async arm(confirmation){
  if(confirmation!=='CHAP NHAN AUTO DA MA')
   throw Error('Chưa xác nhận AUTO đa mã bằng tiền thật');
  if(this.busy||this.armed||this.halted)throw Error(this.error||'AUTO đa mã đang bận hoặc khóa');
  if(!this.config.length)throw Error('Hãy nhập mã coin và mức USDT ký quỹ trước');
  if(this.legacy?.config?.entryMode!=='MARKET')
   throw Error('AUTO đa mã hiện chỉ hỗ trợ MARKET; đổi Kiểu Entry trong Cài đặt thành MARKET');
  if(this.legacy?.armed||this.legacy?.pendingLimit||this.legacy?.activeProtection||
     this.legacy?.previousProtection||this.legacy?.halted)
   throw Error('AUTO BTC cũ hoặc vị thế/checkpoint BTC chưa đối soát; không chạy hai bot');
  this.stopRequested=false;this.busy=true;
  try{
   const mapped=await this.marketAndTransport();
   for(const row of mapped){
    const st=await this.inspect(row.symbol);
    if(st.marginType!=='ISOLATED'||st.leverage!==this.legacy.config.leverage)
     throw Error(row.symbol+' cần ISOLATED và leverage '+this.legacy.config.leverage+'x trên Binance');
    const managed=this.active.get(row.symbol);
    if(managed)await this.verifiedManaged(row.symbol,managed);
    else if(st.positionBTC!==0||st.orders.length||st.algos.length)
     throw Error(row.symbol+' đang có vị thế/lệnh ngoài OCC. Không tự nhận quyền quản lý');
   }
   this.engines.clear();
   // Warmup is historical ONLY. No past cross will ever be traded.
   for(const row of mapped)await this.warmup(row.symbol);
   if(this.stopRequested)throw Error('AUTO đa mã đã được tắt trong lúc khởi tạo');
   this.armed=true;this.error=null;
   this.log('ALL','AUTO_ON','Đã bật AUTO '+mapped.map(x=>x.symbol).join(', '));
   return this.status();
  }finally{this.busy=false;}
 }
 stop(){
  this.stopRequested=true;this.armed=false;this.engines.clear();
  this.log('ALL','AUTO_OFF','Dừng vào lệnh mới, giữ STOP/TP trên Binance');
  return this.status();
 }
 async warmup(symbol){
  const now=this.clock();
  const [h4,m15]=await Promise.all([
   this.publicGet('/fapi/v1/klines',{symbol,interval:'4h',limit:32}),
   this.publicGet('/fapi/v1/klines',{symbol,interval:'15m',limit:48})
  ]);
  const e=new OCCSignalEngine({symbol});
  e.warmup(h4,m15,now);e.setHealthy(true);e.setRunning(true);
  this.engines.set(symbol,e);
 }
 async tick(){
  if(!this.armed||this.busy||this.monitoring)return this.status();
  if(this.running)return this.running;
  this.running=(async()=>{
   this.lastScanAt=this.clock();
   try{
    for(const row of this.config){
     if(!this.armed||this.halted)break;
     const market=this.markets.get(row.base);
     if(!market)continue;
     const symbol=market.symbol,e=this.engines.get(symbol);
     if(!e){await this.warmup(symbol);continue;}
     try{
      const now=this.clock();
      const bars=await this.publicGet('/fapi/v1/klines',{symbol,interval:'15m',limit:5});
      const closed=bars.filter(b=>Number(b?.[6])<now).sort((a,b)=>Number(a[0])-Number(b[0]));
      const upcoming=closed.filter(b=>Number(b[0])>e.lastCandleTime);
      // Backfill/reconnection never turns into a live order.
      if(upcoming.length>1||upcoming.length===1&&Number(upcoming[0][0])!==e.lastCandleTime+M15){
       this.engines.delete(symbol);this.log(symbol,'RESYNC','Thiếu nến; bỏ tín hiệu cũ');
       continue;
      }
      if(upcoming.length===1){
       const signal=e.onCandle(upcoming[0],{live:true,observedAt:now});
       if(signal?.eligible&&now-signal.time>=0&&now-signal.time<=10*60*1000)
        await this.handleSignal(row,market,signal);
      }
     }catch(error){this.log(symbol,'SCAN_ERROR',error.message);this.engines.delete(symbol);}
    }
   }catch(e){this.error='Quét OCC đa mã: '+e.message;this.log('ALL','SCAN_ERROR',e.message);}
   finally{this.running=null;}
   return this.status();
  })();
  return this.running;
 }
 async handleSignal(row,market,signal){
  const symbol=market.symbol;
  // Honor the directional filter in the existing PC trading configuration.
  if(this.legacy.config.side!=='BOTH'&&this.legacy.config.side!==signal.side){
   this.log(symbol,'SIDE_FILTER','Bỏ qua '+signal.side+' do cấu hình chiều giao dịch');return;
  }
  // Existing positions are protected on Binance. A new signal must never stack an entry.
  if(this.active.has(symbol)){this.log(symbol,'POSITION_HOLD','Giữ vị thế hiện tại; bỏ qua '+signal.side);return;}
  if(this.busy||this.monitoring||!this.armed||this.halted)return;
  this.busy=true;
  let submitted=false,plan=null,clientId=null;
  try{
   // Get the latest exchange filters before calculating any symbol minimum.
   this.marketCache=null;
   await this.loadMarkets();
   market=this.markets.get(row.base);
   if(!market||market.symbol!==symbol)throw Error('Cặp Binance vừa thay đổi, bỏ tín hiệu');
   const st=await this.inspect(symbol);
   if(st.marginType!=='ISOLATED'||st.leverage!==this.legacy.config.leverage||
      st.positionBTC!==0||st.orders.length||st.algos.length)
    throw Error('Trạng thái Binance không FLAT/sạch lệnh/đúng đòn bẩy');
   const quote=await this.publicGet('/fapi/v1/ticker/price',{symbol});
   const price=Number(quote?.price);
   if(quote?.symbol!==symbol||!(price>0))throw Error('Không đọc được giá '+symbol+' mới');
   const currentSettings={...this.legacy.config,marginUSDT:20,entryMode:'MARKET'};
   plan=planMultiMargin({market,side:signal.side,desiredMarginUSDT:row.marginUSDT,
    price,availableUSDT:st.availableUSDT,leverage:st.leverage,settings:currentSettings});
   this.lastCalculated={symbol,desired:plan.desiredMarginUSDT,
    minimum:plan.minimumMarginUSDT,effective:plan.effectiveMarginUSDT,autoRaised:plan.autoRaised,
    price:plan.price,quantity:plan.quantity,at:this.clock()};
   if(plan.autoRaised)this.log(symbol,'MARGIN_RAISED','Tự nâng ký quỹ '+row.marginUSDT+' → '+plan.effectiveMarginUSDT+' USDT (tối thiểu Binance)');
   // OFF during preflight must never result in a new exchange order.
   if(!this.armed||this.stopRequested||this.halted)
    throw Error('AUTO đã tắt trước khi gửi Entry');
   // Persist client intent BEFORE the first order POST.
   clientId='OCCM-'+randomBytes(7).toString('hex');
   this.intent(symbol,{phase:'ENTRY_SENDING',clientId,side:signal.side,
    qty:plan.quantity,requestedMarginUSDT:row.marginUSDT,actualMarginUSDT:plan.effectiveMarginUSDT,
    signalTime:signal.time,barTime:signal.barTime});
   submitted=true;
   const ack=await this.api.post('/fapi/v1/order',{symbol,positionSide:'BOTH',
    side:signal.side==='LONG'?'BUY':'SELL',type:'MARKET',quantity:String(plan.quantity),
    newClientOrderId:clientId,newOrderRespType:'RESULT'});
   if(!ack?.orderId)throw Error('Binance Entry Order ID không rõ');
   this.intent(symbol,{phase:'ENTRY_ACK',clientId,orderId:String(ack.orderId),side:signal.side});
   const cp=new ProtectionCheckpoint(this.protectionFile(symbol));
   const coord=new ProtectionCoordinator({api:this.api,checkpoint:cp,settings:currentSettings,
    symbol,notify:e=>this.log(symbol,'PROTECTION_ALERT',e.reason)});
   const protectedTrade=await coord.protectConfirmedEntry({entryOrderId:ack.orderId,
    side:signal.side,stepSize:plan.filters.lotStep,tickSize:plan.filters.tick,
    clientPrefix:clientId});
   this.intent(symbol,{phase:'PROTECTED',clientId,orderId:String(ack.orderId),
    desiredMarginUSDT:row.marginUSDT,effectiveMarginUSDT:plan.effectiveMarginUSDT});
   this.active.set(symbol,cp.load());
   this.lastTrade={symbol,side:signal.side,orderId:String(ack.orderId),status:'PROTECTED',
    entryPrice:protectedTrade.entry.entryPrice,desiredMarginUSDT:row.marginUSDT,
    effectiveMarginUSDT:plan.effectiveMarginUSDT,quantity:plan.quantity,at:this.clock()};
   this.log(symbol,'ENTRY_PROTECTED',signal.side+' '+plan.quantity+' @'+protectedTrade.entry.entryPrice+
    ', STOP + '+protectedTrade.tps.length+' TP đã xác minh');
  }catch(e){
   if(submitted){
    this.armed=false;this.halted=true;
    this.error=symbol+' đã gửi Entry nhưng chưa xác minh bảo vệ: '+e.message;
    this.log(symbol,'HALTED',this.error+'; KHÔNG tự gửi lại');
    // If no active STOP, attempt exactly one exchange-verified reduceOnly close.
    await this.emergencyClose(symbol,clientId).catch(err=>this.log(symbol,'CRITICAL',
     'Không xác minh emergency: '+err.message));
   }else this.log(symbol,'SIGNAL_SKIPPED','Không vào lệnh: '+e.message);
  }finally{this.busy=false;}
 }
 async emergencyClose(symbol,clientId){
  if(!clientId||!this.api)return;
  const cp=safeRead(this.protectionFile(symbol));
  if(cp?.stop||cp?.inFlight)throw Error('STOP đã có/ACK chưa rõ; không đóng mù');
  const first=await this.inspect(symbol),second=await this.inspect(symbol);
  const intent=safeRead(this.intentFile(symbol));
  const entry=await this.api.get('/fapi/v1/order',{symbol,origClientOrderId:clientId});
  const qty=Math.abs(first.positionBTC);
  if(!(qty>0)||!near(qty,Math.abs(second.positionBTC))||
     first.orders.length||first.algos.length||second.orders.length||second.algos.length||
     entry?.clientOrderId!==clientId||entry?.status!=='FILLED'||
     !near(Number(entry.executedQty),qty))
   throw Error('Vị thế hoặc Entry chưa xác minh duy nhất');
  const closeId='OCCM-'+randomBytes(7).toString('hex');
  this.intent(symbol,{...intent,phase:'EMERGENCY_CLOSE_SENDING',clientId,closeId,qty});
  const ack=await this.api.post('/fapi/v1/order',{symbol,positionSide:'BOTH',
   side:first.positionBTC>0?'SELL':'BUY',type:'MARKET',reduceOnly:'true',
   quantity:String(qty),newClientOrderId:closeId,newOrderRespType:'RESULT'});
  if(!ack?.orderId||ack.status!=='FILLED')throw Error('Emergency MARKET chưa xác minh');
  const latest=await this.inspect(symbol);
  if(latest.positionBTC!==0)throw Error('Binance chưa xác nhận FLAT');
  new ProtectionCheckpoint(this.protectionFile(symbol)).save({
   phase:'IDLE',entry:null,stop:null,tps:[],inFlight:null,halted:false});
  this.intent(symbol,{phase:'CLEARED',clientId,closeId});
  this.log(symbol,'EMERGENCY_FLAT','Đã đóng reduceOnly sau khi Entry thiếu STOP');
 }
 detach(){
  this.stop();if(this.api)this.api.close();this.api=null;this.apiSource=null;
 }
 async monitorAll(){
  if(this.busy||this.monitoring||this.running||!this.active.size)return;
  this.monitoring=(async()=>{
   try{
    if(!this.legacy?.api)return; // Auto is OFF, exchange protection remains active.
    if(!this.api||this.apiSource!==this.legacy.api)await this.marketAndTransport();
    for(const [symbol,cp] of [...this.active]){
     if(cp.phase!=='PROTECTED')continue;
     try{
      const st=await this.verifiedManaged(symbol,cp).catch(async e=>{
       const first=await this.inspect(symbol);
       if(first.positionBTC!==0)throw e;
       // Flat path must not require an open protective STOP (it may have fired).
       if(first.orders.length)throw e;
       return first;
      });
      if(st.positionBTC!==0)continue;
      const again=await this.inspect(symbol);
      if(again.positionBTC!==0||again.orders.length)throw Error(symbol+' position changed while verifying FLAT');
      const known=new Map([cp.stop,...cp.tps].filter(Boolean).map(x=>[String(x.id),x]));
      if(again.algos.some(x=>!known.has(String(x.algoId))||
         x.clientAlgoId!==known.get(String(x.algoId)).clientId||!goodAlgo.has(x.algoStatus)))
       throw Error('Algo khác checkpoint; không hủy');
      for(const o of again.algos){
       this.intent(symbol,{phase:'ALGO_CLEANUP_SENDING',removingAlgoId:String(o.algoId)});
       await this.api.del('/fapi/v1/algoOrder',{symbol,algoId:o.algoId});
      }
      const clean=await this.inspect(symbol);
      if(clean.positionBTC!==0||clean.orders.length||clean.algos.length)
       throw Error('Binance còn vị thế/SL/TP sau cleanup');
      new ProtectionCheckpoint(this.protectionFile(symbol)).save({
       phase:'IDLE',entry:null,stop:null,tps:[],inFlight:null,halted:false});
      this.intent(symbol,{phase:'CLEARED'});
      this.active.delete(symbol);
      this.log(symbol,'FLAT','Binance xác nhận FLAT và dọn đủ STOP/TP OCC');
     }catch(e){
      this.armed=false;this.halted=true;
      this.error=symbol+' cần đối soát thủ công: '+e.message;
      this.log(symbol,'HALTED',this.error);
      break;
     }
    }
   }catch(e){this.armed=false;this.halted=true;this.error='Monitor đa mã: '+e.message;}
   finally{this.monitoring=null;}
  })();
  return this.monitoring;
 }
}
