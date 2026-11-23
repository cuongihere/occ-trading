// Unified multi-symbol Futures workbench. Paper Trading and all paper endpoints removed.
import {createServer} from 'node:http';
import {mkdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {OCCSignalEngine} from './occ-signal-engine.mjs';
import {BinanceFeed} from './server-feed.mjs';
import {BtcMarketQuote} from './btc-market-quote.mjs';
import {readLiveReport} from './binance-live-stats.mjs';
import {buildOCCChartComparison,readVerifiedChartHistory} from './futures-chart-compare.mjs';
import {BrowserFutures} from './futures-browser-service.mjs';
import {SquarePublisher} from './square-publisher.mjs';
import {UnifiedPortfolio,validSymbol} from './unified-portfolio.mjs';

const args=new Set(process.argv.slice(2));
if(args.has('--help')){console.log('node server.mjs | BTCUSDT Futures only | DATA_DIR and PORT optional');process.exit(0);}
if(args.size)throw Error('Unknown argument. Paper Trading has been removed.');
const dir=resolve(process.env.DATA_DIR||'./data');mkdirSync(dir,{recursive:true,mode:0o700});
const lock=new DatabaseSync(resolve(dir,'runner-lock.sqlite'));
try{lock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE; CREATE TABLE IF NOT EXISTS lock_owner(id INTEGER);');}
catch{console.error('Another OCC Futures process owns this data directory.');process.exit(1);}
const browserFutures=new BrowserFutures({dataDir:dir});
const portfolio=new UnifiedPortfolio({dataDir:dir,btc:browserFutures});
const liveSignalEngine=new OCCSignalEngine();
const btcMarketQuote=new BtcMarketQuote();
const square=new SquarePublisher({dataDir:dir,fetchKlines:async({symbol='BTCUSDT',filledAt,limit=96})=>{
 if(symbol!=='BTCUSDT')throw Error('Only BTCUSDT Square posts permitted');
 const params=new URLSearchParams({symbol,interval:'15m',
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
   portfolio.handleSignal('BTCUSDT',signal,true,
    ()=>btcMarketQuote.snapshot({healthy:feed.healthy(),state:feed.state}))
    .catch(e=>console.error('Futures AUTO:',e.message));
 },
 onTrade(t){btcMarketQuote.updateTrade(t);},
 onMark(m){btcMarketQuote.updateMark(m);}
});
const binancePreviewHtml=readFileSync(new URL('./BINANCE_UI_PREVIEW.html',import.meta.url),'utf8');
const comparisonHtml=readFileSync(new URL('./OCC_COMPARE.html',import.meta.url),'utf8');
const tradingViewReferenceHtml=readFileSync(new URL('./OCC_TV_WIDGET.html',import.meta.url),'utf8');
// Public Binance Futures candles; chart endpoints remain GET/read-only.
const compareCandleCache=new Map(),compareCandleTasks=new Map();
const assertConfiguredSymbol=value=>{
 const symbol=String(value||'BTCUSDT').toUpperCase();
 if(!validSymbol(symbol)||!portfolio.get(symbol))throw Error('Coin chưa được thêm vào OCC Workbench');
 return symbol;
};
const DAY=86400000,M15=900000,H4=14400000;
const CHART_DAYS=new Set([1,3,7,14,30]);
export const chartDaysParam=value=>{
 const d=Number(value);
 if(!Number.isSafeInteger(d)||!CHART_DAYS.has(d))
  throw Error('Unsupported chart range. Choose 1, 3, 7, 14 or 30 days.');
 return d;
};
async function getComparisonCandles(days=7,symbol='BTCUSDT'){
 const now=Date.now(),cacheKey=symbol+':'+days,cache=compareCandleCache.get(cacheKey);
 if(cache&&cache.expiresAt>now)return cache;
 if(compareCandleTasks.has(cacheKey))return compareCandleTasks.get(cacheKey);
 const task=(async()=>{
  const start=Math.floor((now-days*DAY)/M15)*M15;
  const get=async(interval,params)=>{
   const url='https://fapi.binance.com/fapi/v1/klines?'+
    new URLSearchParams({symbol,interval,...params}).toString();
   const response=await fetch(url,{signal:AbortSignal.timeout(12000),cache:'no-store'});
   if(!response.ok)throw Error('Binance candles '+interval+' HTTP '+response.status);
   const data=await response.json();
   if(!Array.isArray(data))throw Error('Binance '+interval+' candles malformed');
   return data;
  };
  const h4=get('4h',{startTime:String(start-12*H4),endTime:String(now),limit:'300'});
  const m15=[],ids=new Set();
  let cursor=start;
  for(let page=0;page<6&&cursor<=now;page++){
   const batch=await get('15m',{startTime:String(cursor),endTime:String(now),limit:'1000'});
   if(!batch.length)throw Error('Binance M15 history missing near '+new Date(cursor).toISOString());
   let prev=cursor-M15;
   for(const bar of batch){
    const t=Number(bar?.[0]);
    if(!Number.isSafeInteger(t)||t<cursor||t<=prev||ids.has(t))
     throw Error('Invalid or duplicate Binance M15 kline');
    ids.add(t);m15.push(bar);prev=t;
   }
   cursor=prev+M15;
   if(batch.length<1000)break;
  }
  const h=await h4;
  if(h.length<20||m15.length<50)
   throw Error('Not enough Binance M15/H4 history for OCC chart');
  const last=Number(m15.at(-1)?.[0]);
  if(last<now-3*M15)throw Error('Stale Binance M15 chart history');
  const result={h4:h,m15,days,expiresAt:Date.now()+45000};
  compareCandleCache.set(cacheKey,result);
  return result;
 })();
 compareCandleTasks.set(cacheKey,task);
 try{return await task;}finally{compareCandleTasks.delete(cacheKey);}
}
async function readChartComparison(days=7,symbol='BTCUSDT'){
 const {h4,m15}=await getComparisonCandles(days,symbol),now=Date.now();
 const session=portfolio.get(symbol);if(!session)throw Error('Unknown chart symbol');
 const saved=readVerifiedChartHistory(session.ledgerPath,now-30*DAY);
 const model=buildOCCChartComparison({h4,m15,
  fills:saved.fills,signalLinks:saved.signalLinks,
  settings:session.config,now,symbol});
 // A second independent, exchange-signed read-only source gives the current
 // real STOP and TP levels. Never plot guessed SL/TP from the saved config
 // as though they were Binance live orders.
 let livePosition=null,liveReadbackError=null;
 if(session.api&&!session.busy){
  try{
   const current=await session.positionAnalysis();
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
   if(req.url.startsWith('/control/unified/')){
    const action=req.url.slice('/control/unified/'.length);
    const symbol=action==='add'?String(p.symbol||'').trim().toUpperCase():
     ['on-all','off-all'].includes(action)?'BTCUSDT':assertConfiguredSymbol(p.symbol);
    let result;
    if(action==='add')result=await portfolio.add(symbol);
    else if(action==='remove')result=await portfolio.remove(symbol);
    else if(action==='select')result=portfolio.select(symbol,p.enabled);
    else if(action==='config')result=portfolio.configure(symbol,p.config);
    else if(action==='on')result=await portfolio.enable(symbol,p.confirmation);
    else if(action==='off')result=await portfolio.disable(symbol);
    else if(action==='on-all')result=await portfolio.enableSelected(p.confirmation);
    else if(action==='off-all')result=await portfolio.disableAll();
    else if(action==='leverage')result=await portfolio.get(symbol).applyExchangeLeverage({
     requestedLeverage:p.requestedLeverage,confirmation:'SYNC_'+symbol+'_LEVERAGE'
    });
    else if(action==='reconcile')result=await portfolio.get(symbol).checkBinanceAndReconcile();
    else if(action==='history-refresh')result=await portfolio.get(symbol).refreshRealHistory({force:true});
    else if(action==='manual-exit')result=await portfolio.get(symbol).manualMarketExit(p);
    else if(action==='protection-repair')result=await portfolio.get(symbol).repairMissingProtection(p);
    else throw Error('Unknown unified action');
    return res.end(JSON.stringify({ok:true,result}));
   }
   else if(req.url==='/control/live/connect'){
    // Credentials are not logged, journaled, cached or stored in the browser.
    await browserFutures.connect({apiKey:p.apiKey,apiSecret:p.apiSecret,environment:'production',remember:p.remember!==false});
    await portfolio.connectPeers();
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
   else if(req.url==='/control/live/reverse-mode'){
    browserFutures.setReverseOnSignal(p.enabled);
   }
   else if(req.url==='/control/live/leverage'){
    await browserFutures.applyExchangeLeverage(p);
   }
   else if(req.url==='/control/live/on'){
    if(!feed.healthy()||!liveSignalEngine.ready||!liveSignalEngine.healthy)
     throw Error('Cần dữ liệu Binance liên tục và nến OCC đã đồng bộ trước khi bật Auto');
    const quote=btcMarketQuote.snapshot({healthy:feed.healthy(),state:feed.state});
    await portfolio.inspectPeers('BTCUSDT');
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
   else if(req.url==='/control/live/disconnect'){
    await portfolio.detach();browserFutures.close();
   }
   else if(req.url==='/control/live/forget'){
    await portfolio.detach();browserFutures.forgetSavedCredentials();
   }
   else if(req.url==='/control/live/square/key'){square.connect(p.key);}
   else if(req.url==='/control/live/square/on'){square.toggle(p.enabled);}
   else if(req.url==='/control/live/square/forget'){
    square.forget();
   }
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
 if(new URL(req.url,'http://localhost').pathname==='/api/unified/status'){
  res.setHeader('Content-Type','application/json;charset=utf-8');
  return res.end(JSON.stringify(portfolio.status()));
 }
 if(new URL(req.url,'http://localhost').pathname.startsWith('/api/unified/')){
  res.setHeader('Content-Type','application/json;charset=utf-8');
  try{
   const u=new URL(req.url,'http://localhost'),symbol=assertConfiguredSymbol(u.searchParams.get('symbol'));
   const session=portfolio.get(symbol);
   if(u.pathname==='/api/unified/position')return res.end(JSON.stringify(await session.positionAnalysis()));
   if(u.pathname==='/api/unified/report'){
    if(symbol!=='BTCUSDT'&&session.api)await session.refreshRealHistory();
    return res.end(JSON.stringify({symbol,...readLiveReport(session.ledgerPath)}));
   }
   if(u.pathname==='/api/unified/quote')return res.end(JSON.stringify({
    symbol,price:await portfolio.quote(symbol),at:Date.now()
   }));
   if(u.pathname==='/api/unified/sizing')return res.end(JSON.stringify(
    session.sizingPreview(session.config,await portfolio.quote(symbol))));
   throw Error('Unknown unified API');
  }catch(e){res.writeHead(409);return res.end(JSON.stringify({error:e.message}));}
 }
 if(new URL(req.url,'http://localhost').pathname==='/api/binance/occ-chart-compare'){
  res.setHeader('Content-Type','application/json;charset=utf-8');
  try{
   const range=new URL(req.url,'http://localhost').searchParams.get('days')||'7';
   const sym=assertConfiguredSymbol(new URL(req.url,'http://localhost').searchParams.get('symbol'));
   return res.end(JSON.stringify(await readChartComparison(chartDaysParam(range),sym)));
  }catch(e){res.writeHead(503);return res.end(JSON.stringify({error:'Chart chỉ đọc: '+e.message}));}
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
