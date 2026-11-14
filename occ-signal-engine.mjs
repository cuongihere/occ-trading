// Production-only causal OCC BTCUSDT signal engine.
// No paper positions, balances, simulated fills, funding or strategy order execution.
export const M15=900000,H4=14400000;
const barOf=b=>Array.isArray(b)?{time:+b[0],open:+b[1],close:+b[4],closeTime:+b[6]}:
 {time:+b.time,open:+b.open,close:+b.close,closeTime:+b.closeTime};
export function smma(values,length=8){
 if(values.length<length)return null;
 let v=values.slice(0,length).reduce((a,b)=>a+b,0)/length;
 for(const x of values.slice(length))v=(v*(length-1)+x)/length;
 return v;
}
export class OCCSignalEngine{
 constructor(){
  this.ready=false;this.healthy=false;this.running=false;
  this.baseOpen=null;this.baseClose=null;this.currentH4=null;
  this.previous=null;this.lastCandleTime=null;this.history=[];
  this.sessionId=String(Date.now())+'-'+Math.random().toString(36).slice(2,9);
 }
 setHealthy(yes){this.healthy=Boolean(yes);}
 setRunning(yes){if(yes&&!this.ready)throw Error('Warmup required');this.running=Boolean(yes);}
 warmup(h4candles,m15candles,now=Date.now()){
  const h=h4candles.map(barOf).filter(b=>b.time<=now).sort((a,b)=>a.time-b.time);
  const m=m15candles.map(barOf).filter(b=>b.closeTime<now).sort((a,b)=>a.time-b.time);
  if(!m.length)throw Error('No completed M15 candles');
  const start=Math.floor(m[0].time/H4)*H4;
  const seed=h.filter(b=>b.time<start&&b.closeTime<start);
  if(seed.length<8)throw Error('Insufficient H4 SMMA seed');
  for(let i=1;i<seed.length;i++)if(seed[i].time!==seed[i-1].time+H4)throw Error('H4 history gap');
  if(seed.at(-1).time!==start-H4)throw Error('H4 seed not contiguous');
  const first=h.find(b=>b.time===start);
  if(!first&&m[0].time!==start)throw Error('Missing current H4 opening price');
  this.baseOpen=smma(seed.map(b=>b.open));this.baseClose=smma(seed.map(b=>b.close));
  this.currentH4={time:start,open:first?first.open:m[0].open};
  this.previous=null;this.lastCandleTime=null;this.history=[];this.ready=false;
  for(const candle of m)this.onCandle(candle,{live:false,observedAt:now});
  this.ready=true;return {ready:this.ready,historyCount:this.history.length};
 }
 onCandle(input,{live=false,observedAt=Date.now()}={}){
  const b=barOf(input);
  if(!Number.isFinite(b.time)||b.time%M15!==0||b.closeTime!==b.time+M15-1||
    !(b.open>0)||!(b.close>0)||b.closeTime>=observedAt)
   throw Error('Invalid/unfinished M15 candle');
  if(this.lastCandleTime!==null&&b.time<=this.lastCandleTime)return null;
  if(this.lastCandleTime!==null&&b.time!==this.lastCandleTime+M15){
   this.setHealthy(false);throw Error('M15 gap: backfill required');
  }
  const ht=Math.floor(b.time/H4)*H4;
  if(!this.currentH4||ht!==this.currentH4.time){
   if(b.time!==ht)throw Error('Missing H4 open');
   this.currentH4={time:ht,open:b.open};
  }
  if(this.baseOpen===null||this.baseClose===null)throw Error('Warmup required');
  const openSeries=(this.baseOpen*7+this.currentH4.open)/8;
  const closeSeries=(this.baseClose*7+b.close)/8;
  const diff=closeSeries-openSeries;
  const triggerPrice=this.currentH4.open+7*(this.baseOpen-this.baseClose);
  const side=this.previous!==null?
   (diff>0&&this.previous<=0?'LONG':diff<0&&this.previous>=0?'SHORT':null):null;
  this.history.push({time:b.time,closeTime:b.closeTime,close:b.close,openSeries,closeSeries});
  if(this.history.length>1200)this.history.shift();
  this.previous=diff;this.lastCandleTime=b.time;
  if(b.closeTime===ht+H4-1){
   this.baseOpen=openSeries;this.baseClose=closeSeries;this.currentH4=null;
  }
  if(!side||!live)return null;
  return Object.freeze({
   id:this.sessionId+':BTCUSDT:M15:'+b.time+':'+side,
   time:b.closeTime+1,barTime:b.time,observedAt,side,
   candleClose:b.close,crossPrice:(openSeries+closeSeries)/2,
   triggerPrice,openSeries,closeSeries,
   eligible:this.running&&this.healthy,
   source:'Binance USD-M BTCUSDT',mode:'delay0',
   h4Provisional:b.closeTime!==ht+H4-1
  });
 }
}
