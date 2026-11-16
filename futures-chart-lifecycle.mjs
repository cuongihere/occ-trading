// Read-only Binance execution lifecycle. A chart "link" requires actual
// registered OCC order fills. A later opposite entry after SL is NOT proof of
// automated reversal; only an actual REVERSE close has that order role.
const good=n=>Number.isFinite(Number(n))&&Number(n)>0;
const num=n=>Number(n);
const round=(n,d=8)=>Number(num(n).toFixed(d));

export function buildVerifiedTradeSequences(groups=[],fills=[]){
 if(!Array.isArray(groups)||!Array.isArray(fills))
  throw Error('Verified trade lifecycle requires arrays');
 const byGroup=new Map();
 for(const f of fills){
  if(!f||typeof f.groupId!=='string'||!/^[A-Za-z0-9_-]{1,55}$/.test(f.groupId)||
   !['ENTRY','SL','TP1','TP2','TP3','CLOSE','REVERSE'].includes(f.role)||
   !['BUY','SELL'].includes(f.side)||!good(f.qty)||!good(f.price)||
   !Number.isSafeInteger(num(f.time))||num(f.time)<=0||
   !/^[0-9]{1,24}$/.test(String(f.orderId)))continue;
  if(!byGroup.has(f.groupId))byGroup.set(f.groupId,new Map());
  const key=String(f.orderId)+'/'+f.role;
  const list=byGroup.get(f.groupId);
  if(!list.has(key))list.set(key,[]);
  list.get(key).push(f);
 }
 const sequences=[];
 for(const g of groups){
  if(!g||!g.groupId||!['LONG','SHORT'].includes(g.side))continue;
  const raw=byGroup.get(g.groupId);
  if(!raw)continue;
  const events=[];
  for(const items of raw.values()){
   const head=items[0],qty=items.reduce((n,x)=>n+num(x.qty),0),
    price=items.reduce((n,x)=>n+num(x.price)*num(x.qty),0)/qty;
   const role=head.role,at=Math.min(...items.map(x=>num(x.time)));
   events.push({
    id:g.groupId+'/'+head.orderId+'/'+role,groupId:g.groupId,
    role,side:g.side,orderId:String(head.orderId),time:at,
    price:round(price,5),qtyBTC:round(qty),
    realizedUSDT:round(items.reduce((n,x)=>n+Number(x.realized||0),0)),
    feeUSDT:items.every(x=>x.asset==='USDT')?
     round(items.reduce((n,x)=>n+Number(x.fee||0),0)):null,
    label:role==='ENTRY'?g.side+' ENTRY':
     role==='SL'?'SL HIT':role==='REVERSE'?'REVERSE CLOSE':
     role==='CLOSE'?'CLOSE':role+' HIT',
    // These are exchange-verified fills, not working STOP/TP orders.
    source:'BINANCE_VERIFIED_OCC_FILL'
   });
  }
  const ordered=events.sort((a,b)=>a.time-b.time||
   (a.role==='ENTRY'?-1:b.role==='ENTRY'?1:0));
  const entry=ordered.find(e=>e.role==='ENTRY');
  if(!entry)continue;
  const exits=ordered.filter(e=>e.role!=='ENTRY'&&e.time>=entry.time);
  const status=g.status==='CLOSED'?'CLOSED':
    g.status==='PARTIAL'?'PARTIAL':'OPEN_OR_UNMATCHED_EXIT';
  sequences.push({
   groupId:g.groupId,side:g.side,entryOrderId:String(g.entryOrderId||entry.orderId),
   entryTime:entry.time,entryPrice:entry.price,status,entry,exits,
   events:ordered,netExFundingUSDT:g.netExFundingUSDT??null,
   signalStatus:g.signalStatus||'HISTORICAL_SIGNAL_UNVERIFIED',
   signalAt:g.signalAt||null,triggerBTC:g.triggerBTC??null,
   crossMA:g.crossMA??null,signalClose:g.signalClose??null,
   transitions:[]
  });
 }
 sequences.sort((a,b)=>a.entryTime-b.entryTime);
 for(let i=0;i<sequences.length-1;i++){
  const a=sequences[i],b=sequences[i+1];
  if(a.side===b.side||!a.exits.length)continue;
  const last=a.exits.reduce((x,y)=>y.time>x.time?y:x);
  const delta=b.entryTime-last.time;
  if(delta<0)continue;
  const reverse=last.role==='REVERSE'&&delta<=5*60*1000;
  const afterStop=last.role==='SL'&&delta<=24*60*60*1000;
  if(!reverse&&!afterStop)continue;
  const link={
   fromGroupId:a.groupId,toGroupId:b.groupId,
   fromEventId:last.id,toEventId:b.entry.id,
   fromTime:last.time,toTime:b.entryTime,
   fromPrice:last.price,toPrice:b.entry.price,
   kind:reverse?'REVERSE_CLOSE_THEN_OPPOSITE_ENTRY':'SL_THEN_LATER_OPPOSITE_ENTRY',
   verifiedOrders:true,
   verifiedReversalCausality:false,
   // Historical continuity is chronological, never proof of an automated trigger.
   label:reverse?'REVERSE → '+b.side:'SAU SL → '+b.side+' (LỆNH SAU)'
  };
  a.transitions.push(link);b.transitions.push(link);
 }
 return sequences;
}
