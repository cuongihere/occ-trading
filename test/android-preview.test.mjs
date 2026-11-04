import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Android app keeps screen on and only loads offline bundled UI',()=>{
 const manifest=src('android/app/src/main/AndroidManifest.xml');
 const java=src('android/app/src/main/java/com/occtrading/mobile/MainActivity.java');
 const ui=src('android/app/src/main/assets/index.html');
 assert.match(java,/FLAG_KEEP_SCREEN_ON/);
 assert.match(java,/file:\/\/\/android_asset\/index\.html/);
 assert.match(java,/setAllowUniversalAccessFromFileURLs\(false\)/);
 assert.match(manifest,/android\.permission\.INTERNET/);
 assert.match(manifest,/android:allowBackup="false"/);
 assert.doesNotMatch(ui,/class="banner"|BẢN THỬ NGHIỆM · CHỈ ĐỌC/);
 assert.match(ui,/id="wallet"/);
 assert.match(ui,/id="btcPosition"/);
 assert.match(ui,/id="levels"/);
 assert.match(ui,/id="historyBody"/);
});
test('Android credentials remain protected by Keystore and no order write is authorized',()=>{
 const java=src('android/app/src/main/java/com/occtrading/mobile/MainActivity.java');
 assert.match(java,/AndroidKeyStore/);
 assert.match(java,/AES\/GCM\/NoPadding/);
 assert.match(java,/KeyProperties\.PURPOSE_ENCRYPT/);
 assert.match(java,/getPreferences\(MODE_PRIVATE\)/);
 assert.match(java,/return method\.equals\("GET"\) && SIGNED_GET\.contains\(path\);/);
 assert.match(java,/private static final Set<String> SIGNED_GET/);
 assert.match(java,/API = "https:\/\/fapi\.binance\.com"/);
});
test('OCC M15/H4 indicator is byte-identical to original engine aside from module exports',()=>{
 const source=src('engine.mjs');
 const expected=source.replace(/^export const M15/m,'const M15')
  .replace(/^export function smma/m,'function smma')
  .replace(/^export class OCCEngine/m,'class OCCEngine')+'\nwindow.OCCEngine = OCCEngine;\n';
 assert.equal(src('android/app/src/main/assets/engine.js'),expected);
});
test('Android code reads real Futures account, position, conditional orders and Income without placing trades',()=>{
 const feed=src('android/app/src/main/assets/server-feed.js');
 const js=src('android/app/src/main/assets/app.js');
 assert.match(feed,/window\.occPublicGet\(path\)/);
 assert.match(feed,/time!==this\.lastClosed\+M15/);
 assert.match(js,/\/fapi\/v2\/account/);
 assert.match(js,/\/fapi\/v3\/positionRisk/);
 assert.match(js,/\/fapi\/v1\/openAlgoOrders/);
 assert.match(js,/\/fapi\/v1\/income/);
 assert.match(js,/\/fapi\/v1\/userTrades/);
 assert.match(js,/indicator\.pending=null/);
 assert.match(js,/signal\?\.eligible&&opts\.live/);
 assert.doesNotMatch(js,/signed\('POST'|signed\('DELETE'/);
 for(const code of [src('android/app/src/main/assets/engine.js'),feed,js])
  assert.doesNotThrow(()=>new Function(code));
});
test('Android workflow publishes installable debug APK',()=>{
 const yml=src('.github/workflows/android-apk.yml');
 assert.match(yml,/gradle -p android --no-daemon :app:assembleDebug/);
 assert.match(yml,/OCC_Android_Standalone_Preview_APK/);
 assert.match(yml,/app-debug\.apk/);
});
