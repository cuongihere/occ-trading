// BTCUSDT Futures only. Paper Trading and all paper order endpoints removed.
import {createServer} from 'node:http';
import {mkdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {OCCSignalEngine} from './occ-signal-engine.mjs';
import {BinanceFeed} from './server-feed.mjs';
import {BtcMarketQuote} from './btc-market-quote.mjs';
import {readLiveReport} from './binance-live-stats.mjs';
import {buildOCCChartComparison,readVerifiedChartFills} from './futures-chart-compare.mjs';
import {BrowserFutures} from './futures-browser-service.mjs';
import {SquarePublisher} from './square-publisher.mjs';

const args=new Set(process.argv.slice(2));
if(args.has('--help')){console.log('node server.mjs | BTCUSDT Futures only | DATA_DIR and PORT optional');process.exit(0);}
if(args.size)throw Error('Unknown argument. Paper Trading has been removed.');
const dir=resolve(process.env.DATA_DIR||'./data');mkdirSync(dir,{recursive:true,mode:0o700});
const lock=new DatabaseSync(resolve(dir,'runner-lock.sqlite'));
try{lock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE; CREATE TABLE IF NOT EXISTS lock_owner(id INTEGER);');}
catch{console.error('Another OCC Futures process owns this data directory.');process.exit(1);}
const browserFutures=new BrowserFutures({dataDir:dir});
const liveSignalEngine=new OCCSignalEngine();
const btcMarketQuote=new BtcMarketQuote();
const square=new SquarePublisher({dataDir:dir,fetchKlines:async({filledAt,limit=96})=>{
 const params=new URLSearchParams({symbol:'BTCUSDT',interval:'15m',
  endTime:String(Math.floor(Number(filledAt)+60000)),limit:String(Math.min(150,limit))});
 const result=await fetch('https://fapi.binance.com/fapi/v1/klines?'+params,{
  signal:AbortSignal.timeout(12000),cache:'no-store'});
 if(!result.ok)throw Error('Binance chart data HTTP '+result.status);
 const data=await result.json();
 if(!Array.isArray(data)||data.length<24)throw Error('Binance candle history incomplete');
 return data;
}});
browserFutures.setSquarePublisher(square);
let closing=false,status={state:'starting',message:'Synchronizing Binance Futures'};
function statusEvent(s){
 status=s;if(closing)return;
 liveSignalEngine.setHealthy(s.state==='live');
 if(s.state!=='live')liveSignalEngine.setRunning(false);
 else if(liveSignalEngine.ready)liveSignalEngine.setRunning(true);
 console.log(new Date().toISOString(),s.state,s.message);
}
const feed=new BinanceFeed({
 onStatus:statusEvent,
 onReady(p){
  liveSignalEngine.warmup(p.h4,p.m15,p.now);
  liveSignalEngine.setHealthy(false);liveSignalEngine.setRunning(false);
 },
 onCandle(bar,opts){
  const signal=liveSignalEngine.onCandle(bar,opts);
  if(signal?.eligible&&opts.live&&feed.healthy()&&browserFutures.armed)
   browserFutures.signal(signal,true,
    ()=>btcMarketQuote.snapshot({healthy:feed.healthy(),state:feed.state}))
    .catch(e=>console.error('Futures AUTO:',e.message));
 },
 onTrade(t){btcMarketQuote.updateTrade(t);},
 onMark(m){btcMarketQuote.updateMark(m);}
});
const binancePreviewHtml=readFileSync(new URL('./BINANCE_UI_PREVIEW.html',import.meta.url),'utf8');
const comparisonHtml=readFileSync(new URL('./OCC_COMPARE.html',import.meta.url),'utf8');
const tradingViewReferenceHtml=readFileSync(new URL('./OCC_TV_WIDGET.html',import.meta.url),'utf8');
let compareCandleCache=null,compareCandleTask=null;
async function getComparisonCandles(){
 const now=Date.now();
 if(compareCandleCache&&compareCandleCache.expiresAt>now)return compareCandleCache;
 if(compareCandleTask)return compareCandleTask;
 compareCandleTask=(async()=>{
  const get=async interval=>{
   const url='https://fapi.binance.com/fapi/v1/klines?symbol=BTCUSDT&interval='+
    encodeURIComponent(interval)+'&limit='+(interval==='4h'?500:1000);
   const response=await fetch(url,{signal:AbortSignal.timeout(12000),cache:'no-store'});
   if(!response.ok)throw Error('Binance candles HTTP '+response.status+' ('+interval+')');
   const data=await response.json();
   if(!Array.isArray(data)||data.length<50)throw Error('Binance '+interval+' candles incomplete');
   return data;
  };
  const [h4,m15]=await Promise.all([get('4h'),get('15m')]);
  compareCandleCache={h4,m15,expiresAt:Date.now()+45000};
  return compareCandleCache;
 })();
 try{return await compareCandleTask;}
 finally{compareCandleTask=null;}
}
async function readChartComparison(){
 const {h4,m15}=await getComparisonCandles();
 const model=buildOCCChartComparison({h4,m15,
  fills:readVerifiedChartFills(resolve(dir,'binance-live-stats.sqlite')),
  settings:browserFutures.config,now:Date.now()});
 // A second independent, exchange-signed read-only source gives the current
 // real STOP and TP levels. Never plot guessed SL/TP from the saved config
 // as though they were Binance live orders.
 let livePosition=null,liveReadbackError=null;
 if(browserFutures.api&&!browserFutures.busy){
  try{
   const current=await browserFutures.positionAnalysis();
   if(current.status==='open'){
    const owned=current.ownershipVerified===true;
    livePosition={verified:owned,fetchedAt:current.fetchedAt,
     side:current.position?.side||null,
     quantityBTC:current.position?.quantityBTC||null,
     entryPrice:owned?current.position?.entryPrice:null,
     levels:owned?(current.levels||[]).filter(x=>x.confirmed===true&&
      ['BOT_ĐANG_QUẢN_LÝ','KHỚP_CHECKPOINT'].includes(x.origin)&&
      Number.isFinite(Number(x.price))&&Number(x.price)>0).map(x=>({
       role:/-(SL|TP[123])$/.exec(String(x.clientId||''))?.[1]||x.role,
       price:x.price,quantityBTC:x.quantityBTC,
       algoId:x.id,status:x.status,origin:x.origin})):[]
    };
    if(!owned)liveReadbackError='Vị thế Binance chưa đối chiếu đủ OCC Algo ID; không vẽ SL/TP chưa xác minh.';
   }
  }catch(e){liveReadbackError='Không đọc được SL/TP hiện tại: '+e.message;}
 }
 return {...model,livePosition,liveReadbackError};
}
const server=createServer(async(req,res)=>{
 const host=req.headers.host||'';if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(host)){res.writeHead(403);return res.end('Local host required');}
 if(req.method==='POST'&&req.url.startsWith('/control/')){
  res.setHeader('Content-Type','application/json');
  if(req.headers.origin!==`http://${host}`||req.headers['x-occ-local']!=='1'){res.writeHead(403);return res.end(JSON.stringify({error:'Local origin required'}));}
  try{let body='';for await(const chunk of req){body+=chunk;if(body.length>4096)throw Error('Request too large');}const p=JSON.parse(body||'{}');
   if(req.url==='/control/live/connect'){
    // Credentials are not logged, journaled, cached or stored in the browser.
    await browserFutures.connect({apiKey:p.apiKey,apiSecret:p.apiSecret,environment:'production',remember:p.remember!==false});
   }
   else if(req.url==='/control/live/validate'){
    const quote=btcMarketQuote.snapshot({healthy:feed.healthy(),state:feed.state});
    return res.end(JSON.stringify(browserFutures.sizingPreview(p,quote.lastPrice)));
   }
   else if(req.url==='/control/live/config'){
    const quote=btcMarketQuote.snapshot({healthy:feed.healthy(),state:feed.state});
    const preview=browserFutures.sizingPreview(p,quote.lastPrice);
    if(preview.status==='invalid')throw Error(preview.message);
    browserFutures.saveConfig(p);
   }
   else if(req.url==='/control/live/reverse-mode'){browserFutures.setReverseOnSignal(p.enabled);}
   else if(req.url==='/control/live/leverage'){await browserFutures.applyExchangeLeverage(p);}
   else if(req.url==='/control/live/on'){
    if(!feed.healthy()||!liveSignalEngine.ready||!liveSignalEngine.healthy)
     throw Error('Cần dữ liệu Binance liên tục và nến OCC đã đồng bộ trước khi bật Auto');
    const quote=btcMarketQuote.snapshot({healthy:feed.healthy(),state:feed.state});
    await browserFutures.arm(p.acceptance,quote.lastPrice);
   }
   else if(req.url==='/control/live/off'){
    browserFutures.disarm();
    if(browserFutures.pendingLimit)await browserFutures.cancelOpenLimit();
   }
   else if(req.url==='/control/live/limit-cancel'){
    browserFutures.disarm();
    if(!browserFutures.pendingLimit)throw Error('Không có LIMIT OCC đang chờ');
    await browserFutures.cancelOpenLimit();
   }
   else if(req.url==='/control/live/manual-exit'){
    return res.end(JSON.stringify(await browserFutures.manualMarketExit(p)));
   }
   else if(req.url==='/control/live/reconcile'){await browserFutures.checkBinanceAndReconcile();}
   else if(req.url==='/control/live/protection-repair'){
    return res.end(JSON.stringify(await browserFutures.repairMissingProtection(p)));
   }
   else if(req.url==='/control/live/history-refresh'){await browserFutures.refreshRealHistory({force:true});}
   else if(req.url==='/control/live/disconnect'){browserFutures.close();}
   else if(req.url==='/control/live/forget'){browserFutures.forgetSavedCredentials();}
   else if(req.url==='/control/live/square/key'){square.connect(p.key);}
   else if(req.url==='/control/live/square/on'){square.toggle(p.enabled);}
   else if(req.url==='/control/live/square/forget'){square.forget();}
   else throw Error('Unknown action');res.end(JSON.stringify({ok:true}));
  }catch(e){res.writeHead(400);res.end(JSON.stringify({error:e.message}));}return;
 }
 if(req.method!=='GET'){res.writeHead(405);return res.end('Read-only');}
 if(req.headers.origin&&!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.origin)){res.writeHead(403);return res.end('Local read-only access only');}
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.url==='/'){res.writeHead(302,{Location:'/binance'});return res.end();}
 if(req.url==='/binance'){res.setHeader('Content-Type','text/html;charset=utf-8');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'");return res.end(binancePreviewHtml);}
 if(req.url.startsWith('/occ-compare')){
  res.setHeader('Content-Type','text/html;charset=utf-8');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; object-src 'none'");
  return res.end(comparisonHtml);
 }
 if(req.url==='/occ-tradingview-widget'){
  res.setHeader('Content-Type','text/html;charset=utf-8');
  // Load the official widget only inside a sandboxed, opaque-origin iframe.
  // No access to parent DOM or OCC trade APIs/credentials.
  res.setHeader('Content-Security-Policy',
   "default-src 'none'; script-src https://s3.tradingview.com; style-src 'unsafe-inline'; "+
   "img-src https: data:; font-src https: data:; frame-src https:; connect-src https: wss:; object-src 'none'");
  return res.end(tradingViewReferenceHtml);
 }
 if(req.url==='/api/binance/occ-chart-compare'){
  res.setHeader('Content-Type','application/json;charset=utf-8');
  try{return res.end(JSON.stringify(await readChartComparison()));}
  catch(e){res.writeHead(503);return res.end(JSON.stringify({error:'Chart chỉ đọc: '+e.message}));}
 }
 if(req.url==='/api/binance/market'){res.setHeader('Content-Type','application/json;charset=utf-8');return res.end(JSON.stringify(btcMarketQuote.snapshot({healthy:feed.healthy(),state:feed.state})));}
if(req.url==='/api/binance/live-status'){res.setHeader('Content-Type','application/json;charset=utf-8');return res.end(JSON.stringify({...browserFutures.snapshot(),marketHealthy:feed.healthy(),marketState:feed.state}));}
 if(req.url==='/api/binance/protection-repair-preview'){
  res.setHeader('Content-Type','application/json;charset=utf-8');
  try{return res.end(JSON.stringify(await browserFutures.inspectProtectionRepair()));}
  catch(e){res.writeHead(409);return res.end(JSON.stringify({status:'blocked',message:e.message}));}
 }
 if(req.url==='/api/binance/position-analysis'){
  res.setHeader('Content-Type','application/json;charset=utf-8');
  try{
   const quote=btcMarketQuote.snapshot({healthy:feed.healthy(),state:feed.state});
   return res.end(JSON.stringify(await browserFutures.positionAnalysis({
    referencePrice:quote.live===true?quote.lastPrice:null
   })));
  }
  catch(e){res.writeHead(503);return res.end(JSON.stringify({status:'unavailable',message:e.message}));}
 }
 if(req.url==='/api/binance/live-report'){res.setHeader('Content-Type','application/json;charset=utf-8');return res.end(JSON.stringify(readLiveReport(resolve(dir,'binance-live-stats.sqlite'))));}
 if(req.url==='/api/square/status'){
  res.setHeader('Content-Type','application/json;charset=utf-8');
  return res.end(JSON.stringify(square.status()));
 }
 if(req.url==='/api/square/latest-chart.png'){
  const image=square.latestImage();
  if(!image){res.writeHead(404);return res.end('No Binance Square chart has been prepared');}
  res.setHeader('Content-Type','image/png');return res.end(image);
 }
 res.writeHead(404);res.end('Not found');
});
server.on('error',error=>{console.error(error.message);shutdown(1);});
const port=Number(process.env.PORT||8080);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid PORT');
const futuresMonitor=setInterval(()=>browserFutures.monitor().catch(e=>console.error('Futures position monitor:',e.message)),15000);futuresMonitor.unref();
const limitMonitor=setInterval(()=>browserFutures.pollLimit().catch(e=>console.error('LIMIT BTC monitor:',e.message)),2500);limitMonitor.unref();
const accountRefresh=setInterval(()=>browserFutures.refreshAccountOverview().catch(e=>{
  console.error('Futures account refresh:',e.message);
}),25000);accountRefresh.unref();
const liveHistoryRefresh=setInterval(()=>browserFutures.refreshRealHistory()
 .catch(e=>console.error('Binance OCC history:',e.message)),60000);
liveHistoryRefresh.unref();
server.listen(port,'127.0.0.1',()=>{
 console.log('BTCUSDT Futures http://127.0.0.1:'+port+'/binance; AUTO OFF by default');
 browserFutures.restoreSavedConnection().catch(e=>console.error('Saved Binance credentials:',e.message));
 feed.connect();
});
function shutdown(code=0){
 if(closing)return;closing=true;
 clearInterval(futuresMonitor);clearInterval(limitMonitor);clearInterval(accountRefresh);clearInterval(liveHistoryRefresh);
 try{browserFutures.close();}catch{}
 try{feed.disconnect();}catch{}
 try{lock.close();}catch{}
 server.close();process.exitCode=code;setTimeout(()=>process.exit(code),100).unref();
}
process.once('SIGINT',()=>shutdown());process.once('SIGTERM',()=>shutdown());
