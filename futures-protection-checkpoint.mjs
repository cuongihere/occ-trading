// Durable local checkpoint for confirmed BTCUSDT conditional orders.
// On restart, unresolved/protected positions require reconciliation, not blind re-submission.
import {openSync,writeFileSync,fsyncSync,closeSync,renameSync,existsSync,readFileSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
export class ProtectionCheckpoint {
 constructor(path){this.path=path;}
 load(){
  if(!existsSync(this.path))return null;
  const record=JSON.parse(readFileSync(this.path,'utf8'));
  if(!record||!['IDLE','ENTRY_VERIFIED','SL_SENDING','STOP_ACTIVE','TP_SENDING','TP_ACTIVE','PROTECTED','HALTED'].includes(record.phase))
   throw Error('Invalid live checkpoint; manual Binance review required');
  return record;
 }
 save(state){
  if(!state||typeof state.phase!=='string')throw Error('Invalid checkpoint state');
  mkdirSync(dirname(this.path),{recursive:true});
  const tmp=this.path+'.pending';
  const fd=openSync(tmp,'w',0o600);
  try{writeFileSync(fd,JSON.stringify(state,null,2));fsyncSync(fd);}
  finally{closeSync(fd);}
  renameSync(tmp,this.path);
 }
 requiresReconcile(){
  const state=this.load();
  return Boolean(state&&state.phase!=='IDLE');
 }
}
