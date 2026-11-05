'use strict';
const $=id=>document.getElementById(id);
const fmtValue=(v,d=2)=>v==null||v===''||!Number.isFinite(Number(v))?'—':Number(v).toLocaleString('en-US',{maximumFractionDigits:d});
const stamp=v=>v?new Date(Number(v)).toLocaleString('vi-VN',{hour12:false}):'—';
const pending=new Map();
let seq=0,feed=null,healthy=false,lastTrade=0,lastTradePrice=null,lastMark=null,connected=false,account=null,algos=[],
    trades=[],income=[],lastIncome=0,indicator=new OCCEngine(),busy=false;
let stored={phase:'IDLE',config:{marginUSDT:20,leverage:5,side:'BOTH',slPercent:1,tpMode:'Percent',
 tp1Val:1,tp2Val:2,tp3Val:3,tp1Qty:33,tp2Qty:33,reverseOnSignal:false}};
try{
 const x=JSON.parse(OCCAndroid.loadState()||'{}');
 stored={...stored,...x,config:{...stored.config,...x.config}};
}catch{}
const loglines=[];
const log=message=>{
 loglines.unshift(stamp(Date.now())+' · '+String(message).slice(0,120));
 if(loglines.length>5)loglines.pop();
 $('events').textContent=loglines.join('\n');
};
function msg(e){const m=String(e?.message||e);$('message').textContent=m;log(m);}
function color(id,v){const el=$(id);el.classList.remove('positive','negative');if(Number(v)>0)el.classList.add('positive');if(Number(v)<0)el.classList.add('negative');}
window.occNativeResponse=(id,ok,body,status)=>{
 const p=pending.get(id);if(!p)return;
 clearTimeout(p.timer);pending.delete(id);
 if(!ok){const e=Error(body);e.httpStatus=status;p.reject(e);return;}
 try{p.resolve(JSON.parse(body))}catch(e){p.reject(Error('Binance trả dữ liệu không hợp lệ'))}
};
function callNative(method,...args){
 return new Promise((resolve,reject)=>{
  const id=String(++seq);
  const timer=setTimeout(()=>{pending.delete(id);reject(Error('Timeout Binance'));},35000);
  pending.set(id,{resolve,reject,timer});
  try{OCCAndroid[method](...args,id)}catch(e){clearTimeout(timer);pending.delete(id);reject(e)}
 });
}
window.occPublicGet=path=>callNative('publicGet',path);
const signed=(method,path,parameters={})=>callNative('signed',method,path,JSON.stringify(parameters));
const trade=new OCCMobileTrade({
 signed, publicGet:window.occPublicGet,
 load:()=>OCCAndroid.loadState(),save:value=>OCCAndroid.saveState(value),
 newId:()=>OCCAndroid.newPrefix(),report:message=>log(message)
});
stored=trade.cp;
let autoClickBusy=false,lastAutoDiagnostic='';
function quoteAgeMs(){
 if(!lastTrade||!(lastTradePrice>0))return null;
 const appAge=Math.max(0,Date.now()-lastTrade);
 const sourceAge=feed?.tradeAgeMs?.();
 return sourceAge==null?appAge:Math.max(appAge,sourceAge);
}
function quoteIsFresh(){
 const age=quoteAgeMs();
 return healthy&&feed?.healthy()===true&&age!==null&&age<=10000;
}
function quoteStaleReason(){
 const age=quoteAgeMs();
 if(age!==null&&age>10000)
  return 'Giá BTCUSDT LAST đã cũ '+Math.ceil(age/1000)+' giây. '+
    'Chờ aggTrade mới hoặc nhấn Nối lại giá; không bật Auto bằng giá cũ.';
 return 'Binance chưa xác minh được LAST và Mark trực tiếp. '+
  'Chờ dữ liệu mới hoặc nhấn Nối lại giá.';
}
function autoBlocker(){
 if(!connected)return 'Chưa kết nối API Binance Futures. Mở mục API Binance để kết nối.';
 if(trade.cp.halted)return 'OCC đang KHÓA: '+(trade.cp.error||'checkpoint cần đối soát Binance');
 if(trade.cp.phase!=='IDLE')return 'OCC còn '+trade.cp.phase+'; cần xử lý vị thế/checkpoint trước khi bật Auto.';
 if(!indicator.ready)return 'Chưa đồng bộ xong chỉ báo OCC H4/M15.';
 if(!quoteIsFresh())return quoteStaleReason();
 return '';
}
function showAuto(){
 const blocked=autoBlocker();
 const state=trade.cp.halted?'AUTO KHÓA':trade.auto?'AUTO ON':'AUTO OFF';
 $('autoState').textContent=state;
 $('autoState').className=trade.cp.halted?'negative':trade.auto?'positive':'muted';
 $('autoToggle').textContent=trade.busy||autoClickBusy?'Đang kiểm tra…':trade.auto?'Tắt Auto':'Bật Auto';
 // Keep the toggle tappable even when Binance is offline: explain the blocker
 // instead of silently disabling the only control in the dashboard.
 $('autoToggle').disabled=trade.busy||autoClickBusy;
 $('autoCheck').disabled=trade.busy||autoClickBusy;
 $('closeAll').disabled=trade.busy||trade.cp.halted||trade.cp.phase!=='PROTECTED'||!account;
 $('applyLeverage').disabled=trade.busy||trade.auto||trade.cp.halted||
    trade.cp.phase!=='IDLE'||!connected;
 $('safetyLine').textContent=trade.auto?
  (healthy&&feed?.healthy()?'AUTO ON · CHỜ TÍN HIỆU OCC M15 MỚI':
    'AUTO ON · CHỜ BINANCE KHÔI PHỤC GIÁ, KHÔNG GỬI LỆNH MỚI'):
  blocked||lastAutoDiagnostic||'AUTO OFF · Nhấn Kiểm tra Auto để đối chiếu Binance';
}

