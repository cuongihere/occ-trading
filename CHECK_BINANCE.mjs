// NO ORDER SUBMISSION. Sanitized BTCUSDT Futures account overview.
import {BinanceAccountReader} from './binance-account.mjs';
const client=new BinanceAccountReader({apiKey:process.env.BINANCE_FUTURES_API_KEY,apiSecret:process.env.BINANCE_FUTURES_API_SECRET});
delete process.env.BINANCE_FUTURES_API_KEY;delete process.env.BINANCE_FUTURES_API_SECRET;
try{
 const info=await client.connect();
 console.log('\nBINANCE FUTURES BTCUSDT — READ ONLY\n');
 for(const [key,value] of Object.entries(info))console.log(key+': '+String(value));
 console.log('\nConnection verified. This checker CANNOT place, cancel or modify orders.');
 if(!info.oneWay||info.multiAssets||info.leverage!==1||String(info.marginType).toUpperCase()!=='ISOLATED')
  console.log('Notice: live risk preflight would require One-way, Single-asset USDT, BTCUSDT ISOLATED 1x.');
}catch(err){console.error('Binance connection failed:',err.message);process.exitCode=1;}
