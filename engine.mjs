// OCC R5.1: SMMA8, M15 samples of developing H4, delay 0, BOTH; Multi TP v5 exits.
// Deliberately causal: never reproduce historical lookahead_on future leakage.
export const M15 = 900000, H4 = 14400000;
const clone = x => JSON.parse(JSON.stringify(x));
const num = (x, name) => { x=Number(x); if(!Number.isFinite(x)) throw Error(`Invalid ${name}`); return x; };
const barOf = b => Array.isArray(b) ? {time:+b[0],open:+b[1],close:+b[4],closeTime:+b[6]} : {time:+b.time,open:+b.open,close:+b.close,closeTime:+b.closeTime};
export function smma(values, length=8) { if(values.length<length) return null; let v=values.slice(0,length).reduce((a,b)=>a+b,0)/length; for(const x of values.slice(length)) v=(v*(length-1)+x)/length; return v; }
export class OCCEngine {
 constructor(config={}) { this.reset(config); }
 reset(config=this.config) {
  const c={capital:10000,feeBps:5,slippageBps:1,qtyStep:0.001,minQty:0.001,minNotional:0,
   tickSize:0.1,exitMode:'Multi TP v5',classicSlPoints:0,classicTpPoints:0,
   slPercent:1,tpMode:'Percent',tp1Val:1,tp2Val:2,tp3Val:3,tp1Qty:33,tp2Qty:33,reverseOnSignal:false,...config};
  const numeric=['capital','feeBps','slippageBps','qtyStep','minQty','minNotional','tickSize',
   'classicSlPoints','classicTpPoints','slPercent','tp1Val','tp2Val','tp3Val','tp1Qty','tp2Qty'];
  for(const k of numeric)c[k]=num(c[k],k);
  if(typeof c.reverseOnSignal!=='boolean')throw Error('Invalid reversal setting');
  if(c.capital<=0||c.feeBps<0||c.slippageBps<0||c.slippageBps>=10000||
     c.qtyStep<=0||c.minQty<0||c.minNotional<0||c.tickSize<=0||
     !['Classic v3','Multi TP v5'].includes(c.exitMode)||!['Percent','Points'].includes(c.tpMode)||
     c.classicSlPoints<0||!Number.isSafeInteger(c.classicSlPoints)||
     c.classicTpPoints<0||!Number.isSafeInteger(c.classicTpPoints)||
     [c.slPercent,c.tp1Val,c.tp2Val,c.tp3Val,c.tp1Qty,c.tp2Qty].some(x=>x<0)||
     c.tp1Qty>100||c.tp2Qty>100) throw Error('Invalid simulation/exit settings');
  this.config=c;this.balance=c.capital;this.fees=0;this.position=null;this.trades=[];this.signals=[];this.history=[];
  this.running=false;this.healthy=false;this.ready=false;this.pending=null;this.lastPrice=null;
  this.lastTradeTime=-1;this.lastTradeId=null;this.lastCandleTime=null;this.previous=null;
  this.baseOpen=null;this.baseClose=null;this.currentH4=null;this.tradingEnabled=false;
  this.sessionId=String(Date.now())+'-'+Math.random().toString(36).slice(2,9);
 }
 levels() {
  const p=this.position;if(!p)return null;
  const c=this.config,long=p.side==='LONG',entry=p.entryPrice,d=long?1:-1;
  if(c.exitMode==='Classic v3')return {mode:c.exitMode,entry,
   sl:c.classicSlPoints?entry-d*c.classicSlPoints*c.tickSize:null,
   tp1:c.classicTpPoints?entry+d*c.classicTpPoints*c.tickSize:null,
   tp2:null,tp3:null,qty1:p.qty,qty2:0,qty3:0,remaining:p.qty};
  const target=v=>v>0?(c.tpMode==='Percent'?entry*(1+d*v/100):entry+d*v):null;
  return {mode:c.exitMode,entry,sl:c.slPercent?entry*(1-d*c.slPercent/100):null,
   tp1:target(c.tp1Val),tp2:target(c.tp2Val),tp3:target(c.tp3Val),
   qty1:p.legs?.find(x=>x.id==='TP1')?.qty??0,qty2:p.legs?.find(x=>x.id==='TP2')?.qty??0,
   qty3:p.legs?.find(x=>x.id==='TP3')?.qty??0,remaining:p.qty};
 }
 makeLegs(qty,entry,side){
  const c=this.config,d=side==='LONG'?1:-1,round=x=>Number(x.toFixed(12));
  if(c.exitMode==='Classic v3')return [{id:'CLASSIC',qty,
   target:c.classicTpPoints?entry+d*c.classicTpPoints*c.tickSize:null,
   stop:c.classicSlPoints?entry-d*c.classicSlPoints*c.tickSize:null}];
  const stop=c.slPercent?entry*(1-d*c.slPercent/100):null;
  const target=v=>v>0?(c.tpMode==='Percent'?entry*(1+d*v/100):entry+d*v):null;
  const weights=[Math.min(100,c.tp1Qty),Math.min(100-c.tp1Qty,c.tp2Qty)];
  const shares=weights.map(w=>round(Math.floor(qty*w/100/c.qtyStep+1e-10)*c.qtyStep));
  const portions=[shares[0],shares[1],0];
  const rest=round(Math.max(0,qty-shares[0]-shares[1]));
  const lastWeight=100-weights[0]-weights[1];
  const lastEligible=lastWeight>0?2:weights[1]>0?1:0;
  portions[lastEligible]=round(portions[lastEligible]+rest);
  const targets=[target(c.tp1Val),target(c.tp2Val),target(c.tp3Val)];
  return portions.map((q,i)=>({id:'TP'+(i+1),qty:q,target:targets[i],stop})).filter(l=>l.qty>1e-12);
 }
 // Check every trade event without writing every tick to SQLite.
 exitTrigger(price){
  const p=this.position;if(!p||!Number.isFinite(price)||price<=0)return false;
  const long=p.side==='LONG';
  return !!p.legs?.some(l=>l.qty>1e-12&&
   ((l.stop!==null&&(long?price<=l.stop:price>=l.stop))||
    (l.target!==null&&(long?price>=l.target:price<=l.target))));
 }
 setRunning(value) { if(value&&!this.ready) throw Error('Warmup required'); this.running=!!value;if(!value)this.pending=null; }
 configure(update) {
  if(this.running||this.position)throw Error('Tạm dừng và đóng hết vị thế mô phỏng trước khi thay đổi cài đặt.');
  const allowed=['feeBps','slippageBps','slPercent','tpMode','tp1Val','tp2Val','tp3Val','tp1Qty','tp2Qty','reverseOnSignal'];
  const changes=Object.fromEntries(allowed.filter(k=>Object.hasOwn(update,k)).map(k=>[k,update[k]]));
  const next=new OCCEngine({...this.config,...changes,exitMode:'Multi TP v5'});
  if(next.config.feeBps>500||next.config.slippageBps>1000)throw Error('Phí hoặc slippage vượt giới hạn.');
  this.config=next.config;this.pending=null;this.tradingEnabled=false;
  return this.config;
 }

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
    signal={id,time:b.closeTime+1,barTime:b.time,observedAt,side,openSeries,closeSeries,eligible:this.running&&this.healthy&&(!this.position||(this.config.reverseOnSignal&&this.position.side!==side)),source:'Binance USD-M BTCUSDT',mode:'delay0',h4Provisional:(b.closeTime!==ht+H4-1)};
    this.signals.push(Object.freeze(signal));
    if(signal.eligible)this.pending={...signal};
   }
  }
  return signal;
 }
 onTrade({price,time,id},healthy=this.healthy) {
  price=num(price,'trade price');time=num(time,'trade time');if(price<=0)throw Error('Invalid price');
  if(time<this.lastTradeTime||(id!==undefined&&id===this.lastTradeId))return [];
  this.lastPrice=price;this.lastTradeTime=time;this.lastTradeId=id??null;
  if(!healthy){this.setHealthy(false);return [];}this.healthy=true;
  // Never reverse an existing position, including when its last TP/SL fills on this tick.
  const wasPositionOpen=Boolean(this.position);
  if(wasPositionOpen&&!this.config.reverseOnSignal)this.pending=null; // hold mode: no old crossover replay
  const fills=[],c=this.config,round=x=>Number(x.toFixed(12));
  const close=(qty,fillPrice,reason,signalId,fillId)=>{
   const p=this.position;if(!p||qty<=0)return;
   if(qty>p.qty+1e-9)throw Error('Exit exceeds remaining position');
   const pnl=(fillPrice-p.entryPrice)*qty*(p.side==='LONG'?1:-1);
   const fee=qty*fillPrice*c.feeBps/10000;
   this.fees+=fee;this.balance+=pnl-fee;
   const f={id:fillId,signalId,time,tradeId:id??null,action:'CLOSE',side:p.side,
    qty,price:fillPrice,marketPrice:price,fee,pnl,balance:this.balance,reason};
   this.trades.push(Object.freeze(f));fills.push(f);
   p.qty=round(Math.max(0,p.qty-qty));if(p.qty<=1e-12)this.position=null;
  };
  // Exit orders remain active while new entries are paused; stale feeds never fill.
  if(this.position?.legs?.length){
   const p=this.position,long=p.side==='LONG',sell=long?-1:1;
   const stopLegs=p.legs.filter(l=>l.qty>1e-12&&l.stop!==null&&(long?price<=l.stop:price>=l.stop));
   if(stopLegs.length){
    const stopQty=round(stopLegs.reduce((sum,l)=>sum+l.qty,0));
    const stopPrice=price*(1+sell*c.slippageBps/10000);
    const exitId=p.signalId+':EXIT:SL:'+time+':'+String(id??'none');
    p.legs=p.legs.filter(l=>!stopLegs.includes(l));
    close(stopQty,stopPrice,'SL',p.signalId,exitId);
   }
   if(this.position){
    for(const leg of [...(this.position.legs||[])]){
     if(leg.qty>1e-12&&leg.target!==null&&(long?price>=leg.target:price<=leg.target)){
      const exitId=p.signalId+':EXIT:'+leg.id;
      const qty=leg.qty;this.position.legs=this.position.legs.filter(l=>l!==leg);
      close(qty,leg.target,leg.id,p.signalId,exitId);
      if(!this.position)break;
     }
    }
   }
  }
  const pending=this.pending;
  if(!pending||!this.running||time<pending.time||time<pending.observedAt)return clone(fills);
  this.pending=null;
  // Hold mode needs a fresh signal after fully flat. Reverse mode restores
  // the original OCC opposite-crossover exit/entry semantics.
  if(!this.config.reverseOnSignal&&(wasPositionOpen||this.position))return clone(fills);
  if(this.position?.side===pending.side)return clone(fills);
  const direction=pending.side==='LONG'?1:-1;
  const fillPrice=price*(1+direction*c.slippageBps/10000);
  if(this.position){
   close(this.position.qty,fillPrice,'REVERSE',pending.id,pending.id+':CLOSE');
  }
  const qty=round(Math.floor(Math.max(0,this.balance)*0.1/fillPrice/c.qtyStep+1e-10)*c.qtyStep);
  if(qty>=c.minQty&&qty*fillPrice>=c.minNotional&&qty>0){
   const fee=qty*fillPrice*c.feeBps/10000;this.fees+=fee;this.balance-=fee;
   const f={id:pending.id+':OPEN',signalId:pending.id,time,tradeId:id??null,
    action:'OPEN',side:pending.side,qty,price:fillPrice,marketPrice:price,fee,pnl:0,balance:this.balance};
   this.trades.push(Object.freeze(f));fills.push(f);
   this.position={side:pending.side,qty,entryQty:qty,entryPrice:fillPrice,entryTime:time,
    signalId:pending.id,legs:this.makeLegs(qty,fillPrice,pending.side)};
  }
  return clone(fills);
 }
 snapshot(){const unrealized=this.position&&this.lastPrice!==null?(this.lastPrice-this.position.entryPrice)*this.position.qty*(this.position.side==='LONG'?1:-1):0;return clone({config:this.config,sessionId:this.sessionId,balance:this.balance,equity:this.balance+unrealized,unrealized,fees:this.fees,position:this.position,levels:this.levels(),trades:this.trades,signals:this.signals,history:this.history,pending:this.pending,running:this.running,healthy:this.healthy,lastCandleTime:this.lastCandleTime,lastPrice:this.lastPrice,ready:this.ready,funding:'excluded'});}
 serialize(){return clone({version:1,...this});}
 static restore(data){if(data?.version!==1)throw Error('Unsupported session');
  const cfg={...(data.config||{})};if(!Object.hasOwn(cfg,'exitMode'))cfg.exitMode='Classic v3';
  const e=new OCCEngine(cfg);for(const k of Object.keys(e))if(k in data)e[k]=clone(data[k]);
  e.config={...new OCCEngine(cfg).config,...cfg};
  if(e.position&&!e.position.legs)e.position.legs=e.makeLegs(e.position.qty,e.position.entryPrice,e.position.side);
  e.tradingEnabled=Boolean(data.tradingEnabled ?? data.running);
  e.running=false;e.healthy=false;e.pending=null;return e;}
 exportCSV(){const columns=['id','signalId','time','tradeId','action','side','qty','price','marketPrice','fee','pnl','balance'];const esc=x=>'"'+String(x??'').replaceAll('"','""')+'"';return [columns.join(','),...this.trades.map(r=>columns.map(k=>esc(r[k])).join(','))].join('\r\n');}
}
