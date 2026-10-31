// NO ORDER SUBMISSION. Sanitized BTCUSDT Futures account overview.
import {BinanceAccountReader} from './binance-account.mjs';
import {LiveStatsLedger,syncKnownOrderFills} from './binance-live-stats.mjs';
import {resolve} from 'node:path';
import {mkdirSync} from 'node:fs';
const client=new BinanceAccountReader({apiKey:process.env.BINANCE_FUTURES_API_KEY,apiSecret:process.env.BINANCE_FUTURES_API_SECRET});
delete process.env.BINANCE_FUTURES_API_KEY;delete process.env.BINANCE_FUTURES_API_SECRET;
try{
 const info=await client.connect();
 console.log('\nBINANCE FUTURES BTCUSDT — READ ONLY\n');
 for(const [key,value] of Object.entries(info))console.log(key+': '+String(value));
 console.log('\nConnection verified. This checker CANNOT place, cancel or modify orders.');
 const dataDir=resolve(process.env.DATA_DIR||'./data');mkdirSync(dataDir,{recursive:true});
 const ledger=new LiveStatsLedger(resolve(dataDir,'binance-live-stats.sqlite'));
 try{
  const sync=await syncKnownOrderFills(client,ledger);
  console.log('\nOCC REAL TRADE AUDIT: '+sync.tracked+' verified bot order IDs; '+sync.newFills+' new exchange fills.');
  console.log('Closed positions: '+sync.report.summary.closed+', realized PnL after USDT fees excluding funding: '+sync.report.summary.netExFundingUSDT+' USDT');
  if(!sync.tracked)console.log('No OCC live orders have been registered. Manual Binance trades and paper fills are deliberately excluded.');
  console.log('Refresh dashboard: http://127.0.0.1:8080/binance');
 }finally{ledger.close();}
 if(!info.oneWay||info.multiAssets||info.leverage!==1||String(info.marginType).toUpperCase()!=='ISOLATED')
  console.log('Notice: live risk preflight would require One-way, Single-asset USDT, BTCUSDT ISOLATED 1x.');
}catch(err){console.error('Binance connection failed:',err.message);process.exitCode=1;}
