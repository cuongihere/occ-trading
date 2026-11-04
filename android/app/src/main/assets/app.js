'use strict';
const $=id=>document.getElementById(id);
const num=(v,d=2)=>v==null||v===''||!Number.isFinite(Number(v))?'—':Number(v).toLocaleString('en-US',{maximumFractionDigits:d});
const stamp=v=>v?new Date(Number(v)).toLocaleString('vi-VN',{hour12:false}):'—';
const pending=new Map();
let seq=0,feed=null,healthy=false,lastTrade=0,lastMark=null,connected=false,account=null,algos=[],
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
function saveLocal(){
 if(!OCCAndroid.saveState(JSON.stringify(stored)))throw Error('Không thể lưu cấu hình Android');
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
 try{if(stored.phase!=='IDLE')throw Error('Không thay cấu hình khi có checkpoint giao dịch');
  stored.config=readConfig();saveLocal();displayConfig();msg('Đã lưu cấu hình Android');
 }catch(e){msg(e)}
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
  connected=!!result.connected;connectionStatus();
  if(connected){$('apiEditor').open=false;await refresh();await refreshHistory();}
  else{clearAccount();}msg(connected?'Đã kết nối Binance Futures':'Đã ngắt kết nối');
 }catch(e){connected=false;connectionStatus();msg(e)}
 finally{busy=false}
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
 strong.textContent=order?num(order.triggerPrice,2):'—';el.append(strong);
 const sub=document.createElement('small');
 if(order){
  const qty=order.closePosition===true||order.closePosition==='true'?remaining:Number(order.quantity);
  const direction=side==='LONG'?1:-1;
  const gross=(Number(order.triggerPrice)-entry)*qty*direction;
  sub.textContent=num(qty,6)+' BTC · '+num(gross,3)+' USDT (gross)';
 }else sub.textContent='Không có lệnh active';
 el.append(sub);return el;
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
  $('wallet').textContent=num(usdt.walletBalance,2);
  $('available').textContent=num(usdt.availableBalance,2);
  $('equity').textContent=num(acc.totalMarginBalance,2);
  $('unrealized').textContent=num(acc.totalUnrealizedProfit,2);color('unrealized',acc.totalUnrealizedProfit);
  $('btcPosition').textContent=num(amount,6);color('btcPosition',amount);
  $('entry').textContent=side?num(entry,2):'—';
  $('positionMark').textContent=side?num(pos.markPrice,2):'—';
  $('liq').textContent=side?num(pos.liquidationPrice,2):'—';
  $('btcPnl').textContent=side?num(pos.unRealizedProfit,3):'—';color('btcPnl',pos?.unRealizedProfit);
  $('marginMode').textContent=setting?.marginType||'—';
  $('actualLeverage').textContent=setting?.leverage?setting.leverage+'x':'—';
  $('levels').replaceChildren();
  if(side){
   const active=openAlgos.filter(x=>['NEW','ACCEPTED','PENDING_NEW'].includes(x.algoStatus));
   const stop=active.find(x=>x.orderType==='STOP_MARKET');
   const tp=active.filter(x=>x.orderType==='TAKE_PROFIT_MARKET')
     .sort((a,b)=>(side==='LONG'?1:-1)*(Number(a.triggerPrice)-Number(b.triggerPrice)));
   for(const [i,o] of [stop,...tp.slice(0,3)].entries())$('levels').append(createLevel(i===0?'SL':'TP'+i,o,side,entry,qty));
   if(!stop)log('Không thấy SL Binance đang hoạt động');
  }
  account=acc;algos=openAlgos;
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
  $('realNet').textContent=num(total,3);color('realNet',total);
  $('incomeSummary').textContent='7 ngày · Realized '+num(r,3)+' · Phí '+num(fee,3)+' · Funding '+num(fund,3)+
   (inc.length>=1000||rows.length>=1000?' · DỮ LIỆU CHƯA ĐẦY ĐỦ':'');
  const body=$('historyBody');body.replaceChildren();
  for(const x of rows.slice(-100).reverse()){
   const tr=document.createElement('tr');
   for(const v of [stamp(x.time),x.side,num(x.qty,6),num(x.price,2),num(x.realizedPnl,3),num(x.commission,3)]){
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
}
function connectFeed(){
 if(feed)feed.disconnect();
 feed=new BinanceFeed({
  onStatus:({state,message})=>setFeed(state,message),
  onReady:({h4,m15,now})=>{indicator.warmup(h4,m15,now);indicator.setRunning(false);indicator.setHealthy(false)},
  onTrade:({price,receivedAt})=>{lastTrade=receivedAt;$('last').textContent=num(price,1);$('priceTime').textContent=stamp(receivedAt)},
  onMark:({price})=>{if(Number(price)>0){lastMark=Number(price);$('mark').textContent=num(price,2)}},
  onCandle:(bar,opts)=>{
   const signal=indicator.onCandle(bar,opts);indicator.pending=null;
   if(signal?.eligible&&opts.live){$('signal').textContent=signal.side;$('signal').className=signal.side==='LONG'?'positive':'negative';$('signalAt').textContent=stamp(signal.time)}
  }
 });
 feed.connect().catch(msg);
}
displayConfig();connectionStatus();connectFeed();
setInterval(()=>{
 if(lastTrade&&Date.now()-lastTrade>10000){$('last').textContent='—';$('priceTime').textContent='Giá quá hạn'}
},1000);
setInterval(()=>{if(connected)refresh();},15000);
setInterval(()=>{if(connected&&Date.now()-lastIncome>300000)refreshHistory();},60000);
authenticate('restore');
