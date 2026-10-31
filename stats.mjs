/** Full-position paper-fill statistics. Funding is excluded by this engine.
 * Input order is persisted event order (a reversal CLOSE must precede OPEN).
 * Open positions never contribute to win rate or realized closed-position PnL.
 */
export function summarize(fills,sessionIds) {
 const selected=sessionIds==null?null:new Set(Array.isArray(sessionIds)?sessionIds:[sessionIds]);
 const positions=[],open=new Map(),seen=new Map(),EPS=1e-8;
 let wins=0,losses=0,breakeven=0,grossPnl=0,fees=0,realizedNet=0,losingStreak=0,maxLosingStreak=0;
 const finite=(v,label)=>{if(!Number.isFinite(v))throw Error(`Invalid ${label}`);return v;};
 for(const fill of fills){
  if(typeof fill.id!=='string'||typeof fill.signalId!=='string')throw Error('Missing stable fill/signal ID');
  const sessionId=fill.signalId.split(':')[0];
  if(!sessionId)throw Error('Missing session ID');
  if(selected&&!selected.has(sessionId))continue;
  const fingerprint=JSON.stringify(fill);
  if(seen.has(fill.id)){if(seen.get(fill.id)!==fingerprint)throw Error('Conflicting duplicate fill ID');continue;}
  seen.set(fill.id,fingerprint);
  const qty=finite(fill.qty,'qty'),price=finite(fill.price,'price'),fee=finite(fill.fee,'fee'),time=finite(fill.time,'time');
  if(qty<=0||price<=0||fee<0||time<0)throw Error('Invalid full-position fill');
  if(fill.action==='OPEN'){
   if(open.has(sessionId))throw Error('OPEN while previous position remains open');
   if(!['LONG','SHORT'].includes(fill.side))throw Error('Invalid position side');
   open.set(sessionId,{id:fill.id,sessionId,side:fill.side,qty,entryTime:time,entryPrice:price,entryFee:fee});
  }else if(fill.action==='CLOSE'){
   const entry=open.get(sessionId);if(!entry)throw Error('CLOSE without matching OPEN');
   if(Math.abs(qty-entry.qty)>Math.max(1e-12,entry.qty*1e-10))throw Error('Partial/mismatched quantity is unsupported');
   if(time<entry.entryTime)throw Error('CLOSE precedes OPEN');
   const gross=finite(fill.pnl,'close pnl'),totalFees=entry.entryFee+fee,net=gross-totalFees;
   const outcome=net>EPS?'WIN':net< -EPS?'LOSS':'BREAKEVEN';
   positions.push({id:entry.id,sessionId,side:entry.side,qty:entry.qty,entryTime:entry.entryTime,exitTime:time,entryPrice:entry.entryPrice,exitPrice:price,grossPnl:gross,fees:totalFees,netPnl:net,outcome});
   open.delete(sessionId);grossPnl+=gross;fees+=totalFees;realizedNet+=net;
   if(outcome==='WIN'){wins++;losingStreak=0;}else if(outcome==='LOSS'){losses++;losingStreak++;maxLosingStreak=Math.max(maxLosingStreak,losingStreak);}else{breakeven++;losingStreak=0;}
  }else throw Error('Unsupported fill action');
 }
 return {positions,openPositions:[...open.values()],summary:{closed:positions.length,wins,losses,breakeven,winRate:positions.length?wins/positions.length*100:0,realizedNet,grossPnl,fees,losingStreak,maxLosingStreak}};
}
