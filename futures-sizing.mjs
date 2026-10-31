// BTCUSDT live sizing and exchange-price quantization, independent of API.
const finite=(v,name)=>{const n=Number(v);if(!Number.isFinite(n))throw Error('Invalid '+name);return n;};
export const defaultLiveConfig=Object.freeze({side:'BOTH',marginUSDT:20,leverage:5,
 slPercent:1,tpMode:'Percent',tp1Val:1,tp2Val:2,tp3Val:3,tp1Qty:33,tp2Qty:33});
export function validateLiveConfig(value){
 const c={...defaultLiveConfig,...value};
 if(!['BOTH','LONG','SHORT'].includes(c.side)||!['Percent','Points'].includes(c.tpMode))throw Error('Invalid side/TP Mode');
 for(const k of ['marginUSDT','leverage','slPercent','tp1Val','tp2Val','tp3Val','tp1Qty','tp2Qty'])c[k]=finite(c[k],k);
 if(c.marginUSDT<=0||c.marginUSDT>1000||!Number.isInteger(c.leverage)||c.leverage<1||c.leverage>20||
 c.slPercent<=0||c.slPercent>10||[c.tp1Val,c.tp2Val,c.tp3Val].some(x=>x<=0)||
 c.tp1Qty<=0||c.tp2Qty<=0||c.tp1Qty+c.tp2Qty>=100)throw Error('Outside allowed BTC Futures settings');
 return c;
}
const digits=step=>{const s=String(step);if(s.includes('e-'))return Math.min(12,Number(s.split('e-')[1]));return (s.split('.')[1]||'').length;};
export function floorStep(v,step){
 v=finite(v,'size');step=finite(step,'step');
 if(v<0||step<=0)throw Error('Invalid size/step');
 return Number((Math.floor(v/step+1e-9)*step).toFixed(Math.min(12,digits(step))));
}
export function roundTick(price,tick,direction){
 price=finite(price,'price');tick=finite(tick,'tick');
 if(price<=0||tick<=0||!['up','down'].includes(direction))throw Error('Invalid tick');
 const n=direction==='up'?Math.ceil(price/tick-1e-9):Math.floor(price/tick+1e-9);
 return Number((n*tick).toFixed(Math.min(12,digits(tick))));
}
export function liveTargets(entry,side,c){
 const dir=side==='LONG'?1:-1;
 const tp=v=>c.tpMode==='Percent'?entry*(1+dir*v/100):entry+dir*v;
 return {stop:entry*(1-dir*c.slPercent/100),tp1:tp(c.tp1Val),tp2:tp(c.tp2Val),tp3:tp(c.tp3Val)};
}
export function sizeBTC({entry,availableUSDT,step,minQty,minNotional},settings){
 const c=validateLiveConfig(settings);
 if(!Number.isFinite(entry)||entry<=0||!Number.isFinite(availableUSDT)||availableUSDT<c.marginUSDT)
  throw Error('Insufficient available USDT or invalid entry');
 const notional=c.marginUSDT*c.leverage;
 const qty=floorStep(notional/entry,step);
 if(qty<minQty||qty*entry<minNotional)throw Error('Order smaller than Binance minimum qty/notional');
 const a=floorStep(qty*c.tp1Qty/100,step),b=floorStep(qty*c.tp2Qty/100,step),d=floorStep(qty-a-b,step);
 if([a,b,d].some(x=>x<minQty))throw Error('Each of TP1/TP2/TP3 must meet Binance minimum BTC quantity. Increase margin or leverage.');
 return {notional,qty,legs:[a,b,d]};
}
