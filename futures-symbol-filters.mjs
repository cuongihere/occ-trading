// Validate LOT_SIZE + MARKET_LOT_SIZE for an entry that may later need
// reduceOnly TP/SL. A quantity must satisfy BOTH exchange filters.
const positive=(v)=>{const x=Number(v);return Number.isFinite(x)&&x>0?x:null;};
const digits=value=>{
 const n=String(value??'');
 if(n.includes('e-'))return Math.min(12,Number(n.split('e-')[1]));
 return Math.min(12,(n.split('.')[1]||'').replace(/0+$/,'').length);
};
const gcd=(a,b)=>{while(b!==0n){const t=a%b;a=b;b=t;}return a;};
export function commonQuantityStep(a,b){
 if(!(positive(a)&&positive(b)))throw Error('Binance LOT_SIZE/MARKET_LOT_SIZE missing step');
 const factor=10**Math.max(digits(a),digits(b));
 const x=BigInt(Math.round(Number(a)*factor)),y=BigInt(Math.round(Number(b)*factor));
 if(!x||!y||Number(x)>Number.MAX_SAFE_INTEGER||Number(y)>Number.MAX_SAFE_INTEGER)
  throw Error('Unsupported Binance lot precision');
 const l=x/gcd(x,y)*y;
 if(l>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Binance lot steps cannot be combined safely');
 const step=Number(l)/factor;
 if(!positive(step)||!Number.isFinite(step))throw Error('Invalid Binance common lot step');
 return step;
}
export function symbolExecutionFilters(market,{strict=false}={}){
 if(!market||!Array.isArray(market.filters))throw Error('Binance exchangeInfo filters unavailable');
 const f=type=>market.filters.find(row=>row.filterType===type);
 const lot=f('LOT_SIZE'),mkt=f('MARKET_LOT_SIZE');
 if(!positive(lot?.stepSize)||!positive(lot?.minQty)||strict&&
   (!positive(mkt?.stepSize)||!positive(mkt?.minQty)))
  throw Error('Binance LOT_SIZE/MARKET_LOT_SIZE missing or invalid');
 const stepSize=positive(mkt?.stepSize)?commonQuantityStep(lot.stepSize,mkt.stepSize):
  Number(lot.stepSize);
 const minQty=Math.max(Number(lot.minQty),positive(mkt?.minQty)||0);
 const maxQty=Math.min(positive(lot.maxQty)||Infinity,positive(mkt?.maxQty)||Infinity);
 const minNotional=positive(f('MIN_NOTIONAL')?.notional)||
  positive(f('NOTIONAL')?.minNotional)||0;
 const tickSize=positive(f('PRICE_FILTER')?.tickSize);
 if(!tickSize||!Number.isFinite(maxQty)&&strict||minQty>maxQty||strict&&!(minNotional>0))
  throw Error('Binance requires valid PRICE_FILTER, quantity bounds and MIN_NOTIONAL');
 return Object.freeze({stepSize,minQty,maxQty,minNotional,tickSize});
}
