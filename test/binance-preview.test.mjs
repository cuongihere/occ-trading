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

test('Binance status shows only four compact SL/TP projections, without separate risk tables',()=>{
 const html=read('BINANCE_UI_PREVIEW.html'),server=read('server.mjs');
 const service=read('futures-browser-service.mjs'),build=read('BUILD_PORTABLE.ps1');
 const top=html.indexOf('<section class="topgrid">'),history=html.indexOf('<section class="below">');
 assert.ok(top>=0&&history>top);
 const main=html.slice(top,history);
 for(const id of ['entryPrice','markPrice','liqPrice','btcPnl','botState','riskHeadline',
  'riskUpdated','riskSummary','riskAlerts','positionAnalysis','compactSubtitle','compactNote',
  'compactSLshare','compactTP1share','compactTP2share','compactTP3share',
  'compactSLprice','compactTP1price','compactTP2price','compactTP3price',
  'compactSLpnl','compactTP1pnl','compactTP2pnl','compactTP3pnl'])
  assert.match(main,new RegExp('id="'+id+'"'),'Missing compact position element: '+id);
 assert.equal((main.match(/class="compactRow"/g)||[]).length,4);
 assert.doesNotMatch(html,/<section class="riskDashboard"/);
 assert.doesNotMatch(html,/<div class="panel riskLevelsPanel"|<div class="panel riskScenariosPanel"/);
 assert.doesNotMatch(html,/id="riskLevels"|id="riskScenarios"/);
 assert.match(html,/function showPositionAnalysis\(data\)/);
 assert.match(html,/plan\.basis==='illustration'/);
 assert.match(html,/row\.effectiveSharePercent/);
 assert.match(html,/row\.configuredSharePercent/);
 assert.match(html,/setInterval\(refreshPositionAnalysis,12000\)/);
 assert.match(html,/fetch\('\/api\/binance\/position-analysis'/);
 assert.match(server,/req\.url==='\/api\/binance\/position-analysis'/);
 assert.match(server,/referencePrice:quote\.live===true\?quote\.lastPrice:null/);
 assert.match(service,/projectCompactSLTP/);
 assert.match(build,/'futures-compact-pnl\.mjs'/);
 assert.doesNotMatch(html,/innerHTML\s*=/);
 const js=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(js);assert.doesNotThrow(()=>new Function(js));
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

test('Futures reversal switch is visible and persisted separately from AUTO and SL TP configuration',()=>{
 const html=read('BINANCE_UI_PREVIEW.html'),server=read('server.mjs'),
  service=read('futures-browser-service.mjs');
 assert.match(html,/id="reverseToggle"/);
 assert.match(html,/id="reverseState"/);
 assert.match(html,/Đảo chiều theo OCC/);
 assert.match(html,/request\('reverse-mode',\{enabled:value\}\)/);
 assert.match(html,/reverseOnSignal:\$\('reverseToggle'\)\.checked/);
 assert.match(html,/s\.config\.reverseOnSignal===true/);
 assert.match(server,/control\/live\/reverse-mode/);
 assert.match(server,/setReverseOnSignal\(p.enabled\)/);
 assert.match(service,/async reverseManagedPosition\(signal\)/);
 assert.match(service,/reduceOnly:'true'/);
 assert.match(service,/REVERSE_CLOSE_SENDING/);
 assert.match(service,/REVERSE_HALTED/);
 const js=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(js);assert.doesNotThrow(()=>new Function(js));
});

test('App safely clears only OCC checkpoint orphaned SL TP after FLAT and persists verified history',()=>{
 const html=read('BINANCE_UI_PREVIEW.html'),server=read('server.mjs'),
  svc=read('futures-browser-service.mjs'),build=read('BUILD_PORTABLE.ps1'),
  transport=read('futures-transport.mjs');
 assert.match(html,/Kiểm tra & dọn SL\/TP cũ/);
 assert.match(html,/id="historySyncStatus"/);
 assert.match(html,/request\('history-refresh'\)/);
 assert.match(server,/control\/live\/history-refresh/);
 assert.match(server,/const liveHistoryRefresh=setInterval/);
 assert.match(svc,/async reconcileVerifiedClosedPosition\(\)/);
 assert.match(svc,/STALE_ALGO_CANCEL_SENDING/);
 assert.match(svc,/algo\.clientAlgoId!==old\.clientId/);
 assert.match(svc,/positionBTC!==0/);
 assert.match(svc,/registerRealOrder\(/);
 assert.match(svc,/refreshRealHistory\(/);
 assert.match(build,/'futures-live-history\.mjs'/);
 assert.match(transport,/'\/fapi\/v1\/allOrders'/);
 assert.match(transport,/'\/fapi\/v1\/allAlgoOrders'/);
 const js=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(js);assert.doesNotThrow(()=>new Function(js));
});
