import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('Binance /binance dashboard is linked from paper page and served locally',()=>{
 const server=read('server.mjs'),dashboard=read('dashboard.html');
 assert.match(server,/BINANCE_UI_PREVIEW\.html/);
 assert.match(server,/req\.url==='\/binance'/);
 assert.match(dashboard,/href="\/binance"/);
});
test('Real Binance single-screen UI shows account balance and position without price preview',()=>{
 const html=read('BINANCE_UI_PREVIEW.html');
 for(const id of ['enabled','apiKey','apiSecret','rememberApi','credentialEditor','wallet','available','equity',
    'unrealized','btcPosition','marginUSDT','leverage','side','sl','mode','tp1','tp2','tp3','q1','q2','q3','save',
    'realNet','realHistory','realCurve','apiConnect','apiForget','apiDisconnect','apiReconcile','applyLeverage','leverageMismatch','sizingAlert'])
  assert.ok(html.includes('id="'+id+'"'),'Missing '+id);
 assert.doesNotMatch(html,/id="preview"|id="notional"|id="sizingFormula"|id="entry"/);
 assert.match(html,/height:100dvh/);
 assert.match(html,/Lưu API mã hóa trên Windows/);
 assert.doesNotMatch(html,/Binance Demo|tiền thử/);
});
test('Credentials are submitted only to loopback backend, not localStorage',()=>{
 const html=read('BINANCE_UI_PREVIEW.html');
 assert.match(html,/type="password"/);
 assert.match(html,/request\('connect',\{apiKey:key,apiSecret:secret,environment:'production',remember\}\)/);
 assert.doesNotMatch(html,/localStorage/);
 assert.match(html,/request\('on',\{acceptance\}\)/);
 assert.match(html,/CHAP NHAN BTC FUTURES/);
 const js=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(js);assert.doesNotThrow(()=>new Function(js));
});
test('Portable Windows includes credential vault and consolidated dashboard',()=>{
 const build=read('BUILD_PORTABLE.ps1');
 assert.match(build,/'BINANCE_UI_PREVIEW\.html'/);
 assert.match(build,/'futures-credential-vault\.mjs'/);
});

test('Actual leverage differs from bot config until explicit exchange-sync action',()=>{
 const html=read('BINANCE_UI_PREVIEW.html');
 assert.match(html,/Đòn bẩy Binance/);
 assert.match(html,/Bot '\+desiredLeverage\+'x · Chưa đồng bộ/);
 assert.match(html,/request\('leverage',\{requestedLeverage,confirmation:'SYNC_BTCUSDT_LEVERAGE'\}\)/);
 assert.match(html,/leverageMismatch/);
 assert.match(html,/ÁP DỤNG/);
});

test('Binance Futures real BTC price is shown in header and refreshed independently of account API',()=>{
 const html=read('BINANCE_UI_PREVIEW.html'),server=read('server.mjs');
 for(const id of ['btcMarketTicker','btcLastPrice','btcMarketMark','btcLastState','btcPriceTime'])
  assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/BTCUSDT FUTURES · LAST/);
 assert.match(html,/fetch\('\/api\/binance\/market'/);
 assert.match(html,/setInterval\(refreshMarketPrice,1000\)/);
 assert.match(html,/MẤT LUỒNG GIÁ/);
 assert.match(server,/btcMarketQuote\.updateTrade\(t\)/);
 assert.match(server,/btcMarketQuote\.updateMark\(m\)/);
 assert.match(server,/req\.url==='\/api\/binance\/market'/);
});
test('Portable package contains BTC price market quote module',()=>{
 assert.match(read('BUILD_PORTABLE.ps1'),/'btc-market-quote\.mjs'/);
});

