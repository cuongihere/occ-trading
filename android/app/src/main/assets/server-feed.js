// Public Binance USD-M BTCUSDT perpetual data only. No account/order endpoint.
// Official migration: https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/Important-WebSocket-Change-Notice
const REST = 'https://fapi.binance.com';
const STREAM = 'wss://fstream.binance.com/market/stream?streams=btcusdt@aggTrade/btcusdt@markPrice@1s/btcusdt@kline_15m';
const M15 = 900000;
class BinanceFeed {
  constructor(callbacks = {}) {
    this.cb = callbacks; this.generation = 0; this.state = 'disconnected'; this.offset = 0;
    this.lastTradeId = -1; this.lastClosed = 0; this.manual = true;
    this.failures = 0; this.clock = callbacks.clock || (() => Date.now());
  }
  status(state, message) { this.state = state; this.cb.onStatus?.({state, message}); }
  now() { return Math.round(this.clock() + this.offset); }
  healthy() { return this.state === 'live' && this.now() - this.lastTradeTime <= 10000 && this.clock() - this.lastReceive <= 10000 && this.now() - this.lastMarketTime <= 10000; }
  async request(path, signal) {
    if (signal?.aborted) throw Error('Đã hủy yêu cầu.');
    return await window.occPublicGet(path);
  }
  clear() {
    clearInterval(this.watch); clearTimeout(this.retry); clearTimeout(this.bootTimeout); clearTimeout(this.openTimeout);
    this.controller?.abort(); if (this.ws) { this.ws.onclose = null; this.ws.onerror = null; this.ws.onmessage = null; this.ws.close(); }
    this.ws = null;
  }
  disconnect() { this.manual = true; ++this.generation; this.clear(); this.status('disconnected', 'Đã ngắt kết nối. Không tạo lệnh mô phỏng mới.'); }
  reconnect(reason, minDelay = 0) {
    if (this.manual || this.reconnecting) return;
    this.reconnecting = true; this.status('stale', reason + ' Tạm dừng lệnh mới.');
    this.clear(); ++this.generation; const delay=Math.max(minDelay, Math.min(60000, 3000 * 2 ** Math.min(this.failures++,5))); this.retry = setTimeout(() => { this.reconnecting = false; if (!this.manual) this.connect(); }, delay);
  }
  async connect() {
    this.clear(); this.manual = false; this.reconnecting = false;
    const gen = ++this.generation; this.status('connecting', 'Đang tải nến thật từ Binance USD-M Futures…');
    this.lastReceive = 0; this.lastTradeTime = 0; this.lastMarketTime = 0;
    this.controller = new AbortController(); this.bootTimeout = setTimeout(() => this.controller.abort(), 20000);
    let booting = true; const queue = [];
    try {
      const before = this.clock(); const clock = await this.request('/fapi/v1/time', this.controller.signal);
      this.offset = Number(clock.serverTime) - (before + this.clock()) / 2;
      if (!Number.isFinite(this.offset)) throw new Error('Thời gian Binance không hợp lệ.');
      if (gen !== this.generation) return;
      const ws = this.ws = new WebSocket(STREAM);
      const opened = new Promise((resolve,reject) => { const timer=this.openTimeout=setTimeout(()=>reject(new Error('WebSocket Binance Futures không phản hồi sau 15 giây.')),15000); ws.onopen = () => {clearTimeout(timer);resolve();}; ws.onerror = () => {clearTimeout(timer);reject(new Error('WebSocket Binance Futures bị chặn hoặc không kết nối được.'));}; });
      ws.onmessage = e => {
        if (gen !== this.generation) return;
        try { const d = JSON.parse(e.data).data; if (!d) return; const receivedAt=this.clock(); this.cb.onRaw?.({receivedAt,exchangeAt:Number(d.E),data:d}); if (booting) { if (queue.length < 100000) queue.push({d,receivedAt}); else throw new Error('Bộ đệm đồng bộ quá lớn.'); } else this.consume(d,true,receivedAt); }
        catch (err) { this.reconnect('Dữ liệu stream không nhất quán: ' + err.message); }
      };
      const [h4,m15,info] = await Promise.all([
        this.request('/fapi/v1/klines?symbol=BTCUSDT&interval=4h&limit=500',this.controller.signal),
        this.request('/fapi/v1/klines?symbol=BTCUSDT&interval=15m&limit=1000',this.controller.signal),
        this.request('/fapi/v1/exchangeInfo',this.controller.signal), opened
      ]);
      if (gen !== this.generation) return;
      const symbol = info.symbols?.find(s => s.symbol === 'BTCUSDT' && s.contractType === 'PERPETUAL' && s.status === 'TRADING');
      if (!symbol || !Array.isArray(h4) || !Array.isArray(m15)) throw new Error('Không xác nhận được hợp đồng BTCUSDT perpetual hoặc nến.');
      const lot = symbol.filters.find(f=>f.filterType==='LOT_SIZE');
      const notional = symbol.filters.find(f=>f.filterType==='MIN_NOTIONAL');
      const priceFilter = symbol.filters.find(f=>f.filterType==='PRICE_FILTER');
      if (!lot || !(Number(lot.stepSize)>0) || !priceFilter || !(Number(priceFilter.tickSize)>0)) throw new Error('Thiếu quy tắc khối lượng hoặc bước giá hợp đồng.');
      const now = this.now(); const closed = m15.filter(b=>Number(b[6]) < now);
      for(let i=1;i<closed.length;i++) if(Number(closed[i][0])-Number(closed[i-1][0])!==M15) throw new Error('Lịch sử M15 có khoảng trống.');
      if (!closed.length || now - Number(closed.at(-1)[6]) > M15 + 10000) throw new Error('Lịch sử M15 chưa cập nhật.');
      this.lastClosed = Number(closed.at(-1)[0]);
      this.cb.onReady?.({h4,m15,now,stepSize:Number(lot.stepSize),minQty:Number(lot.minQty),minNotional:Number(notional?.notional || 0),tickSize:Number(priceFilter.tickSize)});
      // Catch-up affects indicators only: never replay buffered history as live profit.
      for (const {d,receivedAt} of queue) { if(gen !== this.generation) return; this.consume(d, false, receivedAt); }
      if(gen !== this.generation) return;
      booting = false; clearTimeout(this.bootTimeout);
      ws.onerror = () => this.reconnect('Lỗi kết nối Binance Futures.');
      ws.onclose = () => { if(gen === this.generation) this.reconnect('Mất kết nối Binance Futures.'); };
      this.watch = setInterval(() => {
        if (this.now()-this.lastTradeTime>10000 || this.clock()-this.lastReceive>10000 || this.now()-this.lastMarketTime>10000)
          this.reconnect('Giá/nến quá hạn trên 10 giây.');
      },1000);
    } catch (e) {
      if(gen !== this.generation) return;
      this.clear(); this.status('blocked', `${e.message} Không có giá giả, không mở lệnh.`);
      // Regional restriction is terminal until an operator explicitly retries; never route around it.
      if(e.httpStatus===451 || e.httpStatus===403) { this.manual=true; return; }
      this.reconnect('Lỗi nguồn dữ liệu; sẽ đồng bộ lại với backoff tối đa 60 giây.', e.httpStatus===429 || e.httpStatus===418 ? 60000 : 0);
    }
  }
  consume(d, live = true, receivedAt = this.clock()) {
    if (!['aggTrade','kline','markPriceUpdate'].includes(d.e)) return;
    if(d.s !== 'BTCUSDT') throw new Error('Sai hợp đồng.');
    const eventTime = Number(d.E);
    if (!Number.isFinite(eventTime) || eventTime > this.now()+5000 || this.now()-eventTime > 10000) {
      if(live) this.reconnect('Sự kiện Binance quá hạn/sai thời gian.');
      return;
    }
    this.lastReceive = receivedAt;
    if(d.e==='aggTrade') {
      const id=Number(d.a), time=Number(d.T), price=Number(d.p);
      if (!(price>0) || !Number.isFinite(time) || this.now()-time>10000 || time>this.now()+5000) return;
      this.lastTradeTime=time;
      if(id<=this.lastTradeId) return; this.lastTradeId=id;
      if(live && this.lastMarketTime && this.now()-this.lastMarketTime<=10000 && this.state!=='live') { this.failures=0; this.status('live','Dữ liệu trực tiếp Binance USD-M • BTCUSDT perpetual'); }
      // Historical buffer is never a fill event.
      if(live) this.cb.onTrade?.({price,time,id,receivedAt,exchangeAt:eventTime});
    } else if(d.e==='kline') {
      this.lastMarketTime=eventTime;
      const k=d.k; if (!k || k.i!=='15m' || !k.x) return;
      const time=Number(k.t); if(time<=this.lastClosed) return;
      if(time!==this.lastClosed+M15) { this.reconnect('Phát hiện thiếu nến M15.'); return; }
      if(Number(k.T)>=this.now()) return;
      this.lastClosed=time;
      this.cb.onCandle?.({time,open:Number(k.o),close:Number(k.c),closeTime:Number(k.T)},{live:live && this.healthy(),observedAt:this.now(),receivedAt,exchangeAt:eventTime});
    } else {
      this.cb.onMark?.({price:Number(d.p),time:eventTime,fundingRate:Number(d.r),nextFundingTime:Number(d.T),receivedAt,exchangeAt:eventTime});
      this.cb.onMeta?.({fundingRate:Number(d.r),nextFundingTime:Number(d.T),fundingStatus:'excluded'});
    }
  }
}


window.BinanceFeed = BinanceFeed;
