// OCC R5.1: SMMA8, M15 samples of developing H4, delay 0, BOTH, Classic SL/TP=0.
// Deliberately causal: never reproduce historical lookahead_on future leakage.
export const M15 = 900000, H4 = 14400000;
const clone = x => JSON.parse(JSON.stringify(x));
const num = (x, name) => { x=Number(x); if(!Number.isFinite(x)) throw Error(`Invalid ${name}`); return x; };
const barOf = b => Array.isArray(b) ? {time:+b[0],open:+b[1],close:+b[4],closeTime:+b[6]} : {time:+b.time,open:+b.open,close:+b.close,closeTime:+b.closeTime};
export function smma(values, length=8) { if(values.length<length) return null; let v=values.slice(0,length).reduce((a,b)=>a+b,0)/length; for(const x of values.slice(length)) v=(v*(length-1)+x)/length; return v; }
export class OCCEngine {
 constructor(config={}) { this.reset(config); }
 reset(config=this.config) {
  const c={capital:10000,feeBps:5,slippageBps:1,qtyStep:0.001,minQty:0.001,minNotional:0,...config};
  for(const k of Object.keys(c)) c[k]=num(c[k],k);
  if(c.capital<=0||c.feeBps<0||c.slippageBps<0||c.slippageBps>=10000||c.qtyStep<=0||c.minQty<0||c.minNotional<0) throw Error('Invalid simulation assumptions');
  this.config=c; this.balance=c.capital; this.fees=0; this.position=null; this.trades=[];this.signals=[];this.history=[];this.running=false;this.healthy=false;this.ready=false;this.pending=null;this.lastPrice=null;this.lastTradeTime=-1;this.lastTradeId=null;this.lastCandleTime=null;this.previous=null;this.baseOpen=null;this.baseClose=null;this.currentH4=null;this.sessionId=`${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
 }
 setRunning(value) { if(value&&!this.ready) throw Error('Warmup required'); this.running=!!value;if(!value)this.pending=null; }
 setHealthy(value) { this.healthy=!!value; if(!value)this.pending=null; }
 warmup(h4candles,m15candles,now=Date.now()) {
  const h=h4candles.map(barOf).filter(b=>b.time<=now).sort((a,b)=>a.time-b.time);
  const m=m15candles.map(barOf).filter(b=>b.closeTime<now).sort((a,b)=>a.time-b.time);
  if(!m.length) throw Error('No completed M15 candles');
  const start=Math.floor(m[0].time/H4)*H4;
  const seed=h.filter(b=>b.time<start&&b.closeTime<start);
  if(seed.length<8) throw Error('Insufficient H4 SMMA seed');
  for(let i=1;i<seed.length;i++) if(seed[i].time!==seed[i-1].time+H4)throw Error('H4 history gap');
  if(seed.at(-1).time!==start-H4)throw Error('H4 seed not contiguous');
  const first=h.find(b=>b.time===start);
  if(!first&&m[0].time!==start)throw Error('Missing current H4 opening price');
  this.baseOpen=smma(seed.map(b=>b.open));this.baseClose=smma(seed.map(b=>b.close));
  this.currentH4={time:start,open:first?first.open:m[0].open};this.previous=null;this.lastCandleTime=null;this.history=[];this.pending=null;this.ready=false;
  for(const b of m)this.onCandle(b,{live:false,observedAt:now});
  this.ready=true; return this.snapshot();
 }
 onCandle(input,{live=false,observedAt=Date.now()}={}) {
  const b=barOf(input);
  if(!Number.isFinite(b.time)||b.time%M15!==0||b.closeTime!==b.time+M15-1||!(b.open>0)||!(b.close>0)||b.closeTime>=observedAt)throw Error('Invalid or unfinished M15 candle');
  if(this.lastCandleTime!==null&&b.time<=this.lastCandleTime)return null;
  if(this.lastCandleTime!==null&&b.time!==this.lastCandleTime+M15){this.setHealthy(false);throw Error('M15 gap: backfill required');}
  const ht=Math.floor(b.time/H4)*H4;
  if(!this.currentH4||ht!==this.currentH4.time){if(b.time!==ht)throw Error('Missing H4 open');this.currentH4={time:ht,open:b.open};}
  if(this.baseOpen===null||this.baseClose===null)throw Error('Warmup required');
  const openSeries=(this.baseOpen*7+this.currentH4.open)/8, closeSeries=(this.baseClose*7+b.close)/8;
  const diff=closeSeries-openSeries;
  const side=this.previous!==null?(diff>0&&this.previous<=0?'LONG':diff<0&&this.previous>=0?'SHORT':null):null;
  this.history.push({time:b.time,closeTime:b.closeTime,close:b.close,openSeries,closeSeries});
  if(this.history.length>1200)this.history.shift();
  this.previous=diff;this.lastCandleTime=b.time;
  if(b.closeTime===ht+H4-1){this.baseOpen=openSeries;this.baseClose=closeSeries;this.currentH4=null;}
  let signal=null;
  if(side&&live){
   const id=`${this.sessionId}:BTCUSDT:M15:${b.time}:${side}`;
   if(!this.signals.some(s=>s.id===id)){
    signal={id,time:b.closeTime+1,barTime:b.time,observedAt,side,openSeries,closeSeries,eligible:this.running&&this.healthy,source:'Binance USD-M BTCUSDT',mode:'delay0',h4Provisional:(b.closeTime!==ht+H4-1)};
    this.signals.push(Object.freeze(signal));
    if(signal.eligible)this.pending={...signal};
   }
  }
  return signal;
 }
 onTrade({price,time,id},healthy=this.healthy) {
  price=num(price,'trade price');time=num(time,'trade time'); if(price<=0)throw Error('Invalid price');
  if(time<this.lastTradeTime||(id!==undefined&&id===this.lastTradeId))return [];
  this.lastPrice=price;this.lastTradeTime=time;this.lastTradeId=id??null;
  if(!healthy){this.setHealthy(false);return [];}
  this.healthy=true;
  const p=this.pending;
  if(!p||!this.running||time<p.time||time<p.observedAt)return [];
  this.pending=null;
  if(this.position?.side===p.side)return [];
  const fills=[], direction=p.side==='LONG'?1:-1;
  // Reversal is one directional market action: close old, then open new, fee each side.
  const fillPrice=price*(1+direction*this.config.slippageBps/10000);
  const add=(action,qty,pnl=0)=>{const fee=qty*fillPrice*this.config.feeBps/10000;this.fees+=fee;this.balance+=pnl-fee;
   const f={id:`${p.id}:${action}`,signalId:p.id,time,tradeId:id??null,action,side:p.side,qty,price:fillPrice,marketPrice:price,fee,pnl,balance:this.balance};this.trades.push(Object.freeze(f));fills.push(f);};
  if(this.position){const old=this.position;add('CLOSE',old.qty,(fillPrice-old.entryPrice)*old.qty*(old.side==='LONG'?1:-1));this.position=null;}
  const qty=Math.floor(Math.max(0,this.balance)*0.1/fillPrice/this.config.qtyStep+1e-10)*this.config.qtyStep;
  if(qty>=this.config.minQty&&qty*fillPrice>=this.config.minNotional&&qty>0){add('OPEN',qty);this.position={side:p.side,qty,entryPrice:fillPrice,entryTime:time,signalId:p.id};}
  return clone(fills);
 }
 snapshot(){const unrealized=this.position&&this.lastPrice!==null?(this.lastPrice-this.position.entryPrice)*this.position.qty*(this.position.side==='LONG'?1:-1):0;return clone({config:this.config,sessionId:this.sessionId,balance:this.balance,equity:this.balance+unrealized,unrealized,fees:this.fees,position:this.position,trades:this.trades,signals:this.signals,history:this.history,pending:this.pending,running:this.running,healthy:this.healthy,lastCandleTime:this.lastCandleTime,lastPrice:this.lastPrice,ready:this.ready,funding:'excluded'});}
 serialize(){return clone({version:1,...this});}
 static restore(data){if(data?.version!==1)throw Error('Unsupported session');const e=new OCCEngine(data.config);for(const k of Object.keys(e))if(k in data)e[k]=clone(data[k]);e.running=false;e.healthy=false;e.pending=null;return e;}
 exportCSV(){const columns=['id','signalId','time','tradeId','action','side','qty','price','marketPrice','fee','pnl','balance'];const esc=x=>'"'+String(x??'').replaceAll('"','""')+'"';return [columns.join(','),...this.trades.map(r=>columns.map(k=>esc(r[k])).join(','))].join('\r\n');}
}
