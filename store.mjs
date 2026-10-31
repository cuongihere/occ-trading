import { DatabaseSync } from 'node:sqlite';

// JSON is canonical for immutable-ID comparison, not a signature or a tamper-proof claim.
function json(value) {
  const seen=new Set();
  function normalize(v) {
    if(typeof v==='number'&&!Number.isFinite(v))throw Error('Non-finite journal value');
    if(v===null||typeof v!=='object')return v;
    if(seen.has(v))throw Error('Circular journal value');
    seen.add(v);
    const out=Array.isArray(v)?v.map(normalize):Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,normalize(v[k])]));
    seen.delete(v);return out;
  }
  const text=JSON.stringify(normalize(value));
  if(text===undefined)throw Error('Missing JSON value');
  return text;
}
function timestamp(value,name,nullable=false) {
  if(nullable&&value==null)return null;
  if(!Number.isSafeInteger(value)||value<0)throw Error(`Invalid ${name}`);
  return value;
}
/** A single daemon must hold its process lock before opening this writer.
 * Every input event, immutable signal/fill rows and engine checkpoint share a
 * single SQLite transaction. Callers must halt on commit failure and reload;
 * an in-memory engine mutated before a failed commit must never keep trading.
 */
export class Store {
  #db; #closed=false;
  constructor(path) {
    this.#db=new DatabaseSync(path,{timeout:5000});
    this.#db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL, exchange_at INTEGER, received_at INTEGER NOT NULL,
        payload_json TEXT NOT NULL CHECK(json_valid(payload_json))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS signals (
        id TEXT PRIMARY KEY, first_event_seq INTEGER NOT NULL REFERENCES events(seq),
        record_json TEXT NOT NULL CHECK(json_valid(record_json))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS fills (
        id TEXT PRIMARY KEY, first_event_seq INTEGER NOT NULL REFERENCES events(seq),
        record_json TEXT NOT NULL CHECK(json_valid(record_json))
      ) STRICT;
      CREATE TABLE IF NOT EXISTS checkpoint (
        singleton INTEGER PRIMARY KEY CHECK(singleton=1),
        event_seq INTEGER NOT NULL REFERENCES events(seq),
        state_json TEXT NOT NULL CHECK(json_valid(state_json))
      ) STRICT;
      CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'Journal is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'Journal is append-only'); END;
      CREATE TRIGGER IF NOT EXISTS signals_no_update BEFORE UPDATE ON signals BEGIN SELECT RAISE(ABORT,'Signals are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS signals_no_delete BEFORE DELETE ON signals BEGIN SELECT RAISE(ABORT,'Signals are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS fills_no_update BEFORE UPDATE ON fills BEGIN SELECT RAISE(ABORT,'Fills are append-only'); END;
      CREATE TRIGGER IF NOT EXISTS fills_no_delete BEFORE DELETE ON fills BEGIN SELECT RAISE(ABORT,'Fills are append-only'); END;
      PRAGMA user_version=1;`);
  }
  load() {const row=this.#db.prepare('SELECT state_json FROM checkpoint WHERE singleton=1').get();return row?JSON.parse(row.state_json):null;}
  commit(event,engineState) {
    if(!event||typeof event.type!=='string'||!event.type.trim())throw Error('Missing event type');
    const exchangeAt=timestamp(event.exchangeAt,'exchangeAt',true),receivedAt=timestamp(event.receivedAt,'receivedAt');
    const payload=json(event.payload), state=json(engineState);
    if(!engineState||typeof engineState!=='object'||!Array.isArray(engineState.signals)||!Array.isArray(engineState.trades))throw Error('Checkpoint must contain signals and trades arrays');
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      const result=this.#db.prepare('INSERT INTO events(type,exchange_at,received_at,payload_json) VALUES(?,?,?,?)').run(event.type,exchangeAt,receivedAt,payload);
      const seq=Number(result.lastInsertRowid);
      for(const [table,records] of [['signals',engineState.signals],['fills',engineState.trades]]){
        const find=this.#db.prepare(`SELECT record_json FROM ${table} WHERE id=?`);
        const insert=this.#db.prepare(`INSERT INTO ${table}(id,first_event_seq,record_json) VALUES(?,?,?)`);
        for(const record of records){
          if(typeof record.id!=='string'||!record.id)throw Error(`Missing ${table} stable ID`);
          const text=json(record),existing=find.get(record.id);
          if(existing){if(existing.record_json!==text)throw Error(`Immutable ${table} ID collision: ${record.id}`);}
          else insert.run(record.id,seq,text);
        }
      }
      this.#db.prepare('INSERT INTO checkpoint(singleton,event_seq,state_json) VALUES(1,?,?) ON CONFLICT(singleton) DO UPDATE SET event_seq=excluded.event_seq,state_json=excluded.state_json').run(seq,state);
      this.#db.exec('COMMIT');return seq;
    } catch(error) {this.#db.exec('ROLLBACK');throw error;}
  }
  lastEvent() {
    const r=this.#db.prepare('SELECT seq,type,received_at FROM events ORDER BY seq DESC LIMIT 1').get();
    return r?{seq:r.seq,type:r.type,time:r.received_at}:null;
  }
  activity(limit=80) {
    const rows=this.#db.prepare("SELECT type,received_at,payload_json FROM events WHERE type IN ('offline_interval','process_start','process_stop','user_start','user_pause','status','user_configure') ORDER BY seq").all();
    const output=[];let pause=null;
    for(const row of rows){
      const p=JSON.parse(row.payload_json);
      if(row.type==='offline_interval'){
        const {from,to,reason,approximate}=p;
        if(Number.isSafeInteger(from)&&Number.isSafeInteger(to)&&to>=from)
          output.push({kind:'app_offline',from,to,reason:reason||'Ứng dụng đã tắt',approximate:!!approximate});
      }
      const a=p.activity;if(!a||typeof a.running!=='boolean')continue;
      if(!a.running&&!pause)pause={kind:'trading_paused',from:row.received_at,to:null,reason:a.reason||'Không giao dịch'};
      if(a.running&&pause){output.push({...pause,to:row.received_at});pause=null;}
    }
    if(pause)output.push(pause);
    return output.sort((x,y)=>y.from-x.from).slice(0,Math.max(1,Math.min(500,limit)));
  }
  sessions() {
    const found=new Map();
    for(const r of this.#db.prepare("SELECT received_at,payload_json FROM events WHERE type IN ('process_start','user_reset') ORDER BY seq").all()){
      const state=JSON.parse(r.payload_json).initialState;
      if(state?.sessionId&&!found.has(state.sessionId))found.set(state.sessionId,{id:state.sessionId,startedAt:r.received_at,config:state.config});
    }
    return [...found.values()];
  }
  allEvents() {return this.#db.prepare('SELECT * FROM events ORDER BY seq').all().map(r=>({seq:r.seq,type:r.type,exchangeAt:r.exchange_at,receivedAt:r.received_at,payload:JSON.parse(r.payload_json)}));}
  snapshotRecords() {
    const rows=table=>this.#db.prepare(`SELECT record_json FROM ${table} ORDER BY first_event_seq,id`).all().map(r=>JSON.parse(r.record_json));
    const checkpoint=this.#db.prepare('SELECT event_seq FROM checkpoint WHERE singleton=1').get();
    return {signals:rows('signals'),fills:rows('fills'),checkpointSeq:checkpoint?.event_seq??null};
  }
  close(){if(!this.#closed){this.#db.close();this.#closed=true;}}
}
