# OCC Trading — BTCUSDT Futures (Windows)

Live Binance USDⓈ-M Futures trading, OCC crossover signals, LIMIT/MARKET entries,
exchange-confirmed STOP and TP1/TP2/TP3, and optional Binance Square chart posts.

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
enable **Tự đăng Square**. This does not use the Binance Futures API key.

A Square post is created only after **a new live Binance Entry has FILLED and all
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

## Development

Node.js >=24; no npm packages: `node --test`, `node server.mjs`.
Paper UI and simulation journal are not served or bundled.
See [Vietnamese documentation](README_VI.md).
