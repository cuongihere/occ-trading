// Verified Binance OCC live history discovery; no order mutations or fabricated fills.
// Every trade is identified through a Binance orderId and verified OCCBTC client prefix.
import {syncKnownOrderFills} from './binance-live-stats.mjs';
const ROOT=/^OCCBTC-[0-9a-f]{14}$/;
const ALGO=/^(OCCBTC-[0-9a-f]{14})-(SL|TP[123])$/;
const numericOrder=v=>/^[1-9][0-9]{0,23}$/.test(String(v??''))?String(v):null;
const sideFor=side=>side==='LONG'?'BUY':side==='SHORT'?'SELL':null;
// Binance allOrders/allAlgoOrders default to RECENT 7 DAYS even with limit 1000.
// Backfill 30 days using strictly <7-day requests; split saturated pages so
// old STOP fills cannot silently disappear from historical OCC statistics.
export const HISTORY_DAYS=30;
export async function fetchWindowedOrderHistory(api,endpoint,{now=Date.now(),days=HISTORY_DAYS,maxCalls=64}={}){
 if(!['/fapi/v1/allOrders','/fapi/v1/allAlgoOrders'].includes(endpoint))
  throw Error('Unsupported history endpoint');
 const earliest=now-days*86400000,unique=new Map();
 let calls=0;
 async function scan(start,end){
  if(++calls>maxCalls)throw Error(endpoint+' exceeded bounded history request budget');
  const rows=await api.get(endpoint,{symbol:'BTCUSDT',
   startTime:start,endTime:end,limit:1000});
  if(!Array.isArray(rows))throw Error('Invalid Binance order history');
  if(rows.length>=1000){
   if(start>=end)throw Error('History page saturated at one millisecond; cannot claim complete scan');
   const mid=Math.floor((start+end)/2);
   await scan(start,mid);await scan(mid+1,end);return;
  }
  const field=endpoint.endsWith('/allOrders')?'orderId':'algoId';
  for(const row of rows){
   const id=numericOrder(row?.[field]);
   if(!id)continue; // Invalid IDs cannot become OCC evidence.
   const current=unique.get(id);
   if(current&&JSON.stringify(current)!==JSON.stringify(row))
    throw Error('Conflicting Binance order IDs across windows');
   unique.set(id,row);
  }
 }
 let end=now;
 while(end>=earliest){
  const start=Math.max(earliest,end-(6*86400000-1));
  await scan(start,end);
  end=start-1;
 }
 return {rows:[...unique.values()],calls,startAt:earliest,checkedAt:now};
}
export async function discoverOCCOrderIds(api,ledger,{checkpoint=null,intent=null}={}){
 const warnings=[];let discovered=0;
 const add=record=>{if(ledger.register(record))discovered++;};
 let ordinary=[];
 try{
  ordinary=(await fetchWindowedOrderHistory(api,'/fapi/v1/allOrders')).rows;
 }catch(e){warnings.push('Không đồng bộ đủ Entry '+HISTORY_DAYS+' ngày: '+e.message);}

 for(const order of ordinary){
  const id=numericOrder(order?.orderId),client=String(order?.clientOrderId||'');
  const amount=Number(order?.executedQty);
  const hasRealFill=Number.isFinite(amount)&&amount>0&&
   (order?.status==='FILLED'||(order?.type==='LIMIT'&&
    ['CANCELED','EXPIRED','EXPIRED_IN_MATCH'].includes(order.status)));
  if(!id||!ROOT.test(client)||order.symbol!=='BTCUSDT'||
     !['MARKET','LIMIT'].includes(order.type)||order.positionSide!=='BOTH'||!hasRealFill||
     (order.reduceOnly===true||order.reduceOnly==='true')||!['BUY','SELL'].includes(order.side))continue;
  add({orderId:id,groupId:client,clientId:client,role:'ENTRY',side:order.side});
 }
 if(checkpoint?.entry){
  const entry=checkpoint.entry,prefix=String(entry.clientPrefix||'');
  const id=numericOrder(entry.orderId);
  if(ROOT.test(prefix)&&id){
   try{
    const o=await api.get('/fapi/v1/order',{symbol:'BTCUSDT',orderId:id});
    if(o?.symbol==='BTCUSDT'&&String(o.orderId)===id&&o.clientOrderId===prefix&&
      ['MARKET','LIMIT'].includes(o.type)&&o.status==='FILLED'&&o.positionSide==='BOTH'&&
      o.side===sideFor(entry.side)&&Number(o.executedQty)>0)
     add({orderId:id,groupId:prefix,clientId:prefix,role:'ENTRY',side:o.side});
    else warnings.push('Entry OCC trong checkpoint không khớp lệnh Binance; không ghi lịch sử sai.');
   }catch(e){warnings.push('Không xác minh được Entry OCC cũ: '+e.message);}
  }
 }
 const allAlgos=[];
 try{
  const found=await fetchWindowedOrderHistory(api,'/fapi/v1/allAlgoOrders');
  allAlgos.push(...found.rows);
 }catch(e){warnings.push('Không đồng bộ đủ Algo SL/TP '+HISTORY_DAYS+' ngày: '+e.message);}
 // Checkpoint supplies exact Algo IDs even if allAlgoOrders did not include them.
 const tracked=[checkpoint?.stop,...checkpoint?.tps||[]].filter(x=>x?.id!=null);
 for(const saved of tracked){
  if(allAlgos.some(x=>String(x.algoId)===String(saved.id)))continue;
  try{
   const algo=await api.get('/fapi/v1/algoOrder',{symbol:'BTCUSDT',algoId:String(saved.id)});
   if(algo)allAlgos.push(algo);
  }catch(e){warnings.push('Không xác minh được SL/TP #'+saved.id+': '+e.message);}
 }
 for(const a of allAlgos){
  const match=ALGO.exec(String(a?.clientAlgoId||''));
  const actual=numericOrder(a?.actualOrderId);
  if(!match||!actual||a.symbol!=='BTCUSDT'||a.positionSide!=='BOTH'||
    !['BUY','SELL'].includes(a.side))continue;
  const [client,group,role]=match;
   const canonicalGroup=checkpoint?.entry?.algoPrefix===group?
    checkpoint.entry.clientPrefix:group;
  // Verify an actual executed child order exists before attributing P&L.
  try{
   const child=await api.get('/fapi/v1/order',{symbol:'BTCUSDT',orderId:actual});
   if(child?.symbol!=='BTCUSDT'||String(child.orderId)!==actual||
      child.side!==a.side||(child.positionSide&&child.positionSide!=='BOTH')||
      !['FILLED','PARTIALLY_FILLED'].includes(child.status)||
      !(Number(child.executedQty)>0))continue;
   add({orderId:actual,groupId:canonicalGroup,clientId:client,role,side:a.side});
  }catch(e){warnings.push('Không xác minh được lệnh thực thi SL/TP #'+a.algoId+': '+e.message);}
 }
 // Recovery of a reverse reduceOnly close if the final ACK was never persisted.
 if(ROOT.test(String(intent?.oldClientId||''))&&ROOT.test(String(intent?.closeId||''))){
  try{
   const o=await api.get('/fapi/v1/order',{symbol:'BTCUSDT',origClientOrderId:intent.closeId});
   if(o?.symbol==='BTCUSDT'&&o.clientOrderId===intent.closeId&&
     o.status==='FILLED'&&o.type==='MARKET'&&(o.reduceOnly===true||o.reduceOnly==='true')&&
     numericOrder(o.orderId)){
    const role=['TP1','TP2','TP3','CLOSE'].includes(intent.role)?intent.role:'REVERSE';
    add({orderId:String(o.orderId),groupId:intent.oldClientId,
     clientId:intent.closeId,role,side:o.side});
   }
  }catch(e){warnings.push('Không xác minh được lệnh đóng đảo chiều: '+e.message);}
 }
 return {discovered,warnings};
}
// Query all recent BTCUSDT fills, including orders OCC can no longer identify.
// Binance caps each response at 1000 and prohibits fromId with time bounds.
// Recursively partition the 7-day interval instead of silently losing fills.
export async function fetchExchangeTrades7Days(api,{now=Date.now(),startTime=null,maxCalls=32}={}){
 const first=Math.max(0,startTime==null?now-7*86400000:Number(startTime)),full=[];
 if(!Number.isSafeInteger(first)||!Number.isSafeInteger(now)||now<first||
    now-first>7*86400000)throw Error('Binance userTrades date window must be <=7 days');
 let calls=0;
 async function scan(start,end){
  if(++calls>maxCalls)throw Error('Binance userTrades exceeds bounded audit capacity; partial scan discarded');
  const rows=await api.get('/fapi/v1/userTrades',{
   symbol:'BTCUSDT',startTime:start,endTime:end,limit:1000});
  if(!Array.isArray(rows))throw Error('Invalid Binance userTrades response');
  if(rows.length>=1000){
   if(start>=end)throw Error('At least 1000 fills at one timestamp; cannot claim a complete scan');
   const mid=Math.floor((start+end)/2);
   await scan(start,mid);
   await scan(mid+1,end);
   return;
  }
  for(const x of rows){
   if(x?.symbol!=='BTCUSDT'||!Number.isSafeInteger(Number(x.time))||
      Number(x.time)<start||Number(x.time)>end)
    throw Error('Inconsistent Binance account trade timestamps/symbol');
   full.push(x);
  }
 }
 await scan(first,now);
 const seen=new Set();
 for(const x of full){
  const id=String(x.id);
  if(seen.has(id))throw Error('Binance userTrades returned duplicate trade ID across windows');
  seen.add(id);
 }
 return {rows:full,checkedAt:now,requests:calls};
}
// Multi-window 30-day scan preserves actual historic BTC fills beyond the
// single 7-day Binance API default. All pages must succeed before committing.
export async function fetchExchangeTrades30Days(api,{now=Date.now(),maxCalls=96}={}){
 const earliest=now-HISTORY_DAYS*86400000,all=[],seen=new Set();
 let requests=0;
 let end=now;
 while(end>=earliest){
  const start=Math.max(earliest,end-(6*86400000-1));
  const result=await fetchExchangeTrades7Days(api,{now:end,startTime:start,maxCalls:maxCalls-requests});
  requests+=result.requests;
  for(const row of result.rows){
   if(seen.has(String(row.id)))throw Error('Binance duplicated trade IDs across history windows');
   seen.add(String(row.id));all.push(row);
  }
  end=start-1;
 }
 return {rows:all,checkedAt:now,startAt:earliest,requests};
}
export async function syncBinanceIncome(api,ledger,{now=Date.now()}={}){
 // Binance Income is account-level, unlike trade-specific userTrades.
 // Use one bounded seven-day window; do not claim exhaustive data if truncated.
 const rows=await api.get('/fapi/v1/income',{
  symbol:'BTCUSDT',startTime:now-7*86400000,endTime:now,limit:1000
 });
 if(!Array.isArray(rows)||rows.length>=1000)
  throw Error('Binance Income có thể chưa đầy đủ; từ chối kết quả phân trang thiếu.');
 return {newIncome:ledger.ingestIncome(rows),incomeCheckedAt:now};
}
export async function syncOCCLiveHistory(api,ledger,inputs={}){
 const found=await discoverOCCOrderIds(api,ledger,inputs);
 let exchangeTradesUpdated=false,newExchangeFills=0,accountRequests=0,newFillsFull=0;
 if(inputs.syncExchangeTrades===true){
  try{
   const audit=await fetchExchangeTrades30Days(api);
   // Ingestion is atomic; don't record a "full scan" if pagination fails.
   newExchangeFills=ledger.ingestExchange(audit.rows,audit.checkedAt,audit.startAt);
   // Once discovered, all known OCC orderId fills can be matched directly.
   newFillsFull=ledger.ingest(audit.rows);
   accountRequests=audit.requests;exchangeTradesUpdated=true;
  }catch(e){found.warnings.push('Chưa quét đủ Binance userTrades 30 ngày: '+e.message);}
 }
 let incomeUpdated=false;
 if(inputs.syncIncome===true){
  try{
   const audit=await syncBinanceIncome(api,ledger);
   incomeUpdated=true;found.newIncome=audit.newIncome;
  }catch(e){found.warnings.push('Binance Income chưa đối soát: '+e.message);}
 }
 let synced={tracked:ledger.orders().length,newFills:0,report:ledger.report()};
 try{synced=await syncKnownOrderFills(api,ledger);}
 catch(e){found.warnings.push('Không đồng bộ đầy đủ được fill Binance: '+e.message);}
 return {...found,...synced,newFills:synced.newFills+newFillsFull,
  exchangeTradesUpdated,newExchangeFills,accountRequests,report:ledger.report(),incomeUpdated};
}
