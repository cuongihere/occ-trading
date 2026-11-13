// Read-only OCC / Binance execution comparison. No trading or order mutations.
import {DatabaseSync} from 'node:sqlite';
import {existsSync} from 'node:fs';
import {OCCEngine,M15} from './engine.mjs';

const finite=n=>Number.isFinite(Number(n))?Number(n):null;
const clean=c=>Array.isArray(c)&&c.length>=7?
 {time:Number(c[0]),open:Number(c[1]),high:Number(c[2]),low:Number(c[3]),
  close:Number(c[4]),closeTime:Number(c[6])}:null;
const round=(n,d=5)=>Number(Number(n).toFixed(d));

export function readVerifiedChartFills(path,since=Date.now()-14*86400000){
 if(!existsSync(path))return [];
 const db=new DatabaseSync(path,{readOnly:true});
 try{
  const found=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='fills'").get();
  if(!found)return [];
  return db.prepare(
   'SELECT f.fill_id AS fillId,f.order_id AS orderId,o.group_id AS groupId,'+
   'o.client_id AS clientId,o.role AS role,f.side AS side,f.qty AS qty,'+
   'f.price AS price,f.fee AS fee,f.realized AS realized,f.asset AS asset,'+
   'f.filled_at AS filledAt FROM fills f INNER JOIN orders o ON o.order_id=f.order_id '+
   'WHERE f.filled_at>=? ORDER BY f.filled_at,CAST(f.fill_id AS INTEGER) LIMIT 3000'
  ).all(since).map(x=>({...x,source:'BINANCE_VERIFIED_OCC_FILL'}));
 }finally{db.close();}
}

export function buildOCCChartComparison({h4,m15,fills=[],settings={},now=Date.now()}){
 if(!Array.isArray(h4)||!Array.isArray(m15)||!Array.isArray(fills))
  throw Error('Missing historical Binance candles or verified fills');
 const candles=m15.map(clean).filter(b=>b&&b.time>0&&b.closeTime<now&&
  [b.open,b.high,b.low,b.close].every(x=>x>0&&Number.isFinite(x))&&
  b.low<=Math.min(b.open,b.close)&&b.high>=Math.max(b.open,b.close))
  .sort((a,b)=>a.time-b.time);
 if(candles.length<50)throw Error('Insufficient verified M15 candles');
 const engine=new OCCEngine();
 engine.warmup(h4,m15,now);
 const series=engine.history;
 const signals=[];
 let prev=null;
 for(const h of series){
  const diff=h.closeSeries-h.openSeries;
  const side=prev===null?null:diff>0&&prev<=0?'LONG':diff<0&&prev>=0?'SHORT':null;
  if(side)signals.push({time:h.time,confirmAt:h.closeTime+1,side,
   signalClose:h.close,crossMA:round((h.openSeries+h.closeSeries)/2),
   triggerBTC:round(h.close-8*diff),source:'OCC_ENGINE_CAUSAL_SMMA8'});
  prev=diff;
 }
 const validFills=fills.filter(x=>Number.isSafeInteger(Number(x.filledAt))&&
  Number(x.price)>0&&Number(x.qty)>0&&['BUY','SELL'].includes(x.side)&&
  ['ENTRY','SL','TP1','TP2','TP3','CLOSE','REVERSE'].includes(x.role))
  .map(x=>({time:Number(x.filledAt),orderId:String(x.orderId),
   fillId:String(x.fillId),groupId:String(x.groupId),role:x.role,side:x.side,
   qty:Number(x.qty),price:Number(x.price),fee:Number(x.fee),
   realized:Number(x.realized),source:'BINANCE_VERIFIED_OCC_FILL'}));
 const groups=new Map();
 for(const f of validFills){
  if(!groups.has(f.groupId))groups.set(f.groupId,{entries:[],exits:[]});
  groups.get(f.groupId)[f.role==='ENTRY'?'entries':'exits'].push(f);
 }
 const comparisons=[];
 const pct=settings?.tpMode==='Points'?false:true;
 const targets={SL:finite(settings?.slPercent),TP1:finite(settings?.tp1Val),
  TP2:finite(settings?.tp2Val),TP3:finite(settings?.tp3Val)};
 for(const [groupId,g] of groups){
  if(!g.entries.length)continue;
  const qty=g.entries.reduce((a,f)=>a+f.qty,0);
  const entryPrice=g.entries.reduce((a,f)=>a+f.price*f.qty,0)/qty;
  const time=Math.min(...g.entries.map(f=>f.time));
  const side=g.entries[0].side==='BUY'?'LONG':'SHORT';
  const candidates=signals.filter(sig=>sig.side===side&&sig.confirmAt<=time&&
   time-sig.confirmAt<=2*60*60*1000);
  const matched=candidates.at(-1)||null;
  const dir=side==='LONG'?1:-1;
  const one=(role,actual,fillTime,quantity)=>{
   const p=targets[role];
   const ref=role==='ENTRY'?matched?.signalClose:
    matched&&p!==null&&p>0?(pct?matched.signalClose*
      (1+(role==='SL'?-dir:dir)*p/100):
      matched.signalClose+(role==='SL'?-dir:dir)*p):null;
   return {groupId,side,role,fillTime,qty:round(quantity,8),
    binancePrice:round(actual),referencePrice:ref==null?null:round(ref),
    deltaPrice:ref==null?null:round(actual-ref),
    deltaPct:ref==null?null:round((actual-ref)/ref*100,4),
    signalTime:matched?.confirmAt||null,
    signalClose:matched?.signalClose||null,
    triggerBTC:matched?.triggerBTC||null,
    crossMA:matched?.crossMA||null,
    delaySeconds:matched?round((fillTime-matched.confirmAt)/1000,1):null,
    attribution:matched?'NEAREST_PRECEDING_SIGNAL_NOT_PROVEN':'NO_MATCHING_SIGNAL'};
  };
  comparisons.push(one('ENTRY',entryPrice,time,qty));
  for(const role of ['SL','TP1','TP2','TP3','CLOSE','REVERSE']){
   const exits=g.exits.filter(x=>x.role===role);
   if(!exits.length)continue;
   const n=exits.reduce((a,x)=>a+x.qty,0);
   const price=exits.reduce((a,x)=>a+x.price*x.qty,0)/n;
   comparisons.push(one(role,price,Math.min(...exits.map(x=>x.time)),n));
  }
 }
 comparisons.sort((a,b)=>b.fillTime-a.fillTime);
 return {symbol:'BTCUSDT',interval:'15m',asOf:now,
  note:'OCC reference is a causal JavaScript reconstruction of SMMA8 H4/M15. Not actual TradingView Pine Strategy Tester fills. Signal-to-order association is time-based only.',
  candles:candles.slice(-1200),
  series:series.map(x=>({time:x.time,openMA:round(x.openSeries),
   closeMA:round(x.closeSeries)})),
  signals:signals.slice(-1200),fills:validFills.slice(-2500),
  comparisons:comparisons.slice(0,150),settings:{
   slPercent:targets.SL,tp1Val:targets.TP1,tp2Val:targets.TP2,
   tp3Val:targets.TP3,tpMode:settings?.tpMode||'Percent'}};
}
