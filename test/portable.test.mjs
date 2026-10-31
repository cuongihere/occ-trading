import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('portable launcher bootstraps local verified runtime',()=>{
 const bat=read('START_WINDOWS.bat'),script=read('BOOTSTRAP_RUNTIME.ps1');
 assert.match(bat,/BOOTSTRAP_RUNTIME\.ps1/i);
 assert.match(bat,/runtime\\node\.exe/i);
 assert.doesNotMatch(bat,/npm install|winget|choco install/i);
 assert.match(script,/nodejs\.org\/dist\//i);
 assert.match(script,/Get-FileHash/i);
 assert.match(script,/ZIP SHA256 mismatch/i);
 assert.match(script,/node\.exe SHA256 mismatch/i);
 assert.match(script,/Join-Path \$app 'runtime'/i);
});
test('runtime hashes match source documentation',()=>{
 const ps=read('BOOTSTRAP_RUNTIME.ps1'),doc=read('RUNTIME_SOURCE.txt');
 for(const hash of ['ca1bff5d8ead13c9f2ea404a176db46bd430704d5b5113734049fa365e7799e2','1c331340fa6cac5e4294725959070a143fa0507195a78ad77eed7943f719aac9']){
  assert.ok(ps.includes(hash));assert.ok(doc.includes(hash));
 }
});
test('server serves standalone dashboard with readiness state',()=>{
 const server=read('server.mjs'),dashboard=read('dashboard.html');
 assert.match(server,/readFileSync\(new URL\('\.\/dashboard\.html'/);
 assert.match(server,/ready:s\.ready/);
 for(const id of ['state','start','pause','connect','price','equity','position','pnl','session','curve','closed','winrate','trades','positionsCsv','fillsCsv','signalsJson','reset'])
  assert.ok(dashboard.includes('id="'+id+'"'),'missing dashboard control: '+id);
 assert.match(dashboard,/getJSON\('\/api\/state'\)/);
 assert.match(dashboard,/getJSON\('\/api\/report\?session='/);
});
test('Windows workflow tests and bundles all required runtime files',()=>{
 const build=read('BUILD_PORTABLE.ps1'),workflow=read('.github/workflows/windows-portable.yml');
 for(const file of ['server.mjs','server-feed.mjs','engine.mjs','stats.mjs','store.mjs','dashboard.html','START_WINDOWS.bat','BOOTSTRAP_RUNTIME.ps1'])
  assert.ok(build.includes("'"+file+"'"),'missing build asset: '+file);
 assert.match(workflow,/node --test/);
 assert.match(workflow,/BUILD_PORTABLE\.ps1/);
 assert.match(workflow,/actions\/upload-artifact@v4/);
});
