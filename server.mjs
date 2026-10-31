import {createServer} from 'node:http';
import {mkdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {OCCEngine} from './engine.mjs';
import {Store} from './store.mjs';
import {summarize} from './stats.mjs';
import {BinanceFeed} from './server-feed.mjs';
import {readLiveReport} from './binance-live-stats.mjs';
const args=new Set(process.argv.slice(2));
if(args.has('--help')){console.log('node server.mjs [--simulate]\nDefault: data collection only. --simulate explicitly enables paper simulation after synchronization. Dashboard localhost:8080. DATA_DIR and PORT optional. No keys/accounts/orders.');process.exit(0);}
if([...args].some(x=>x!=='--simulate'))throw Error('Unknown argument; use --help');
const dir=resolve(process.env.DATA_DIR||'./data');mkdirSync(dir,{recursive:true,mode:0o700});
// A separate SQLite exclusive transaction is a crash-safe, OS-released single-process lock.
const lock=new DatabaseSync(resolve(dir,'runner-lock.sqlite'));
try{lock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE; CREATE TABLE IF NOT EXISTS lock_owner(id INTEGER);');}
catch{console.error('Another collector owns this data directory. Refusing concurrent simulation.');process.exit(1);}
const store=new Store(resolve(dir,'occ.sqlite'));
const saved=store.load(),previousEvent=store.lastEvent();
let engine=saved?OCCEngine.restore(saved):new OCCEngine();
let simulate=Boolean(args.has('--simulate')||saved?.tradingEnabled||(!Object.hasOwn(saved||{},'tradingEnabled')&&saved?.running));
if(engine.config.exitMode!=='Multi TP v5')simulate=false;
engine.tradingEnabled=simulate;
let status={state:'starting',message:'Synchronizing real Binance data'},
 lastMark=null,lastObserved=null,lastPriceCommit=0,closing=false;
function commit(type,payload,exchangeAt=null,receivedAt=Date.now(),mutate=()=>{}){
 const before=engine.serialize();
 try {
  const runningBefore=engine.running;
  mutate();
  const p={...payload};
  if(runningBefore!==engine.running||type==='process_start'||type==='process_stop'){
   p.activity={running:engine.running,reason:
    type==='process_start'?'Khởi động và đồng bộ nguồn giá':
    type==='process_stop'?'Ứng dụng đã tắt':
    type==='user_pause'?'Người dùng tạm dừng':
    type==='user_start'?'Người dùng bắt đầu mô phỏng':
    type==='status'?(status.message||'Nguồn giá không sẵn sàng'):type};
  }
  const checkpoint=engine.serialize();checkpoint.history=[];
  store.commit({type,exchangeAt,receivedAt,payload:p},checkpoint);
 }catch(error){
  engine=OCCEngine.restore(before);
  console.error('Durability failure; refusing further paper events:',error.message);
  shutdown(1);throw error;
 }
}
function statusEvent(s){
 status=s;if(closing)return;
 commit('status',s,null,Date.now(),()=>{
  engine.setHealthy(s.state==='live');
  if(s.state!=='live')engine.setRunning(false);
  else if(simulate&&engine.ready&&engine.config.exitMode==='Multi TP v5')engine.setRunning(true);
 });
 console.log(new Date().toISOString(),s.state,s.message);
}
const feed=new BinanceFeed({
 onStatus:statusEvent,
 onReady(p){commit('warmup',p,p.now,Date.now(),()=>{for(const [k,v]of Object.entries({qtyStep:p.stepSize,minQty:p.minQty,minNotional:p.minNotional,tickSize:p.tickSize}))if(Number.isFinite(v)&&v>0)engine.config[k]=v;engine.warmup(p.h4,p.m15,p.now);engine.setRunning(false);engine.setHealthy(false);});},
 onCandle(bar,opts){commit('candle',{bar,opts},opts.exchangeAt??opts.observedAt,opts.receivedAt??Date.now(),()=>engine.onCandle(bar,opts));},
 onTrade(t){lastObserved=t.receivedAt??Date.now();const due=engine.pending||engine.exitTrigger(t.price)||Date.now()-lastPriceCommit>=1000;
  if(!due)return;lastPriceCommit=Date.now();const healthy=feed.healthy();commit(engine.pending||engine.exitTrigger(t.price)?'execution_candidate':'price_sample',{trade:t,healthy},t.time,lastObserved,()=>engine.onTrade(t,healthy));
 },
 onMark(m){lastMark=m;},
});
// Always persist the offline interval BEFORE starting a new process record. If the
// prior process crashed, the last durable event is only an estimated start boundary.
const bootTime=Date.now();
if(previousEvent){
 const approximate=previousEvent.type!=='process_stop';
 if(bootTime>=previousEvent.time)
  commit('offline_interval',{from:previousEvent.time,to:bootTime,
   reason:approximate?'Mất kết nối tiến trình hoặc đóng đột ngột (ước tính từ nhật ký cuối)':'Ứng dụng đã tắt',
   approximate},null,bootTime);
}
commit('process_start',{simulate,pid:process.pid,version:2,initialState:engine.serialize()},null,bootTime);
const html=readFileSync(new URL('./dashboard.html',import.meta.url),'utf8');
const binancePreviewHtml=readFileSync(new URL('./BINANCE_UI_PREVIEW.html',import.meta.url),'utf8');
const server=createServer(async(req,res)=>{
 const host=req.headers.host||'';if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(host)){res.writeHead(403);return res.end('Local host required');}
 if(req.method==='POST'&&req.url.startsWith('/control/')){
  res.setHeader('Content-Type','application/json');
  if(req.headers.origin!==`http://${host}`||req.headers['x-occ-local']!=='1'){res.writeHead(403);return res.end(JSON.stringify({error:'Local origin required'}));}
  try{let body='';for await(const chunk of req){body+=chunk;if(body.length>4096)throw Error('Request too large');}const p=JSON.parse(body||'{}');
   if(req.url==='/control/start'){if(engine.config.exitMode!=='Multi TP v5')throw Error('Phiên cũ không dùng Multi TP v5. Hãy tạo phiên mới để chuyển chế độ.');if(!feed.healthy()||!engine.ready)throw Error('Chưa có dữ liệu Binance liên tục. Kết nối lại trước.');commit('user_start',{},null,Date.now(),()=>{engine.setHealthy(true);engine.setRunning(true);engine.tradingEnabled=true;});simulate=true;}
   else if(req.url==='/control/pause'){simulate=false;commit('user_pause',{},null,Date.now(),()=>{engine.setRunning(false);engine.tradingEnabled=false;});}
   else if(req.url==='/control/connect'){commit('feed_reconnect',{},null,Date.now(),()=>engine.setRunning(false));feed.connect();}
   else if(req.url==='/control/configure'){
    if(engine.running||engine.position)throw Error('Tạm dừng và đóng hết vị thế trước khi sửa thông số.');
    if(Object.hasOwn(p,'capital')&&Number(p.capital)!==engine.config.capital)throw Error('Không thay vốn ban đầu trên tài khoản liên tục.');
    commit('user_configure',{settings:p},null,Date.now(),()=>{engine.configure(p);});
    simulate=false;
   }
   else if(req.url==='/control/reset')throw Error('Đã bỏ tạo phiên mới. Hãy dùng Lưu cấu hình Multi TP để giữ lịch sử, số dư và tổng P&L.');
   else throw Error('Unknown action');res.end(JSON.stringify({ok:true}));
  }catch(e){res.writeHead(400);res.end(JSON.stringify({error:e.message}));}return;
 }
 if(req.method!=='GET'){res.writeHead(405);return res.end('Read-only');}
 if(req.headers.origin&&!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.origin)){res.writeHead(403);return res.end('Local read-only access only');}
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 if(req.url==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');return res.end(html);}
 if(req.url==='/binance'){res.setHeader('Content-Type','text/html;charset=utf-8');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'");return res.end(binancePreviewHtml);}
 if(req.url==='/api/binance/live-report'){res.setHeader('Content-Type','application/json;charset=utf-8');return res.end(JSON.stringify(readLiveReport(resolve(dir,'binance-live-stats.sqlite'))));}
 if(req.url==='/api/state'){const s=engine.snapshot();res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({mode:simulate?'paper_enabled':'collect_only',status,lastObservedUTC:lastObserved?new Date(lastObserved).toISOString():null,lastTrade:s.lastPrice,markPrice:lastMark?.price??null,balance:s.balance,equity:s.equity,unrealized:s.unrealized,fees:s.fees,funding:'EXCLUDED',position:s.position,levels:s.levels,capital:s.config.capital,config:s.config,trades:s.trades,signals:s.signals,signalCount:s.signals.length,fillCount:s.trades.length,running:s.running,tradingEnabled:engine.tradingEnabled,healthy:feed.healthy(),ready:s.ready,session:s.sessionId}));}
 const url=new URL(req.url,'http://localhost');
 if(url.pathname==='/api/activity'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(store.activity()));}
 if(url.pathname==='/api/sessions'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(store.sessions()));}
 if(['/api/report','/positions.csv','/trades.csv','/signals.json'].includes(url.pathname)){
  const selected=url.searchParams.get('session')||'all';
  if(selected!=='all'&&!store.sessions().some(x=>x.id===selected)){res.writeHead(404);return res.end(JSON.stringify({error:'Unknown session'}));}
  const records=store.snapshotRecords(),matches=x=>selected==='all'||(x.signalId||x.id).split(':')[0]===selected;
  const fills=records.fills.filter(matches),signals=records.signals.filter(matches);
  const result=summarize(fills);result.summary.allFees=fills.reduce((sum,f)=>sum+f.fee,0);result.currentSessionId=engine.sessionId;
  if(url.pathname==='/api/report'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(result));}
  if(url.pathname==='/signals.json'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(signals));}
  const positions=url.pathname==='/positions.csv',rows=positions?result.positions:fills;
  const cols=positions?['id','sessionId','side','qty','entryTime','exitTime','entryPrice','exitPrice','exitReason','grossPnl','fees','netPnl','outcome']:['id','signalId','time','tradeId','action','side','qty','price','marketPrice','fee','pnl','balance'];
  const esc=x=>'"'+String(x??'').replaceAll('"','""')+'"';
  res.setHeader('Content-Type','text/csv;charset=utf-8');res.setHeader('Content-Disposition',`attachment; filename="occ-${positions?'positions':'fills'}-${selected}.csv"`);
  return res.end('\ufeff'+[cols.join(','),...rows.map(r=>cols.map(c=>esc(r[c])).join(','))].join('\r\n'));
 }
 res.writeHead(404);res.end('Not found');
});
server.on('error',error=>{console.error(error.message);shutdown(1);});
const port=Number(process.env.PORT||8080);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid PORT');
server.listen(port,'127.0.0.1',()=>{console.log(`Local dashboard http://127.0.0.1:${port}; ${simulate?'paper simulation explicitly enabled':'collection only'}`);feed.connect();});
function shutdown(code=0){
 if(closing)return;closing=true;
 // Commit an explicit shutdown checkpoint. No pending orders are replayed later.
 if(code===0){try{commit('process_stop',{tradingEnabled:engine.tradingEnabled},null,Date.now(),()=>engine.setRunning(false));}
 catch(e){console.error('Failed to persist shutdown:',e.message);code=1;}}
 try{feed.disconnect();}catch{}
 try{store.close();}catch{}
 try{lock.close();}catch{}
 server.close();process.exitCode=code;setTimeout(()=>process.exit(code),100).unref();
}
process.once('SIGINT',()=>shutdown());process.once('SIGTERM',()=>shutdown());
