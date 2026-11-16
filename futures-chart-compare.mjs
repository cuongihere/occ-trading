// Single read-only BTCUSDT chart: causal OCC lines/crosses + verified Binance fills.
// Historical crossings are reconstructed from completed M15 + H4 SMMA8 inputs.
// TradingView Pine Strategy Tester fills are NOT substituted for exchange fills.
import {DatabaseSync} from 'node:sqlite';
import {existsSync} from 'node:fs';
import {OCCSignalEngine,M15} from './occ-signal-engine.mjs';

const finite=x=>Number.isFinite(Number(x))?Number(x):null;
const round=(x,n=5)=>Number(Number(x).toFixed(n));
const valid=x=>Number.isFinite(Number(x))&&Number(x)>0;
const clean=c=>Array.isArray(c)&&c.length>=7?{
 time:Number(c[0]),open:Number(c[1]),high:Number(c[2]),
 low:Number(c[3]),close:Number(c[4]),closeTime:Number(c[6])
}:c&&typeof c==='object'?{
 time:Number(c.time),open:Number(c.open),high:Number(c.high),
 low:Number(c.low),close:Number(c.close),closeTime:Number(c.closeTime)
}:null;
const table=db=>new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name));

export function readVerifiedChartHistory(path,since=Date.now()-30*86400000){
 if(!existsSync(path))return {fills:[],signalLinks:[]};
 const db=new DatabaseSync(path,{readOnly:true});
 try{
  const tables=table(db);
  if(!tables.has('fills')||!tables.has('orders'))return {fills:[],signalLinks:[]};
  const fills=db.prepare(
   'SELECT f.fill_id AS fillId,f.order_id AS orderId,o.group_id AS groupId,'+
   'o.client_id AS clientId,o.role AS role,f.side AS side,f.qty AS qty,'+
   'f.price AS price,f.fee AS fee,f.realized AS realized,f.asset AS asset,'+
   'f.filled_at AS filledAt FROM fills f JOIN orders o ON o.order_id=f.order_id '+
   'WHERE f.filled_at>=? ORDER BY f.filled_at,CAST(f.fill_id AS INTEGER) LIMIT 6000'
  ).all(since).map(x=>({...x,source:'BINANCE_VERIFIED_OCC_FILL'}));
  const signalLinks=tables.has('entry_signals')?db.prepare(
   'SELECT group_id AS groupId,order_id AS orderId,side,bar_time AS barTime,'+
   'confirm_at AS confirmAt,signal_close AS signalClose,trigger_price AS triggerBTC,'+
   'cross_ma AS crossMA FROM entry_signals WHERE confirm_at>=? ORDER BY confirm_at'
  ).all(since-2*60*60*1000):[];
  return {fills,signalLinks};
 }finally{db.close();}
}
export function readVerifiedChartFills(path,since=Date.now()-14*86400000){
 return readVerifiedChartHistory(path,since).fills;
}
export function buildOCCChartComparison({h4,m15,fills=[],signalLinks=[],settings={},now=Date.now()}){
 if(!Array.isArray(h4)||!Array.isArray(m15)||!Array.isArray(fills)||
    !Array.isArray(signalLinks))throw Error('Binance candles/fills unavailable');
 const candles=m15.map(clean).filter(b=>b&&Number.isSafeInteger(b.time)&&b.time>0&&
  b.closeTime===b.time+M15-1&&b.closeTime<now&&
  [b.open,b.high,b.low,b.close].every(valid)&&
  b.low<=Math.min(b.open,b.close)&&b.high>=Math.max(b.open,b.close))
  .sort((a,b)=>a.time-b.time);
 if(candles.length<50)throw Error('Not enough completed M15 Binance candles');
 for(let i=1;i<candles.length;i++){
  if(candles[i].time!==candles[i-1].time+M15)
   throw Error('Missing historical M15 candle; cannot reconstruct OCC crossings safely');
 }
 // Warm up only with the first completed M15: the signal engine intentionally
 // caps its internal history at 1200. Capture EACH next sample before eviction
 // to support 30 full days without a truncated OCC overlay.
 const engine=new OCCSignalEngine(),first=candles[0];
 engine.warmup(h4,[first],first.closeTime+1);
 const samples=[engine.history.at(-1)],signals=[],series=[];
 let previous=samples[0].closeSeries-samples[0].openSeries;
 series.push({time:first.time,openMA:round(samples[0].openSeries),
  closeMA:round(samples[0].closeSeries)});
 for(let i=1;i<candles.length;i++){
  const b=candles[i];
  engine.onCandle(b,{live:false,observedAt:now});
  const h=engine.history.at(-1),diff=h.closeSeries-h.openSeries;
  series.push({time:h.time,openMA:round(h.openSeries),closeMA:round(h.closeSeries)});
  const side=diff>0&&previous<=0?'LONG':diff<0&&previous>=0?'SHORT':null;
  if(side){
   const ht=Math.floor(b.time/(16*M15))*(16*M15);
   signals.push({time:b.time,confirmAt:b.closeTime+1,side,
    signalClose:b.close,crossMA:round((h.openSeries+h.closeSeries)/2),
    triggerBTC:round(b.close-8*diff),
    h4Provisional:b.closeTime!==ht+16*M15-1,
    source:'OCC_CAUSAL_H4_SMMA8'});
  }
  previous=diff;
 }
 const validFills=fills.filter(x=>
  Number.isSafeInteger(Number(x.filledAt))&&valid(x.price)&&valid(x.qty)&&
  ['BUY','SELL'].includes(x.side)&&
  ['ENTRY','SL','TP1','TP2','TP3','CLOSE','REVERSE'].includes(x.role)&&
  typeof x.groupId==='string'&&/^[A-Za-z0-9_-]{1,55}$/.test(x.groupId)
 ).map(x=>({
  time:Number(x.filledAt),orderId:String(x.orderId),fillId:String(x.fillId),
  groupId:x.groupId,clientId:x.clientId||null,role:x.role,side:x.side,
  qty:Number(x.qty),price:Number(x.price),fee:Number(x.fee),
  realized:Number(x.realized),asset:x.asset,source:'BINANCE_VERIFIED_OCC_FILL'
 }));
 const groups=new Map();
 for(const item of validFills){
  if(!groups.has(item.groupId))groups.set(item.groupId,{entries:[],exits:[]});
  groups.get(item.groupId)[item.role==='ENTRY'?'entries':'exits'].push(item);
 }
 const links=new Map(signalLinks.filter(x=>x?.groupId&&x?.orderId).map(x=>[x.groupId,x]));
 const pct=settings?.tpMode!=='Points';
 const targets={SL:finite(settings?.slPercent),TP1:finite(settings?.tp1Val),
  TP2:finite(settings?.tp2Val),TP3:finite(settings?.tp3Val)};
 const comparisons=[],historyGroups=[];
 const roleOrder=['SL','TP1','TP2','TP3','CLOSE','REVERSE'];
 for(const [groupId,g] of groups){
  if(!g.entries.length)continue;
  const qty=g.entries.reduce((a,f)=>a+f.qty,0);
  const price=g.entries.reduce((a,f)=>a+f.price*f.qty,0)/qty;
  const entryTime=Math.min(...g.entries.map(f=>f.time));
  const side=g.entries[0].side==='BUY'?'LONG':'SHORT';
  const orderId=g.entries[0].orderId;
  const linked=links.get(groupId);
  // Provenance is VERIFIED only if entry ID, group, side and time all agree.
  const proven=linked&&String(linked.orderId)===String(orderId)&&
   linked.side===side&&Number(linked.confirmAt)<=entryTime&&
   Number(linked.confirmAt)>0&&Number(linked.barTime)+M15===Number(linked.confirmAt);
  const candidate=signals.filter(x=>x.side===side&&x.confirmAt<=entryTime&&
   entryTime-x.confirmAt<=2*60*60*1000).at(-1)||null;
  const related=proven?{
   confirmAt:Number(linked.confirmAt),time:Number(linked.barTime),side,
   crossMA:Number(linked.crossMA),triggerBTC:Number(linked.triggerBTC),
   signalClose:Number(linked.signalClose)
  }:candidate;
  const dir=side==='LONG'?1:-1;
  const delta=(role,value,fillTime,fillQty,exitId)=>{
   const target=targets[role];
   const reference=role==='ENTRY'?related?.signalClose:
    related&&target!==null&&target>0?
      (pct?related.signalClose*(1+(role==='SL'?-dir:dir)*target/100):
       related.signalClose+(role==='SL'?-dir:dir)*target):null;
   return {groupId,orderId:String(exitId),side,role,fillTime,qty:round(fillQty,8),
    binancePrice:round(value),referencePrice:reference==null?null:round(reference),
    deltaPrice:reference==null?null:round(value-reference),
    deltaPct:reference==null?null:round((value-reference)/reference*100,4),
    signalTime:related?.confirmAt||null,
    signalClose:related?.signalClose||null,triggerBTC:related?.triggerBTC||null,
    crossMA:related?.crossMA||null,
    delaySeconds:related?round((fillTime-related.confirmAt)/1000,1):null,
    attribution:proven?'VERIFIED_ORDER_SIGNAL':
      related?'NEAREST_PRECEDING_SIGNAL_NOT_PROVEN':'NO_MATCHING_SIGNAL'};
  };
  const closedQty=g.exits.reduce((a,f)=>a+f.qty,0);
  const remaining=Math.max(0,qty-closedQty);
  const status=remaining<=Math.max(1e-8,qty*1e-6)?'CLOSED':
   closedQty>0?'PARTIAL':'OPEN_OR_UNMATCHED_EXIT';
  const exitPrice=closedQty?g.exits.reduce((a,f)=>a+f.price*f.qty,0)/closedQty:null;
  const realized=g.exits.reduce((a,f)=>a+f.realized,0);
  const usdtFees=[...g.entries,...g.exits].filter(f=>f.asset==='USDT')
   .reduce((a,f)=>a+f.fee,0);
  const nonUSDT=[...g.entries,...g.exits].some(f=>f.asset!=='USDT');
  const result={groupId,entryOrderId:orderId,side,
   entryTime,entryPrice:round(price),qtyBTC:round(qty,8),
   closedBTC:round(closedQty,8),remainingBTC:round(remaining,8),
   exitTime:g.exits.length?Math.max(...g.exits.map(f=>f.time)):null,
   exitPrice:exitPrice===null?null:round(exitPrice),
   roles:[...new Set(g.exits.map(f=>f.role))],
   exitOrderIds:[...new Set(g.exits.map(f=>f.orderId))],
   status,realizedUSDT:round(realized,6),feesUSDT:nonUSDT?null:round(usdtFees,6),
   netExFundingUSDT:nonUSDT?null:round(realized-usdtFees,6),
   signalStatus:proven?'VERIFIED_ORDER_SIGNAL':'HISTORICAL_SIGNAL_UNVERIFIED',
   signalAt:proven?Number(linked.confirmAt):null,
   signalClose:proven?Number(linked.signalClose):null,
   triggerBTC:proven?Number(linked.triggerBTC):null,
   crossMA:proven?Number(linked.crossMA):null,
   candidateSignalAt:!proven?candidate?.confirmAt||null:null
  };
  historyGroups.push(result);
  comparisons.push(delta('ENTRY',price,entryTime,qty,orderId));
  for(const role of roleOrder){
   const exits=g.exits.filter(x=>x.role===role);
   if(!exits.length)continue;
   const n=exits.reduce((a,x)=>a+x.qty,0);
   const px=exits.reduce((a,x)=>a+x.price*x.qty,0)/n;
   comparisons.push(delta(role,px,Math.min(...exits.map(x=>x.time)),n,exits[0].orderId));
  }
 }
 historyGroups.sort((a,b)=>b.entryTime-a.entryTime);
 comparisons.sort((a,b)=>b.fillTime-a.fillTime);
 return {symbol:'BTCUSDT',interval:'15m',asOf:now,
  note:'OCC computed causally from completed BTCUSDT Binance candles. Only exchange-verified fills are plotted. Historical signal/order associations are unverified unless a durable matching Entry Order ID record exists.',
  candles:candles.slice(-3500),series:series.slice(-3500),signals:signals.slice(-3500),
  fills:validFills.slice(-5800),historyGroups:historyGroups.slice(0,500),
  comparisons:comparisons.slice(0,500),settings:{
   slPercent:targets.SL,tp1Val:targets.TP1,tp2Val:targets.TP2,
   tp3Val:targets.TP3,tpMode:settings?.tpMode||'Percent'}};
}
