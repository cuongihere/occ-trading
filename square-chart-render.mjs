import {deflateSync} from 'node:zlib';
// Public Binance candles + verified trade levels. No strategy, balances or secrets.
const W=1200,H=675;
const P={bg:[8,19,32],panel:[13,30,47],grid:[33,56,78],white:[232,244,253],
 muted:[137,164,188],green:[23,202,143],red:[244,93,108],blue:[72,176,239]};
const FONT={
 A:['01110','10001','10001','11111','10001','10001','10001'],
 B:['11110','10001','10001','11110','10001','10001','11110'],
 C:['01111','10000','10000','10000','10000','10000','01111'],
 D:['11110','10001','10001','10001','10001','10001','11110'],
 E:['11111','10000','10000','11110','10000','10000','11111'],
 F:['11111','10000','10000','11110','10000','10000','10000'],
 G:['01111','10000','10000','10111','10001','10001','01110'],
 H:['10001','10001','10001','11111','10001','10001','10001'],
 I:['11111','00100','00100','00100','00100','00100','11111'],
 J:['00111','00010','00010','00010','10010','10010','01100'],
 K:['10001','10010','10100','11000','10100','10010','10001'],
 L:['10000','10000','10000','10000','10000','10000','11111'],
 M:['10001','11011','10101','10101','10001','10001','10001'],
 N:['10001','11001','10101','10011','10001','10001','10001'],
 O:['01110','10001','10001','10001','10001','10001','01110'],
 P:['11110','10001','10001','11110','10000','10000','10000'],
 R:['11110','10001','10001','11110','10100','10010','10001'],
 S:['01111','10000','10000','01110','00001','00001','11110'],
 T:['11111','00100','00100','00100','00100','00100','00100'],
 U:['10001','10001','10001','10001','10001','10001','01110'],
 V:['10001','10001','10001','10001','10001','01010','00100'],
 X:['10001','10001','01010','00100','01010','10001','10001'],
 Y:['10001','10001','01010','00100','00100','00100','00100'],
 '0':['01110','10011','10101','10101','11001','10001','01110'],
 '1':['00100','01100','00100','00100','00100','00100','01110'],
 '2':['01110','10001','00001','00010','00100','01000','11111'],
 '3':['11110','00001','00001','01110','00001','00001','11110'],
 '4':['00010','00110','01010','10010','11111','00010','00010'],
 '5':['11111','10000','10000','11110','00001','00001','11110'],
 '6':['01111','10000','10000','11110','10001','10001','01110'],
 '7':['11111','00001','00010','00100','01000','01000','01000'],
 '8':['01110','10001','10001','01110','10001','10001','01110'],
 '9':['01110','10001','10001','01111','00001','00001','11110'],
 '.':['00000','00000','00000','00000','00000','00110','00110'],
 ':':['00000','00110','00110','00000','00110','00110','00000'],
 '-':['00000','00000','00000','11111','00000','00000','00000'],
 '/':['00001','00001','00010','00100','01000','10000','10000'],
 ' ':['00000','00000','00000','00000','00000','00000','00000']
};
function set(p,x,y,c){if(x<0||y<0||x>=W||y>=H)return;const i=(Math.floor(y)*W+Math.floor(x))*4;p[i]=c[0];p[i+1]=c[1];p[i+2]=c[2];p[i+3]=255;}
function rect(p,x,y,w,h,c){for(let b=Math.max(0,Math.floor(y));b<Math.min(H,Math.ceil(y+h));b++)for(let a=Math.max(0,Math.floor(x));a<Math.min(W,Math.ceil(x+w));a++)set(p,a,b,c);}
function line(p,x1,y1,x2,y2,c,n=1){const count=Math.max(Math.abs(y2-y1),Math.abs(x2-x1),1);for(let i=0;i<=count;i++){const x=x1+(x2-x1)*i/count,y=y1+(y2-y1)*i/count;rect(p,x-n/2,y-n/2,n,n,c);}}
function text(p,s,x,y,k,c){let px=x;for(const ch of String(s).toUpperCase()){const g=FONT[ch]||FONT[' '];for(let j=0;j<7;j++)for(let i=0;i<5;i++)if(g[j][i]==='1')rect(p,px+i*k,y+j*k,k,k,c);px+=6*k;}}
function crc(data){let c=-1;for(const n of data){c^=n;for(let k=0;k<8;k++)c=(c>>>1)^(0xedb88320&-(c&1));}return (c^-1)>>>0;}
function chunk(t,b){const name=Buffer.from(t),n=Buffer.alloc(4),sum=Buffer.alloc(4);n.writeUInt32BE(b.length);sum.writeUInt32BE(crc(Buffer.concat([name,b])));return Buffer.concat([n,name,b,sum]);}
function png(p){const raw=Buffer.alloc((W*4+1)*H);for(let j=0;j<H;j++){const a=j*(W*4+1);raw[a]=0;p.copy(raw,a+1,j*W*4,(j+1)*W*4);}const ih=Buffer.alloc(13);ih.writeUInt32BE(W,0);ih.writeUInt32BE(H,4);ih[8]=8;ih[9]=6;return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}
const ok=x=>Number.isFinite(Number(x))&&Number(x)>0,price=x=>Number(x).toFixed(1);
export function renderSquareTradeChart({klines,side,entry,sl,tps,filledAt=Date.now()}){
 if(!Array.isArray(klines)||klines.length<24||!['LONG','SHORT'].includes(side)||
  !ok(entry)||!ok(sl)||!Array.isArray(tps)||tps.length!==3||!tps.every(ok))throw Error('Invalid verified Binance trade/chart');
 if(side==='LONG'&&!(sl<entry&&tps.every(x=>x>entry))||
    side==='SHORT'&&!(sl>entry&&tps.every(x=>x<entry)))throw Error('Invalid directional SL/TP');
 const rows=klines.slice(-96).map(k=>Array.isArray(k)?{at:Number(k[0]),o:+k[1],h:+k[2],l:+k[3],c:+k[4]}:
 {at:k.at,o:k.o,h:k.h,l:k.l,c:k.c}).filter(x=>Number.isSafeInteger(x.at)&&
  [x.o,x.h,x.l,x.c].every(ok)&&x.l<=Math.min(x.o,x.c)&&x.h>=Math.max(x.o,x.c));
 if(rows.length<24)throw Error('Not enough verified Binance candles');
 const p=Buffer.alloc(W*H*4);rect(p,0,0,W,H,P.bg);rect(p,20,15,W-40,H-30,P.panel);
 text(p,'BTCUSDT PERPETUAL',40,33,4,P.white);
 text(p,side,920,33,4,side==='LONG'?P.green:P.red);
 const low=Math.min(...rows.map(x=>x.l),entry,sl,...tps),high=Math.max(...rows.map(x=>x.h),entry,sl,...tps);
 const pad=(high-low)*.1||100,lo=low-pad,hi=high+pad,L=46,R=1016,T=129,B=595;
 const y=v=>Math.round(B-(v-lo)/(hi-lo)*(B-T));
 rect(p,L,T,R-L,B-T,[8,23,37]);
 for(let k=0;k<=5;k++){const v=lo+(hi-lo)*k/5,cy=y(v);line(p,L,cy,R,cy,P.grid);text(p,price(v),1035,cy-8,2,P.muted);}
 const x=i=>Math.round(L+8+i*(R-L-15)/(rows.length-1));
 for(let i=0;i<rows.length;i++){const r=rows[i],q=x(i),c=r.c>=r.o?P.green:P.red;
  line(p,q,y(r.h),q,y(r.l),c,1);rect(p,q-3,y(Math.max(r.o,r.c)),6,Math.max(2,y(Math.min(r.o,r.c))-y(Math.max(r.o,r.c))),c);}
 for(const [label,v,c] of [['ENTRY',entry,P.blue],['SL',sl,P.red],...tps.map((v,i)=>['TP'+(i+1),v,P.green])]){
  const cy=y(Number(v));line(p,600,cy,R,cy,c,2);rect(p,1027,cy-12,157,25,P.panel);text(p,label+' '+price(v),1032,cy-7,2,c);}
 const d=new Date(filledAt);if(!Number.isNaN(d.getTime())){const date=[d.getUTCFullYear(),String(d.getUTCMonth()+1).padStart(2,'0'),String(d.getUTCDate()).padStart(2,'0')].join('-');text(p,date,48,630,2,P.muted);}
 return png(p);
}
