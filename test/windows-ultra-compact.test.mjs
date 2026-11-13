import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('Desktop Futures fits one viewport and chart gets all remaining height',()=>{
 const ui=read('BINANCE_UI_PREVIEW.html'),chart=read('OCC_COMPARE.html');
 assert.match(ui,/grid-template-rows:32px 46px 54px minmax\(0,1fr\) 140px!important/);
 assert.match(ui,/height:100dvh!important/);
 assert.match(ui,/overflow:hidden!important/);
 assert.match(ui,/#tradeCompareFrame\{[\s\S]*?flex:1 1 auto!important/);
 assert.match(ui,/id="tradeCompareFrame"[\s\S]*?src="\/occ-compare\?embed=1&view=real"/);
 assert.match(chart,/html\.embed\.realonly main\{height:100%!important/);
 assert.match(chart,/html\.embed\.realonly \.execPanel canvas\{[\s\S]*?height:0!important/);
 assert.match(chart,/\$\('showMA'\)\.checked=false/);
});
test('Main screen keeps actual LIVE controls and makes secondary settings/history modal',()=>{
 const ui=read('BINANCE_UI_PREVIEW.html');
 for(const id of ['enabled','openConfigBtn','openHistoryBtn','openApiBtn','closeConfigBtn',
  'credentialEditor','autoConfigDetails','historyDrawer','closeHistoryBtn',
  'manualCloseAll','manualTP1','manualTP2','manualTP3','apiReconcile','btcLastPrice']){
  assert.match(ui,new RegExp('id="'+id+'"'),'Missing: '+id);
 }
 assert.match(ui,/historyDrawer:not\(\[open\]\)\{display:none!important\}/);
 assert.match(ui,/#credentialEditor\[open\]\{display:block!important/);
 assert.match(ui,/#autoConfigDetails\[open\]>.autoConfigBody\{display:block!important/);
 assert.match(ui,/if\(e\.key==='Escape'\)/);
 assert.match(ui,/\$\('credentialEditor'\)\.open=false;\s*\$\('apiConnect'\)/);
 const script=ui.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(script);
 assert.doesNotThrow(()=>new Function(script));
});
test('Actual Binance fill markers remain read-only and show role/quantity on hover',()=>{
 const chart=read('OCC_COMPARE.html'),srv=read('server.mjs');
 assert.match(chart,/const atBar=kind==='real'/);
 assert.match(chart,/ctx\.fillText\(f\.role/);
 assert.match(chart,/document\.documentElement\.classList\.contains\('realonly'\)/);
 assert.match(srv,/readVerifiedChartFills/);
 assert.doesNotMatch(chart,/\/control\/live\/on|\/control\/live\/manual-exit/);
 const scripts=[...chart.matchAll(/<script(?: [^>]*)?>([\s\S]*?)<\/script>/g)];
 assert.ok(scripts.length>0);
 for(const m of scripts)assert.doesNotThrow(()=>new Function(m[1]));
});