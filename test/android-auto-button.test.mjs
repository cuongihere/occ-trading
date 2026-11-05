import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Android WebChromeClient displays real Futures confirm and typed prompt',()=>{
 const java=read('android/app/src/main/java/com/occtrading/mobile/MainActivity.java');
 assert.match(java,/setWebChromeClient\(new WebChromeClient\(\)/);
 assert.match(java,/boolean onJsConfirm\(/);
 assert.match(java,/boolean onJsPrompt\(/);
 assert.match(java,/result\.confirm\(input\.getText\(\)\.toString\(\)\)/);
 assert.match(java,/file:\/\/\/android_asset\/index\.html"\.equals\(url\)/);
 assert.match(java,/result\.cancel\(\)/);
 assert.match(java,/publicNetwork = Executors\.newFixedThreadPool\(2\)/);
 assert.match(java,/readNetwork = Executors\.newFixedThreadPool\(4\)/);
 assert.match(java,/tradeNetwork = Executors\.newSingleThreadExecutor\(\)/);
});

test('Insufficient default margin returns actionable Binance minimum, not silent Auto refusal',()=>{
 const win={};
 runInNewContext(read('android/app/src/main/assets/trade-core.js'),{window:win});
 const bot=new win.OCCMobileTrade({
  load:()=> '{}',save:()=>true,report:()=>{},signed:async()=>{},publicGet:async()=>{},
  newId:()=> 'OCCBTC-1234567890abcd'
 });
 const rules={step:.001,min:.001,minNotional:5,tick:.1};
 const minimum=bot.minMarginForThreeTP(78000,rules);
 assert.ok(minimum>60&&minimum<80);
 assert.throws(()=>bot.plan({availableUSDT:800},78000,rules),error=>
  /Ký quỹ 20 USDT/.test(error.message)&&
  /cần khoảng/.test(error.message)&&/Cấu hình Auto/.test(error.message));
 bot.setConfig({marginUSDT:70});
 assert.equal(bot.plan({availableUSDT:800},78000,rules).parts.length,3);
});

function createUi(){
 const els=new Map();
 const node=id=>{
  if(!els.has(id))els.set(id,{
   id,disabled:false,textContent:'',value:'',className:'',checked:false,open:false,
   classList:{remove(){},add(){}},append(){},replaceChildren(){},focus(){}
  });
  return els.get(id);
 };
 const current={};
 class FakeTrade{
  constructor(){
   this.cp={phase:'IDLE',halted:false,config:{side:'BOTH',marginUSDT:70,
    leverage:5,slPercent:1,tpMode:'Percent',tp1Val:1,tp2Val:2,tp3Val:3,
    tp1Qty:33,tp2Qty:33,reverseOnSignal:false}};
   this.auto=false;this.connected=false;this.busy=false;
   current.trade=this;
  }
  setConfig(c){this.cp.config=c}
  persist(){}
  async preflight({price,healthy}){
   assert.equal(price,78000);
   assert.equal(healthy,true);
   return {quantityBTC:.004,legsBTC:[.001,.001,.002],
    marginUSDT:this.cp.config.marginUSDT,leverage:this.cp.config.leverage};
  }
  async arm({confirmation,healthy}){
   assert.equal(confirmation,'CHAP NHAN BTC FUTURES');
   assert.equal(healthy,true);
   this.auto=true;return true;
  }
  disarm(){this.auto=false}
 }
 const window={};
 const api={
  loadState:()=> '{}',saveState:()=>true,newPrefix:()=> 'OCCBTC-1234567890abcd',
  // Leave automatic restore pending in this isolated UI test; readiness is set
  // explicitly by the individual test to avoid asynchronous auth state races.
  auth:(op,key,secret,remember,id)=>{},
  publicGet(){},signed(){},shareCsv(){}
 };
 const context={window,document:{getElementById:node,createElement:()=>({
  classList:{add(){},remove(){}},append(){},replaceChildren(){}})},
  OCCAndroid:api,OCCMobileTrade:FakeTrade,
  OCCEngine:class{constructor(){this.ready=false}setHealthy(){}setRunning(){}},
  BinanceFeed:class{constructor(cb){this.cb=cb}connect(){return Promise.resolve()}disconnect(){}healthy(){return true}},
  setTimeout:()=>0,clearTimeout(){},setInterval(){},confirm:()=>true,
  prompt:()=> 'CHAP NHAN BTC FUTURES',console,Date
 };
 runInNewContext(read('android/app/src/main/assets/app.js'),context);
 return {node,context,current};
}

test('Auto button remains tappable while offline and shows visible reason beside header',async()=>{
 const ui=createUi();
 assert.equal(ui.node('autoToggle').disabled,false);
 await ui.node('autoToggle').onclick();
 assert.match(ui.node('message').textContent,/Chưa kết nối API Binance/);
 assert.equal(ui.node('apiEditor').open,true);
});

test('Tapping Auto after feed/API readiness enters ON and explicitly waits for fresh signal',async()=>{
 const ui=createUi();
 runInNewContext(`connected=true;trade.connected=true;indicator.ready=true;healthy=true;
  lastTrade=Date.now();lastTradePrice=78000;feed.healthy=()=>true;showAuto();`,ui.context);
 assert.equal(ui.node('autoToggle').disabled,false);
 await ui.node('autoToggle').onclick();
 assert.equal(ui.current.trade.auto,true);
 assert.equal(ui.node('autoState').textContent,'AUTO ON');
 assert.match(ui.node('message').textContent,/chờ tín hiệu OCC M15 MỚI/);
 await ui.node('autoToggle').onclick();
 assert.equal(ui.current.trade.auto,false);
 assert.equal(ui.node('autoState').textContent,'AUTO OFF');
});

test('Auto preflight button reports verified BTC legs without enabling live orders',async()=>{
 const ui=createUi();
 runInNewContext(`connected=true;trade.connected=true;indicator.ready=true;healthy=true;
  lastTrade=Date.now();lastTradePrice=78000;feed.healthy=()=>true;showAuto();`,ui.context);
 await ui.node('autoCheck').onclick();
 assert.equal(ui.current.trade.auto,false);
 assert.match(ui.node('safetyLine').textContent,/BINANCE ĐÃ XÁC MINH/);
 assert.match(ui.node('safetyLine').textContent,/0\.004 BTC/);
});
