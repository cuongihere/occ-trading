import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BrowserFutures} from './futures-browser-service.mjs';
import {UnifiedPortfolio,validSymbol} from './unified-portfolio.mjs';
import {FuturesTransport} from './futures-transport.mjs';

const vault=()=>({exists:()=>false,load:()=>null,save:()=>{},delete:()=>{}});
const market=symbol=>({symbol,contractType:'PERPETUAL',status:'TRADING',
 baseAsset:symbol.slice(0,-4),quoteAsset:'USDT',marginAsset:'USDT'});
function fixture(t,{now=Date.now()}={}){
 const dir=mkdtempSync(join(tmpdir(),'occ-unified-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const btc=new BrowserFutures({dataDir:dir,credentialVault:vault()});
 const calls=[];
 const publicGet=async(path,params={})=>{
  calls.push({path,params});
  if(path==='/fapi/v1/exchangeInfo')return {symbols:[
   market('BTCUSDT'),market('ETHUSDT'),market('SOLUSDT'),
   {...market('XRPUSDT'),contractType:'CURRENT_QUARTER'},
   {...market('BNBUSDT'),status:'BREAK'},
   {...market('LTCUSDT'),marginAsset:'USDC'}
  ]};
  if(path==='/fapi/v1/ticker/price')return {symbol:params.symbol,price:'2000'};
  throw Error('Unexpected market read '+path);
 };
 const p=new UnifiedPortfolio({dataDir:dir,btc,clock:()=>now,publicGet});
 return {p,btc,dir,calls};
}
test('Coin selection accepts only exact TRADING USDT Perpetual, with BTC always present',async t=>{
 const h=fixture(t);
 assert.equal(validSymbol('BTCUSDT'),true);
 assert.equal(validSymbol('ETHUSDT'),true);
 assert.equal(validSymbol('ETHBTC'),false);
 assert.equal(h.p.status().rows.length,1);
 assert.equal(h.p.status().rows[0].symbol,'BTCUSDT');
 for(const invalid of ['BTCUSDT','BAD','DOGE/USDT'])await assert.rejects(()=>h.p.add(invalid),/USDT/);
 for(const invalid of ['XRPUSDT','BNBUSDT','LTCUSDT'])await assert.rejects(()=>h.p.add(invalid),/Perpetual/);
 await h.p.add('ETHUSDT');
 assert.deepEqual(h.p.status().rows.map(x=>x.symbol),['BTCUSDT','ETHUSDT']);
 assert.equal(h.p.get('ETHUSDT').armed,false);
 assert.equal(h.p.get('ETHUSDT').vault.exists(),false);
 assert.equal(h.p.get('ETHUSDT').symbol,'ETHUSDT');
 assert.equal(h.p.get('ETHUSDT').squarePublisher,null);
});
test('Per-symbol settings, intent, SL/TP and audit DB never overwrite BTC settings',async t=>{
 const {p,btc,dir}=fixture(t);
 await p.add('ETHUSDT');await p.add('SOLUSDT');
 assert.equal(btc.path,join(dir,'futures-browser-settings.json'));
 assert.equal(btc.ledgerPath,join(dir,'binance-live-stats.sqlite'));
 assert.equal(p.get('ETHUSDT').ledgerPath,join(dir,'binance-ETHUSDT-live-stats.sqlite'));
 assert.notEqual(p.get('ETHUSDT').protectionPath,p.get('SOLUSDT').protectionPath);
 assert.notEqual(p.get('ETHUSDT').intentPath,p.get('SOLUSDT').intentPath);
 p.configure('ETHUSDT',{marginUSDT:55,leverage:7,slPercent:1.5,
  tp1Val:2,tp2Val:3,tp3Val:5,reverseOnSignal:true});
 p.configure('SOLUSDT',{marginUSDT:10,leverage:2});
 assert.equal(p.get('ETHUSDT').config.leverage,7);
 assert.equal(p.get('SOLUSDT').config.leverage,2);
 assert.equal(btc.config.leverage,5);
 assert.equal(p.get('ETHUSDT').config.reverseOnSignal,true);
 const saved=JSON.parse(readFileSync(join(dir,'futures-ETHUSDT-settings.json'),'utf8'));
 assert.equal(saved.tp3Val,5);
 assert.equal(existsSync(join(dir,'futures-browser-settings.json')),false);
});
test('Global AUTO selection persists but no Futures AUTO or exchange orders start on restart',async t=>{
 const {p,btc,dir}=fixture(t);
 await p.add('ETHUSDT');
 p.select('BTCUSDT',true);p.select('ETHUSDT',true);
 assert.equal(p.status().armedCount,0);
 const reloaded=new UnifiedPortfolio({dataDir:dir,btc:new BrowserFutures({dataDir:dir,credentialVault:vault()}),
  publicGet:p.publicGet});
 assert.equal(reloaded.btcSelected,true);
 assert.equal(reloaded.rows[0].selected,true);
 assert.equal(reloaded.get('BTCUSDT').armed,false);
 assert.equal(reloaded.get('ETHUSDT').armed,false);
 assert.equal(reloaded.get('ETHUSDT').api,null);
 assert.equal(reloaded.get('ETHUSDT').config.marginUSDT,btc.config.marginUSDT);
});
test('Neither BTC nor alt Futures can arm without exact operator consent',async t=>{
 const {p}=fixture(t);await p.add('ETHUSDT');
 await assert.rejects(()=>p.enable('BTCUSDT','CHAP NHAN ETHUSDT FUTURES'),/Chưa xác nhận/);
 await assert.rejects(()=>p.enable('ETHUSDT','CHAP NHAN BTC FUTURES'),/Chưa xác nhận/);
 await assert.rejects(()=>p.enableSelected('INVALID'),/Cần xác nhận/);
 assert.equal(p.get('BTCUSDT').armed,false);
 assert.equal(p.get('ETHUSDT').armed,false);
});
test('An unrelated coin remains excluded from approved managed positions',async t=>{
 const {p}=fixture(t);await p.add('ETHUSDT');await p.add('SOLUSDT');
 assert.deepEqual(p.approvedOthers('ETHUSDT'),[]);
 const eth=p.get('ETHUSDT');
 eth.activeProtection={entry:{symbol:'ETHUSDT',clientPrefix:'OCCM-abcdef01234567'},
  stop:{id:'1'},tps:[{id:'2'}]};
 assert.deepEqual(p.approvedOthers('BTCUSDT'),['ETHUSDT']);
 eth.halted=true;
 assert.deepEqual(p.approvedOthers('BTCUSDT'),[]);
 await assert.rejects(()=>p.inspectPeers('BTCUSDT'),/chưa xác minh/);
});
test('Cannot remove a coin without two live Binance FLAT reads, never from cached account',async t=>{
 const {p}=fixture(t);await p.add('ETHUSDT');
 await assert.rejects(()=>p.remove('ETHUSDT'),/kết nối/);
 const peer=p.get('ETHUSDT');
 let times=0;
 peer.api={close(){}};
 peer.inspect=async()=>{times++;return {positionBTC:times===2?0.01:0,openOrders:0,openAlgos:0}};
 await assert.rejects(()=>p.remove('ETHUSDT'),/Binance còn vị thế/);
 assert.equal(p.get('ETHUSDT'),peer);
 assert.equal(times,2);
 peer.inspect=async()=>({positionBTC:0,openOrders:0,openAlgos:0});
 await p.remove('ETHUSDT');
 assert.equal(p.get('ETHUSDT'),null);
});
test('Two simultaneous OCC entry signals share one serialization lock',async t=>{
 const {p}=fixture(t,{now:1_800_000});await p.add('ETHUSDT');
 const peer=p.get('ETHUSDT');peer.armed=true;
 let concurrent=0,maxConcurrent=0,calls=0;
 peer.signal=async()=>{concurrent++;calls++;maxConcurrent=Math.max(concurrent,maxConcurrent);
  await new Promise(resolve=>setTimeout(resolve,5));concurrent--;};
 const bar={side:'LONG',time:1_700_000};
 await Promise.all([p.handleSignal('ETHUSDT',bar,true),p.handleSignal('ETHUSDT',bar,true)]);
 assert.equal(calls,2);assert.equal(maxConcurrent,1);
 await p.handleSignal('ETHUSDT',{...bar,time:0},true);
 assert.equal(calls,2,'Old signals are never replayed');
});
test('Signed Futures transport remains restricted to exactly one explicitly approved contract',async()=>{
 const make=(allowedSymbols,unifiedConsent)=>new FuturesTransport({
  apiKey:'demo-key',apiSecret:'demo-secret',allowedSymbols,unifiedConsent,environment:'demo'
 });
 assert.throws(()=>make(['ETHUSDT']),/Only explicitly approved/);
 assert.throws(()=>make(['BTCUSDT','ETHUSDT'],'OCC_UNIFIED_SYMBOL_EXECUTOR'),/Only explicitly approved/);
 const eth=make(['ETHUSDT'],'OCC_UNIFIED_SYMBOL_EXECUTOR');
 assert.deepEqual([...eth.allowedSymbols],['ETHUSDT']);
 await assert.rejects(()=>eth.get('/fapi/v3/positionRisk',{symbol:'BTCUSDT'}),/allowlist/);
 const btc=make(['BTCUSDT']);
 assert.deepEqual([...btc.allowedSymbols],['BTCUSDT']);
 await assert.rejects(()=>btc.get('/fapi/v3/positionRisk',{symbol:'ETHUSDT'}),/Only BTCUSDT/);
});
test('Square publisher is never attached to non-BTC executors',async t=>{
 const {p}=fixture(t);await p.add('ETHUSDT');
 const alt=p.get('ETHUSDT'),btc=p.get('BTCUSDT');
 let posts=0;
 alt.setSquarePublisher({onProtected:async()=>{posts++}});
 btc.setSquarePublisher({onProtected:async()=>{posts++}});
 alt.notifySquareProtected({entry:{symbol:'ETHUSDT'}});
 await Promise.resolve();await Promise.resolve();
 assert.equal(posts,0);
 btc.notifySquareProtected({entry:{symbol:'BTCUSDT'}});
 await Promise.resolve();await Promise.resolve();
 assert.equal(posts,1);
});