function saveLocal(){
 trade.persist();
}
function displayConfig(){
 const c=stored.config;
 for(const [id,v]of Object.entries({marginUSDT:c.marginUSDT,leverage:c.leverage,side:c.side,sl:c.slPercent,
  mode:c.tpMode,tp1:c.tp1Val,tp2:c.tp2Val,tp3:c.tp3Val,q1:c.tp1Qty,q2:c.tp2Qty}))
   $(id).value=v;
 $('reverse').checked=c.reverseOnSignal;
 $('summary').textContent=c.marginUSDT+'U · '+c.leverage+'x · SL '+c.slPercent+'% · TP '+c.tp1Val+'/'+c.tp2Val+'/'+c.tp3Val;
}
function readConfig(){
 const c={side:$('side').value,marginUSDT:Number($('marginUSDT').value),leverage:Number($('leverage').value),
  slPercent:Number($('sl').value),tpMode:$('mode').value,
  tp1Val:Number($('tp1').value),tp2Val:Number($('tp2').value),tp3Val:Number($('tp3').value),
  tp1Qty:Number($('q1').value),tp2Qty:Number($('q2').value),reverseOnSignal:$('reverse').checked};
 if(!['BOTH','LONG','SHORT'].includes(c.side)||!['Percent','Points'].includes(c.tpMode)||
  !Number.isInteger(c.leverage)||c.leverage<1||c.leverage>20||!(c.marginUSDT>0&&c.marginUSDT<=1000)||
  !(c.slPercent>0&&c.slPercent<=10)||
  [c.tp1Val,c.tp2Val,c.tp3Val,c.tp1Qty,c.tp2Qty].some(v=>!Number.isFinite(v)||v<=0)||
  c.tp1Qty+c.tp2Qty>=100)throw Error('Cấu hình không hợp lệ');
 return c;
}
$('saveConfig').onclick=()=>{
 try{trade.setConfig(readConfig());displayConfig();showAuto();msg('Đã lưu cấu hình');}
 catch(e){msg(e)}
};

