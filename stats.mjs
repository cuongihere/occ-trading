/** Summary of COMPLETE positions, aggregating partial TP/SL fills into one trade.
 * Compatible with legacy full-position OPEN/CLOSE journals and Multi TP v5.
 * Positions still open (even after partial take profits) are NOT counted as wins/losses.
 */
export function summarize(fills,sessionIds) {
 const selected=sessionIds==null?null:new Set(Array.isArray(sessionIds)?sessionIds:[sessionIds]);
 const positions=[],open=new Map(),seen=new Map(),EPS=1e-8,QUANTITY_EPS=1e-10;
 let wins=0,losses=0,breakeven=0,grossPnl=0,fees=0,realizedNet=0,losingStreak=0,maxLosingStreak=0;
 const finite=(v,label)=>{if(!Number.isFinite(v))throw Error('Invalid '+label);return v;};
 for(const fill of fills){
  if(typeof fill.id!=='string'||typeof fill.signalId!=='string')throw Error('Missing stable fill/signal ID');
  const sessionId=fill.signalId.split(':')[0];if(!sessionId)throw Error('Missing session ID');
  if(selected&&!selected.has(sessionId))continue;
  const fingerprint=JSON.stringify(fill);
  if(seen.has(fill.id)){if(seen.get(fill.id)!==fingerprint)throw Error('Conflicting duplicate fill ID');continue;}
  seen.set(fill.id,fingerprint);
  const qty=finite(fill.qty,'qty'),price=finite(fill.price,'price'),fee=finite(fill.fee,'fee'),time=finite(fill.time,'time');
  if(qty<=0||price<=0||fee<0||time<0)throw Error('Invalid position fill');
  if(fill.action==='OPEN'){
   if(open.has(sessionId))throw Error('OPEN while previous position remains open');
   if(!['LONG','SHORT'].includes(fill.side))throw Error('Invalid position side');
   open.set(sessionId,{id:fill.id,sessionId,side:fill.side,qty,remainingQty:qty,
    entryTime:time,entryPrice:price,entryFee:fee,exitFees:0,exits:[],grossPnl:0,partialNetPnl:-fee});
  }else if(fill.action==='CLOSE'){
   const entry=open.get(sessionId);if(!entry)throw Error('CLOSE without matching OPEN');
   const tolerance=Math.max(1e-12,entry.qty*QUANTITY_EPS);
   if(qty>entry.remainingQty+tolerance)throw Error('Partial/mismatched quantity exceeds open position');
   if(time<entry.entryTime)throw Error('CLOSE precedes OPEN');
   const gross=finite(fill.pnl,'close pnl');entry.grossPnl+=gross;entry.exitFees+=fee;
   entry.partialNetPnl+=gross-fee;entry.remainingQty=Math.max(0,entry.remainingQty-qty);
   entry.exits.push({id:fill.id,reason:fill.reason??null,qty,price,time,fee,pnl:gross});
   if(entry.remainingQty<=tolerance){
    const totalFees=entry.entryFee+entry.exitFees,net=entry.grossPnl-totalFees;
    const outcome=net>EPS?'WIN':net< -EPS?'LOSS':'BREAKEVEN';
    const last=entry.exits.at(-1);
    const avgExit=entry.exits.reduce((sum,e)=>sum+e.price*e.qty,0)/entry.qty;
    positions.push({id:entry.id,sessionId,side:entry.side,qty:entry.qty,entryTime:entry.entryTime,
     exitTime:last.time,entryPrice:entry.entryPrice,exitPrice:avgExit,exitReason:last.reason,
     exits:entry.exits,grossPnl:entry.grossPnl,fees:totalFees,netPnl:net,outcome});
    open.delete(sessionId);grossPnl+=entry.grossPnl;fees+=totalFees;realizedNet+=net;
    if(outcome==='WIN'){wins++;losingStreak=0;}else if(outcome==='LOSS'){
     losses++;losingStreak++;maxLosingStreak=Math.max(maxLosingStreak,losingStreak);
    }else{breakeven++;losingStreak=0;}
   }
  }else throw Error('Unsupported fill action');
 }
 return {positions,openPositions:[...open.values()],
  summary:{closed:positions.length,wins,losses,breakeven,winRate:positions.length?wins/positions.length*100:0,
   realizedNet,grossPnl,fees,losingStreak,maxLosingStreak}};
}
