import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {OCCSignalEngine,M15,H4} from './occ-signal-engine.mjs';
import {FuturesTransport} from './futures-transport.mjs';
import {protectionRequests} from './futures-protection-plan.mjs';
import {MultiAutoWorker} from './multi-auto-worker.mjs';
import {validateMultiConfig,resolveUsdtMarkets,planMultiMargin,calculateMinimumMargin} from './multi-auto-sizing.mjs';

const base='USDT',f=(type,values)=>({filterType:type,...values});
const market=(symbol,price=2000,step='.001',minQty='.001',minNotional='5')=>({
 symbol,baseAsset:symbol.slice(0,-4),quoteAsset:base,marginAsset:'USDT',contractType:'PERPETUAL',status:'TRADING',
 filters:[
  f('LOT_SIZE',{stepSize:step,minQty,maxQty:'1000'}),
  f('MARKET_LOT_SIZE',{stepSize:step,minQty,maxQty:'1000'}),
  f('PRICE_FILTER',{tickSize:String(price>=1000?.1:0.01)}),
  f('MIN_NOTIONAL',{notional:minNotional})
 ]
});
const mBTC=market('BTCUSDT',70000,'.001','.001');
const mETH=market('ETHUSDT',2000,'.001','.001');
const settings={side:'BOTH',slPercent:1,tpMode:'Percent',tp1Val:1,tp2Val:2,tp3Val:3,tp1Qty:33,tp2Qty:33,
 reverseOnSignal:false,entryMode:'MARKET'};

test('BTC, ETH, BNB user input maps only to trading USDT perpetual contracts',()=>{
 const info={symbols:[mBTC,mETH,market('BNBUSDT',600,'.01','.01'),
  {...market('BTCUSD',70000),quoteAsset:'USD',status:'TRADING'},
  {...market('LTCUSDT',80),status:'BREAK'}]};
 assert.deepEqual(resolveUsdtMarkets(validateMultiConfig([
  {base:'btc',marginUSDT:20},{base:'ETHUSDT',marginUSDT:12.12345},{base:'BNB',marginUSDT:1}
 ]),info).map(x=>x.symbol),['BTCUSDT','ETHUSDT','BNBUSDT']);
 assert.throws(()=>resolveUsdtMarkets([{base:'LTC',marginUSDT:5}],info),/không có cặp/);
 assert.throws(()=>validateMultiConfig([{base:'btc',marginUSDT:10},{base:'BTCUSDT',marginUSDT:20}]),/trùng/);
 assert.throws(()=>validateMultiConfig([{base:'BTC',marginUSDT:0}]),/dương/);
 assert.throws(()=>validateMultiConfig([{base:'BTC',marginUSDT:'abc'}]),/dương/);
});

test('BTC 20 USDT requested automatically becomes minimum valid 3-TP margin, not a fixed override',()=>{
 const args={market:mBTC,side:'LONG',desiredMarginUSDT:20,price:70000,
  leverage:5,availableUSDT:100,settings};
 const min=calculateMinimumMargin({market:mBTC,price:70000,leverage:5,settings});
 assert.equal(min.minimumMarginUSDT,56);
 const plan=planMultiMargin(args);
 assert.equal(plan.autoRaised,true);
 assert.equal(plan.minimumMarginUSDT,56);
 assert.equal(plan.effectiveMarginUSDT,56);
 assert.equal(plan.quantity,.004);
 assert.deepEqual(plan.legs,[.001,.001,.002]);
 assert.ok(plan.tps.every(x=>x>70000));
 assert.ok(plan.stop<70000);
});

test('If requested margin is already enough it is preserved, including arbitrary fractional numbers',()=>{
 for(const desired of [20,19.53217,2050.123456]){
  const plan=planMultiMargin({market:mETH,side:'SHORT',price:2000,
   desiredMarginUSDT:desired,availableUSDT:100000,leverage:5,settings});
  assert.equal(plan.effectiveMarginUSDT,desired);
  assert.equal(plan.autoRaised,false);
  assert.ok(plan.stop>2000);
  assert.ok(plan.tps.every(x=>x<2000));
 }
});

test('A low configured margin with insufficient wallet funds skips order rather than exceeding balance',()=>{
 assert.throws(()=>planMultiMargin({market:mBTC,side:'LONG',price:70000,
  desiredMarginUSDT:20,availableUSDT:55,leverage:5,settings}),/Không đủ USDT/);
 assert.throws(()=>planMultiMargin({market:mBTC,side:'LONG',price:70000,
  desiredMarginUSDT:20,availableUSDT:56,leverage:5,settings}),/Không đủ USDT/);
});

