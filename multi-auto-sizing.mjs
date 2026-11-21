// USDⓈ-M per-symbol margin sizing. No exchange mutations in this module.
import {floorStep,roundTick,liveTargets,validateLiveConfig} from './futures-sizing.mjs';

const positive=(value,name)=>{
 const n=Number(value);
 if(typeof value==='boolean'||value===null||value===undefined||String(value).trim()===''||
    !Number.isFinite(n)||n<=0||n>1e9)throw Error(name+' phải là số USDT dương hợp lệ');
 return n;
};
const close=(a,b)=>Math.abs(a-b)<=Math.max(1e-9,Math.abs(b)*1e-9);
const precision=(number)=>Number(number.toFixed(12));
const symbolRegexp=/^[A-Z0-9]{2,20}$/;

export function validateMultiConfig(raw){
 if(!Array.isArray(raw)||raw.length<1||raw.length>30)
  throw Error('Nhập từ 1 đến 30 mã coin cho Auto Trade');
 const seen=new Set();
 return raw.map((row)=>{
  const base=String(row?.base||row?.symbol||'').trim().toUpperCase().replace(/USDT$/,'');
  if(!symbolRegexp.test(base)||base==='USDT'||seen.has(base))
   throw Error('Mã coin không hợp lệ hoặc bị trùng: '+base);
  seen.add(base);
  return {base,marginUSDT:positive(row?.marginUSDT,'Ký quỹ '+base)};
 });
}
export function parseCoinInput(input,defaultMarginUSDT=20){
 const names=String(input||'').split(/[\s,;，]+/).map(x=>x.trim()).filter(Boolean);
 return validateMultiConfig(names.map(base=>({base,marginUSDT:defaultMarginUSDT})));
}
export function resolveUsdtMarkets(config,info){
 if(!Array.isArray(info?.symbols))throw Error('Binance exchangeInfo không hợp lệ');
 const list=validateMultiConfig(config);
 return list.map(row=>{
  const hits=info.symbols.filter(x=>x.baseAsset===row.base&&x.quoteAsset==='USDT'&&
   x.contractType==='PERPETUAL'&&x.status==='TRADING'&&x.marginAsset==='USDT');
  const preferred=hits.find(x=>x.symbol===row.base+'USDT');
  const market=preferred||(hits.length===1?hits[0]:null);
  if(!market||!symbolRegexp.test(market.symbol))
   throw Error(row.base+' không có cặp USDT Perpetual TRADING hợp lệ trên Binance');
  return {...row,symbol:market.symbol};
 });
}
function filtersFor(market){
 const f=name=>market?.filters?.find(x=>x.filterType===name);
 const lot=f('LOT_SIZE'),mkt=f('MARKET_LOT_SIZE')||lot,px=f('PRICE_FILTER');
 const lotStep=positive(lot?.stepSize,'LOT_SIZE.stepSize');
 const marketStep=positive(mkt?.stepSize,'MARKET_LOT_SIZE.stepSize');
 // Every entry and protective TP must use a quantity valid under both filters.
 const step=Math.max(lotStep,marketStep),small=Math.min(lotStep,marketStep);
 if(!close(step/small,Math.round(step/small)))
  throw Error('Bước lot MARKET và TP không tương thích');
 const minQty=Math.max(positive(lot?.minQty,'LOT_SIZE.minQty'),positive(mkt?.minQty,'MARKET_LOT_SIZE.minQty'));
 const caps=[lot?.maxQty,mkt?.maxQty].map(Number).filter(v=>Number.isFinite(v)&&v>0);
 const maxQty=Math.min(...caps);
 const tick=positive(px?.tickSize,'PRICE_FILTER.tickSize');
 const notionalRaw=f('MIN_NOTIONAL')?.notional??f('NOTIONAL')?.minNotional??0;
 const minNotional=Number(notionalRaw);
 if(!Number.isFinite(minNotional)||minNotional<0)throw Error('Binance MIN_NOTIONAL không hợp lệ');
 return {lotStep,step,minQty,maxQty,tick,minNotional};
}
export function calculateMinimumMargin({market,price,leverage,settings}){
 const p=positive(price,'Giá'),lev=positive(leverage,'Đòn bẩy');
 if(!Number.isInteger(lev)||lev>20)throw Error('Leverage phải là số nguyên từ 1 đến 20');
 const c=validateLiveConfig({...settings,marginUSDT:20,leverage:lev});
 const f=filtersFor(market),side='LONG';
 const checked=n=>{
  const q=precision(n*f.step);
  if(q<f.minQty-1e-9||q>f.maxQty+1e-9||q*p<f.minNotional-1e-8)return false;
  const a=floorStep(q*c.tp1Qty/100,f.lotStep),b=floorStep(q*c.tp2Qty/100,f.lotStep);
  const d=floorStep(q-a-b,f.lotStep),sum=a+b+d;
  if(!close(sum,q))return false;
  const lvl=liveTargets(p,side,c);
  const targets=[lvl.tp1,lvl.tp2,lvl.tp3].map(v=>roundTick(v,f.tick,'up'));
  if(!targets.every(v=>v>p))return false;
  return [a,b,d].every((leg,i)=>leg>=f.minQty-1e-9 &&
   leg*targets[i]>=f.minNotional-1e-8 && leg<=f.maxQty+1e-9);
 };
 const lower=Math.max(1,Math.ceil(f.minQty/f.step-1e-8));
 const upper=Math.floor(Math.min(1e12,f.maxQty/f.step)+1e-9);
 if(!Number.isSafeInteger(upper)||upper<lower||!checked(upper))
  throw Error('Không thể chia 3 TP hợp lệ trong giới hạn lot Binance cho '+market.symbol);
 let lo=lower,hi=upper;
 while(lo<hi){const mid=lo+Math.floor((hi-lo)/2);if(checked(mid))hi=mid;else lo=mid+1;}
 const minQty=precision(lo*f.step);
 // Round UP to 0.01 USDT, never down, so the theoretical minimum is executable.
 let minimumMarginUSDT=Math.ceil(minQty*p/lev*100-1e-8)/100;
 for(let i=0;i<4;i++){
  const achievable=floorStep(minimumMarginUSDT*lev/p,f.step);
  if(achievable>=minQty-1e-9)break;
  minimumMarginUSDT=precision(minimumMarginUSDT+0.01);
 }
 return {minimumMarginUSDT,minQuantity:minQty,filters:f};
}
export function planMultiMargin({market,side,desiredMarginUSDT,price,availableUSDT,leverage,settings}){
 if(!['LONG','SHORT'].includes(side))throw Error('Chiều LONG/SHORT không hợp lệ');
 const desired=positive(desiredMarginUSDT,'Ký quỹ mong muốn');
 const available=Number(availableUSDT);
 if(!Number.isFinite(available)||available<0)throw Error('Không đọc được USDT khả dụng');
 const {minimumMarginUSDT,minQuantity,filters:f}=calculateMinimumMargin({
  market,price,leverage,settings});
 const effectiveMarginUSDT=Math.max(desired,minimumMarginUSDT);
 const q=floorStep(effectiveMarginUSDT*leverage/price,f.step);
 if(q<f.minQty||q>f.maxQty||q*price<f.minNotional||
    q<minQuantity-1e-9)throw Error('Khối lượng sau làm tròn không đạt quy tắc Binance');
 const c=validateLiveConfig({...settings,marginUSDT:20,leverage});
 const q1=floorStep(q*c.tp1Qty/100,f.lotStep);
 const q2=floorStep(q*c.tp2Qty/100,f.lotStep);
 const q3=floorStep(q-q1-q2,f.lotStep);
 const targets=liveTargets(price,side,c),up=side==='LONG';
 const stop=roundTick(targets.stop,f.tick,up?'down':'up');
 const tps=[targets.tp1,targets.tp2,targets.tp3].map(x=>roundTick(x,f.tick,up?'up':'down'));
 if([q1,q2,q3].some((v,i)=>v<f.minQty||v*tps[i]<f.minNotional-1e-8)||
    !close(q1+q2+q3,q)||
    !(up?stop<price&&tps.every(x=>x>price):stop>price&&tps.every(x=>x<price)))
  throw Error('TP hoặc STOP không hợp lệ tại giá thực tế, bỏ qua tín hiệu');
 // Leave headroom for taker entry fees/price movement: never consume every USDT.
 const reserveUSDT=Math.max(0.1,effectiveMarginUSDT*0.01);
 if(effectiveMarginUSDT+reserveUSDT>available+1e-8)
  throw Error('Không đủ USDT khả dụng cho ký quỹ '+effectiveMarginUSDT.toFixed(2)+
   ' và dự phòng phí '+reserveUSDT.toFixed(2)+' (khả dụng '+available.toFixed(2)+')');
 return Object.freeze({symbol:market.symbol,side,desiredMarginUSDT:desired,
  minimumMarginUSDT,effectiveMarginUSDT,autoRaised:effectiveMarginUSDT>desired,
  estimatedInitialMarginUSDT:q*price/leverage,leverage,price,quantity:q,
  legs:[q1,q2,q3],stop,tps,filters:f,reserveUSDT});
}
