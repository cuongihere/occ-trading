// Binance USD-M symbol-allowlisted signed transport. No retries of mutations.
import {createHmac} from 'node:crypto';
const HOSTS=Object.freeze({demo:'https://demo-fapi.binance.com',production:'https://fapi.binance.com'});
const GETS=new Set(['/fapi/v1/time','/fapi/v1/exchangeInfo','/fapi/v1/ticker/price','/fapi/v2/account',
 '/fapi/v3/positionRisk','/fapi/v1/positionSide/dual','/fapi/v1/symbolConfig',
 '/fapi/v1/openOrders','/fapi/v1/openAlgoOrders','/fapi/v1/allOrders','/fapi/v1/allAlgoOrders',
 '/fapi/v1/order','/fapi/v1/algoOrder','/fapi/v1/userTrades','/fapi/v1/income']);
const POSTS=new Set(['/fapi/v1/order','/fapi/v1/algoOrder','/fapi/v1/leverage']);
const DELETES=new Set(['/fapi/v1/algoOrder','/fapi/v1/order']);
export class FuturesTransport{
 constructor({apiKey,apiSecret,fetchFn=fetch,clock=Date.now,environment='demo',productionConsent=null,allowedSymbols=['BTCUSDT'],unifiedConsent=null}){
  if(!apiKey||!apiSecret)throw Error('Missing API credentials');
  if(!Object.hasOwn(HOSTS,environment))throw Error('Unsupported Binance Futures environment');
  if(environment==='production'&&productionConsent!=='I_ACCEPT_LIVE_BTCUSDT')
   throw Error('Explicit real-money constructor consent required');
  // One explicit symbol per signed transport. BTC remains the default and
  // additional symbols require a trusted opt-in from the unified workbench.
  if(!Array.isArray(allowedSymbols)||allowedSymbols.length!==1||
     !/^[A-Z0-9]{2,20}USDT$/.test(allowedSymbols[0])||
     (allowedSymbols[0]!=='BTCUSDT'&&unifiedConsent!=='OCC_UNIFIED_SYMBOL_EXECUTOR'))
   throw Error('Only explicitly approved USDT perpetual symbols permitted for Futures trading');
  this.allowedSymbols=new Set(allowedSymbols);
  this.baseUrl=HOSTS[environment];this.environment=environment;
  this.key=apiKey;this.secret=apiSecret;this.fetchFn=fetchFn;this.clock=clock;this.offset=0;
  this.clockSyncTask=null;this.clockSyncVersion=0;this.clockSyncedAt=null;
 }
 async request(method,path,params={},timeRetried=false){
  if(!(method==='GET'?GETS:method==='POST'?POSTS:DELETES).has(path))throw Error('Endpoint not allowed');
  if(params.symbol&&!this.allowedSymbols.has(params.symbol))throw Error(
   this.allowedSymbols.size===1&&this.allowedSymbols.has('BTCUSDT')?
    'Only BTCUSDT permitted':'Futures symbol not in approved allowlist');
  if(method!=='GET'&&!this.allowedSymbols.has(params.symbol))throw Error('Mutations require allowed Futures symbol');
  if(method==='POST'&&path==='/fapi/v1/leverage'){
   const value=Number(params.leverage);
   if(!this.allowedSymbols.has(params.symbol)||!Number.isInteger(value)||value<1||value>20||
      Object.keys(params).some(k=>!['symbol','leverage'].includes(k)))
    throw Error('BTCUSDT leverage must be an integer between 1x and 20x');
  }
  if(method==='POST'&&path==='/fapi/v1/order'){
   if(params.type==='LIMIT'){
    const allowed=['symbol','side','positionSide','type','timeInForce','quantity','price',
     'goodTillDate','newClientOrderId','newOrderRespType'];
    const deadline=Number(params.goodTillDate),now=this.clock()+this.offset;
    if(!this.allowedSymbols.has(params.symbol)||!['BUY','SELL'].includes(params.side)||
       params.positionSide!=='BOTH'||params.timeInForce!=='GTD'||
       params.newOrderRespType!=='ACK'||!/^OCC(?:BTC|M)-[0-9a-f]{14}$/.test(params.newClientOrderId||'')||
       !(Number(params.quantity)>0)||!(Number(params.price)>0)||
       !Number.isFinite(deadline)||deadline<=now+600000||deadline>=now+1800000||
       Object.keys(params).some(k=>!allowed.includes(k)))
     throw Error('Unsafe BTCUSDT GTD LIMIT request');
   }else if(params.type!=='MARKET')throw Error('Only MARKET or verified GTD LIMIT orders permitted');
  }
  if(method==='DELETE'&&path==='/fapi/v1/order'){
   if(!this.allowedSymbols.has(params.symbol)||!/^OCC(?:BTC|M)-[0-9a-f]{14}$/.test(params.origClientOrderId||'')||
     !/^[0-9]{1,24}$/.test(String(params.orderId||''))||
     Object.keys(params).some(k=>!['symbol','orderId','origClientOrderId'].includes(k)))
    throw Error('Only exact OCC BTCUSDT LIMIT cancellation permitted');
  }
  if(method==='POST'&&path==='/fapi/v1/algoOrder'){
   if(!['STOP_MARKET','TAKE_PROFIT_MARKET'].includes(params.type)||params.algoType!=='CONDITIONAL')
    throw Error('Only conditional stop-market or take-profit-market algorithms permitted');
   if(params.closePosition===true||params.closePosition==='true'){
    if(params.quantity!==undefined||params.reduceOnly!==undefined)throw Error('closePosition cannot combine with quantity or reduceOnly');
   }
  }
  const qs=new URLSearchParams(Object.entries(params).map(([k,v])=>[k,String(v)]));
  const isPublic=path==='/fapi/v1/time'||path==='/fapi/v1/ticker/price'||path==='/fapi/v1/exchangeInfo';
  if(!isPublic){
   // Read-only gets tolerate network jitter; mutations keep the 5s window.
   qs.append('recvWindow',method==='GET'?'10000':'5000');
   qs.append('timestamp',String(Math.floor(this.clock()+this.offset)));
   qs.append('signature',createHmac('sha256',this.secret).update(qs.toString()).digest('hex'));
  }
  const offsetVersion=this.clockSyncVersion;
  const url=this.baseUrl+path+((method==='GET'||method==='DELETE')?'?'+qs:'');
  const opts={method,headers:{'X-MBX-APIKEY':this.key},signal:AbortSignal.timeout(9000)};
  if(method==='POST'){opts.headers['Content-Type']='application/x-www-form-urlencoded';opts.body=qs.toString();}
  let response;
  try{response=await this.fetchFn(url,opts);}
  catch{throw Error('Binance request outcome unknown; reconcile before any subsequent order');}
  let body;
  try{body=await response.json();}catch{throw Error('Binance response unreadable; reconcile before any subsequent order');}
  if(!response.ok||(typeof body?.code==='number'&&body.code<0)){
   // Binance -1021: only auto-resync and re-sign an idempotent GET ONCE.
   // Never retry a POST/DELETE order, including one rejected by the exchange.
   if(body?.code===-1021&&method==='GET'&&path!=='/fapi/v1/time'&&!timeRetried){
    if(offsetVersion===this.clockSyncVersion)await this.syncClockShared();
    return this.request(method,path,params,true);
   }
   // Return endpoint, HTTP status and Binance error code without printing signed URL or API keys.
   const code=Number.isInteger(body?.code)?String(body.code):'unknown';
   const message=typeof body?.msg==='string'?body.msg.replace(/[A-Za-z0-9_-]{40,}/g,'[redacted]').slice(0,160):'';
   throw Error('Binance '+method+' '+path+' HTTP '+response.status+' (code '+code+')'+(message?': '+message:''));
  }
  return body;
 }
 async syncClock(){
  // Keep a Binance UTC offset only inside this app; do not change Windows settings.
  const started=this.clock(),response=await this.request('GET','/fapi/v1/time');
  const ended=this.clock(),remote=Number(response?.serverTime);
  if(!Number.isSafeInteger(remote)||remote<=0||
     !Number.isFinite(started)||!Number.isFinite(ended)||
     ended<started||ended-started>15000)
   throw Error('Không thể xác minh giờ Binance; không gửi lệnh khi chưa đồng bộ');
  const offset=remote-(started+ended)/2;
  if(!Number.isFinite(offset)||!Number.isSafeInteger(Math.floor(ended+offset)))
   throw Error('Giờ Binance không hợp lệ; không gửi lệnh');
  this.offset=offset;this.clockSyncedAt=ended;this.clockSyncVersion++;
  return offset;
 }
 async syncClockShared(){
  // If multiple signed GETs fail simultaneously, one Binance /time read suffices.
  if(this.clockSyncTask)return this.clockSyncTask;
  const task=this.syncClock();this.clockSyncTask=task;
  try{return await task;}finally{if(this.clockSyncTask===task)this.clockSyncTask=null;}
 }
 get(path,p={}){return this.request('GET',path,p);}
 post(path,p={}){return this.request('POST',path,p);}
 del(path,p={}){return this.request('DELETE',path,p);}
 close(){this.secret='';this.key='';this.clockSyncedAt=null;}
}