test('Live BTCUSDT quote occupies API panel space, not the top header',()=>{
 const html=read('BINANCE_UI_PREVIEW.html');
 const header=html.slice(html.indexOf('<header class="topbar">'),html.indexOf('</header>'));
 const account=html.slice(html.indexOf('<div class="panel apiPanel">'),html.indexOf('<h2>Cấu hình Auto'));
 assert.doesNotMatch(header,/btcMarketTicker|btcLastPrice/);
 assert.match(account,/id="btcMarketTicker"/);
 assert.match(account,/id="btcLastPrice"/);
 assert.match(account,/id="btcMarketMark"/);
 assert.match(html,/\.apiPanel\{display:flex;flex-direction:column\}/);
 assert.match(html,/font-size:clamp\(35px,3\.5vw,58px\)/);
 assert.match(html,/color:#ffd66b/);
 assert.match(html,/#btcMarketMark\{font-weight:800;color:#68dafa\}/);
});

test('Auto remains selected through Binance feed interruption and only OFF or exit disarms',()=>{
 const server=read('server.mjs'),html=read('BINANCE_UI_PREVIEW.html');
 assert.doesNotMatch(server,/s\.state!=='live'&&browserFutures\.armed\)browserFutures\.disarm\(\)/);
 assert.match(server,/opts\.live&&feed\.healthy\(\)&&browserFutures\.armed/);
 assert.match(server,/marketHealthy:feed\.healthy\(\)/);
 assert.match(server,/\/control\/live\/off'\)\{browserFutures\.disarm\(\)/);
 assert.match(html,/AUTO ON · CHỜ GIÁ/);
 assert.match(html,/AUTO ON · KHÓA AN TOÀN/);
 assert.match(html,/sizingStatus!=='valid'/);
});

test('live margin/TP editing validates immediately and server checks before save and Auto ON',()=>{
 const html=read('BINANCE_UI_PREVIEW.html'),server=read('server.mjs');
 assert.match(html,/scheduleSizingValidation\(\)/);
 assert.match(html,/request\('validate',settings\)/);
 assert.match(html,/const check=await validateSizing\(\)/);
 assert.match(html,/check.status!=='valid'/);
 assert.match(server,/control\/live\/validate/);
 assert.match(server,/preview.status==='invalid'/);
 assert.match(server,/arm\(p.acceptance,quote.lastPrice\)/);
 const js=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(js);assert.doesNotThrow(()=>new Function(js));
});

test('Position analysis displays actual Binance SL TP steps and scenarios without configuration forecasts',()=>{
 const html=read('BINANCE_UI_PREVIEW.html'),server=read('server.mjs');
 const service=read('futures-browser-service.mjs'),build=read('BUILD_PORTABLE.ps1');
 for(const id of ['positionAnalysis','riskHeadline','riskUpdated','riskSummary',
  'riskLevels','riskScenarios','riskAlerts','riskDisclaimer'])
  assert.ok(html.includes('id="'+id+'"'),'missing risk panel: '+id);
 assert.match(html,/fetch\('\/api\/binance\/position-analysis'/);
 assert.match(html,/setInterval\(refreshPositionAnalysis,12000\)/);
 assert.match(html,/riskRow\(/);
 assert.match(html,/const origin=level\.origin/); // ownership states are explicit
 assert.doesNotMatch(html,/innerHTML\s*=/);
 assert.match(server,/req\.url==='\/api\/binance\/position-analysis'/);
 assert.match(service,/async positionAnalysis\(\)/);
 assert.match(service,/analyzeFuturesPosition/);
 assert.match(build,/'futures-position-analysis\.mjs'/);
 const js=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(js);assert.doesNotThrow(()=>new Function(js));
});

test('status and risk metrics are consolidated in one account panel; SL TP and scenarios are compact tables',()=>{
 const html=read('BINANCE_UI_PREVIEW.html');
 const top=html.indexOf('<section class="topgrid">');
 const risk=html.indexOf('<section class="riskDashboard" id="positionAnalysis"');
 const history=html.indexOf('<section class="below">');
 assert.ok(top>=0&&risk>top&&history>risk,'Tables must follow the account status row');
 const primary=html.slice(top,risk),tables=html.slice(risk,history);
 for(const id of ['entryPrice','markPrice','liqPrice','btcPnl','marginMode',
  'accountLeverage','botState','riskHeadline','riskUpdated','riskSummary','riskAlerts'])
  assert.match(primary,new RegExp('id="'+id+'"'),'Missing consolidated status: '+id);
 assert.doesNotMatch(tables,/id="riskSummary"|riskOverview|Tổng quan vị thế đang mở/);
 assert.doesNotMatch(primary,/Tổng quan vị thế đang mở/);
 assert.match(tables,/id="riskLevels"/);
 assert.match(tables,/id="riskScenarios"/);
 assert.equal((html.match(/id="riskSummary"/g)||[]).length,1);
 assert.equal((html.match(/class="panel riskLevelsPanel"/g)||[]).length,1);
 assert.equal((html.match(/class="panel riskScenariosPanel"/g)||[]).length,1);
 assert.match(tables,/class="riskTable" aria-label="Các lệnh SL TP đang mở trên Binance"/);
 assert.match(tables,/class="riskTable" aria-label="Các kịch bản kết quả của vị thế"/);
 assert.match(html,/function riskRow\(/);
 assert.match(html,/\.riskDashboard\{grid-template-columns:minmax\(0,1\.1fr\) minmax\(0,1fr\)/);
 assert.match(html,/\.accountPanel\{overflow:visible\}/);
 assert.doesNotMatch(html,/\.accountPanel\{overflow-y:auto/);
 assert.match(html,/\.app\{max-width:1780px;min-height:100dvh;height:auto/);
 assert.match(html,/@media\(max-width:750px\)/);
 assert.match(html,/fetch\('\/api\/binance\/position-analysis'/);
 assert.match(html,/setInterval\(refreshPositionAnalysis,12000\)/);
 assert.doesNotMatch(html,/innerHTML\s*=/);
 const js=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(js);
 assert.doesNotThrow(()=>new Function(js));
});

test('reconnect recovery keeps manual check clickable with DPAPI key even after saved API reconnect fails',()=>{
 const html=read('BINANCE_UI_PREVIEW.html'),server=read('server.mjs');
 const svc=read('futures-browser-service.mjs');
 assert.match(html,/id="apiReconcile"/);
 assert.match(html,/Kiểm tra \/ mở khóa/);
 assert.match(html,/request\('reconcile'\)/);
 assert.match(html,/s\.armed\|\|s\.busy\|\|\(!s\.connected&&!s\.credentialSaved\)/);
 assert.match(html,/API LỖI · THỬ LẠI/);
 assert.match(html,/recoveryStatus==='recovered'/);
 assert.match(server,/await browserFutures\.checkBinanceAndReconcile\(\)/);
 assert.match(svc,/async reconcileClosedAfterReconnect\(\)/);
 assert.match(svc,/async checkBinanceAndReconcile\(\)/);
 assert.match(svc,/await this\.reconcileFlat\(\)/);
 const js=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(js);assert.doesNotThrow(()=>new Function(js));
});
