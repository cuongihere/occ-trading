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
