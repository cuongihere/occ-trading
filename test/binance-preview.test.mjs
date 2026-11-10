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
 assert.match(server,/\/control\/live\/off'\)\{/);
 assert.match(server,/browserFutures\.disarm\(\)/);
 assert.match(server,/browserFutures\.cancelOpenLimit\(\)/);
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
  'compactSLpnl','compactTP1pnl','compactTP2pnl','compactTP3pnl',
  'compactSLmeta','compactTP1meta','compactTP2meta','compactTP3meta','compactUnverified','slTpRefresh'])
  assert.match(main,new RegExp('id="'+id+'"'),'Missing compact position element: '+id);
 assert.equal((main.match(/class="compactRow"/g)||[]).length,4);
 assert.doesNotMatch(html,/<section class="riskDashboard"/);
 assert.doesNotMatch(html,/<div class="panel riskLevelsPanel"|<div class="panel riskScenariosPanel"/);
 assert.doesNotMatch(html,/id="riskLevels"|id="riskScenarios"/);
 assert.match(html,/function showPositionAnalysis\(data\)/);
 assert.match(html,/\$\('positionAnalysis'\)\.hidden=!positionOpen/);
 assert.match(html,/\.compactRow\[hidden\]\{display:none!important\}/);
 assert.match(html,/x\.active&&x\.confirmed/);
 assert.match(html,/x\.origin!=='CHƯA_XÁC_MINH'/);
 assert.match(html,/x\.clientId\?\.endsWith\('-'\+role\)/);
 assert.match(html,/Binance xác minh/);
 assert.match(html,/Algo #/);
 assert.match(html,/Chưa xác minh|CHƯA XÁC MINH/);
 assert.match(html,/\$\('slTpRefresh'\)\.onclick=async/);
 assert.match(html,/row\.hidden=false/);
 assert.match(html,/không phải lợi nhuận Binance/);
 assert.match(html,/Lệnh Algo trên Binance chưa xác minh thuộc OCC/);
 assert.doesNotMatch(html,/plan\.basis==='illustration'/);
 assert.match(html,/setInterval\(refreshPositionAnalysis,12000\)/);
 assert.match(html,/fetch\('\/api\/binance\/position-analysis'/);
 assert.match(server,/req\.url==='\/api\/binance\/position-analysis'/);
 assert.match(server,/referencePrice:quote\.live===true\?quote\.lastPrice:null/);
 assert.match(service,/projectCompactSLTP/);
 assert.match(build,/'futures-compact-pnl\.mjs'/);
 assert.doesNotMatch(html,/innerHTML\s*=/);
 assert.match(html,/id="incomeAuditSummary"/);
 assert.match(html,/t\.netBinanceUSDT===null/);
 assert.match(html,/s\.binanceAuditedClosed/);
 assert.match(html,/nhóm (OCC )?chưa ghép đủ fill/);
 assert.match(read('futures-transport.mjs'),/'\/fapi\/v1\/income'/);
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

test('Operator BTCUSDT manual TP1 TP2 TP3 and close-all buttons require confirmation and exact Binance quantities',()=>{
 const html=read('BINANCE_UI_PREVIEW.html'),server=read('server.mjs'),
  service=read('futures-browser-service.mjs'),portable=read('BUILD_PORTABLE.ps1');
 for(const id of ['manualTP1','manualTP2','manualTP3','manualCloseAll','manualActionStatus'])
  assert.match(html,new RegExp('id="'+id+'"'));
 assert.match(html,/function performManualExit\(role\)/);
 assert.match(html,/request\('manual-exit'/);
 assert.match(html,/expectedEntryOrderId:current\.entryOrderId/);
 assert.match(html,/expectedRemainingBTC:current\.remainingBTC/);
 assert.match(html,/manualSnapshot\?\.allowed/);
 assert.match(html,/MANUAL\s?MARKET|MARKET KHÔNG chờ giá TP/);
 assert.match(server,/control\/live\/manual-exit/);
 assert.match(server,/await browserFutures\.manualMarketExit\(p\)/);
 assert.match(service,/async manualMarketExit\(/);
 assert.match(service,/MANUAL_TP_CANCEL_SENDING/);
 assert.match(service,/reduceOnly:'true'/);
 assert.match(service,/MANUAL_EXIT_HALTED/);
 assert.match(portable,/'futures-manual-exit\.mjs'/);
 const js=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(js);assert.doesNotThrow(()=>new Function(js));
});

test('Windows portable bundles the LIMIT executor imported by Futures service',()=>{
 const builder=read('BUILD_PORTABLE.ps1');
 const service=read('futures-browser-service.mjs');
 assert.match(builder,/'futures-limit-entry\.mjs'/);
 assert.match(service,/import \{installLimitEntry\} from '\.\/futures-limit-entry\.mjs'/);
 assert.match(read('server.mjs'),/browserFutures\.pollLimit\(\)/);
});

test('API, real Binance quote and minimized Auto config share a row without losing trading controls',()=>{
 const html=read('BINANCE_UI_PREVIEW.html');
 const apiStart=html.indexOf('<div class="panel apiPanel">');
 const priceStart=html.indexOf('<div class="panel pricePanel"');
 const configStart=html.indexOf('<div class="panel configPanel">');
 const positionStart=html.indexOf('<section class="positionSection"');
 assert.ok(apiStart>=0&&priceStart>apiStart&&configStart>priceStart&&positionStart>configStart);
 const api=html.slice(apiStart,priceStart),price=html.slice(priceStart,configStart),config=html.slice(configStart,positionStart);
 assert.doesNotMatch(api,/id="btcMarketTicker"/);
 assert.match(price,/class="marketTicker stale" id="btcMarketTicker"/);
 assert.equal((html.match(/id="btcMarketTicker"/g)||[]).length,1);
 for(const id of ['credentialEditor','apiKey','apiSecret','rememberApi','apiConnect','apiDisconnect','apiForget','apiReconcile'])
  assert.match(api,new RegExp('id="'+id+'"'));
 for(const id of ['marginUSDT','leverage','side','sl','mode','tp1','tp2','tp3','q1','q2','q3','reverseToggle','reverseState','sizingAlert','save','applyLeverage','settingStatus'])
  assert.match(config,new RegExp('id="'+id+'"'));
 assert.match(config,/<details id="autoConfigDetails" class="autoConfigDetails">/);
 assert.doesNotMatch(config,/<details id="autoConfigDetails"[^>]* open/);
 assert.match(config,/id="autoConfigSnapshot"/);
 assert.match(config,/class="configPrimary"/);
 assert.match(config,/class="configTargets"/);
 assert.equal((config.match(/<label/g)||[]).length,16);
 for(const id of ['entryMode','limitBasis','limitOffsetPct','limitWaitSeconds','cancelLimit','limitInfo'])
  assert.match(config,new RegExp('id="'+id+'"'));
 assert.match(html,/\.configPanel \.configTargets\{display:grid;grid-template-columns:/);
 assert.match(html,/\.topgrid\{display:grid;grid-template-columns:minmax\(310px,1\.15fr\) minmax\(260px,\.9fr\) minmax\(350px,1fr\)/);
 assert.match(html,/\.pricePanel \.marketTicker\{flex:1 1 auto;margin:0/);
 assert.match(html,/\.configPanel \.configTargets\{grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
 assert.match(html,/@media\(max-width:1220px\)/);
 assert.match(html,/@media\(max-width:750px\)/);
 assert.match(html,/function updateAutoConfigSnapshot\(\)/);
 assert.match(html,/updateAutoConfigSnapshot\(\);/);
 assert.match(html,/setInterval\(refreshMarketPrice,1000\)/);
 const js=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(js);assert.doesNotThrow(()=>new Function(js));
});

test('7-day Binance Income is the primary PnL, with separate OCC closed-trade Net',()=>{
 const html=read('BINANCE_UI_PREVIEW.html');
 const top=html.slice(html.indexOf('<section class="kpis">'),html.indexOf('<section class="topgrid">'));
 const history=html.slice(html.indexOf('<section class="below">'),html.indexOf('</section>',html.indexOf('<section class="below">')));
 assert.match(top,/P&L Binance BTC · 7 ngày/);
 assert.match(top,/id="binanceIncomeTotal"/);
 assert.doesNotMatch(top,/id="realNet"/);
 assert.match(history,/id="realNet"/);
 assert.match(history,/id="occScopeWarning"/);
 assert.match(history,/id="incomeReconcileSummary"/);
 assert.match(html,/incomeLastCheckedAt=s\.lastIncomeSync\|\|null/);
 assert.match(html,/syncAge<11\*60\*1000/);
 assert.match(html,/ia\?\.available===true/);
 assert.match(html,/matchedTradeIncomeUSDT/);
 assert.match(html,/unmatchedTradeIncomeUSDT/);
 assert.match(html,/không sử dụng Net OCC làm tổng P&L tài khoản/);
 const js=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(js);assert.doesNotThrow(()=>new Function(js));
});
test('BTC position is one full-width horizontal panel BELOW API and Auto settings, not the third top-grid column',()=>{
 const html=read('BINANCE_UI_PREVIEW.html');
 const top=html.indexOf('<section class="topgrid">');
 const position=html.indexOf('<section class="positionSection"');
 const history=html.indexOf('<section class="below">');
 assert.ok(top>=0&&position>top&&history>position);
 const upper=html.slice(top,position),section=html.slice(position,history);
 assert.doesNotMatch(upper,/class="panel accountPanel"|id="positionAnalysis"/);
 assert.match(upper,/class="panel apiPanel"/);
 assert.match(upper,/class="panel configPanel"/);
 assert.match(section,/class="panel accountPanel"/);
 assert.match(section,/id="positionAnalysis"/);
 assert.equal((html.match(/class="panel accountPanel"/g)||[]).length,1);
 assert.equal((html.match(/class="positionSection"/g)||[]).length,1);
 for(const id of ['riskHeadline','riskUpdated','riskSummary','positionAnalysis',
  'entryPrice','markPrice','liqPrice','btcPnl','marginMode','accountLeverage',
  'botState','autoHint','compactSLprice','compactTP1price','compactTP2price','compactTP3price',
  'compactSLpnl','compactTP1pnl','compactTP2pnl','compactTP3pnl','manualTP1','manualTP2',
  'manualTP3','manualCloseAll','manualActionStatus','riskAlerts'])
  assert.match(section,new RegExp('id="'+id+'"'),'Missing full-width position element '+id);
 assert.match(html,/grid-template-rows:48px 90px auto auto minmax\(180px,1fr\) 20px/);
 assert.match(html,/\.topgrid\{display:grid;grid-template-columns:minmax\(310px,1\.15fr\) minmax\(260px,\.9fr\) minmax\(350px,1fr\)/);
 assert.match(html,/\.positionSection>\.accountPanel\{\s*display:grid/);
 assert.match(html,/\.positionSection \.positionGrid\{\s*grid-column:1\/-1;grid-row:4;\s*grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
 assert.match(html,/\.positionSection \.compactRows\{\s*display:grid;grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
 assert.match(html,/@media\(max-width:1120px\)/);
 assert.match(html,/@media\(max-width:900px\)/);
 assert.match(html,/@media\(max-width:540px\)/);
 // No change to trading actions or Binance data refresh cadence.
 assert.match(html,/request\('manual-exit'/);
 assert.match(html,/setInterval\(refreshPositionAnalysis,12000\)/);
 assert.doesNotMatch(section,/overflow-y:auto|style="overflow:/);
 const js=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(js);assert.doesNotThrow(()=>new Function(js));
});

test('Missing 0/4 SL-TP on Binance offers consented recovery from actual OCC fills',()=>{
 const html=read('BINANCE_UI_PREVIEW.html'),server=read('server.mjs');
 const svc=read('futures-browser-service.mjs'),build=read('BUILD_PORTABLE.ps1');
 assert.match(html,/id="repairProtection"/);
 assert.match(html,/id="repairProtectionStatus"/);
 assert.match(html,/\/api\/binance\/protection-repair-preview/);
 assert.match(html,/request\('protection-repair',\{/);
 assert.match(html,/KHOI PHUC SL TP BTCUSDT/);
 assert.match(html,/data\.algoCount===0&&data\.normalOrderCount===0/);
 assert.match(server,/\/control\/live\/protection-repair/);
 assert.match(server,/\/api\/binance\/protection-repair-preview/);
 assert.match(svc,/import \{installProtectionRepair\} from '\.\/futures-protection-repair\.mjs'/);
 assert.match(build,/'futures-protection-repair\.mjs'/);
 assert.doesNotMatch(html,/autoRepair\(\)|sendStopOnRender/);
});

test('Windows dashboard shows Binance unlinked realized fills separately and never counts them as OCC trades',()=>{
 const html=read('BINANCE_UI_PREVIEW.html');
 const service=read('futures-browser-service.mjs');
 const history=read('futures-live-history.mjs');
 const ledger=read('binance-live-stats.mjs');
 assert.match(html,/id="unlinkedBinanceHistory"/);
 assert.match(html,/id="exchangeHistoryStatus"/);
 assert.match(html,/unmatchedRealizedOrders/);
 assert.match(html,/CHƯA XÁC MINH THUỘC OCC/);
 assert.match(history,/fetchExchangeTrades7Days/);
 assert.match(service,/syncExchangeTrades/);
 assert.match(ledger,/BINANCE_USER_TRADES_UNATTRIBUTED/);
 assert.doesNotMatch(html,/liveReport\.exchangeHistory\.unmatchedRealizedOrders\.reduce/);
});
