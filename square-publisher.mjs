// Independent Binance Square publisher. Does NOT control/modify Futures orders.
// Square key is a separate publishing-only credential encrypted by Windows DPAPI.
// New positions only; previous/ambiguous publishes never retry automatically.
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {resolve} from 'node:path';
import {WindowsCredentialVault} from './futures-credential-vault.mjs';
import {renderSquareTradeChart} from './square-chart-render.mjs';

const API_V1='https://www.binance.com/bapi/composite/v1/public/pgc/openApi';
const API_V2='https://www.binance.com/bapi/composite/v2/public/pgc/openApi';
const HEADERS={clienttype:'binanceSkill','Content-Type':'application/json'};
const mask=e=>String(e?.message||e||'Unknown API failure')
 .replace(/[A-Za-z0-9+/=]{60,}/g,'[redacted]').slice(0,240);
const n=x=>Number(x);
const price=x=>{const n=Number(x);const digits=n>=100?1:n>=1?4:n>=0.01?6:9;
 return n.toLocaleString('en-US',{maximumFractionDigits:digits});};
export const SQUARE_SIGNAL_DISCLAIMER='Đây là Tín hiệu phân tích kỹ thuật, chưa phải giao dịch đã khớp.';
function levels(p){
 const entry=p?.entry,stop=p?.stop,tps=p?.tps;
 if(!entry||!stop||!Array.isArray(tps)||tps.length!==3||
  !/^OCCBTC-[A-Za-z0-9_-]{1,25}$/.test(String(entry.clientPrefix||''))||
  !/^[0-9]{1,24}$/.test(String(entry.orderId))||
  !['LONG','SHORT'].includes(entry.side)||
  ![entry.entryPrice,entry.qty,stop.triggerPrice,...tps.map(x=>x.triggerPrice)].every(x=>n(x)>0&&Number.isFinite(n(x)))||
  stop.role!=='SL'||tps.some((x,i)=>x.role!=='TP'+(i+1)))
  throw Error('Entry SL/TP chưa được Binance xác minh đầy đủ');
 const id=String(entry.orderId),side=entry.side,at=Date.now();
 const result={id,groupId:entry.clientPrefix,side,entry:n(entry.entryPrice),
  sl:n(stop.triggerPrice),tps:tps.map(x=>n(x.triggerPrice)),qty:n(entry.qty),at};
 if(side==='LONG'&&!(result.sl<result.entry&&result.tps.every(x=>x>result.entry))||
    side==='SHORT'&&!(result.sl>result.entry&&result.tps.every(x=>x<result.entry)))
  throw Error('SL/TP không hợp lệ theo chiều đã khớp');
 return result;
}
export function squareSignalCaption(signal){
 if(!/^[A-Z0-9]{1,20}USDT$/.test(signal?.symbol||'')||
    !['LONG','SHORT'].includes(signal?.side)||
    !(Number(signal?.entry)>0)||!(Number(signal?.sl)>0)||
    !Array.isArray(signal?.tps)||signal.tps.length!==3||
    !signal.tps.every(x=>Number(x)>0))
  throw Error('Tín hiệu Square thiếu mức giá tham khảo hợp lệ');
 return '$'+signal.symbol+' PERPETUAL | '+signal.side+' | M15'+
  '\nGiá tín hiệu tham khảo: '+price(signal.entry)+
  '\nSL tham khảo: '+price(signal.sl)+
  '\nTP1: '+price(signal.tps[0])+
  '\nTP2: '+price(signal.tps[1])+
  '\nTP3: '+price(signal.tps[2])+
  '\n'+SQUARE_SIGNAL_DISCLAIMER;
}
export function squareCaption(trade){
 return '$BTCUSDT PERPETUAL | '+trade.side+'\nENTRY: '+price(trade.entry)+
  '\nSL: '+price(trade.sl)+'\nTP1: '+price(trade.tps[0])+
  '\nTP2: '+price(trade.tps[1])+'\nTP3: '+price(trade.tps[2]);
}
async function requestJson(fetcher,url,key,body,timeout=16000){
 const res=await fetcher(url,{method:'POST',headers:{...HEADERS,'X-Square-OpenAPI-Key':key},
  body:JSON.stringify(body),signal:AbortSignal.timeout(timeout)});
 if(url.endsWith('/content/add')&&res.status===504)
  return {unknown:true}; // upstream may have published; NEVER blind retry
 let payload;
 try{payload=await res.json();}catch{throw Error('Binance Square trả dữ liệu không hợp lệ (HTTP '+res.status+')');}
 if(!res.ok||payload?.code!=='000000')
  throw Error('Binance Square '+String(payload?.code||res.status)+' '+String(payload?.message||''));
 return payload.data||{};
}
function verifyUploadUrl(value){
 const u=new URL(value);
 if(u.protocol!=='https:'||u.username||u.password||u.port||
   /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[|::)/i.test(u.hostname)||
   !/(\.amazonaws\.com|\.aliyuncs\.com|\.binance\.com|\.cloudfront\.net)$/i.test(u.hostname))
  throw Error('Square upload URL không thuộc nhà cung cấp được cho phép');
 return u.toString();
}
async function publishImage(fetcher,key,png,caption,sleep,imageName='BTCUSDT_trade.png',textFallback=false){
 let imageUrl=null;
 try{
  // No Square content/add request is made during the media preparation stage.
  const ticket=await requestJson(fetcher,API_V2+'/image/presignedUrl',key,{imageName});
  if(!ticket?.fileTicket||!ticket?.presignedUrl)throw Error('Square chưa cấp phép upload ảnh');
  const upload=verifyUploadUrl(ticket.presignedUrl);
  const put=await fetcher(upload,{method:'PUT',headers:{'Content-Type':'image/png'},
   body:png,signal:AbortSignal.timeout(30000)});
  if(!put.ok)throw Error('Square upload ảnh thất bại HTTP '+put.status);
  for(let i=0;i<10;i++){
   const state=await requestJson(fetcher,API_V2+'/image/imageStatus',key,{fileTicket:ticket.fileTicket});
   if(state?.status===1&&state.imageUrl){imageUrl=state.imageUrl;break;}
   if(state?.status===2)throw Error('Square xử lý ảnh thất bại');
   if(i!==9)await sleep(3000);
  }
  if(!imageUrl||!String(imageUrl).startsWith('https://'))
   throw Error('Square chưa xác nhận ảnh đã sẵn sàng');
 }catch(error){
  if(!textFallback)throw error;
  // Images are optional for analytical posts. If media setup fails BEFORE
  // content/add, use a text-only public post with the SAME disclaimer.
  // Never fallback after a content/add call because publication may be ambiguous.
  return requestJson(fetcher,API_V1+'/content/add',key,{
   contentType:1,bodyTextOnly:caption
  },20000);
 }
 // Exactly one attempt to publish after image preparation succeeded.
 return requestJson(fetcher,API_V1+'/content/add',key,{
  contentType:1,bodyTextOnly:caption,imageList:[imageUrl]
 },20000);
}
export class SquarePublisher{
 constructor({dataDir,fetcher=fetch,fetchKlines=null,vault=null,sleep=ms=>new Promise(r=>setTimeout(r,ms))}){
  this.dir=resolve(dataDir,'square-publications');
  this.statePath=resolve(dataDir,'square-publisher.json');
  this.vault=vault||new WindowsCredentialVault(resolve(dataDir,'square-post.dpapi.json'));
  this.fetcher=fetcher;this.fetchKlines=fetchKlines;this.sleep=sleep;
  const saved=existsSync(this.statePath)?JSON.parse(readFileSync(this.statePath,'utf8')):{};
  this.enabled=saved.enabled===true;this.posts=Array.isArray(saved.posts)?saved.posts.slice(-1200):[];
  this.tasks=new Map();
  let changed=false;for(const p of this.posts)if(['UPLOADING','PUBLISHING','QUEUED'].includes(p.status)){
   p.status='REVIEW_REQUIRED';p.error='Tác vụ bị gián đoạn, chưa rõ bài đã đăng hay chưa';changed=true;}
  if(changed)this.save();
 }
 keyExists(){return Boolean(process.env.BINANCE_SQUARE_OPENAPI_KEY||this.vault.exists());}
 getKey(){
  const env=String(process.env.BINANCE_SQUARE_OPENAPI_KEY||'').trim();
  if(env)return env;
  return this.vault.load()?.apiKey||'';
 }
 save(){mkdirSync(resolve(this.statePath,'..'),{recursive:true,mode:0o700});
  const tmp=this.statePath+'.pending';
  writeFileSync(tmp,JSON.stringify({enabled:this.enabled,posts:this.posts.slice(-1200)},null,2),{mode:0o600});
  renameSync(tmp,this.statePath);}
 connect(key){
  if(typeof key!=='string'||key.trim().length<16||key.length>512||/[\r\n]/.test(key))
   throw Error('Binance Square OpenAPI key không hợp lệ');
  this.vault.save({apiKey:key.trim(),apiSecret:'SQUARE-POSTING-ONLY'});
  return this.status();
 }
 forget(){this.enabled=false;this.vault.delete();this.save();return this.status();}
 toggle(on){
  if(typeof on!=='boolean')throw Error('Trạng thái Square phải ON hoặc OFF');
  if(on&&!this.keyExists())throw Error('Cần Square OpenAPI key riêng trong Creator Center');
  this.enabled=on;this.save();return this.status();
 }
 status(){const last=this.posts.at(-1);
  return {enabled:this.enabled,keyStored:this.keyExists(),last:last?{
   kind:last.kind||'TRADE',symbol:last.symbol||'BTCUSDT',orderId:last.orderId,status:last.status,at:last.at,postedAt:last.postedAt||null,
   url:last.url||null,error:last.error||null,chartReady:last.chartReady||false}:null,
   postCount:this.posts.filter(x=>x.status==='SENT').length};
 }
 latestImage(){
  const post=[...this.posts].reverse().find(p=>p.chartReady);
  if(!post)return null;
  const path=resolve(this.dir,post.filename||('entry-'+post.orderId+'.png'));
  return existsSync(path)?readFileSync(path):null;
 }
 async onProtected(confirmed){
  if(!this.enabled||!this.keyExists())return {skipped:true};
  const trade=levels(confirmed);if(this.posts.some(x=>x.orderId===trade.id))return {duplicate:true};
  const record={kind:'TRADE',orderId:trade.id,at:trade.at,status:'QUEUED',chartReady:false,
   url:null,error:null,postedAt:null};
  this.posts.push(record);this.save(); // reserve before any external mutation
  const job=this._run(record,trade).catch(error=>{
   record.status='REVIEW_REQUIRED';record.error=mask(error);this.save();return {error:record.error};
  }).finally(()=>this.tasks.delete(trade.id));
  this.tasks.set(trade.id,job);return job;
 }
 // Analytical signals have no Binance Entry. Never label them as executed.
 async onSignal(signal){
  if(!this.keyExists())return {skipped:true};
  const key=String(signal?.key||'');
  if(!/^[A-Z0-9]{1,20}USDT:M15:[0-9]{8,15}:(LONG|SHORT)$/.test(key)||
     signal.symbol+':M15:'+signal.barTime+':'+signal.side!==key||
     !(Number(signal.at)>0)||!(Number(signal.entry)>0)||!(Number(signal.sl)>0)||
     !Array.isArray(signal.tps)||signal.tps.length!==3)
   throw Error('Tín hiệu Scanner không hợp lệ');
  const caption=squareSignalCaption(signal);
  if(!caption.includes(SQUARE_SIGNAL_DISCLAIMER))throw Error('Thiếu cảnh báo bắt buộc');
  if(this.posts.some(p=>p.key===key))return {duplicate:true};
  const record={kind:'SIGNAL',key,orderId:null,symbol:signal.symbol,
   at:Number(signal.at),status:'QUEUED',chartReady:false,url:null,error:null,postedAt:null,
   filename:'signal-'+signal.symbol+'-'+signal.barTime+'-'+signal.side+'.png'};
  this.posts.push(record);this.save();
  const job=this._run(record,{...signal,isSignal:true}).catch(error=>{
   record.status='REVIEW_REQUIRED';record.error=mask(error);this.save();
   return {status:'REVIEW_REQUIRED',error:record.error};
  }).finally(()=>this.tasks.delete(key));
  this.tasks.set(key,job);return job;
 }
 async _run(record,trade){
  if(typeof this.fetchKlines!=='function')throw Error('Nguồn nến Binance chưa sẵn sàng');
  const rawKlines=await this.fetchKlines({symbol:trade.symbol||'BTCUSDT',filledAt:trade.at,limit:96});
  const klines=trade.isSignal?rawKlines.filter(k=>Number(Array.isArray(k)?k[6]:k.closeTime)<trade.at):rawKlines;
  const png=renderSquareTradeChart({klines,side:trade.side,entry:trade.entry,
   sl:trade.sl,tps:trade.tps,filledAt:trade.at,symbol:trade.symbol||'BTCUSDT',signal:trade.isSignal===true});
  mkdirSync(this.dir,{recursive:true,mode:0o700});
  const file=resolve(this.dir,record.filename||('entry-'+trade.id+'.png')),tmp=file+'.pending';
  writeFileSync(tmp,png,{mode:0o600});renameSync(tmp,file);
  record.chartReady=true;record.status='UPLOADING';this.save();
  const key=this.getKey();if(!key)throw Error('Square key đã bị thu hồi');
  // A failure in or after publish can be ambiguous. Never re-publish
  // the same entry without manual reconciliation at Binance Square.
  record.status='PUBLISHING';this.save();
  const caption=trade.isSignal?squareSignalCaption(trade):squareCaption(trade);
  const imageName=trade.isSignal?trade.symbol+'_signal.png':'BTCUSDT_trade.png';
  const result=await publishImage(this.fetcher,key,png,caption,this.sleep,imageName,trade.isSignal===true);
  if(result?.unknown){record.status='REVIEW_REQUIRED';record.error='Binance Square HTTP 504; có thể đã đăng, hãy kiểm tra thủ công';}
  else{record.status='SENT';record.url=result.shareLink||
    (result.id?'https://www.binance.com/square/post/'+encodeURIComponent(String(result.id)):null);
   record.postedAt=Date.now();record.error=null;}
  this.save();return {status:record.status,url:record.url};
 }
}
