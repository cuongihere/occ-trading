import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Android preview is independent native APK with screen-on flag and no trading credentials',()=>{
 const manifest=src('android/app/src/main/AndroidManifest.xml');
 const activity=src('android/app/src/main/java/com/occtrading/mobile/MainActivity.java');
 const html=src('android/app/src/main/assets/index.html');
 const build=src('android/app/build.gradle');
 assert.match(activity,/FLAG_KEEP_SCREEN_ON/);
 assert.match(activity,/new URL\("https:\/\/fapi\.binance\.com" \+ path\)/);
 assert.match(activity,/path\.equals\("\/fapi\/v1\/time"\)/);
 assert.doesNotMatch(activity,/\/fapi\/v1\/order|apiSecret|apiKey|Hmac|POST/);
 assert.match(manifest,/android\.permission\.INTERNET/);
 assert.doesNotMatch(manifest,/FOREGROUND_SERVICE/);
 assert.match(build,/minSdk 26/);
 assert.match(html,/CHỈ ĐỌC · KHÔNG GIAO DỊCH THẬT/);
 assert.doesNotMatch(html,/API Secret|Kết nối & lưu API/);
});
test('Android OCC indicator matches production engine exactly apart from export syntax',()=>{
 const source=src('engine.mjs');
 const converted=source.replace(/^export const M15/m,'const M15')
  .replace(/^export function smma/m,'function smma')
  .replace(/^export class OCCEngine/m,'class OCCEngine')+
  '\nwindow.OCCEngine = OCCEngine;\n';
 assert.equal(src('android/app/src/main/assets/engine.js'),converted);
});
test('Android public feed preserves original close-of-candle and no-catch-up checks',()=>{
 const feed=src('android/app/src/main/assets/server-feed.js');
 const script=src('android/app/src/main/assets/app.js');
 assert.match(feed,/time!==this\.lastClosed\+M15/);
 assert.match(feed,/live && this\.healthy\(\)/);
 assert.match(feed,/window\.occPublicGet\(path\)/);
 assert.doesNotMatch(feed,/^export /m);
 assert.match(script,/indicator\.pending=null/);
 assert.match(script,/signal\?\.eligible&&opts\.live/);
 assert.doesNotMatch(script,/\/fapi\/v1\/order|apiKey|POST/);
 for(const code of [src('android/app/src/main/assets/engine.js'),feed,script])
  assert.doesNotThrow(()=>new Function(code));
});
test('Android workflow creates a locally hosted APK install artifact',()=>{
 const yml=src('.github/workflows/android-apk.yml');
 assert.match(yml,/gradle -p android --no-daemon :app:assembleDebug/);
 assert.match(yml,/OCC_Android_Standalone_Preview_APK/);
 assert.match(yml,/app-debug\.apk/);
});
