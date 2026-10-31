// BTCUSDT USD-M real public market stream quote. Never use paper fills as a ticker.
// Expose prices only while the exchange feed is healthy and timestamps are recent.
export class BtcMarketQuote {
 constructor({clock=()=>Date.now(),maxAgeMs=10000}={}) {
  this.clock=clock;this.maxAgeMs=maxAgeMs;this.trade=null;this.mark=null;
 }
 updateTrade(trade) {
  const price=Number(trade?.price),receivedAt=Number(trade?.receivedAt),exchangeAt=Number(trade?.time);
  if(!(price>0)||!Number.isFinite(price)||!Number.isFinite(receivedAt)||
     !Number.isFinite(exchangeAt)||receivedAt>this.clock()+3000||
     this.clock()-receivedAt>this.maxAgeMs) return false;
  if(this.trade&&exchangeAt<this.trade.exchangeAt)return false;
  this.trade={price,receivedAt,exchangeAt};return true;
 }
 updateMark(mark) {
  const price=Number(mark?.price),receivedAt=Number(mark?.receivedAt),exchangeAt=Number(mark?.time);
  if(!(price>0)||!Number.isFinite(price)||!Number.isFinite(receivedAt)||
     !Number.isFinite(exchangeAt)||receivedAt>this.clock()+3000||
     this.clock()-receivedAt>this.maxAgeMs)return false;
  if(this.mark&&exchangeAt<this.mark.exchangeAt)return false;
  this.mark={price,receivedAt,exchangeAt};return true;
 }
 snapshot({healthy=false,state='disconnected'}={}) {
  const now=this.clock();
  const fresh=x=>healthy&&state==='live'&&x&&
   now-x.receivedAt>=-3000&&now-x.receivedAt<=this.maxAgeMs;
  const tradeFresh=Boolean(fresh(this.trade)),markFresh=Boolean(fresh(this.mark));
  return {symbol:'BTCUSDT',contract:'USD-M PERPETUAL',source:'Binance Futures public aggTrade + markPrice',
   state,live:tradeFresh,lastPrice:tradeFresh?this.trade.price:null,
   lastExchangeAt:tradeFresh?this.trade.exchangeAt:null,
   lastReceivedAt:tradeFresh?this.trade.receivedAt:null,
   markPrice:markFresh?this.mark.price:null,
   markReceivedAt:markFresh?this.mark.receivedAt:null};
 }
}
