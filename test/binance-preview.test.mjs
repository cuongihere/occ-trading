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
test('Preview has editable sizing and Multi TP settings while live toggle stays OFF',()=>{
 const html=read('BINANCE_UI_PREVIEW.html');
 for(const id of ['enabled','side','eq','limit','sl','mode','tp1','tp2','tp3','entry','q1','q2','q3','preview','save'])
  assert.ok(html.includes('id="'+id+'"'),'Missing '+id);
 assert.match(html,/id="enabled" disabled/);
 assert.doesNotMatch(html,/\/fapi\/v1\/order|\/fapi\/v1\/algoOrder/);
 assert.match(html,/Bản nháp|bản nháp/);
});
test('Portable packager includes the preview file',()=>{
 assert.match(read('BUILD_PORTABLE.ps1'),/'BINANCE_UI_PREVIEW\.html'/);
});
