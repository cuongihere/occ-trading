// Build exchange-side BTCUSDT order descriptions after a VERIFIED entry fill.
// Pure planning only; no network transmission.
import {validateLiveConfig,floorStep,roundTick,liveTargets} from './futures-sizing.mjs';
export function protectionRequests({side,entryPrice,filledQty,stepSize,tickSize,clientPrefix},settings){
 const c=validateLiveConfig(settings);
 if(!['LONG','SHORT'].includes(side))throw Error('Invalid direction');
 if(!/^OCCBTC-[A-Za-z0-9_-]{1,18}$/.test(clientPrefix||''))throw Error('Invalid client prefix');
 if(!Number.isFinite(filledQty)||filledQty<=0||!Number.isFinite(entryPrice)||entryPrice<=0)throw Error('Missing verified fill');
 const qty=floorStep(filledQty,stepSize),levels=liveTargets(entryPrice,side,c);
 if(qty<=0)throw Error('No executable BTC quantity');
 const q1=floorStep(qty*c.tp1Qty/100,stepSize);
 const q2=floorStep(qty*c.tp2Qty/100,stepSize);
 const q3=floorStep(qty-q1-q2,stepSize);
 if([q1,q2,q3].some(x=>x<stepSize))throw Error('TP quantity falls below step size');
 const closeSide=side==='LONG'?'SELL':'BUY';
 const common={algoType:'CONDITIONAL',symbol:'BTCUSDT',side:closeSide,positionSide:'BOTH',workingType:'CONTRACT_PRICE'};
 const stop={...common,type:'STOP_MARKET',closePosition:'true',
  triggerPrice:String(roundTick(levels.stop,tickSize,side==='LONG'?'down':'up')),clientAlgoId:clientPrefix+'-SL'};
 const vals=[levels.tp1,levels.tp2,levels.tp3],qtys=[q1,q2,q3];
 const tps=vals.map((price,i)=>({...common,type:'TAKE_PROFIT_MARKET',reduceOnly:'true',
  quantity:String(qtys[i]),triggerPrice:String(roundTick(price,tickSize,side==='LONG'?'up':'down')),
  clientAlgoId:clientPrefix+'-TP'+(i+1)}));
 return Object.freeze({stop,tps,qtys});
}
