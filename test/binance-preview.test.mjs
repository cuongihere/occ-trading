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
    'realNet','realHistory','realCurve','apiConnect','apiForget','apiDisconnect','apiReconcile','applyLeverage','leverageMismatch'])
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
