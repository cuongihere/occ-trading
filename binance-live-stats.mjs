import {DatabaseSync} from 'node:sqlite';
import {existsSync} from 'node:fs';
// Only Binance-verified BTCUSDT fills of explicitly registered OCC bot orders count.
// No heuristic attribution, paper fills, manual positions or estimated costs.
const number=(v,k)=>{const x=Number(v);if(!Number.isFinite(x))throw Error('Invalid '+k);return x;};
const EPS=1e-8;
const schema=[
"PRAGMA journal_mode=WAL","PRAGMA foreign_keys=ON",
"CREATE TABLE IF NOT EXISTS orders (order_id TEXT PRIMARY KEY,group_id TEXT NOT NULL,client_id TEXT NOT NULL,role TEXT NOT NULL,side TEXT NOT NULL,synced_at INTEGER NOT NULL DEFAULT 0)",
"CREATE TABLE IF NOT EXISTS fills (fill_id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES orders(order_id),side TEXT NOT NULL,qty REAL NOT NULL,price REAL NOT NULL,realized REAL NOT NULL,fee REAL NOT NULL,asset TEXT NOT NULL,filled_at INTEGER NOT NULL)",
"CREATE TABLE IF NOT EXISTS income_events (income_type TEXT NOT NULL,tran_id TEXT NOT NULL,trade_id TEXT,asset TEXT NOT NULL,amount REAL NOT NULL,occurred_at INTEGER NOT NULL,PRIMARY KEY(income_type,tran_id))"
].join(';')+';';
export const emptyLiveReport=()=>({source:'BINANCE_VERIFIED_OCC_ONLY',asOf:null,registeredOrders:0,
 summary:{closed:0,open:0,wins:0,losses:0,breakeven:0,winRate:null,grossRealizedUSDT:0,
 usdtFees:0,netExFundingUSDT:0,incomplete:0,nonUSDTFeeFills:0,
  binanceAuditedNetUSDT:0,binanceAuditedClosed:0,binanceUnverifiedClosed:0},
 positions:[],openPositions:[],curve:[],incomeAudit:null,
 warnings:['Chỉ tính lệnh BTCUSDT đã được bot đăng ký ID và đối chiếu với Binance.',
 'P&L sau phí USDT chưa bao gồm funding và các phí không tính bằng USDT.',
 'Hiện chưa có bộ thực thi lệnh thật; khi chỉ chạy Paper/Preview sẽ không có giao dịch thực.']});