function connectionStatus(){
 $('connection').textContent=connected?'ĐÃ KẾT NỐI':'CHƯA KẾT NỐI';
 $('connection').className=connected?'positive':'muted';
}
async function authenticate(op){
 if(busy)return;
 busy=true;
 try{
  const result=await callNative('auth',op,$('apiKey').value,$('apiSecret').value,$('remember').checked);
  $('apiKey').value='';$('apiSecret').value='';
  connected=!!result.connected;trade.connected=connected;if(!connected)trade.disarm();
  connectionStatus();showAuto();
  if(connected)$('apiEditor').open=false;
  else clearAccount();
  if(op!=='restore')msg(connected?'Đã kết nối Binance Futures':'Đã ngắt kết nối');
 }catch(e){connected=false;trade.connected=false;trade.disarm();connectionStatus();showAuto();if(op!=='restore')msg(e)}
 finally{busy=false}
 if(connected){await refresh();await refreshHistory()}
}
$('connect').onclick=()=>authenticate('connect');
$('restore').onclick=()=>authenticate('restore');
$('disconnect').onclick=()=>authenticate('disconnect');
$('forget').onclick=()=>{
 if(confirm('Xóa API Binance đã lưu trên điện thoại?'))authenticate('forget');
};
function clearAccount(){
 for(const id of ['wallet','available','equity','unrealized','btcPosition','entry','positionMark','liq','btcPnl','marginMode','actualLeverage','realNet'])$(id).textContent='—';
 $('levels').replaceChildren();
}
function createLevel(label,order,side,entry,remaining){
 const el=document.createElement('div');el.className='level';
 const caption=document.createElement('small');caption.textContent=label;el.append(caption);
 const strong=document.createElement('strong');
 strong.textContent=order?fmtValue(order.triggerPrice,2):'—';el.append(strong);
 const sub=document.createElement('small');
 if(order){
  const qty=order.closePosition===true||order.closePosition==='true'?remaining:Number(order.quantity);
  const direction=side==='LONG'?1:-1;
  const gross=(Number(order.triggerPrice)-entry)*qty*direction;
  sub.textContent=fmtValue(qty,6)+' BTC · '+fmtValue(gross,3)+' USDT (gross)';
 }else sub.textContent='Không có lệnh active';
 el.append(sub);
 const cp=trade.cp;
 if(label.startsWith('TP')&&order&&cp.phase==='PROTECTED'&&!cp.halted&&cp.entry?.side===side){
  const leg=cp.tps?.find(x=>x.role===label);
  if(leg&&String(leg.id)===String(order.algoId)&&leg.clientId===order.clientAlgoId){
   const button=document.createElement('button');button.textContent='Chốt MKT';
   button.onclick=()=>performManual(label);el.append(button);
  }
 }
 return el;
}
async function refresh(){
 if(!connected||busy)return;
 busy=true;
 try{
  const [acc,risk,openAlgos,conf]=await Promise.all([
   signed('GET','/fapi/v2/account'),
   signed('GET','/fapi/v3/positionRisk',{symbol:'BTCUSDT'}),
   signed('GET','/fapi/v1/openAlgoOrders',{symbol:'BTCUSDT'}),
   signed('GET','/fapi/v1/symbolConfig',{symbol:'BTCUSDT'})
  ]);
  if(!Array.isArray(acc.assets)||!Array.isArray(risk)||!Array.isArray(openAlgos)||!Array.isArray(conf))
   throw Error('Binance không trả dữ liệu vị thế hợp lệ');
  const usdt=acc.assets.find(x=>x.asset==='USDT')||{},pos=risk.find(x=>x.symbol==='BTCUSDT'&&x.positionSide==='BOTH');
  const setting=conf.find(x=>x.symbol==='BTCUSDT');
  const amount=Number(pos?.positionAmt||0),side=amount>0?'LONG':amount<0?'SHORT':null;
  const entry=Number(pos?.entryPrice||0),qty=Math.abs(amount);
  $('wallet').textContent=fmtValue(usdt.walletBalance,2);
  $('available').textContent=fmtValue(usdt.availableBalance,2);
  $('equity').textContent=fmtValue(acc.totalMarginBalance,2);
  $('unrealized').textContent=fmtValue(acc.totalUnrealizedProfit,2);color('unrealized',acc.totalUnrealizedProfit);
  $('btcPosition').textContent=fmtValue(amount,6);color('btcPosition',amount);
  $('entry').textContent=side?fmtValue(entry,2):'—';
  $('positionMark').textContent=side?fmtValue(pos.markPrice,2):'—';
  $('liq').textContent=side?fmtValue(pos.liquidationPrice,2):'—';
  $('btcPnl').textContent=side?fmtValue(pos.unRealizedProfit,3):'—';color('btcPnl',pos?.unRealizedProfit);
  $('marginMode').textContent=setting?.marginType||'—';
  $('actualLeverage').textContent=setting?.leverage?setting.leverage+'x':'—';
  $('levels').replaceChildren();
  if(side){
   const active=openAlgos.filter(x=>OCC_ACTIVE.has(String(x.algoStatus)));
   const cp=trade.cp,managed=cp.phase==='PROTECTED'&&cp.entry?.side===side;
   const byCheckpoint=r=>r?active.find(x=>String(x.algoId)===String(r.id)&&x.clientAlgoId===r.clientId):null;
   const sl=managed?byCheckpoint(cp.stop):active.find(x=>x.orderType==='STOP_MARKET');
   $('levels').append(createLevel('SL',sl,side,entry,qty));
   const sorted=active.filter(x=>x.orderType==='TAKE_PROFIT_MARKET')
    .sort((a,b)=>(side==='LONG'?1:-1)*(Number(a.triggerPrice)-Number(b.triggerPrice)));
   for(let i=0;i<3;i++){
    const role='TP'+(i+1);
    const order=managed?byCheckpoint(cp.tps.find(x=>x.role===role)):sorted[i];
    $('levels').append(createLevel(role,order,side,entry,qty));
   }
   if(!sl)log('Không xác minh được STOP đang hoạt động');
  }
  account=acc;algos=openAlgos;showAuto();
  $('status').textContent=healthy?'LIVE':'CHỜ GIÁ';
 }catch(e){msg(e)}
 finally{busy=false}
}
$('refresh').onclick=refresh;
async function refreshHistory(){
 if(!connected)return;
 try{
  const end=Date.now(),start=end-7*86400000;
  const [inc,rows]=await Promise.all([
   signed('GET','/fapi/v1/income',{symbol:'BTCUSDT',startTime:start,endTime:end,limit:1000}),
   signed('GET','/fapi/v1/userTrades',{symbol:'BTCUSDT',startTime:start,endTime:end,limit:1000})
  ]);
  if(!Array.isArray(inc)||!Array.isArray(rows))throw Error('Binance không trả lịch sử');
  income=inc;trades=rows;lastIncome=Date.now();
  const sum=type=>inc.filter(x=>x.incomeType===type&&x.asset==='USDT').reduce((v,x)=>v+Number(x.income),0);
  const r=sum('REALIZED_PNL'),fee=sum('COMMISSION'),fund=sum('FUNDING_FEE');
  const total=r+fee+fund;
  $('realNet').textContent=fmtValue(total,3);color('realNet',total);
  $('incomeSummary').textContent='7 ngày · Realized '+fmtValue(r,3)+' · Phí '+fmtValue(fee,3)+' · Funding '+fmtValue(fund,3)+
   (inc.length>=1000||rows.length>=1000?' · DỮ LIỆU CHƯA ĐẦY ĐỦ':'');
  const body=$('historyBody');body.replaceChildren();
  for(const x of rows.slice(-100).reverse()){
   const tr=document.createElement('tr');
   for(const v of [stamp(x.time),x.side,fmtValue(x.qty,6),fmtValue(x.price,2),fmtValue(x.realizedPnl,3),fmtValue(x.commission,3)]){
    const td=document.createElement('td');td.textContent=String(v);tr.append(td);
   }
   body.append(tr);
  }
 }catch(e){msg(e)}
}
$('historyRefresh').onclick=refreshHistory;
$('csv').onclick=()=>{
 if(!trades.length){msg('Không có lịch sử để xuất');return}
 const cols=['time','orderId','id','side','qty','price','realizedPnl','commission','commissionAsset'];
 const csv=[cols.join(','),...trades.map(x=>cols.map(k=>'"'+String(x[k]??'').replaceAll('"','""')+'"').join(','))].join('\r\n');
 OCCAndroid.shareCsv(csv);
};
function setFeed(status,message){
 healthy=status==='live';
 $('status').textContent=healthy?'LIVE':status.toUpperCase();
 $('status').className=healthy?'positive':'warning';
 indicator.setHealthy(healthy);
 indicator.setRunning(healthy&&indicator.ready);
 if(message)log(message);
 showAuto();
}
function connectFeed(){
 if(feed)feed.disconnect();
 feed=new BinanceFeed({
  onStatus:({state,message})=>setFeed(state,message),
  onReady:({h4,m15,now})=>{indicator.warmup(h4,m15,now);indicator.setRunning(false);indicator.setHealthy(false)},
  onTrade:({price,receivedAt})=>{
    if(!(Number(price)>0)||!Number.isFinite(receivedAt))return;
    lastTrade=receivedAt;lastTradePrice=Number(price);
    $('last').textContent=fmtValue(price,1);
    $('priceTime').textContent='LAST nhận lúc '+stamp(receivedAt);
    showAuto();
   },
  onMark:({price})=>{if(Number(price)>0){lastMark=Number(price);$('mark').textContent=fmtValue(price,2)}},
  onCandle:(bar,opts)=>{
   const signal=indicator.onCandle(bar,opts);indicator.pending=null;
   if(signal?.eligible&&opts.live){
    $('signal').textContent=signal.side;
    $('signal').className=signal.side==='LONG'?'positive':'negative';
    $('signalAt').textContent=stamp(signal.time);
    if(trade.auto&&quoteIsFresh())
     trade.onSignal(signal,lastTradePrice,true).then(()=>{showAuto();refresh()})
      .catch(e=>{msg(e);showAuto()});
   }
  }
 });
 feed.connect().catch(msg);
}
async function performManual(role){
 if(!confirm('Chốt '+role+' BTCUSDT bằng MARKET tiền thật?'))return;
 try{const result=await trade.manualClose(role);
  msg('Đã chốt '+result.qty+' BTC · còn '+result.remaining+' BTC');
  await refresh();await refreshHistory();
 }catch(e){msg(e)}finally{showAuto()}
}
async function inspectAuto(){
 const blocker=autoBlocker();
 if(blocker)throw Error(blocker);
 if(trade.busy)throw Error('OCC đang đối soát Binance; thử lại sau khi hoàn thành.');
 try{trade.setConfig(readConfig());displayConfig();}
 catch(e){$('configDetails').open=true;throw e;}
 return trade.preflight({price:lastTradePrice,
  healthy:quoteIsFresh()});
}
function showPreflightError(e){
 const reason=String(e?.message||e);
 lastAutoDiagnostic='CHƯA THỂ BẬT AUTO: '+reason;
 msg(reason);
 if(/ký quỹ|TP|LOT_SIZE|USDT|đòn bẩy|leverage|ISOLATED|CROSS/i.test(reason))
  $('configDetails').open=true;
 if(!connected)$('apiEditor').open=true;
 showAuto();
}
$('autoCheck').onclick=async()=>{
 if(trade.auto){lastAutoDiagnostic='AUTO đang ON';showAuto();return;}
 if(autoClickBusy)return;
 autoClickBusy=true;lastAutoDiagnostic='Đang kiểm tra điều kiện Binance Futures…';showAuto();
 try{
  const result=await inspectAuto();
  lastAutoDiagnostic='BINANCE ĐÃ XÁC MINH · '+result.quantityBTC+' BTC · TP '+
   result.legsBTC.join(' / ')+' BTC · ký quỹ '+result.marginUSDT+' USDT / '+result.leverage+'x';
  $('message').textContent='';showAuto();
 }catch(e){showPreflightError(e)}
 finally{autoClickBusy=false;showAuto()}
};
$('autoToggle').onclick=async()=>{
 if(trade.auto){
  trade.disarm();lastAutoDiagnostic='AUTO OFF · SL/TP đang mở vẫn giữ nguyên trên Binance';
  msg(lastAutoDiagnostic);showAuto();return;
 }
 if(autoClickBusy)return;
 autoClickBusy=true;lastAutoDiagnostic='Đang kiểm tra điều kiện Binance…';showAuto();
 try{
  const check=await inspectAuto();
  lastAutoDiagnostic='BINANCE ĐÃ XÁC MINH · '+check.quantityBTC+' BTC · 3 TP hợp lệ';
  showAuto();
  if(!confirm('BẬT AUTO BTCUSDT FUTURES BẰNG TIỀN THẬT?'))return;
  const confirmation=prompt('Nhập CHAP NHAN BTC FUTURES:');
  if(confirmation!=='CHAP NHAN BTC FUTURES'){
   msg('Chưa xác nhận giao dịch Futures. AUTO vẫn OFF.');return;
  }
  lastAutoDiagnostic='Đang đối soát lại Binance trước khi bật…';showAuto();
  await trade.arm({price:lastTradePrice,
   healthy:quoteIsFresh(),confirmation});
  lastAutoDiagnostic='';
  msg('AUTO ON · Đã xác minh Binance, chờ tín hiệu OCC M15 MỚI.');
 }catch(e){showPreflightError(e)}
 finally{autoClickBusy=false;showAuto()}
};
$('closeAll').onclick=()=>performManual('ALL');
$('reconcile').onclick=async()=>{
 if(!confirm('Kiểm tra vị thế và SL/TP trên Binance? AUTO vẫn OFF.'))return;
 try{await trade.reconcile();msg('Đã đối soát Binance');await refresh();}
 catch(e){msg(e)}finally{showAuto()}
};
$('applyLeverage').onclick=async()=>{
 try{
  const value=Number($('leverage').value);
  if(!confirm('Đặt đòn bẩy BTCUSDT '+value+'x trên Binance?'))return;
  await trade.setLeverage(value);msg('Đòn bẩy đã xác minh');await refresh();
 }catch(e){msg(e)}finally{showAuto()}
};
$('priceReconnect').onclick=()=>{
 lastAutoDiagnostic='Đang nối lại giá LAST + Mark';
 lastTrade=0;lastTradePrice=null;
 $('last').textContent='—';$('priceTime').textContent='Đang nối lại giá trực tiếp…';
 connectFeed();showAuto();
};
displayConfig();connectionStatus();showAuto();connectFeed();
setInterval(()=>{
 if(!quoteIsFresh()){
  $('last').textContent='—';
  $('priceTime').textContent=lastTrade?
   'LAST cuối '+stamp(lastTrade)+' · đã quá hạn':'Chưa có giá LAST trực tiếp';
  if(healthy){$('status').textContent='GIÁ CŨ';$('status').className='warning';}
 }else{
  $('last').textContent=fmtValue(lastTradePrice,1);
  $('priceTime').textContent='LAST nhận lúc '+stamp(lastTrade);
  $('status').textContent='LIVE';$('status').className='positive';
 }
 showAuto();
},1000);
setInterval(async()=>{
 if(!connected)return;
 await trade.monitor();await refresh();showAuto();
},20000);
setInterval(()=>{if(connected&&Date.now()-lastIncome>300000)refreshHistory();},60000);
authenticate('restore');
