# Production Readiness Audit

Audit date: 2026-10-21

## Code-level result

The engine now has concrete Wallex REST and Centrifugo adapters, configurable AI and research adapters, Drizzle/SQLite persistence and migrations, and runnable backtest, shadow, live, recovery, reporting, and order-cancellation paths. AI SDK providers include OpenAI, Anthropic, Google, generic OpenAI-compatible endpoints, BoxAPI, and workspace-scoped Liara AIaaS. The implementation is a single-process modular monolith; SQLite leases prevent concurrent live or shadow loops using the same database.

The main production controls are implemented and covered by automated tests:

- Live mode is opt-in, requires the credit sub-account key/client ID, package ID and explicit allowlist, and refuses to start with the kill switch enabled.
- Every proposed order passes deterministic market, precision, balance, exposure, drawdown, loss, freshness, book-depth, and slippage checks. Shadow mode has only a read-only market-data port.
- Live order intent and client ID are stored before submission. Ambiguous submissions reconcile by that ID and are never automatically resubmitted. Orders with incomplete fill detail stay unresolved until reconciled.
- Live and shadow runners hold renewable database leases. Lost ownership fails closed. Backtest and shadow recovery use persisted inputs/checkpoints to avoid duplicate fills after restart.
- Backtest and shadow accept pair/strategy matrices up to 32 cases per command. Strategy mandates are persisted with runs, confidence and order-type gates are deterministic, and shadow portfolio/reflection memory is isolated by pair and strategy. Historical backtest reflections are scoped to their run to prevent cross-run leakage.
- Configuration is available through a masked interactive `configure` wizard, redacted `config show`, persistent `config set/unset`, and validated per-command overrides (`--set` plus named AI, BoxAPI, Liara, Wallex, trading-mode, strategy, database, and virtual-cash options). Missing runtime requirements prompt on an interactive TTY; `--no-prompt` fails with setup guidance. Live and auto-trading flags remain separate explicit opt-ins.
- Commands accept `--env-file` for isolated profiles; command-line overrides supersede file and shell settings. The default SQLite file is under the OS user's application-data directory, and migrations are resolved relative to the engine rather than the launch directory. `doctor` checks parsed configuration, mode requirements, database migrations, and optionally public Wallex market connectivity without calling a model or any write endpoint. Secret-file updates are atomic and use owner-only permissions where the OS supports them.
- Shadow HTML reports aggregate completed cycles into lifetime virtual-portfolio performance for each pair/strategy, survive process restarts, and auto-refresh at the watch interval. Individual runs remain separately auditable.
- Backtests report quote-currency P&amp;L and return, buy-and-hold/excess return, drawdown, fill count, volume, reliability, fees and slippage. Equity curves retain local highs/lows while being bounded to 1,000 chart points. `--html` emits a self-contained offline SVG benchmark and scorecard; JSON `report` retains the full decision/evidence/risk/order audit trail.
- Autonomous live cycles require the explicit `live --auto-trade` flag and a separate `WALLEX_ENABLE_AUTOTRADING=true` opt-in, in addition to ordinary live enablement and risk checks. Live auto mode is restricted to one pair and strategy per process and stops on cycle errors.
- Run review data includes source snapshots, findings, proposals, risk decisions, order intents, fills, fees by fee asset, and quote-currency slippage impact.
- Wallex market orders omit `price`, and cancellation uses the documented `clientOrderId` query parameter. See [Wallex order creation](https://developers.wallex.ir/spot/createorder), [order detail](https://developers.wallex.ir/spot/singleorderdetail), and [API reference](https://api-docs.wallex.ir/).
- Current and completed historical candle inputs are separated. Backtests exclude current contextual feeds and state their candle-fill assumptions in reports.

## Verification run

- `bun run typecheck` — passed.
- `bun test` — passed: 47 tests, 231 assertions across 19 files.
- `bun audit` — passed with no vulnerabilities after locking the legacy Drizzle helper onto patched `esbuild`.
- CLI smoke checks — configuration help/show from the shipped dotenv template, BoxAPI and Liara one-run provider validation with dummy credentials, one-run local-provider overrides, non-interactive missing-config guidance, migration-backed `db:migrate`, `report --html`, and the disabled autonomous-live guard ran successfully against temporary settings/database files. `doctor` also passed from the project directory and a different working directory; its optional public Wallex check returned 373 active spot markets and confirmed the configured pairs. No model inference or trading write was performed.
- Drizzle migration generator help — ran successfully after the dependency override.

Tests use deterministic fakes and recorded API shapes. They exercise the engine’s external boundaries without placing real orders.

## Live rollout boundary

This audit does not claim that a real Wallex account or package has been operationally verified. No API key, assigned challenge balance, package ID, or approved market credentials were available, so this work did not call authenticated account endpoints, submit/cancel a live order, or validate real fill/fee payloads against the target account. Before enabling live mode, run `validate --mode live`, inspect `markets`, verify the sub-account balance and package restrictions, and complete a supervised minimal-size order lifecycle on the approved account. Do not grant withdrawal permission to the API key.

The supported deployment is one engine process on one machine with a local SQLite database. SQLite must be on durable local storage and backed up together with the lockfile and persisted run data. This version does not provide multi-host coordination, a hosted dashboard, or a separate monitoring service; the shadow dashboard is a local self-refreshing HTML report. External news/sentiment/tokenomics feeds are only current context, not historical backtest data; LLM outputs are not deterministic market signals or a profitability guarantee.
