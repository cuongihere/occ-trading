# Binance Futures API — BTCUSDT

Status: **read-only Binance API connectivity**, not real order execution.

## Windows portable

1. Create a Binance Futures API key with **Read** permission. Never enable withdrawals. Use IP restriction where available.
2. Extract the latest OCC Portable ZIP.
3. Run **CHECK_BINANCE_WINDOWS.bat**.
4. Enter API key and secret in the local PowerShell prompt (hidden typing). Credentials are held in process memory, not saved to files.
5. Review BTCUSDT USD-M account balance, position, One-way/Hedge, isolated/cross margin, leverage, existing orders and server authentication.

**START_WINDOWS.bat remains paper trading.** This release contains no API order-placement feature.

## Requirements before automation with real funds

- Restrict all symbol operations to BTCUSDT perpetual only.
- Separate REAL balances from existing paper SQLite.
- Reconcile every order/fill and the exchange position across restarts and uncertain HTTP outcomes.
- Deploy exchange-side SL confirmation before TP1/TP2/TP3 for partial exits.
- Fail closed on lost feed, rate limits and unmatched positions; never silently retry ambiguous trade submissions.
- Test with supported Binance non-production environment, then very small real exposure only with deliberate opt-in.
- Binance can restrict API connectivity by geography; do not bypass restrictions.

Official USD-M account docs: https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/account

Official USD-M trade docs: https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/trade
