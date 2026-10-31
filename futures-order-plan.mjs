// Preflight is pure and always fail-closed; does not place any Binance order.
import {sizeBTC,validateLiveConfig,liveTargets,roundTick} from './futures-sizing.mjs';
const num=(v,k)=>{const x=Number(v);if(!Number.isFinite(x))throw Error('Invalid '+k);return x;};
export function validateExchangeState(state,settings){
 const c=validateLiveConfig(settings);
 if(state?.symbol!=='BTCUSDT'||state?.contractType!=='PERPETUAL')throw Error('BTCUSDT perpetual required');
 if(state?.dualSidePosition!==false)throw Error('One-way mode required');
 if(String(state?.marginType).toUpperCase()!=='ISOLATED')throw Error('ISOLATED margin required');
 if(num(state.leverage,'leverage')!==c.leverage)throw Error('Leverage mismatch: configure manually on Binance first');
 if(state?.canTrade!==true)throw Error('Futures permission missing');
 if(state?.hasOtherPositions||state?.hasUnknownOrders)throw Error('Unmanaged exchange positions/orders');
 if(Math.abs(num(state.positionBTC,'positionBTC'))>1e-10)throw Error('Must be flat before opening BTCUSDT');
 return c;
}
export function draftProtectedOrder({side,account,filters,quotePrice},settings){
 const c=validateExchangeState(account,settings);
 if(!['LONG','SHORT'].includes(side))throw Error('Unsupported direction');
 if(c.side!=='BOTH'&&c.side!==side)throw Error('Direction excluded by settings');
 const price=num(quotePrice,'quotePrice');
 const s=sizeBTC({entry:price,availableUSDT:num(account.availableUSDT,'availableUSDT'),
  step:num(filters.stepSize,'stepSize'),minQty:num(filters.minQty,'minQty'),
  minNotional:num(filters.minNotional,'minNotional')},c);
 const levels=liveTargets(price,side,c),tick=num(filters.tickSize,'tickSize');
 const stop=roundTick(levels.stop,tick,side==='LONG'?'down':'up');
 const targets=[levels.tp1,levels.tp2,levels.tp3].map(v=>roundTick(v,tick,side==='LONG'?'up':'down'));
 if(side==='LONG'&&!(stop<price&&targets.every(x=>x>price)))throw Error('Invalid LONG stops/targets');
 if(side==='SHORT'&&!(stop>price&&targets.every(x=>x<price)))throw Error('Invalid SHORT stops/targets');
 return Object.freeze({symbol:'BTCUSDT',side,marginUSDT:c.marginUSDT,leverage:c.leverage,
  notionalUSDT:s.notional,qtyBTC:s.qty,legsBTC:s.legs,referencePrice:price,
  stopPrice:stop,tpPrices:targets,requiresExchangeAck:true,
  warnings:['Not a live order','Quote price is indicative; actual fills may differ']});
}
