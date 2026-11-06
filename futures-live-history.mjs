// Verified Binance OCC live history discovery; no order mutations or fabricated fills.
// Every trade is identified through a Binance orderId and verified OCCBTC client prefix.
import {syncKnownOrderFills} from './binance-live-stats.mjs';
const ROOT=/^OCCBTC-[0-9a-f]{14}$/;
const ALGO=/^(OCCBTC-[0-9a-f]{14})-(SL|TP[123])$/;
const numericOrder=v=>/^[1-9][0-9]{0,23}$/.test(String(v??''))?String(v):null;
const sideFor=side=>side==='LONG'?'BUY':side==='SHORT'?'SELL':null;
export async function discoverOCCOrderIds(api,ledger,{checkpoint=null,intent=null}={}){
 const warnings=[];let discovered=0;
 const add=record=>{if(ledger.register(record))discovered++;};
 let ordinary=[];
 try{
  ordinary=await api.get('/fapi/v1/allOrders',{symbol:'BTCUSDT',limit:1000});
  if(!Array.isArray(ordinary))throw Error('Invalid allOrders response');
  if(ordinary.length>=1000)warnings.push('Binance chỉ trả 1000 lệnh gần nhất; lịch sử xa hơn có thể cần đồng bộ bổ sung.');
 }catch(e){warnings.push('Không đọc được lịch sử Entry Binance: '+e.message);}
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
  const orders=await api.get('/fapi/v1/allAlgoOrders',{symbol:'BTCUSDT',limit:1000});
  if(!Array.isArray(orders))throw Error('Invalid allAlgoOrders response');
  allAlgos.push(...orders);
  if(orders.length>=1000)warnings.push('Lịch sử SL/TP Binance vượt giới hạn một trang (1000).');
 }catch(e){warnings.push('Không đọc được lịch sử SL/TP Binance: '+e.message);}
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
  // Verify an actual executed child order exists before attributing P&L.
  try{
   const child=await api.get('/fapi/v1/order',{symbol:'BTCUSDT',orderId:actual});
   if(child?.symbol!=='BTCUSDT'||String(child.orderId)!==actual||
      child.side!==a.side||!['FILLED','PARTIALLY_FILLED'].includes(child.status)||
      !(Number(child.executedQty)>0))continue;
   add({orderId:actual,groupId:group,clientId:client,role,side:a.side});
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
 return {...found,...synced,report:ledger.report(),incomeUpdated};
}
