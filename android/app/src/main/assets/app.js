'use strict';
const $=id=>document.getElementById(id);
const fmt=(n,d=2)=>Number.isFinite(Number(n))&&n!=null?Number(n).toLocaleString('en-US',{maximumFractionDigits:d}):'—';
const clock=t=>new Date(t).toLocaleTimeString('vi-VN',{hour12:false});
let sequence=0,feed=null,lastTick=0,markPrice=null,ready=false,healthy=false;
const pending=new Map(), loglines=[], indicator=new OCCEngine();
window.occPublicGet=(path)=>new Promise((resolve,reject)=>{
 const id=String(++sequence);
 const timeout=setTimeout(()=>{pending.delete(id);reject(Error('Binance REST quá thời gian chờ'));},18000);
 pending.set(id,{resolve,reject,timeout});
 OCCAndroid.get(path,id);
});
window.occNativeResponse=(id,ok,payload,httpStatus)=>{
 const p=pending.get(id);if(!p)return;pending.delete(id);clearTimeout(p.timeout);
 if(!ok){const error=Error(payload);error.httpStatus=httpStatus;p.reject(error);return;}
 try{p.resolve(JSON.parse(payload));}catch(e){p.reject(Error('Phản hồi REST không phải JSON'));}
};
const log=message=>{
 const text=clock(Date.now())+' · '+String(message).slice(0,170);
 loglines.unshift(text);loglines.length=Math.min(loglines.length,10);
 $('events').textContent=loglines.join('\n');
};
function setState(state,message){
 healthy=state==='live';
 $('health').textContent=healthy?'LIVE':state.toUpperCase();
 $('health').className='metric '+(healthy?'ok':'watch');
 indicator.setHealthy(healthy);
 indicator.setRunning(healthy&&indicator.ready);
 if(message)log(message);
}
function renderIndicators(){
 const h=indicator.history.at(-1);if(!h)return;
 $('m15').textContent=clock(h.closeTime);
 const delta=h.closeSeries-h.openSeries;
 $('smma').textContent=(delta>0?'+':'')+fmt(delta,4);
 $('smma').className='metric '+(delta>0?'ok':delta<0?'error':'muted');
}
function connect(){
 if(feed)feed.disconnect();
 ready=false;healthy=false;$('warmup').textContent='ĐANG TẢI';
 feed=new BinanceFeed({
   onStatus:({state,message})=>setState(state,message),
   onReady:({h4,m15,now})=>{
     indicator.warmup(h4,m15,now);
     indicator.setHealthy(false);indicator.setRunning(false);
     ready=true;$('warmup').textContent='ĐÃ SẴN SÀNG';
     $('warmup').className='metric ok';
     renderIndicators();log('SMMA8 H4/M15 đã đồng bộ từ nến Binance.');
   },
   onCandle:(bar,opts)=>{
     const signal=indicator.onCandle(bar,opts);
     indicator.pending=null; // signal-only mode: never emulate live fills
     renderIndicators();
     if(signal?.eligible&&opts.live){
       $('signal').textContent=signal.side;
       $('signal').className=signal.side==='LONG'?'ok':'error';
       $('signalTime').textContent='Nến M15: '+clock(signal.time)+' · Giá trị đã xác minh từ Binance';
       log('TÍN HIỆU OCC '+signal.side+' từ nến M15 đóng.');
     }
   },
   onTrade:({price,receivedAt})=>{
     lastTick=receivedAt;$('last').textContent=fmt(price,1);
     $('time').textContent='Cập nhật '+clock(receivedAt);
   },
   onMark:({price})=>{
     if(Number.isFinite(price)&&price>0){markPrice=price;$('mark').textContent=fmt(price,2);}
   }
 });
 feed.connect().catch(e=>log('Không khởi động được: '+e.message));
}
$('reconnect').onclick=connect;
setInterval(()=>{
 $('clock').textContent=clock(Date.now());
 if(lastTick&&Date.now()-lastTick>10000){
   $('last').textContent='—';$('time').textContent='Giá quá hạn / chờ kết nối';
 }
 if(feed&&ready&&!feed.healthy())$('health').textContent='KHÔNG ỔN ĐỊNH';
},1000);
connect();
