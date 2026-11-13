import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('One Windows trading screen has inline OCC/Binance charts, not a required second page',()=>{
 const page=read('BINANCE_UI_PREVIEW.html');
 const a=page.indexOf('<header class="topbar">');
 const b=page.indexOf('<section class="kpis">');
 const c=page.indexOf('<section class="topgrid">');
 const d=page.indexOf('<section class="chartWorkbench panel"');
 const e=page.indexOf('<section class="positionSection"');
 const f=page.indexOf('<details class="historyDrawer"');
 assert.ok(a>=0&&b>a&&c>b&&d>c&&e>d&&f>e,'Unified page hierarchy');
 assert.match(page,/id="tradeCompareFrame"[\s\S]*?src="\/occ-compare\?embed=1"/);
 assert.match(page,/id="chartWorkbench"/);
 assert.match(page,/href="#chartWorkbench"/);
 assert.match(page,/class="historyDrawerSummary"/);
 assert.match(page,/id="historyDrawerBrief"/);
 assert.match(page,/id="enabled"/);
 assert.match(page,/id="reverseToggle"/);
 assert.match(page,/id="repairProtection"/);
 assert.match(page,/id="manualCloseAll"/);
 assert.match(page,/id="realHistory"/);
 assert.match(page,/id="unlinkedBinanceHistory"/);
 assert.match(page,/id="incomeReconcileSummary"/);
 assert.match(page,/historyDrawer'\)\.addEventListener\('toggle'/);
 const scripts=page.match(/<script>([\s\S]*?)<\/script>/g)||[];
 assert.ok(scripts.length);
 for(const script of scripts)assert.doesNotThrow(()=>new Function(script.replace(/^<script>/,'').replace(/<\/script>$/,'')));
});

test('Dual chart frame embeds same-origin only with compact UI and read-only API',()=>{
 const server=read('server.mjs'),chart=read('OCC_COMPARE.html');
 assert.match(server,/req\.url==='\/occ-compare\?embed=1'/);
 assert.match(server,/frame-ancestors 'self'/);
 assert.match(chart,/URLSearchParams\(location\.search\)\.get\('embed'\)==='1'/);
 assert.match(chart,/html\.embed main\{max-width:none;padding:2px 3px\}/);
 assert.match(chart,/html\.embed canvas\{height:286px\}/);
 assert.match(chart,/html\.embed header,html\.embed main>\.note,html\.embed main>\.foot,html\.embed #tv/);
 assert.match(chart,/id="reference"/);
 assert.match(chart,/id="execution"/);
 assert.match(chart,/id="rows"/);
 assert.match(chart,/\/api\/binance\/occ-chart-compare/);
 assert.doesNotMatch(chart,/request\('connect'|\/control\/live\/on|\/control\/live\/manual-exit/);
 const blocks=chart.match(/<script(?:[^>]*)>([\s\S]*?)<\/script>/g)||[];
 for(const block of blocks){
  const js=block.slice(block.indexOf('>')+1,block.lastIndexOf('</script>'));
  assert.doesNotThrow(()=>new Function(js));
 }
});

test('Trading core and native credential storage unchanged by unified dashboard',()=>{
 const build=read('BUILD_PORTABLE.ps1'),server=read('server.mjs');
 assert.match(build,/'BINANCE_UI_PREVIEW\.html'/);
 assert.match(build,/'OCC_COMPARE\.html'/);
 assert.match(server,/readVerifiedChartFills/);
 assert.match(server,/browserFutures\.signal\(signal,true,/);
 assert.match(server,/req\.url==='\/binance'/);
});
