import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('Binance preview is linked from paper dashboard and served locally',()=>{
 const server=read('server.mjs'),dashboard=read('dashboard.html');
 assert.match(server,/BINANCE_UI_PREVIEW\.html/);
 assert.match(server,/req\.url==='\/binance'/);
 assert.match(dashboard,/href="\/binance"/);
});
test('BTC Futures shows margin USDT and leverage inputs, not equity percent or cap',()=>{
 const html=read('BINANCE_UI_PREVIEW.html');
 for(const id of ['enabled','side','marginUSDT','leverage','notional','sizingFormula',
                  'sl','mode','tp1','tp2','tp3','entry','q1','q2','q3','preview','save'])
  assert.ok(html.includes('id="'+id+'"'),'Missing '+id);
 assert.doesNotMatch(html,/id="eq"|id="limit"/);
 assert.match(html,/id="marginUSDT"[^>]*value="20"/);
 assert.match(html,/id="leverage"[^>]*value="5"/);
 assert.match(html,/margin\*leverage/);
 assert.match(html,/notional\/entry/);
});
test('Binance preview cannot submit actual trades or enable LIVE',()=>{
 const html=read('BINANCE_UI_PREVIEW.html');
 assert.match(html,/id="enabled" disabled/);
 assert.doesNotMatch(html,/\/fapi\/v1\/order|\/fapi\/v1\/algoOrder/);
 assert.match(html,/fetch\('\/api\/binance\/live-report'/);
 assert.match(html,/Bản nháp|bản nháp/);
});
test('Frontend script parses without syntax errors',()=>{
 const html=read('BINANCE_UI_PREVIEW.html');
 const js=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(js);
 assert.doesNotThrow(()=>new Function(js));
});
test('Portable packager includes Binance settings page',()=>{
 assert.match(read('BUILD_PORTABLE.ps1'),/'BINANCE_UI_PREVIEW\.html'/);
});
