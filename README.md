# OCC Trading — Unified USDT Perpetual Futures (Windows)

Live Binance USDⓈ-M Futures trading, OCC crossover signals, LIMIT/MARKET entries,
exchange-confirmed STOP and TP1/TP2/TP3, and optional Binance Square chart posts.

**Windows PC only.** One trading dashboard switches between BTCUSDT and up to 12 additional Binance USDⓈ-M USDT perpetual symbols. The same causal OCC H4/M15 engine, verified exchange-side STOP, TP1/TP2/TP3, LIMIT/MARKET entry and reversal logic are reused for every configured symbol. The Windows portable build is the release target.

**Paper Trading is not available in the application or Windows build.** Historical
paper fixtures remain only as development/regression tests and are never executed.

## Run on Windows

1. Open [Windows Portable Actions](https://github.com/cuongihere/occ-trading/actions/workflows/windows-portable.yml) and select a successful run.
2. Download the `OCC_Portable_Windows_x64` artifact, extract its inner ZIP, and run `START_WINDOWS.bat`.
3. Dashboard: `http://127.0.0.1:8080/binance`. Live AUTO stays OFF until explicitly enabled.
4. Preserve `data/` when upgrading; it holds encrypted credentials and live order checkpoints.

## Binance Square (optional)

Binance Square provides a separate posting-only OpenAPI key. Create it in
[Square Creator Center](https://www.binance.com/square/creator-center/home).
Open **Cài đặt → Binance Square**, save that key (Windows DPAPI), then explicitly
enable the specific BTC, watchlist, or ALL publishing toggle. This does not use the Binance Futures API key.

A **verified BTCUSDT trade** Square post is created only after **a new live Binance Entry has FILLED and all
exchange STOP/TP orders have been verified**. It includes a fresh PNG candlestick
chart and public Entry / SL / TP1 / TP2 / TP3 levels and LONG/SHORT direction.
No strategy name, indicator formula, position size, margin, order ID, account
balance, PnL, or API secret is printed on the chart or caption.

Failures in Square publishing do not affect Futures execution. Each Entry ID
is reserved before uploading and **never blindly retried** after an uncertain
network or publish acknowledgement. Inspect the Square Creator Center before
manually attempting to resend any failed post.

Square media support/API permissions depend on your Creator account and region.
We cannot validate an actual Square post without your posting-only key.
Posts are public and cryptocurrency futures trading is high risk.

## Unified one-screen trading

- Add symbols using the **+ Coin** field on the same dashboard; Binance `exchangeInfo` must verify the symbol is TRADING, USDT-quoted and USDT-margined perpetual.
- Click a coin tab to switch the single chart and selected-coin position/SL/TP readback. The position summary below remains multi-coin.
- Each symbol has independent margin, leverage, side filter, Entry mode, STOP, TP settings and reversal toggle. Copy from BTC and adjust; leverage must match the leverage set on Binance.
- BTC's existing `data/futures-*` state and `binance-live-stats.sqlite` are preserved. Additional symbols use `data/futures-SYMBOL-*.json` and `data/binance-SYMBOL-live-stats.sqlite`, never shared across symbols.
- AUTO defaults OFF for every symbol after startup. Individual coin AUTO and the explicit **AUTO TẤT CẢ** action are opt-in; selecting a coin for AUTO does not arm it. OFF does not remove exchange-side STOP/TP.
- A per-account serial trade queue checks a fresh signed Binance balance before each Entry; unrelated exchange positions/unknown orders block trading. Previously managed positions must be verified using their exact Entry and Algo IDs.
- Square has three independent opt-in channels: **BTC** (confirmed live Entry only, separate daily cap), **List 1** (comma-separated user-defined USDT Perpetual symbols, separate per-scan and daily caps), and **ALL** (read-only public-market USDT Perpetual OCC scanner, separate per-scan and daily caps). The watchlist has priority over ALL, preventing duplicate symbol posts; BTC is reserved for the confirmed-trade channel.
- Scanner posts are explicitly labeled **technical analysis signals, NOT filled positions**, use public Binance closed M15 candles, and never call Futures order endpoints. New scanner modes default OFF. Each batch is limited to 1–3 posts and each group to 1–20 posts/day; account-wide Square limits still apply.
- This is live-money Futures software; keep `data/`, check all existing positions and exchange-side conditional orders directly on Binance before upgrading, and do not run two copies of the same account.

## Development

Node.js >=24; no npm packages: `node --test`, `node server.mjs`.
Paper UI and simulation journal are not served or bundled.
See [Vietnamese documentation](README_VI.md).
