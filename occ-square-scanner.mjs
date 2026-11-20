// Public USD-M perpetual OCC signal scanner. Read-only Binance market data.
// This module intentionally does NOT import the Futures execution transport.
// Only BTCUSDT live trade executor elsewhere may send Binance orders.
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {resolve} from 'node:path';
import {OCCSignalEngine,M15} from './occ-signal-engine.mjs';

const ROOT='https://fapi.binance.com';
const validSymbol=s=>typeof s==='string'&&/^[A-Z0-9]{1,20}USDT$/.test(s);
const maxAge=10*60*1000;
const limitNumber=(x,min,max,name)=>{const n=Number(x);if(!Number.isFinite(n)||n<min||n>max)throw Error(name+' không hợp lệ');return n;};
export const SCANNER_DISCLAIMER='Đây là Tín hiệu phân tích kỹ thuật, chưa phải giao dịch đã khớp.';
export const defaultScannerConfig=Object.freeze({
 enabled:false,autoPublish:false,maxDailyPosts:15,maxPerCycle:3,
 minQuoteVolumeUSDT:10000000,slPercent:0.8,tp1Percent:1.5,tp2Percent:3,tp3Percent:5
});
function validateConfig(raw){
 const c={...defaultScannerConfig,...raw};
 if(typeof c.enabled!=='boolean'||typeof c.autoPublish!=='boolean')
  throw Error('Bật/tắt Scanner không hợp lệ');
 c.maxDailyPosts=limitNumber(c.maxDailyPosts,1,20,'Số bài/ngày');
 c.maxPerCycle=limitNumber(c.maxPerCycle,1,3,'Số bài/chu kỳ');
 c.minQuoteVolumeUSDT=limitNumber(c.minQuoteVolumeUSDT,0,1000000000000,'Thanh khoản tối thiểu');
 for(const key of ['slPercent','tp1Percent','tp2Percent','tp3Percent'])
  c[key]=limitNumber(c[key],0.01,30,key);
 if(!Number.isInteger(c.maxDailyPosts)||!Number.isInteger(c.maxPerCycle)||
   !(c.slPercent<Math.min(c.tp1Percent,c.tp2Percent,c.tp3Percent))||
   !(c.tp1Percent<c.tp2Percent&&c.tp2Percent<c.tp3Percent))
  throw Error('Thiết lập SL/TP Scanner không hợp lệ');
 return c;
}
export function signalProposal(signal,config=defaultScannerConfig,quoteVolumeUSDT=0){
 const c=validateConfig(config),symbol=signal?.symbol;
 if(!validSymbol(symbol)||!['LONG','SHORT'].includes(signal?.side)||
   !Number.isSafeInteger(Number(signal.barTime))||Number(signal.barTime)%M15!==0||
   !(Number(signal.candleClose)>0)||!(Number(signal.triggerPrice)>0))
  throw Error('Tín hiệu OCC chưa xác nhận hợp lệ');
 const entry=Number(signal.candleClose),d=signal.side==='LONG'?1:-1;
 const round=n=>Number(n.toPrecision(12));
 return Object.freeze({
  key:symbol+':M15:'+signal.barTime+':'+signal.side,
  symbol,side:signal.side,barTime:Number(signal.barTime),
  at:Number(signal.barTime)+M15,
  entry:round(entry),triggerPrice:round(Number(signal.triggerPrice)),
  sl:round(entry*(1-d*c.slPercent/100)),
  tps:[c.tp1Percent,c.tp2Percent,c.tp3Percent].map(p=>round(entry*(1+d*p/100))),
  quoteVolumeUSDT:Number(quoteVolumeUSDT)||0,
  indicator:'OCC_SMMA8_H4_M15_CONFIRMED',
  isExecuted:false,source:'PUBLIC_BINANCE_KLINES'
 });
}
export class OccSquareScanner{
 constructor({dataDir,publisher,marketGet=null,clock=()=>Date.now(),concurrency=5}){
  this.path=resolve(dataDir,'occ-square-scanner.json');this.publisher=publisher;this.clock=clock;
  this.marketGet=marketGet||this.binanceGet.bind(this);
  this.concurrency=Math.max(1,Math.min(8,Math.floor(concurrency)));
  const saved=existsSync(this.path)?JSON.parse(readFileSync(this.path,'utf8')):{};
  this.config=validateConfig(saved.config||{});
  this.recentSignals=Array.isArray(saved.recentSignals)?saved.recentSignals.slice(-150):[];
  this.seen=new Set(Array.isArray(saved.seen)?saved.seen.slice(-1600):[]);
  this.engines=new Map();this.symbols=[];this.universeAt=0;this.running=null;
  this.lastBucket=null;this.lastScanAt=null;this.scanned=0;this.warmed=0;
  this.lastError=null;this.blockedUntil=0;this.lastCandidates=0;
  this.lastPostResult=null;
 }
 save(){
  if(this.seen.size>1600)this.seen=new Set([...this.seen].slice(-1600));
  mkdirSync(resolve(this.path,'..'),{recursive:true,mode:0o700});
  const tmp=this.path+'.pending';
  writeFileSync(tmp,JSON.stringify({config:this.config,recentSignals:this.recentSignals.slice(-150),
   seen:[...this.seen].slice(-1600)},null,2),{mode:0o600});
  renameSync(tmp,this.path);
 }
 configure(patch){
  if(!patch||typeof patch!=='object'||Array.isArray(patch))throw Error('Cấu hình Scanner không hợp lệ');
  const permitted=['enabled','autoPublish','maxDailyPosts','maxPerCycle','minQuoteVolumeUSDT',
   'slPercent','tp1Percent','tp2Percent','tp3Percent'];
  if(Object.keys(patch).some(key=>!permitted.includes(key)))throw Error('Trường Scanner không được hỗ trợ');
  const c=validateConfig({...this.config,...patch});
  if(c.autoPublish&&!this.publisher.keyExists())throw Error('Cần Square OpenAPI key riêng trước khi bật tự đăng');
  this.config=c;this.save();
  return this.status();
 }
 status(){
  const now=this.clock(),day=new Date(now).toISOString().slice(0,10);
  const used=this.publisher.posts.filter(p=>
   new Date(Number(p.at)).toISOString().slice(0,10)===day&&
   ['QUEUED','UPLOADING','PUBLISHING','REVIEW_REQUIRED','SENT'].includes(p.status)).length;
  return {config:this.config,running:Boolean(this.running),tracked:this.symbols.length,
   warmed:this.engines.size,scanned:this.scanned,lastScanAt:this.lastScanAt,
   lastError:this.lastError,blockedUntil:this.blockedUntil,detected:this.lastCandidates,
   dailyUsed:used,dailyRemaining:Math.max(0,this.config.maxDailyPosts-used),
   squareKeyStored:this.publisher.keyExists(),
   lastPostResult:this.lastPostResult,recentSignals:this.recentSignals.slice(-60).reverse()};
 }
 async binanceGet(path,params={}){
  const url=ROOT+path+'?'+new URLSearchParams(params).toString();
  const res=await fetch(url,{signal:AbortSignal.timeout(14000),cache:'no-store',credentials:'omit'});
  if(res.status===429||res.status===418){
   this.blockedUntil=this.clock()+30*60*1000;
   throw Error('Binance market-data rate limit '+res.status+'; Scanner tạm dừng 30 phút');
  }
  if(!res.ok)throw Error('Binance market-data '+path+' HTTP '+res.status);
  return res.json();
 }
 async refreshUniverse(){
  if(this.symbols.length&&this.clock()-this.universeAt<3*60*60*1000)return;
  const [info,tickers]=await Promise.all([
   this.marketGet('/fapi/v1/exchangeInfo'),
   this.marketGet('/fapi/v1/ticker/24hr')
  ]);
  if(!Array.isArray(info?.symbols)||!Array.isArray(tickers))
   throw Error('Không xác nhận được danh sách Binance USD-M Futures');
  const volumes=new Map(tickers.map(x=>[x.symbol,Number(x.quoteVolume)||0]));
  const symbols=info.symbols.filter(s=>s.status==='TRADING'&&s.contractType==='PERPETUAL'&&
   s.quoteAsset==='USDT'&&validSymbol(s.symbol))
   .map(s=>({symbol:s.symbol,volume:volumes.get(s.symbol)||0}))
   .sort((a,b)=>b.volume-a.volume);
  if(!symbols.length)throw Error('Không có hợp đồng USD-M Perpetual hợp lệ');
  this.symbols=symbols;this.universeAt=this.clock();
  const set=new Set(symbols.map(s=>s.symbol));
  for(const key of this.engines.keys())if(!set.has(key))this.engines.delete(key);
 }
 async symbolPass(item,now){
  const symbol=item.symbol;
  let engine=this.engines.get(symbol);
  if(!engine){
   const [h4,m15]=await Promise.all([
    this.marketGet('/fapi/v1/klines',{symbol,interval:'4h',limit:'16'}),
    this.marketGet('/fapi/v1/klines',{symbol,interval:'15m',limit:'32'})
   ]);
   if(!Array.isArray(h4)||!Array.isArray(m15))throw Error('Binance candles thiếu');
   engine=new OCCSignalEngine();
   // Initialization/backfill is NEVER a publishable live signal.
   engine.warmup(h4,m15,now);
   engine.setHealthy(true);engine.setRunning(true);
   this.engines.set(symbol,engine);
   return [];
  }
  const bars=await this.marketGet('/fapi/v1/klines',{symbol,interval:'15m',limit:'4'});
  if(!Array.isArray(bars))throw Error('Binance M15 thiếu');
  const closed=bars.filter(b=>Number(b?.[6])<now).sort((a,b)=>Number(a[0])-Number(b[0]));
  const upcoming=closed.filter(b=>Number(b[0])>engine.lastCandleTime);
  if(!upcoming.length)return [];
  if(Number(upcoming[0][0])!==engine.lastCandleTime+M15){
   // Gap: discard any delayed signals; rebuild causally next cycle.
   this.engines.delete(symbol);return [];
  }
  const out=[];
  for(const candle of upcoming){
   const signal=engine.onCandle(candle,{live:true,observedAt:now});
   if(signal?.eligible&&now-signal.time>=0&&now-signal.time<=maxAge){
    const proposal=signalProposal({...signal,symbol},this.config,item.volume);
    if(!this.seen.has(proposal.key)){
     this.seen.add(proposal.key);out.push(proposal);
    }
   }
  }
  return out;
 }
 async tick({force=false}={}){
  if(!this.config.enabled||this.clock()<this.blockedUntil)return this.status();
  if(this.running)return this.running;
  const now=this.clock(),bucket=Math.floor((now-60000)/M15);
  // Require at least 60 seconds after bar close before scanning a complete M15.
  if(!force&&(bucket<=this.lastBucket||now%M15<60000))return this.status();
  this.running=(async()=>{
   this.lastScanAt=this.clock();this.scanned=0;this.lastCandidates=0;
   try{
    await this.refreshUniverse();
    let next=0,errors=0;
    const proposals=[];
    const worker=async()=>{
     while(next<this.symbols.length&&this.config.enabled&&this.clock()>=this.blockedUntil){
      const item=this.symbols[next++];
      try{
       const found=await this.symbolPass(item,this.clock());
       proposals.push(...found);
       this.scanned++;
      }catch(e){
       errors++;if(errors<=3)this.lastError=String(e.message||e).slice(0,180);
       if(/rate limit/i.test(String(e.message||'')))break;
      }
     }
    };
    await Promise.all(Array.from({length:this.concurrency},()=>worker()));
    this.lastCandidates=proposals.length;
    this.warmed=this.engines.size;
    for(const s of proposals){
     this.recentSignals.push({...s,publishStatus:'DETECTED'});
    }
    this.recentSignals=this.recentSignals.slice(-150);
    // Prefer volume + freshness for public posts, not any profitability claim.
    const qualified=proposals.filter(x=>x.quoteVolumeUSDT>=this.config.minQuoteVolumeUSDT)
     .sort((a,b)=>b.quoteVolumeUSDT-a.quoteVolumeUSDT);
    if(this.config.autoPublish&&this.publisher.keyExists()){
     let slots=Math.min(this.config.maxPerCycle,this.status().dailyRemaining);
     for(const s of qualified){
      if(!this.config.enabled||!this.config.autoPublish||slots<=0)break;
      if(this.clock()-s.at>maxAge)continue;
      const result=await this.publisher.onSignal(s);
      const row=this.recentSignals.find(x=>x.key===s.key);
      if(row)row.publishStatus=result.status||result.error||'SKIPPED';
      this.lastPostResult={symbol:s.symbol,at:this.clock(),status:result.status||'REVIEW_REQUIRED'};
      if(result.status==='SENT'||result.status==='REVIEW_REQUIRED')slots--;
     }
    }
    this.lastError=errors?'Không đọc được '+errors+' mã / '+this.symbols.length+
     (this.lastError?' · '+this.lastError:''):null;
    this.lastBucket=bucket;this.save();
   }catch(e){this.lastError=String(e.message||e).slice(0,240);this.save();}
   finally{this.running=null;}
   return this.status();
  })();
  return this.running;
 }
}