test('Binance minimum notional on each TP leg also affects the dynamically calculated floor',()=>{
 const m=market('ETHUSDT',2000,'.001','.001','30');
 const min=calculateMinimumMargin({market:m,price:2000,leverage:5,settings});
 assert.ok(min.minimumMarginUSDT>=20);
 const p=planMultiMargin({market:m,side:'LONG',price:2000,
  desiredMarginUSDT:1,availableUSDT:100,leverage:5,settings});
 assert.ok(p.legs.every((qty,i)=>qty*p.tps[i]>=30));
});

test('Custom symbol OCC engine produces the same closed-M15 crossover without hard-coded BTC identity',()=>{
 const bar=(time,o,c,period)=>({time,open:o,close:c,closeTime:time+period-1});
 const h4=Array.from({length:10},(_,i)=>bar(i*H4,100,100,H4));
 const t=10*H4;
 const engine=new OCCSignalEngine({symbol:'ETHUSDT'});
 engine.warmup(h4,[bar(t,100,100,M15)],t+M15);
 engine.setHealthy(true);engine.setRunning(true);
 const candle=bar(t+M15,100,99,M15);
 const signal=engine.onCandle(candle,{live:true,observedAt:candle.closeTime+1});
 assert.equal(signal.side,'SHORT');
 assert.equal(signal.symbol,'ETHUSDT');
 assert.match(signal.id,/:ETHUSDT:M15:/);
});

test('Exchange STOP and all TP requests preserve ETH symbol and OCCM prefix',()=>{
 const p=protectionRequests({symbol:'ETHUSDT',side:'SHORT',entryPrice:2000,
  filledQty:.06,stepSize:.001,tickSize:.1,clientPrefix:'OCCM-1234567890abcd'},settings);
 assert.equal(p.stop.symbol,'ETHUSDT');
 assert.equal(p.stop.closePosition,'true');
 assert.equal(p.stop.side,'BUY');
 assert.ok(p.tps.every(x=>x.symbol==='ETHUSDT'&&x.reduceOnly==='true'));
});

test('Signed transport still defaults to BTC-only, but multi-mode allows only explicitly selected pairs',async()=>{
 let count=0;
 const api=new FuturesTransport({apiKey:'key',apiSecret:'secret',environment:'production',
  productionConsent:'I_ACCEPT_LIVE_BTCUSDT',allowedSymbols:['ETHUSDT','BNBUSDT'],
  clock:()=>1000,fetchFn:async()=>{count++;return {ok:true,status:200,json:async()=>({ok:true})};}});
 await assert.rejects(api.get('/fapi/v1/order',{symbol:'BTCUSDT',orderId:1}),/allowlist/);
 const data=await api.get('/fapi/v1/order',{symbol:'ETHUSDT',orderId:1});
 assert.equal(data.ok,true);assert.equal(count,1);
 api.close();
});

test('Multisymbol configuration preview is read-only and uses independent checkpoint filenames',async()=>{
 const temp=mkdtempSync(join(tmpdir(),'occ-multi-'));
 try{
  const legacy={api:null,account:null,config:{leverage:5,...settings},armed:false,halted:false};
  let marketCalls=0;
  const worker=new MultiAutoWorker({dataDir:temp,legacy,publicGet:async(path,params)=>{
   marketCalls++;
   if(path==='/fapi/v1/exchangeInfo')return {symbols:[mBTC,mETH]};
   if(path==='/fapi/v1/ticker/price')return {symbol:params.symbol,price:params.symbol==='BTCUSDT'?'70000':'2000'};
   throw Error('No live kline trading in preview');
  },transportFactory:()=>{throw Error('Preview must not construct a trade transport');}});
  worker.configure([{base:'BTC',marginUSDT:20},{base:'ETH',marginUSDT:37.777}]);
  const pre=await worker.preview();
  assert.equal(pre.rows[0].effective,56);
  assert.equal(pre.rows[0].autoRaised,true);
  assert.equal(pre.rows[1].effective,37.777);
  assert.equal(pre.rows[1].autoRaised,false);
  assert.notEqual(worker.intentFile('BTCUSDT'),worker.intentFile('ETHUSDT'));
  assert.equal(worker.status().armed,false);
  assert.equal((await worker.tick()).armed,false);
  await assert.rejects(worker.arm('wrong'),/Chưa xác nhận/);
  assert.ok(marketCalls>=3);
 }finally{rmSync(temp,{recursive:true,force:true});}
});
