import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Store} from './store.mjs';
function setup(t){const dir=mkdtempSync(join(tmpdir(),'occ-store-test-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return join(dir,'journal.sqlite');}
const event=(n=1)=>({type:'test-only-fixture',exchangeAt:n,receivedAt:n+1,payload:{n}});
const state=()=>({version:1,balance:10000,signals:[{id:'session:sig:1',side:'LONG',time:1}],trades:[{id:'session:sig:1:OPEN',qty:.01,price:50000}]});
test('event, rows and checkpoint commit atomically and survive restart',t=>{const path=setup(t),s=new Store(path);assert.equal(s.load(),null);assert.equal(s.commit(event(),state()),1);assert.equal(s.snapshotRecords().checkpointSeq,1);s.close();const r=new Store(path);assert.deepEqual(r.load(),state());assert.deepEqual(r.allEvents(),[{seq:1,...event()}]);assert.equal(r.snapshotRecords().fills.length,1);r.close();});
test('stable IDs deduplicate without altering first records',t=>{const s=new Store(setup(t));s.commit(event(),state());s.commit(event(2),{...state(),balance:9999});assert.equal(s.allEvents().length,2);assert.equal(s.snapshotRecords().signals.length,1);assert.equal(s.snapshotRecords().fills.length,1);assert.equal(s.snapshotRecords().checkpointSeq,2);s.close();});
test('ID conflict rolls back newly inserted event and rows and checkpoint',t=>{const s=new Store(setup(t));s.commit(event(),state());const conflicting=state();conflicting.signals.unshift({id:'new-row',side:'SHORT'});conflicting.trades[0].price=1;assert.throws(()=>s.commit(event(2),conflicting),/Immutable fills/);assert.deepEqual(s.load(),state());assert.equal(s.allEvents().length,1);assert.equal(s.snapshotRecords().signals.length,1);assert.equal(s.snapshotRecords().checkpointSeq,1);assert.equal(s.commit(event(3),state()),2);s.close();});
test('append-only database triggers reject update/delete; WAL FULL configured',t=>{const path=setup(t),s=new Store(path);s.commit(event(),state());const db=new DatabaseSync(path);assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode,'wal');assert.equal(db.prepare('PRAGMA synchronous').get().synchronous,2);for(const table of ['events','signals','fills'])assert.throws(()=>db.exec(`DELETE FROM ${table}`),/append-only/);assert.throws(()=>db.exec("UPDATE signals SET record_json='{}'"),/append-only/);db.close();s.close();});
test('invalid values rejected without journal/checkpoint progress',t=>{const s=new Store(setup(t));assert.throws(()=>s.commit({...event(),receivedAt:NaN},state()),/receivedAt/);assert.throws(()=>s.commit(event(),{...state(),balance:Infinity}),/Non-finite/);assert.equal(s.allEvents().length,0);assert.equal(s.load(),null);s.close();});
