import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {BrowserFutures} from '../futures-browser-service.mjs';
import {ProtectionCheckpoint} from '../futures-protection-checkpoint.mjs';

const ROOT='OCCBTC-a1234567890abc';
const ENTRY={symbol:'BTCUSDT',positionSide:'BOTH',side:'BUY',type:'MARKET',
  status:'FILLED',orderId:15151,clientOrderId:ROOT,executedQty:'0.004',
  origQty:'0.004',avgPrice:'75390.4',updateTime:1762718000000};
function fixture(t,{manual=false,algoHistory=[],failStop=false,otherOrders=[]}={}){
 const dir=mkdtempSync(join(tmpdir(),'occ-repair-'));
 t.after(()=>rmSync(dir,{force:true,recursive:true}));
 const calls=[],algos=[],position={qty:.004,entry:75390.4},history=algoHistory;
 const rootOrder={...ENTRY,clientOrderId:manual?'manual-123':ROOT};
 const api={
  async syncClock(){},
  close(){},
  async get(path,params={}){
   calls.push({method:'GET',path,params});
   if(path==='/fapi/v2/account')return {canTrade:true,totalWalletBalance:'400',totalMarginBalance:'397',
    totalUnrealizedProfit:'-3',totalInitialMargin:'60',assets:[{asset:'USDT',walletBalance:'400',
     availableBalance:'340'}]};
   if(path==='/fapi/v1/positionSide/dual')return {dualSidePosition:false};
   if(path==='/fapi/v1/symbolConfig')return [{symbol:'BTCUSDT',leverage:5,marginType:'ISOLATED'}];
   if(path==='/fapi/v3/positionRisk')return [{symbol:'BTCUSDT',positionSide:'BOTH',
    positionAmt:String(position.qty),entryPrice:String(position.entry),markPrice:'75218'}];
   if(path==='/fapi/v1/openOrders')return [];
   if(path==='/fapi/v1/openAlgoOrders')return algos.map(x=>({...x}));
   if(path==='/fapi/v1/allAlgoOrders')return history.map(x=>({...x}));
   if(path==='/fapi/v1/allOrders')return [rootOrder,...otherOrders];
   if(path==='/fapi/v1/exchangeInfo')return {symbols:[{symbol:'BTCUSDT',
    contractType:'PERPETUAL',status:'TRADING',filters:[
     {filterType:'MARKET_LOT_SIZE',stepSize:'0.001',minQty:'0.001'},
     {filterType:'PRICE_FILTER',tickSize:'0.1'},
     {filterType:'MIN_NOTIONAL',notional:'5'}]}]};
   if(path==='/fapi/v1/order'){
    if(String(params.orderId)===String(ENTRY.orderId))return {...rootOrder};
    throw Error('Unknown Binance Order ID');
   }
   throw Error('Unexpected GET '+path);
  },
  async post(path,p){
   calls.push({method:'POST',path,p:{...p}});
   if(path==='/fapi/v1/algoOrder'){
    if(failStop&&p.type==='STOP_MARKET')throw Error('Binance STOP ACK unknown');
    const o={...p,algoId:9000+algos.length,algoStatus:'NEW',orderType:p.type,
     closePosition:p.closePosition==='true',reduceOnly:p.reduceOnly==='true',
     triggerPrice:p.triggerPrice,quantity:p.quantity};
    algos.push(o);return {algoId:o.algoId,clientAlgoId:o.clientAlgoId};
   }
   throw Error('Unexpected POST '+path);
  },
  async del(){throw Error('Repair must never delete another order');}
 };
 const vault={
  exists:()=>false,save(){},delete(){},load(){throw Error('Not used in repair fixture');}
 };
 const service=new BrowserFutures({dataDir:dir,transportFactory:()=>api,credentialVault:vault});
 service.api=api;service.environment='production';
 const currentConfig={marginUSDT:70,leverage:5,side:'BOTH',slPercent:.8,tpMode:'Percent',
  tp1Val:1.5,tp2Val:3,tp3Val:5,tp1Qty:33,tp2Qty:33,reverseOnSignal:true};
 service.saveConfig(currentConfig);
 // Simulate a halted OCC app after an otherwise filled entry with no open stops.
 service.halted=true;service.error='Binance STOP chưa xác minh';
 return {service,api,calls,algos,position,dir};
}
test('Read-only repair checks a unique OCC Binance Entry and calculates SL/3 TP from real fill',async t=>{
 const x=fixture(t);
 const p=await x.service.inspectProtectionRepair();
 assert.equal(p.side,'LONG');assert.equal(p.qty,.004);
 assert.equal(p.entryPrice,75390.4);assert.equal(p.orderId,String(ENTRY.orderId));
 assert.equal(p.leverage,5);assert.equal(p.tps.length,3);
 assert.deepEqual(p.tps.map(v=>v.qty),[.001,.001,.002]);
 assert.equal(p.stopPrice,74787.2);
 assert.equal(x.calls.some(v=>v.method!=='GET'),false);
});
test('Approved repair places STOP first then TP1-3 using actual Binance Entry and verifies all',async t=>{
 const x=fixture(t);
 const p=await x.service.inspectProtectionRepair();
 const r=await x.service.repairMissingProtection({confirmation:'KHOI PHUC SL TP BTCUSDT',
  expectedOrderId:p.orderId,expectedQty:p.qty,
  expectedEntryPrice:p.entryPrice,expectedSide:p.side});
 assert.equal(r.ok,true);assert.equal(r.auto,false);
 assert.equal(x.service.snapshot().armed,false);
 assert.equal(x.service.snapshot().halted,false);
 assert.equal(x.service.snapshot().protectedPosition.entry.qty,.004);
 assert.equal(x.service.snapshot().protectedPosition.entry.entryPrice,75390.4);
 const posts=x.calls.filter(v=>v.method==='POST');
 assert.deepEqual(posts.map(v=>v.p.type),
  ['STOP_MARKET','TAKE_PROFIT_MARKET','TAKE_PROFIT_MARKET','TAKE_PROFIT_MARKET']);
 assert.equal(posts[0].p.closePosition,'true');
 assert.deepEqual(posts.slice(1).map(v=>Number(v.p.quantity)),[.001,.001,.002]);
 assert.equal(x.algos.length,4);
 const cp=new ProtectionCheckpoint(join(x.dir,'futures-live-protection.json')).load();
 assert.equal(cp.phase,'PROTECTED');
 assert.equal(cp.entry.clientPrefix,ROOT);
 const record=JSON.parse(readFileSync(join(x.dir,'futures-live-intent.json'),'utf8'));
 assert.equal(record.phase,'PROTECTED');
 await assert.rejects(x.service.repairMissingProtection({confirmation:'KHOI PHUC SL TP BTCUSDT',
  expectedOrderId:p.orderId,expectedQty:p.qty,expectedEntryPrice:p.entryPrice,expectedSide:p.side}),
 /đã có checkpoint|không có lệnh|tồn tại/i);
 assert.equal(x.calls.filter(v=>v.method==='POST').length,4);
});
test('Wrong confirmation or stale expected Entry does not create Binance orders',async t=>{
 const x=fixture(t);
 const p=await x.service.inspectProtectionRepair();
 await assert.rejects(x.service.repairMissingProtection({confirmation:'OK'}),/Chưa xác nhận/);
 await assert.rejects(x.service.repairMissingProtection({confirmation:'KHOI PHUC SL TP BTCUSDT',
  expectedOrderId:p.orderId,expectedQty:.003,expectedEntryPrice:p.entryPrice,
  expectedSide:p.side}),/khác lúc xác nhận/);
 assert.equal(x.calls.some(v=>v.method==='POST'),false);
});
test('Manual, unowned BTC position never receives OCC SL/TP just because quantity matches',async t=>{
 const x=fixture(t,{manual:true});
 await assert.rejects(x.service.inspectProtectionRepair(),/Không xác minh được Entry OCC duy nhất/);
 assert.equal(x.calls.some(v=>v.method==='POST'),false);
});
test('Previously canceled STOP is replaced using a NEW Algo prefix, without overwriting Entry ownership',async t=>{
 const x=fixture(t,{algoHistory:[{symbol:'BTCUSDT',clientAlgoId:ROOT+'-SL',
  algoId:9123,algoStatus:'CANCELED'}]});
 const preview=await x.service.inspectProtectionRepair();
 assert.equal(preview.useFreshAlgoPrefix,true);
 assert.equal(x.calls.some(v=>v.method==='POST'),false);
 const done=await x.service.repairMissingProtection({confirmation:'KHOI PHUC SL TP BTCUSDT',
  expectedOrderId:preview.orderId,expectedQty:preview.qty,
  expectedEntryPrice:preview.entryPrice,expectedSide:preview.side});
 assert.equal(done.protected,true);
 const checkpoint=x.service.snapshot().protectedPosition;
 assert.equal(checkpoint.entry.clientPrefix,ROOT);
 assert.notEqual(checkpoint.entry.algoPrefix,ROOT);
 assert.equal(checkpoint.stop.clientId,checkpoint.entry.algoPrefix+'-SL');
 assert.equal(x.calls.filter(v=>v.method==='POST').length,4);
});
test('Previously FINISHED STOP never triggers automatic duplicate protection',async t=>{
 const x=fixture(t,{algoHistory:[{symbol:'BTCUSDT',clientAlgoId:ROOT+'-SL',
  algoId:9123,algoStatus:'FINISHED'}]});
 await assert.rejects(x.service.inspectProtectionRepair(),/đã kích hoạt|chưa rõ/);
 assert.equal(x.calls.some(v=>v.method==='POST'),false);
});
test('Failed STOP forces HALT, no TPs, no automatic retry and durable inFlight checkpoint',async t=>{
 const x=fixture(t,{failStop:true});
 const p=await x.service.inspectProtectionRepair();
 await assert.rejects(x.service.repairMissingProtection({
  confirmation:'KHOI PHUC SL TP BTCUSDT',expectedOrderId:p.orderId,expectedQty:p.qty,
  expectedEntryPrice:p.entryPrice,expectedSide:p.side}),/STOP ACK unknown/);
 assert.equal(x.service.snapshot().halted,true);
 assert.equal(x.service.snapshot().armed,false);
 assert.equal(x.calls.filter(v=>v.method==='POST').length,1);
 assert.match(x.service.snapshot().error,/KHÔI PHỤC SL\/TP CHƯA XÁC MINH/);
 const cp=new ProtectionCheckpoint(join(x.dir,'futures-live-protection.json')).load();
 assert.equal(cp.phase,'HALTED');assert.equal(cp.inFlight.role,'SL');
 await assert.rejects(x.service.inspectProtectionRepair(),/Checkpoint đã từng gửi/);
 assert.equal(x.calls.filter(v=>v.method==='POST').length,1);
});
test('Ambiguous multiple OCC entries or mismatched checkpoint disallow repair',async t=>{
 const x=fixture(t,{otherOrders:[{...ENTRY,orderId:15152,
  clientOrderId:'OCCBTC-abcdef12345678'}]});
 await assert.rejects(x.service.inspectProtectionRepair(),/Nhiều Entry OCC/);
 assert.equal(x.calls.some(v=>v.method==='POST'),false);
});
