import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WindowsCredentialVault} from './futures-credential-vault.mjs';
test('Windows DPAPI encrypts Binance API before disk, restores on same Windows user',()=>{
 if(process.platform!=='win32')return;
 const dir=mkdtempSync(join(tmpdir(),'occ-dpapi-'));
 try{
  const p=join(dir,'futures-api.dpapi.json');
  const vault=new WindowsCredentialVault(p);
  const key='test-API-KEY-ONLY-FIXTURE',secret='test-SECRET-ONLY-FIXTURE';
  vault.save({apiKey:key,apiSecret:secret});
  const raw=readFileSync(p,'utf8');
  assert.doesNotMatch(raw,/test-API-KEY-ONLY-FIXTURE|test-SECRET-ONLY-FIXTURE/);
  assert.equal(JSON.parse(raw).method,'DPAPI-CurrentUser');
  assert.deepEqual(new WindowsCredentialVault(p).load(),{apiKey:key,apiSecret:secret});
  vault.delete();assert.equal(existsSync(p),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
