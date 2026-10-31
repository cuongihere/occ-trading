# BTCUSDT Futures execution development

Status: **PROTOTYPE ONLY — no live trade submission wired to UI**.

Implemented source modules:
- `futures-transport.mjs`: signed USD-M REST transport, no automatic retries on POST/DELETE; hard-scoped to BTCUSDT.
- `futures-sizing.mjs`: margin USDT × leverage, quantity step rounding, limits for three separate TP lots.
- `futures-order-plan.mjs`: preflight one-way/isolated/leverage/flat-account validation, stop/TP price draft.
- Unit tests cover request signing, invalid sizing, asymmetric LONG/SHORT levels and unsafe account rejection.

The prototype is **not packaged as an executable live worker**. Keep the LIVE switch OFF. This commit does not change Paper Trading.

### Missing before activating real money

- Explicit user-only API credentials and explicit per-launch permission, never stored in Git.
- Durable trade-state journal before submitting each network mutation and crash recovery.
- Exchange-side confirmed stop-market close-all, then verified reduce-only TP1/TP2/TP3.
- Correct order status and executed quantity reconciliation on uncertain outcomes; no blind retries.
- Idempotent trade grouping, user-data feed, funding, fees and integration with the real-trade report.
- Exchange-side order protection checks after startup or partial fills; safe abort/reduce-only closure path.
- Testnet integration with real exchange filters, API behavior, and restart/lost-connection tests.

**Sizing example:** At BTC = 77,000, 20 USDT margin with 5x represents about 100 USDT nominal and generally cannot be divided into 3 independently valid TP legs of 0.001 BTC each. The prototype refuses the plan rather than silently changing exit percentages.

See Binance USD-M API documentation for current supported endpoints. Price/quantity rules depend on live exchangeInfo filters.

### Prototype lifecycle safeguards (latest)

- New `futures-lifecycle.mjs`: pure fail-closed order state machine, rejecting repeated entry signals, requiring confirmed STOP before TP, and refusing automatic arming after restart.
- New `futures-lifecycle.test.mjs`: tests unknown exchange outcomes, stop-before-target ordering, three TP acknowledgements and FLAT verification.
- `futures-transport.mjs` now uses Binance USD-M **Demo** REST by default. Production requires explicit constructor opt-in; no live runner currently invokes it.
- This is source-level scaffolding only. Neither `START_WINDOWS.bat` nor the `/binance` dashboard submits real orders; LIVE stays OFF.

Note: Binance Demo API credentials are distinct from production credentials. Exchange and order formats may differ; no real demo network execution has been verified from this environment.

- `futures-protection-plan.mjs`: produces post-fill STOP close-all and three reduce-only TP descriptions for review and offline tests; it does not send these requests.

## Post-entry SL / Multi TP coordinator

Source helpers `futures-protection-orchestrator.mjs` and `futures-protection-checkpoint.mjs` now implement a testable sequence for a confirmed filled BTCUSDT entry: verify exchange position, persist a request marker, send `STOP_MARKET` close-all, verify it via exchange open algo orders, then send and verify TP1, TP2 and TP3 with `reduceOnly` and separate quantities. All uncertain requests halt; restart requires manual reconciliation, never duplicate submission. Unit tests use an exchange mock, not real funds.

**Not yet integrated with the dashboard LIVE switch or a running execution worker.** Real trading remains OFF. Missing end-to-end Demo testing, fill/conditional-order reconciliation, protection after partial fills, cancellation of stale TP/SL when the position becomes flat, and contingency handling for unprotected entries. Binance-side orders, once verified, operate at the exchange without keeping the app open; execution is not guaranteed at a particular trigger price.

## Browser API + Auto Demo integration

- Browser form at `/binance` now accepts Binance Demo/Production credentials using password fields. POST origin is restricted to local app; key/secret are in RAM and discarded on disconnect/shutdown; they are never persisted in SQLite, settings, browser draft or source.
- Local `/api/binance/live-status` reports connection, available margin, position, demo mode, Auto ON/OFF and fail-closed errors without exposing credentials.
- `/control/live/on` activates the **Demo-only** bot after account check (BTCUSDT, One-way, Isolated, leverage match, flat, no other orders). `/control/live/off` prevents new orders; exchange-side protective orders remain.
- New M15 OCC signals are forwarded to a separate Demo worker, which records entry intent before MARKET submission, verifies Entry fill, then uses the stop-first TP coordinator.
- A 15-second position reconciliation monitor confirms stop existence, cleans up OCC-owned conditional orders when flat and blocks fresh entries until cleared. Uncertain errors HALT; on restart Auto defaults OFF, with manual FLAT and no-order confirmation.
- Production transport is restricted at service level to read-only GET. No mainnet POST/DELETE can run through the browser service. **Do not use this as a real-money bot** until authentic Binance Demo API execution, restart recovery, partial-fill and conditional-order lifecycle have been independently verified.

This is not a guarantee of exchange order fill, instant stop execution, or the absence of slippage. No bypass of Binance regional restrictions.
