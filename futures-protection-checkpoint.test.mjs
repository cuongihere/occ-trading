import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ProtectionCheckpoint} from './futures-protection-checkpoint.mjs';
test('durable checkpoint can restore STOP and TP ids without auto-retry',t=>{
 const dir=mkdtempSync(join(tmpdir(),'occ-protect-'));
 t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const file=join(dir,'live','protection.json');
 let cp=new ProtectionCheckpoint(file);
 assert.equal(cp.requiresReconcile(),false);
 const state={phase:'PROTECTED',entry:{orderId:'1'},stop:{id:'11'},tps:[{id:'12'}],inFlight:null};
 cp.save(state);cp=new ProtectionCheckpoint(file);
 assert.deepEqual(cp.load(),state);
 assert.equal(cp.requiresReconcile(),true);
});
