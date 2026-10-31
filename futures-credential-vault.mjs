// Persist Binance API credentials using Windows DPAPI (CurrentUser).
// No plaintext credentials are written to disk or passed on the process command line.
import {spawnSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,renameSync,unlinkSync,mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
const PS_SCRIPT=[
 "$ErrorActionPreference='Stop'",
 "$raw=[Console]::In.ReadToEnd()",
 "$bytes=[Convert]::FromBase64String($raw.Trim())",
 "$entropy=[Text.Encoding]::UTF8.GetBytes('OCC-BTCUSDT-FUTURES-API-v1')",
 "if($env:OCC_DPAPI_MODE -eq 'protect'){",
 " $data=[Security.Cryptography.ProtectedData]::Protect($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)",
 "}elseif($env:OCC_DPAPI_MODE -eq 'unprotect'){",
 " $data=[Security.Cryptography.ProtectedData]::Unprotect($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)",
 "}else{throw 'Invalid DPAPI operation'}",
 "[Console]::Out.Write([Convert]::ToBase64String($data))"
].join('\n');
function windowsDpapi(bytes,mode){
 if(process.platform!=='win32')throw Error('Lưu API yêu cầu Windows DPAPI. Không lưu plaintext.');
 const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',PS_SCRIPT],{
  input:Buffer.from(bytes).toString('base64'),encoding:'utf8',windowsHide:true,
  env:{...process.env,OCC_DPAPI_MODE:mode},timeout:12000,maxBuffer:1024*1024
 });
 if(result.error||result.status!==0||!result.stdout?.trim())
  throw Error('Windows DPAPI không thể '+(mode==='protect'?'mã hóa':'giải mã')+' API trên tài khoản Windows này');
 return Buffer.from(result.stdout.trim(),'base64');
}
export class WindowsCredentialVault{
 constructor(path,{crypt=windowsDpapi}={}){this.path=path;this.crypt=crypt;}
 exists(){return existsSync(this.path);}
 save({apiKey,apiSecret}){
  if(typeof apiKey!=='string'||typeof apiSecret!=='string'||apiKey.length<8||apiSecret.length<8)
   throw Error('API credentials không hợp lệ');
  const plaintext=Buffer.from(JSON.stringify({apiKey,apiSecret}),'utf8');
  let encrypted;
  try{encrypted=this.crypt(plaintext,'protect');}
  finally{plaintext.fill(0);}
  if(!Buffer.isBuffer(encrypted)||encrypted.length<24)throw Error('Windows API encryption unavailable');
  mkdirSync(dirname(this.path),{recursive:true,mode:0o700});
  const tmp=this.path+'.pending';
  try{
   writeFileSync(tmp,JSON.stringify({version:1,method:'DPAPI-CurrentUser',data:encrypted.toString('base64')}),{mode:0o600});
   renameSync(tmp,this.path);
  }finally{if(existsSync(tmp))unlinkSync(tmp);encrypted.fill(0);}
 }
 load(){
  if(!this.exists())return null;
  const saved=JSON.parse(readFileSync(this.path,'utf8'));
  if(saved?.version!==1||saved?.method!=='DPAPI-CurrentUser'||typeof saved.data!=='string')
   throw Error('Dữ liệu API mã hóa không hợp lệ');
  const plain=this.crypt(Buffer.from(saved.data,'base64'),'unprotect');
  try{
   const x=JSON.parse(plain.toString('utf8'));
   if(typeof x?.apiKey!=='string'||typeof x?.apiSecret!=='string')throw Error('Invalid secret');
   return x;
  }finally{plain.fill(0);}
 }
 delete(){if(this.exists())unlinkSync(this.path);}
}
