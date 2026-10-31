// Read-only Binance USD-M Futures account checker. NO TRADE endpoints.
import {createHmac} from 'node:crypto';
const HOST='https://fapi.binance.com';
const ALLOWED=new Set(['/fapi/v1/time','/fapi/v2/account','/fapi/v1/positionSide/dual',
 '/fapi/v1/symbolConfig','/fapi/v3/positionRisk','/fapi/v1/openOrders','/fapi/v1/openAlgoOrders']);
export class BinanceAccountReader {
 constructor({apiKey,apiSecret,fetchFn=fetch,clock=()=>Date.now()}={}){
  if(typeof apiKey!=='string'||!apiKey||typeof apiSecret!=='string'||!apiSecret)
   throw Error('Missing Binance Futures API key/secret (local environment only)');
  this.key=apiKey;this.secret=apiSecret;this.fetchFn=fetchFn;this.clock=clock;this.offset=0;
 }
 async get(path,params={}){
  if(!ALLOWED.has(path))throw Error('Only allowlisted read-only Binance Futures endpoints are supported');
  if(params.symbol!==undefined&&params.symbol!=='BTCUSDT')throw Error('Only BTCUSDT supported');
  const signed=path!=='/fapi/v1/time';
  const q=new URLSearchParams(Object.entries(params).map(([k,v])=>[k,String(v)]));
  if(signed){
   q.append('recvWindow','5000');q.append('timestamp',String(Math.floor(this.clock()+this.offset)));
   q.append('signature',createHmac('sha256',this.secret).update(q.toString()).digest('hex'));
  }
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{
   const response=await this.fetchFn(HOST+path+'?'+q,{method:'GET',headers:{'X-MBX-APIKEY':this.key},signal:controller.signal});
   const data=await response.json();
   if(!response.ok||data?.code<0)throw Error('Binance HTTP '+response.status+' ('+(data?.code||'')+'): '+(data?.msg||'Error'));
   return data;
  }catch(e){throw Error(String(e.message).replace(/[A-Za-z0-9]{35,}/g,'[redacted]'));}
  finally{clearTimeout(timer);}
 }
 async connect(){
  const before=this.clock(),time=await this.get('/fapi/v1/time');
  this.offset=Number(time.serverTime)-(before+this.clock())/2;
  if(!Number.isFinite(this.offset)||Math.abs(this.offset)>30000)throw Error('System clock differs from Binance by over 30s');
  const [account,mode,symbolConfig,positions,orders,algos]=await Promise.all([
   this.get('/fapi/v2/account'),this.get('/fapi/v1/positionSide/dual'),
   this.get('/fapi/v1/symbolConfig',{symbol:'BTCUSDT'}),
   this.get('/fapi/v3/positionRisk',{symbol:'BTCUSDT'}),
   this.get('/fapi/v1/openOrders',{symbol:'BTCUSDT'}),
   this.get('/fapi/v1/openAlgoOrders',{symbol:'BTCUSDT'})
  ]);
  const config=Array.isArray(symbolConfig)?symbolConfig.find(x=>x.symbol==='BTCUSDT'):null;
  const p=Array.isArray(positions)?positions.find(x=>x.symbol==='BTCUSDT'&&x.positionSide==='BOTH'):null;
  if(!config||!Array.isArray(orders)||!Array.isArray(algos))throw Error('Unexpected Binance Futures response');
  const usdt=account.assets?.find(a=>a.asset==='USDT');
  return {
   connected:true,market:'Binance USD-M Futures',symbol:'BTCUSDT',
   canTrade:account.canTrade===true,marginType:config.marginType,leverage:Number(config.leverage),
   oneWay:mode.dualSidePosition===false,multiAssets:account.multiAssetsMargin===true,
   walletUSDT:Number(usdt?.walletBalance??0),availableUSDT:Number(usdt?.availableBalance??0),
   positionBTC:Number(p?.positionAmt??0),entryPrice:Number(p?.entryPrice??0),
   unrealizedPnlUSDT:Number(p?.unRealizedProfit??0),openOrders:orders.length,
   openStopTpOrders:algos.length,orderSubmissionEnabled:false
  };
 }
}