export class LiveStatsLedger{
 #db;
 constructor(path){
  this.#db=new DatabaseSync(path);this.#db.exec(schema);
  // Upgrade any ledger file created by an older OCC release without losing fills.
  if(!this.#db.prepare('PRAGMA table_info(orders)').all().some(x=>x.name==='synced_at'))
   this.#db.exec('ALTER TABLE orders ADD COLUMN synced_at INTEGER NOT NULL DEFAULT 0');
 }
 register({orderId,groupId,clientId,role,side}){
  if(!/^[0-9]{1,24}$/.test(String(orderId))||!/^OCCBTC-[A-Za-z0-9_-]{1,29}$/.test(clientId||'')||
     !/^[A-Za-z0-9_-]{1,55}$/.test(groupId||'')||
     !['ENTRY','TP1','TP2','TP3','SL','CLOSE','REVERSE'].includes(role)||
     !['BUY','SELL'].includes(side))throw Error('Invalid OCCBTC order registration');
  const item=[String(orderId),groupId,clientId,role,side];
  const existing=this.#db.prepare('SELECT * FROM orders WHERE order_id=?').get(item[0]);
  if(existing){if(['order_id','group_id','client_id','role','side'].some((k,i)=>existing[k]!==item[i]))throw Error('Conflicting order registration');return false;}
  this.#db.prepare('INSERT INTO orders(order_id,group_id,client_id,role,side) VALUES (?,?,?,?,?)').run(...item);return true;
 }
 orders(){return this.#db.prepare('SELECT * FROM orders ORDER BY rowid').all();}
 dueOrders(limit=24){return this.#db.prepare(
  'SELECT * FROM orders ORDER BY synced_at ASC,rowid DESC LIMIT ?'
 ).all(limit);}
 markChecked(orderId,at=Date.now()){
  this.#db.prepare('UPDATE orders SET synced_at=? WHERE order_id=?').run(at,String(orderId));
 }
 ingestIncome(rows){
  if(!Array.isArray(rows))throw Error('Invalid Binance income history');
  const add=this.#db.prepare('INSERT INTO income_events VALUES (?,?,?,?,?,?)');
  const old=this.#db.prepare('SELECT * FROM income_events WHERE income_type=? AND tran_id=?');
  let added=0;
  this.#db.exec('BEGIN IMMEDIATE');
  try{
   for(const x of rows){
    if(x.symbol!=='BTCUSDT'||!['REALIZED_PNL','COMMISSION','FUNDING_FEE'].includes(x.incomeType))
     continue;
    const amount=Number(x.income),at=Number(x.time),type=String(x.incomeType),
      tran=String(x.tranId),trade=x.tradeId==null?'':String(x.tradeId),
      asset=String(x.asset||'');
    if(!/^[0-9]{1,24}$/.test(tran)||!Number.isFinite(amount)||
       !Number.isSafeInteger(at)||at<0||!/^[A-Z0-9]{2,12}$/.test(asset)||
       (trade!==''&&!/^[0-9]{1,24}$/.test(trade)))
     throw Error('Invalid Binance income event');
    const row=[type,tran,trade,asset,amount,at];
    const prior=old.get(type,tran);
    if(prior){
     if(['income_type','tran_id','trade_id','asset','amount','occurred_at']
       .some((k,i)=>prior[k]!==row[i]))throw Error('Conflicting Binance income transaction');
     continue;
    }
    add.run(...row);added++;
   }
   this.#db.exec('COMMIT');return added;
  }catch(e){this.#db.exec('ROLLBACK');throw e;}
 }
 incomeEvents(){return this.#db.prepare('SELECT * FROM income_events ORDER BY occurred_at,tran_id').all();}
 ingest(rows){
  if(!Array.isArray(rows))throw Error('Expected Binance userTrades array');
  const valid=new Map(this.orders().map(o=>[o.order_id,o]));
  let added=0;
  this.#db.exec('BEGIN IMMEDIATE');
  try{
   const add=this.#db.prepare('INSERT INTO fills VALUES (?,?,?,?,?,?,?,?,?)');
   const find=this.#db.prepare('SELECT * FROM fills WHERE fill_id=?');
   for(const t of rows){
    if(t.symbol!=='BTCUSDT'||!valid.has(String(t.orderId)))continue;
    if(!/^[0-9]{1,24}$/.test(String(t.id))||t.side!==valid.get(String(t.orderId)).side)throw Error('Bad Binance trade identity');
    const qty=number(t.qty,'qty'),price=number(t.price,'price'),realized=number(t.realizedPnl,'realizedPnl'),
     fee=number(t.commission,'commission'),at=number(t.time,'time');
    if(qty<=0||price<=0||fee<0||!Number.isSafeInteger(at)||at<0||!/^[A-Z0-9]{2,12}$/.test(t.commissionAsset||''))
     throw Error('Malformed Binance fill');
    const row=[String(t.id),String(t.orderId),t.side,qty,price,realized,fee,t.commissionAsset,at];
    const old=find.get(row[0]);
    if(old){if(Object.values(old).some((v,i)=>v!==row[i]))throw Error('Conflicting Binance fill ID');continue;}
    add.run(...row);added++;
   }
   this.#db.exec('COMMIT');return added;
  }catch(e){this.#db.exec('ROLLBACK');throw e;}
 }
 report(){return computeLiveReport(this.orders(),
  this.#db.prepare('SELECT * FROM fills ORDER BY filled_at,CAST(fill_id AS INTEGER)').all(),
  this.incomeEvents());}
 close(){this.#db.close();}
}
export function computeLiveReport(orders,fills,incomes=[],now=Date.now()){
 const r=emptyLiveReport(),known=new Map(),groups=new Map();
 for(const order of orders){
  known.set(order.order_id,order);
  if(!groups.has(order.group_id))groups.set(order.group_id,[]);
 }
 for(const f of fills){
  const order=known.get(f.order_id);
  if(order)groups.get(order.group_id).push({...f,role:order.role,group_id:order.group_id});
 }
 r.registeredOrders=orders.length;
 for(const [id,list] of groups){
  if(!list.length)continue;
  const entryOrder=orders.find(o=>o.group_id===id&&o.role==='ENTRY');
  if(!entryOrder)continue;
  const entry=list.filter(f=>f.role==='ENTRY'),exits=list.filter(f=>f.role!=='ENTRY');
  if(!entry.length)continue;
  const qty=entry.reduce((s,x)=>s+x.qty,0),closedQty=exits.reduce((s,x)=>s+x.qty,0);
  if(closedQty>qty+EPS)continue; // impossible/ambiguous, not counted as a win
  const avg=items=>items.length?items.reduce((s,x)=>s+x.price*x.qty,0)/items.reduce((s,x)=>s+x.qty,0):null;
  const real=list.reduce((s,x)=>s+x.realized,0);
  const fees=list.filter(x=>x.asset==='USDT').reduce((s,x)=>s+x.fee,0);
  const other=list.filter(x=>x.asset!=='USDT').length,net=other?null:real-fees;
  const complete=Math.abs(qty-closedQty)<=Math.max(EPS,qty*1e-8);
  const item={id,side:entryOrder.side==='BUY'?'LONG':'SHORT',qty,closedQty,remaining:Math.max(0,qty-closedQty),
   entryPrice:avg(entry),exitPrice:avg(exits),entryAt:Math.min(...entry.map(x=>x.filled_at)),
   exitAt:complete?Math.max(...exits.map(x=>x.filled_at)):null,
   grossRealizedUSDT:real,usdtFees:fees,netExFundingUSDT:net,nonUSDTFeeFills:other,
   exitReasons:[...new Set(exits.map(x=>x.role))],fills:list.length,
   result:complete?(net===null?'UNVERIFIED':net>EPS?'WIN':net< -EPS?'LOSS':'BREAKEVEN'):'OPEN'};
  (complete?r.positions:r.openPositions).push(item);
 }
 r.positions.sort((a,b)=>a.exitAt-b.exitAt);
 const s=r.summary;s.closed=r.positions.length;s.open=r.openPositions.length;
 s.wins=r.positions.filter(x=>x.result==='WIN').length;s.losses=r.positions.filter(x=>x.result==='LOSS').length;
 s.breakeven=r.positions.filter(x=>x.result==='BREAKEVEN').length;
 s.incomplete=r.positions.filter(x=>x.result==='UNVERIFIED').length;
 const count=s.wins+s.losses+s.breakeven;s.winRate=count?100*s.wins/count:null;
 s.grossRealizedUSDT=r.positions.reduce((v,x)=>v+x.grossRealizedUSDT,0);
 s.usdtFees=r.positions.reduce((v,x)=>v+x.usdtFees,0);
 s.nonUSDTFeeFills=r.positions.reduce((v,x)=>v+x.nonUSDTFeeFills,0);
 s.netExFundingUSDT=r.positions.filter(x=>x.netExFundingUSDT!==null).reduce((v,x)=>v+x.netExFundingUSDT,0);
 let cumulative=0;
 r.curve=r.positions.filter(x=>x.netExFundingUSDT!==null).map(x=>({at:x.exitAt,cumulative:cumulative+=x.netExFundingUSDT}));
 r.asOf=Date.now();return r;
}
export function readLiveReport(path){
 if(!existsSync(path))return emptyLiveReport();
 const db=new DatabaseSync(path,{readOnly:true});
 try{return computeLiveReport(db.prepare('SELECT * FROM orders').all(),db.prepare('SELECT * FROM fills ORDER BY filled_at,CAST(fill_id AS INTEGER)').all());}
 finally{db.close();}
}
export async function syncKnownOrderFills(reader,ledger){
 const orders=ledger.orders();
 let added=0;
 for(const o of (typeof ledger.dueOrders==='function'?ledger.dueOrders(24):orders.slice(-24))){
  const rows=await reader.get('/fapi/v1/userTrades',{symbol:'BTCUSDT',orderId:o.order_id,limit:1000});
  if(!Array.isArray(rows)||rows.length>=1000)throw Error('Binance fills incomplete; no partial total published');
  added+=ledger.ingest(rows);
  ledger.markChecked?.(o.order_id);
 }
 return {tracked:orders.length,newFills:added,report:ledger.report()};
}
