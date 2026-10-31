// Binance USD-M BTCUSDT signed transport. No retries of mutations.
import {createHmac} from 'node:crypto';
const HOSTS=Object.freeze({demo:'https://demo-fapi.binance.com',production:'https://fapi.binance.com'});
const GETS=new Set(['/fapi/v1/time','/fapi/v1/exchangeInfo','/fapi/v1/ticker/price','/fapi/v2/account',
 '/fapi/v3/positionRisk','/fapi/v1/positionSide/dual','/fapi/v1/symbolConfig',
 '/fapi/v1/openOrders','/fapi/v1/openAlgoOrders','/fapi/v1/order','/fapi/v1/algoOrder','/fapi/v1/userTrades']);
const POSTS=new Set(['/fapi/v1/order','/fapi/v1/algoOrder','/fapi/v1/leverage']);
const DELETES=new Set(['/fapi/v1/algoOrder']);
export class FuturesTransport{
 constructor({apiKey,apiSecret,fetchFn=fetch,clock=Date.now,environment='demo',productionConsent=null}){
  if(!apiKey||!apiSecret)throw Error('Missing API credentials');
  if(!Object.hasOwn(HOSTS,environment))throw Error('Unsupported Binance Futures environment');
  if(environment==='production'&&productionConsent!=='I_ACCEPT_LIVE_BTCUSDT')
   throw Error('Explicit real-money constructor consent required');
  this.baseUrl=HOSTS[environment];this.environment=environment;
  this.key=apiKey;this.secret=apiSecret;this.fetchFn=fetchFn;this.clock=clock;this.offset=0;
 }
 async request(method,path,params={}){
  if(!(method==='GET'?GETS:method==='POST'?POSTS:DELETES).has(path))throw Error('Endpoint not allowed');
  if(params.symbol&&params.symbol!=='BTCUSDT')throw Error('Only BTCUSDT permitted');
  if(method==='POST'&&path==='/fapi/v1/leverage'){
   const value=Number(params.leverage);
   if(params.symbol!=='BTCUSDT'||!Number.isInteger(value)||value<1||value>20||
      Object.keys(params).some(k=>!['symbol','leverage'].includes(k)))
    throw Error('BTCUSDT leverage must be an integer between 1x and 20x');
  }
  if(method==='POST'&&path==='/fapi/v1/order'&&params.type!=='MARKET')throw Error('Only MARKET orders permitted');
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
   qs.append('recvWindow','5000');qs.append('timestamp',String(Math.floor(this.clock()+this.offset)));
   qs.append('signature',createHmac('sha256',this.secret).update(qs.toString()).digest('hex'));
  }
  const url=this.baseUrl+path+(method==='GET'?'?'+qs:'');
  const opts={method,headers:{'X-MBX-APIKEY':this.key},signal:AbortSignal.timeout(9000)};
  if(method!=='GET'){opts.headers['Content-Type']='application/x-www-form-urlencoded';opts.body=qs.toString();}
  let response;
  try{response=await this.fetchFn(url,opts);}
  catch{throw Error('Binance request outcome unknown; reconcile before any subsequent order');}
  let body;
  try{body=await response.json();}catch{throw Error('Binance response unreadable; reconcile before any subsequent order');}
  if(!response.ok||(typeof body?.code==='number'&&body.code<0)){
   // Return endpoint, HTTP status and Binance error code without printing signed URL or API keys.
   const code=Number.isInteger(body?.code)?String(body.code):'unknown';
   const message=typeof body?.msg==='string'?body.msg.replace(/[A-Za-z0-9_-]{40,}/g,'[redacted]').slice(0,160):'';
   throw Error('Binance '+method+' '+path+' HTTP '+response.status+' (code '+code+')'+(message?': '+message:''));
  }
  return body;
 }
 async syncClock(){
  const a=this.clock(),r=await this.request('GET','/fapi/v1/time');this.offset=Number(r.serverTime)-(a+this.clock())/2;
  if(!Number.isFinite(this.offset)||Math.abs(this.offset)>30000)throw Error('System clock exceeds 30 second offset');
 }
 get(path,p={}){return this.request('GET',path,p);}
 post(path,p={}){return this.request('POST',path,p);}
 del(path,p={}){return this.request('DELETE',path,p);}
 close(){this.secret='';this.key='';}
}
