# Trex

A Bun and TypeScript modular monolith for crypto market research, decision support, backtesting, shadow trading, and explicitly enabled Wallex credit-account spot execution. Its multi-agent workflow combines parallel market/technical, news, sentiment, and tokenomics/on-chain analysis; bull/bear researchers; a research manager; a trader; aggressive/conservative/neutral risk reviewers; and a portfolio manager.

The model agents are read-only. They can inspect provided evidence and completed candles and return schema-validated findings or proposals. The application workflow is explicit, and only the deterministic risk gate can authorize an order for the live execution adapter.

## Runtime

- Bun 1.2 or newer, TypeScript, Commander, AI SDK provider registry and `ToolLoopAgent`.
- Drizzle ORM with SQLite through Bun's native SQLite driver. This is a single-process/single-runner deployment.
- Decimal arithmetic for sizing, fills, exposure, fees, and reports.
- Wallex REST for spot market metadata, quotes, depth, candles, package restrictions, balances, and order lifecycle; Centrifugo v2 for live public price and book-change signals.
- The `trex` package executable delegates to Bun, so it can be linked or installed as a CLI while retaining Bun SQLite support.

## Setup

### Start the dashboard

Requirements: Bun 1.2 or newer and network access for package installation and exchange/model APIs. Clone the repo and install its workspaces:

```powershell
git clone https://github.com/mhbdev/trex.git
cd trex
bun install
# Run once for this database. Store the printed key in a password manager or OS secret store.
bun run trex secrets generate-key
```

Set the saved key in each terminal session before starting Trex. PowerShell prompts without echoing the value:

```powershell
$secureKey = Read-Host "ENCRYPTION_KEY from your secret store" -AsSecureString
$env:ENCRYPTION_KEY = [System.Net.NetworkCredential]::new("", $secureKey).Password
bun run ui
```

On macOS or Linux, use a hidden prompt in Bash and then start the dashboard:

```bash
read -rsp "ENCRYPTION_KEY from your secret store: " ENCRYPTION_KEY; printf '\n'; export ENCRYPTION_KEY
bun run ui
```

Open `http://127.0.0.1:4173`. In **Profiles and settings**, choose the active profile and configure an AI provider, model, provider key, and approved market symbols. Save, then use **System health** to validate the setup. Start with a backtest or shadow run to exercise the agents and virtual portfolio without sending exchange orders. Model API calls may still incur provider charges. Shadow uses live Wallex market data; backtest uses historical candles.

The key must stay the same for this database. Generate it once, save it outside the repository and database, and load that saved value whenever Trex starts. Generating a replacement key makes existing encrypted credentials unreadable. If the key is lost, those credentials cannot be recovered. Closing the browser leaves engine work running; stopping the local service requests a graceful stop for managed runs.

The dashboard and CLI use the same SQLite database and named configuration profiles. Runtime settings and provider/exchange credentials come from the active database profile; dotenv files are not loaded during normal startup. To migrate an existing `.env`, first provide the external `ENCRYPTION_KEY`, then use `bun run trex profile import-dotenv <path> --name <profile>`. The importer validates and stores recognized settings, verifies encrypted credentials, then removes imported assignments from the source file. The dashboard can run diagnostics, validate settings, inspect markets, start backtests and shadow or explicitly confirmed live runs, review reports, and cancel linked live orders.

### Use the CLI

The guided setup stores configuration in the active database profile. Run it once, check the setup, then start a one-cycle shadow run:

```powershell
bun run trex configure --mode shadow
bun run trex doctor --mode shadow --check-wallex
bun run trex shadow --symbol BTCTMN --strategy agentic-balanced --html reports/first-shadow.html
```

For continuous one-minute shadow evaluation, add `--watch --interval-seconds 60`. Shadow never creates an exchange order writer. Use `bun run trex --help` and `bun run trex <command> --help` to see available commands and options. The [engine guide](packages/engine/README.md) explains the workflow, agent debate and memory, risk checks, portfolios, and audit trail.

The default Trex SQLite database is stored in the current OS user's application-data directory (`~/AppData/Local/trex/trex.sqlite` on Windows, `~/Library/Application Support/trex/trex.sqlite` on macOS, and `~/.local/share/trex/trex.sqlite` on Linux). If an existing database from an earlier Trex version is present, Trex keeps using it so profiles and run history remain available. To use another database, pass the bootstrap-only `--database-url` option, for example `bun run trex --database-url file:./data/trex.sqlite ui`; the database location is not a profile setting because the engine must know where the database is before it can read settings. When importing a legacy dotenv file whose `DATABASE_URL` pointed to a non-default database, pass that same path as `--database-url` to the import command. Migration files are resolved relative to the installed engine, so database commands also work when launched from another directory.

For a live credit sub-account, configure its own Wallex API key with read and trade permissions and no withdrawal permission. Save `WALLEX_SUB_ACCOUNT_CLIENT_ID`, `WALLEX_PACKAGE_ID`, `WALLEX_ALLOWED_MARKETS`, `LIVE_MAX_GROSS_EXPOSURE`, and `WALLEX_ENABLE_LIVE_TRADING` in the active profile using the dashboard or `trex config set`. Live mode refuses to start while `LIVE_MAX_GROSS_EXPOSURE` is zero. This absolute ceiling is in `WALLEX_QUOTE_CURRENCY` and limits the engine's total marked open-position exposure; it is combined with `RISK_MAX_GROSS_EXPOSURE` and any tighter strategy cap. The engine also fetches the configured package's `unavailableMarkets` before it enables a market. Do not use a main-account key for the challenge credit sub-account.

### Wallex credit identifiers and exposure budget

- **Package ID** identifies the credit-plan definition (the plan, not your personal account or the loan amount). Find it in Wallex's [active trade-credit packages](https://developers.wallex.ir/docs/trade-credit-active-packages) list and use the ID to inspect [package details](https://developers.wallex.ir/docs/trade-credit-package-details). The details API is `GET /v1/prop/packages/{id}`; the engine reads its `unavailableMarkets` from this endpoint. The screenshot's plan card shows the credit and an activation action, but not the numeric package ID. If the plan still shows an activation action, verify under your active credits/history that the package was actually activated before using its account credentials.
- **Sub-account client ID** identifies the personal credit account created by activation. Find active accounts in Wallex's [active sub-accounts list](https://developers.wallex.ir/docs/trade-credit-active-sub-account-list), where the response field is `clientId`, or inspect [trade-credit account history](https://developers.wallex.ir/docs/trade-credit-sub-account-history), where it is `client_id`. Copy that value from the active credit-account row. This is sent as the `sub-account-client-id` header; it is different from both the package ID and the engine's per-order `client_id`.
- **API key** is a separate secret. Create/use a key intended for the credit sub-account with read and trade permissions and no withdrawal permission. Never paste it into chat or commit it.

Wallex describes the package's entry asset as the user's collateral: losses are deducted from it when the package closes. Credit also accrues a daily fee. Reaching the warning limit can require closing or adding collateral; reaching the liquidation limit closes the package automatically. If the main wallet is [connected for automatic top-ups](https://developers.wallex.ir/docs/trade-credit-connect-wallet), Wallex may transfer main-wallet assets when the package crosses its warning limit. An engine exposure ceiling does not change those Wallex package rules and cannot guarantee a maximum loss for the whole account. Disconnect automatic wallet top-ups if you want to avoid transfers from the main wallet, and verify the package's current loan, collateral, warning/liquidation levels, and daily fee in Wallex before any real order.

To keep the engine's live exposure small, set an explicit hard ceiling and smaller per-order/position caps. For example, **only if Wallex confirms a 5,000,000 TMN loan**, a `LIVE_MAX_GROSS_EXPOSURE` of `100000` TMN is 2% of that loan; it limits total open-position value created/held in the credit account, not the loss amount promised by Wallex. Also set `RISK_MAX_ORDER_NOTIONAL=50000`, `RISK_MAX_POSITION_NOTIONAL=75000`, and `RISK_MAX_GROSS_EXPOSURE=100000`. A full loss of that exposure, fees, price gaps, or non-engine/manual orders remain possible. The cap defaults to zero (live disabled) and is applied again immediately before order submission.

Markets can be entered as either Wallex symbols (`BTCTMN`) or readable pairs (`BTC/TMN`); the CLI normalizes both. Start with a short allowlist such as `BTCTMN,ETHTMN,USDTTMN`. Those were active spot markets in the current public market feed and are absent from the restricted-pair list you supplied. `USDTTMN` is the USDT/Toman conversion market, not another crypto/TMN trading pair. A current active spot listing still does not prove your package permits that market: the package-specific `unavailableMarkets` response is checked before shadow/live decisions. Wallex's public market feed and 24-hour volumes change, so recheck with `trex markets --all` and your package before trading.

## Configure from the CLI

Use `configure` for the guided setup; it prompts for missing AI credentials with masked input and asks for an explicit confirmation before enabling live order access. Required settings can also be collected automatically when an interactive backtest, shadow, or live command starts. In non-interactive runs, missing settings produce a setup message; use `--no-prompt` to opt out of prompts.

```powershell
bun run trex configure --mode shadow
bun run trex config show
bun run trex config set AI_API_KEY # prompts with hidden input
bun run trex config set ENGINE_STRATEGIES_JSON '[{"id":"momentum-lite","name":"Momentum Lite","mandate":"Only trade with the completed-candle trend; otherwise HOLD.","minConfidence":0.7,"allowedOrderTypes":["LIMIT"]}]'
bun run trex config unset AI_API_KEY
```

Use named profiles for independent environments: `trex profile list`, `trex profile create "Shadow lab"`, `trex profile use <profile-id>`, and `trex profile delete <profile-id>`. The active database profile is the runtime source of truth. The precedence is **one-command CLI overrides → active database profile → built-in defaults**. CLI options and `--set KEY=VALUE` affect that invocation only; dashboard edits and `trex config set` persist to the active profile. Provider, Wallex, and data-source credentials are encrypted in SQLite and never returned to the browser. Two bootstrap values are intentionally outside profiles: `DATABASE_URL` selects the database before it can be opened, and `ENCRYPTION_KEY` protects encrypted profile secrets. Keep the key in an OS/service secret manager; do not place it in SQLite or dotenv. `profile import-dotenv` is a one-time migration helper; dotenv files are never loaded during normal CLI or dashboard startup.

Operational commands accept one-run overrides such as `--ai-provider`, `--ai-model`, `--ai-base-url`, `--boxapi-api-key`, `--boxapi-base-url`, `--liara-api-key`, `--liara-workspace-id`, `--liara-base-url`, `--wallex-api-key`, `--wallex-sub-account-client-id`, `--wallex-package-id`, `--wallex-allowed-markets`, `--live-trading`, `--auto-trading`, `--strategy-profiles-json`, `--max-debate-rounds`, `--max-risk-discuss-rounds`, `--memory-holding-period-bars`, `--memory-benchmark-symbol`, and `--paper-initial-cash`. `--set KEY=VALUE` supports any validated database setting, including role model JSON and risk caps. Named CLI options take precedence over `--set`; command-line values override the selected profile only for that invocation. `--database-url` selects the SQLite database before profile loading and is not stored in the database. The `config set` command saves values to the active encrypted profile; secret values are masked when prompted and encrypted before SQLite persistence. Command-line secret arguments may appear in shell history and process listings, so prefer a masked prompt or the dashboard's write-only credential fields.

The debate and memory controls are configurable in the guided setup, the active profile, `config set`, or as per-command options. For a faster paper experiment, for example, use `--max-debate-rounds 2 --max-risk-discuss-rounds 1 --memory-holding-period-bars 30`; the memory window is measured in completed one-minute bars.

`AI_PROVIDER` and `AI_MODEL` select the default provider registry entry and model in the active database profile. Supported providers are OpenAI, Anthropic, Google, generic OpenAI-compatible endpoints, BoxAPI, and Liara AIaaS. `AI_API_KEY` supplies the default provider's key, and `AI_BASE_URL` configures a generic compatible endpoint. BoxAPI uses its encrypted `BOXAPI_API_KEY` credential and defaults to `https://ai.boxapi.ir/ai/v1`; Liara uses an encrypted `LIARA_API_KEY`, `LIARA_WORKSPACE_ID`, and `LIARA_BASE_URL` (default `https://ai.liara.ir`), with the workspace-specific `/api/{workspaceID}/v1` inference path assembled by the adapter. Provider credentials are encrypted in the selected profile. To route individual roles, store provider-specific credentials in the dashboard's key fields or use the hidden `AI_PROVIDER_KEYS_JSON` prompt, then set `AI_ROLE_MODELS_JSON`:

```powershell
bun run trex config set AI_ROLE_MODELS_JSON '{"news_analyst":"anthropic:<available-model>","portfolio_manager":"boxapi:<available-model>","trader":"liara:<provider/model>"}'
```

Or edit roles visually on the dashboard's **Agents** page. Provider API keys belong in the dashboard's write-only credential editor or a masked `trex config set AI_PROVIDER_KEYS_JSON` prompt; never put them in the route JSON.

For Liara, inference model IDs are workspace-scoped and can be checked with its authenticated [available-models endpoint](https://developers.liara.ir/ai-chat-completions/models/list-available-models); its [public model catalog](https://developers.liara.ir/ai-models/model-catalog-v2/list-models-with-filters) provides broader model metadata. The BoxAPI endpoint and its OpenAI-compatible request format are documented [here](https://boxapi.ir/docs/ai/#sdk). The providers share the AI SDK OpenAI-compatible adapter; choose models that support the tool calling and structured outputs used by this engine, since support varies by model and account plan.

The BoxAPI adapter sends `reasoning_effort: "none"` through the AI SDK provider options on BoxAPI requests. This matches the `/v1/chat/completions` tool-calling requirement in the gateway error reported for `gpt-6-luna`; role findings and deterministic risk controls remain active, while model reasoning-token usage will generally be zero for these requests.

For BoxAPI workflow tests, start with `gpt-5.6-luna`; its current model catalog describes it as fast and economical. Compare `gpt-5.6-terra` as a balanced candidate, then test `gpt-5.6-sol` or the `gpt-6.1-sol` alias shown in your hackathon model list for decision quality. Do not start every role on `gpt-6-astra`: the current BoxAPI text model catalog lists it at $10 per million input tokens and $50 per million output tokens, and one engine decision invokes many roles. If experimenting with Astra, assign it to one role first with `AI_ROLE_MODELS_JSON` and measure actual BoxAPI usage. These are test candidates, not claims about trading profitability; BoxAPI pricing/model availability can change. The `text-embedding-3-small` and `text-embedding-3-large` models are embedding models, not chat models, so they cannot be used for `AI_MODEL`; this engine currently has no embedding-based memory retrieval. Before a shadow run, smoke-test the chosen model with the engine because AI SDK tool loops require the selected model/account to support tool calls and the final proposal must pass structured-output validation.

Set `AI_REQUEST_TIMEOUT_SECONDS` in the active profile with `trex config set AI_REQUEST_TIMEOUT_SECONDS <seconds>` to bound a full model operation. `AI_TOOL_TIMEOUT_SECONDS` bounds each tool call, including optional Wallex market reads. `AI_TIMEOUT_RETRIES` controls bounded retries after a full model operation times out (0–2; default 1). Each retry is recorded in run diagnostics. Market reads carry cancellation through to the HTTP request and retry only while the operation remains active; order writes are never automatically retried. Configure optional contextual feeds through the dashboard's data-source settings or the encrypted `RESEARCH_ENDPOINTS_JSON` profile secret. Each endpoint is queried with `symbol`, comma-separated `categories`, and point-in-time `asOf` parameters and returns `{ "items": [ResearchItem] }`; optional `maxAgeSeconds` controls how long each feed is considered fresh. Stale and future-dated items are excluded, response size is capped, and provider errors are recorded as warnings without erasing other providers' evidence. Provider URLs must use HTTPS; HTTP is allowed only for localhost development.

Live and shadow runs query CoinPaprika for exact-symbol asset catalogue, supply fields and aggregated USD market metrics, and CoinDesk's RSS feed for current headlines. Reddit and StockTwits remain controlled by the active profile. When the active profile has a TronScan API key, TRX runs also query TronScan's TRON-mainnet indexer for circulating supply, cumulative block/vote rewards and fee/resource burns, current reward/fee/resource chain parameters with linked proposal history, network staking-rate history, governance proposals, protocol-reported burn/staking revenue, and recent network-wide daily activity. Add the key under Profile settings; TronScan requires an API key for normal mainnet access ([key setup and authentication](https://docs.tronscan.org/en/api/api-keys), [API requirements](https://docs.tronscan.org/en/api/common-network-auth)). Analysts can query DexPaprika on demand for exact-ticker candidates in indexed decentralized-exchange markets; results include network and token address/id because tickers can collide. Run audits record each source's status, returned/accepted/included item counts, and stale/future exclusions. no_matches, failed, filtered, and skipped are coverage outcomes, not proof that an event or activity did not happen. CoinPaprika figures are third-party aggregates and may be estimates; its free API plan is limited to personal use and requires attribution, so commercial use needs a suitable license ([API terms](https://coinpaprika.com/api/pricing/), [ticker data](https://docs.coinpaprika.com/api-reference/tickers/get-ticker-for-a-specific-coin)). CoinDesk items are headlines/excerpts ([RSS feed information](https://www.coindesk.com/coindesk-news/2021/09/17/coindesk-rss)). TronScan provides indexed protocol/network aggregates, not a holder-specific return or full local verification ([supply and burn](https://docs.tronscan.org/en/api/statistics/funds), [staking](https://docs.tronscan.org/en/api/statistics/freezeresource), [chain parameters](https://docs.tronscan.org/en/api/witness/chainparameters), [protocol revenue](https://docs.tronscan.org/en/api/protocol-revenue-service-api/turnover-new), [governance](https://docs.tronscan.org/en/api/witness/proposal), [network activity](https://docs.tronscan.org/en/api/statistics/stats-overview)). DexPaprika covers indexed pools only ([API overview](https://docs.dexpaprika.com/introduction)). These sources do not provide a verified future unlock calendar or prove holder-level utility capture; the tokenomics analyst must mark missing dimensions unassessable. Price, candles, and trading volume are not tokenomics evidence.

`MARKET_QUOTE_FALLBACKS_JSON` is an encrypted profile value containing an ordered array of `{ "id", "url", "timeoutMs?", "headers?" }` endpoints. Each endpoint receives `?symbol=...` and must return `{ "symbol", "price", "observedAt?" }`; timestamps are Unix milliseconds. Configure it in the dashboard's data-source settings or with a masked `trex config set MARKET_QUOTE_FALLBACKS_JSON` prompt. Wallex remains first choice and is required for live authorization. Fallback prices are visibly marked with their provider ID and cannot pass the live risk gate. Provider URLs must use HTTPS; HTTP is allowed only for localhost development.

## Commands

```text
bun run trex doctor [--mode backtest|shadow|live] [--check-wallex] [--json]
bun run trex validate [--mode backtest|shadow|live]
bun run trex markets [--all]
bun run trex backtest --symbol BTCUSDT --strategy momentum --from 2025-01-01T00:00:00Z --to 2025-01-02T00:00:00Z --html reports/btc-momentum.html
bun run trex backtest --symbols BTCUSDT,ETHUSDT --strategies agentic-balanced,momentum,mean-reversion --from 2025-01-01T00:00:00Z --to 2025-01-02T00:00:00Z --html reports/matrix.html
bun run trex backtest --symbol BTCUSDT --from <unix-seconds> --to <unix-seconds> --resume <run-id>
bun run trex shadow --symbols BTCUSDT,ETHUSDT --strategies agentic-balanced,momentum --html reports/shadow.html
bun run trex shadow --symbols BTCUSDT,ETHUSDT --strategies agentic-balanced,momentum --watch --interval-seconds 60 --audit-limit 100 --html reports/shadow-live.html
bun run trex live --symbol BTC/TMN --strategy capital-preservation --live-trading true --live-max-gross-exposure 100000 --set WALLEX_QUOTE_CURRENCY=TMN --set RISK_MAX_ORDER_NOTIONAL=50000 --set RISK_MAX_POSITION_NOTIONAL=75000 --set RISK_MAX_GROSS_EXPOSURE=100000
bun run trex live --symbol BTC/TMN --auto-trade --interval-seconds 60
bun run trex status [--limit 20]
bun run trex report [run-id] [--html reports/run.html] [--audit-limit 50] [--include-backtest-data]
bun run trex cancel-order <client-order-id>
bun run trex db:migrate
```

`doctor` checks configuration, mode safety requirements, database opening, and migrations. Add `--check-wallex` to make a public read-only market metadata request and check that configured pairs are active. It does not call an AI provider or any exchange write endpoint. A pass confirms local wiring and, when requested, public market connectivity; it does not validate private credentials or model-provider compatibility.

The default shadow and live commands make one decision cycle. A single **live** cycle can still submit a real order when the proposal and all risk checks pass. Shadow accepts comma-separated pairs and strategy profiles; each pair/strategy combination uses an isolated virtual portfolio. `--watch` repeats the shadow matrix and subscribes to Wallex's Centrifugo v2 public price and order-book channels. On initial connection or reconnect, REST market depth is fetched because these public channels do not provide a complete initial book or replay the missed interval. Shadow cycles never construct an `OrderExecutionPort`; the only order writer is created by the explicit `live` command.

For a live-updating paper-trading dashboard, run `bun run trex shadow --symbol BTCTMN --strategy agentic-balanced --watch --interval-seconds 60 --html reports/shadow-live.html`. The CLI prints a local dashboard URL (default port 4173); open that URL while the process is running. If that port is busy, pass `--dashboard-port 0` to choose an available port. The dashboard binds only to `127.0.0.1`, is read-only, and streams engine status and refreshed report data over Server-Sent Events. Its keyboard-accessible sidebar links to the report sections; live updates preserve the selected section, expanded audit details, and focus. A matching standalone HTML snapshot is written to the `--html` path each cycle and remains usable after the watcher stops. The dashboard shows cumulative persisted virtual-portfolio performance per pair and strategy, including across process restarts. Each cycle is also available as a separate run in `status` and `report`. Shadow uses no exchange trading balance and cannot submit orders. Its paper fills estimate execution from a fresh visible depth snapshot plus configured fees and slippage; they do not model queue priority, exchange latency, hidden liquidity, order acceptance, or market impact beyond configured slippage. Shadow results exercise the agent and portfolio lifecycle, but cannot guarantee live fills or returns. Model API calls can still incur provider charges; to avoid external inference costs, configure `AI_PROVIDER=compatible` and `AI_BASE_URL` in a database profile and point them at a local OpenAI-compatible model server that supports tool calling and structured JSON output.

The standalone HTML report includes normalized equity and drawdown charts; pair/strategy performance; recent run configurations and assumptions; each stored decision, quote, proposal, rationale, evidence and agent finding; deterministic risk checks; order intents and fills; portfolio snapshots; source snapshots; and memory outcomes/reflections. Portfolio details include cash, marked position value, unrealized P&amp;L, realized P&amp;L today, fees, and total equity P&amp;L. Execution reliability is shown only when an order proposal exercised the execution path; a HOLD-only run is marked “Not exercised,” not 100% reliable. Newly captured run failures include a redacted error name and message; older failure causes cannot be recovered if they were not recorded at the time. AI activity is audited by agent role, configured provider/model, step status, duration, finish reason, tool names, provider-reported input/output/reasoning/total tokens, warnings, and failed-call details. It deliberately does not save full prompts or tool arguments. Provider billing is not estimated because model prices and discounts differ by account and can change; use the provider's usage page for billed cost. `shadow --audit-limit 100` controls how many recent run audits are embedded in a continuously refreshed report; the performance aggregate still covers all completed runs. `report --audit-limit 50 --html reports/recent.html` controls the recent-run dashboard window, while `report <run-id> --html reports/run.html` includes that run's complete persisted audit. Older runs remain in SQLite and can be opened individually.

**Live trading** means the selected command is allowed to send real orders to the configured Wallex credit account; plain `live` runs one cycle and may submit a real order. **Autotrading** is the repeated, unattended version of live trading: it continuously runs cycles at the interval and may submit real orders each time. It requires both the explicit `live --auto-trade` flag and `WALLEX_ENABLE_AUTOTRADING=true` saved in the active database profile, in addition to `WALLEX_ENABLE_LIVE_TRADING=true`, a positive `LIVE_MAX_GROSS_EXPOSURE`, and all other live checks. The autonomous command is restricted to one pair and one strategy per process, and stops on an execution or recovery error. A configuration flag alone does not start trading; the explicit command is also required.

Built-in strategies are `agentic-balanced`, `momentum`, `mean-reversion`, and `capital-preservation`. The `ENGINE_STRATEGIES_JSON` database-profile setting can add profiles or replace a built-in by ID; the dashboard provides a guided strategy editor. Each profile supplies its mandate, minimum confidence, and allowed order types; optional `maxOrderNotional`, `maxPositionNotional`, and `maxGrossExposure` caps let profiles use different risk budgets. Confidence, order-type rules, and risk caps are enforced deterministically after model output. Configure roles and strategies separately so model selection and trading mandate can be benchmarked as separate variables.

For example, `ENGINE_STRATEGIES_JSON=[{"id":"breakout","name":"Volume confirmed breakout","mandate":"Trade only a close above the recent completed range with confirming volume; otherwise HOLD.","minConfidence":0.75,"allowedOrderTypes":["LIMIT"]}]` adds a profile. The natural-language mandate guides the agents; the minimum confidence and allowed order types are hard deterministic gates.

Backtest and shadow commands emit case-by-case JSON performance comparisons. A shadow HTML report aggregates all completed cycles for each isolated virtual portfolio. `--html` writes a self-contained dashboard with normalized equity and drawdown charts, performance scorecards and comparison tables, run configuration and assumptions, decision/evidence/debate detail, risk outcomes, order/fill audit, source snapshots, memory evaluations, and per-step AI usage telemetry. `--audit-limit` bounds the recent run detail embedded in shadow/recent-run dashboards; cumulative performance metrics continue to use the complete stored history. The buy-and-hold baseline enters at the first executable next-bar open and applies configured fee and slippage assumptions on entry and exit; it is a transparent long-only reference, not an investable index.

Performance is attributed to the full agent workflow for each pair/strategy profile. Individual analyst and risk-review roles provide evidence and review proposals; they do not run independent portfolios, so their isolated P&amp;L is not reported.

### Debate and outcome memory

The workflow follows the Python graph order: the four analysts run concurrently; bull then bear researchers alternate for each configured debate round; the research manager synthesizes their findings; the trader creates a candidate; aggressive, conservative, and neutral risk analysts review sequentially for each configured risk round; and the portfolio manager makes the final proposal. Defaults match the Python project's one full bull/bear round and one full three-reviewer risk round. Round limits are 1–10 and every repeated finding is retained in the decision audit with its turn number and prior findings.

Each final BUY, SELL, or HOLD decision creates a pending memory entry. It is scored only after the configured holding window has fully elapsed: entry uses the first completed close after the decision, then the configured number of one-minute bars are held. The memory stores the underlying return, benchmark return, alpha, prices, timestamps, decision thesis, and a short AI-generated reflection. By default the benchmark is BTC paired with the market's quote currency; `MEMORY_BENCHMARK_SYMBOL` can override it. If price history or reflection generation is unavailable, the record stays pending and can be retried on a later cycle. A settled lesson becomes eligible for future agent context only at or after its resolution time; historical backtests apply the same cutoff to prevent future-outcome leakage. The latest five same-pair lessons and three cross-pair lessons for the same mode and strategy are supplied when available.

The default memory horizon is `MEMORY_HOLDING_PERIOD_BARS=7200` (five days in 24/7 crypto markets), the crypto equivalent of the Python engine's five-trading-day default. `report <run-id>` includes pending and settled memory records for audit. These memory returns evaluate the decision's market call versus BTC; they are not account P&amp;L. Use portfolio equity, fees, and fills in backtest/shadow reports to evaluate actual strategy performance.

## Modes and safety

- **Backtest** reads Wallex one-minute OHLCV history and considers completed candles only. A signal from a closed bar can fill no earlier than the next bar's open. Current news, sentiment, tokenomics, and on-chain feeds are excluded because they are not point-in-time historical data. Fee and slippage assumptions are stored in the run report. It does not claim historical order-book, queue-position, or intrabar execution accuracy; the selected language model may also carry knowledge unavailable at the historical decision time.
- **Shadow** uses live Wallex market data, contextual providers, current visible book depth, and an isolated virtual portfolio for every pair/strategy. It has no API path for create/cancel orders.
- **Live** requires the explicit `live` subcommand, live enablement, a dedicated credit-account API key and client ID, an allowlisted active spot market, package restriction lookup, a fresh Wallex price, and a passing deterministic risk check. A fresh risk check is made again immediately before submitting.

Live order submission persists an intent and unique Wallex `client_id` before the POST. A SQLite lease prevents overlapping live or shadow runners; abandoned leases expire after a crash. On a timeout or connection error the engine checks order detail and open orders for the same client ID and never repeats the create request automatically. Unknown or still-open intents pause new trading until status is reconciled. Fills and order details are recorded from Wallex REST responses. API keys are not included in run configurations or reports.

`cancel-order` only accepts a client ID linked to a persisted live-mode intent. It uses the same live-runner lease, cancels the matching Wallex order, and records any fills reported by the exchange. It remains available when live-trading enablement or the risk kill switch blocks new submissions.

Configure caps and switches with `LIVE_MAX_GROSS_EXPOSURE`, `RISK_MAX_ORDER_NOTIONAL`, `RISK_MAX_POSITION_NOTIONAL`, `RISK_MAX_GROSS_EXPOSURE`, `RISK_MAX_DRAWDOWN_PCT`, `RISK_MAX_DAILY_LOSS`, `RISK_MAX_DATA_AGE_SECONDS`, `RISK_FEE_BUFFER_BPS`, `RISK_MAX_MARKET_SLIPPAGE_BPS`, and `RISK_KILL_SWITCH`. `LIVE_MAX_GROSS_EXPOSURE` is an additional live-only hard ceiling on all marked positions in the quote currency, including positions already in the sub-account, plus the proposed order; the effective ceiling is the lowest of it, the general gross-exposure cap, and the strategy cap. It limits exposure taken by this engine, not losses elsewhere or Wallex's separate credit/liquidation behavior. Drawdown and daily-loss gates stop new orders; they do not automatically close a position or guarantee a stop price. A fast price gap can cause a larger loss before another cycle checks risk. Use the credit sub-account exclusively for this engine while it runs so a simultaneous manual order cannot race its balance snapshot. Market quantity and price precision are checked against Wallex metadata; spot sells cannot exceed the recorded available base-asset quantity. Live market orders require fresh visible depth sufficient for the entire order and are rejected when estimated slippage exceeds the configured bound. Account balances are read from Wallex's [credit sub-account balance details endpoint](https://developers.wallex.ir/docs/generated/sub-account-balances-details), and assets that cannot be valued against `WALLEX_QUOTE_CURRENCY` halt live operation.

## Persisted review trail

SQLite migrations create tables for runs, source snapshots, decisions and rationales, risk outcomes, order intents, fills, portfolio snapshots, execution leases, recovery checkpoints, pending/settled decision memories, reflections, and AI model-call telemetry. Each decision stores the quote, research evidence with source/time/confidence, agent findings, selected strategy, final proposal, deterministic risk result, and memory lifecycle. `report <run-id>` includes decision evidence, risk outcomes, linked orders/fills, decision memory scores and reflections, per-step provider/model/token/timing status, and full portfolio history; add `--include-backtest-data` to include historical candles used for the run and its benchmark. Backtests reuse persisted per-bar decisions and checkpoints after a restart, preventing repeated model calls or duplicate simulated fills. Keep SQLite backups with the associated config and dependency lockfile to reproduce a run.

Configured AI providers receive the decision context, including portfolio balances and positions. Run records retain model selections and provider IDs but omit API keys, endpoint URLs, and custom headers.

Run outputs include net return, maximum drawdown, trade count (fills), volume, average fill size, execution reliability, fees grouped by fee asset, quote-currency slippage impact, and stated assumptions.

## Wallex references

- [Spot markets and precision](https://developers.wallex.ir/docs/spot-active-markets)
- [Credit-account spot requirements](https://developers.wallex.ir/docs/spot-intro)
- [Trade-credit overview and terms](https://developers.wallex.ir/docs/trade-credit-intro)
- [Active sub-accounts](https://developers.wallex.ir/docs/generated/active-sub-accounts-list)
- [Trade-credit active sub-account list](https://developers.wallex.ir/docs/trade-credit-active-sub-account-list)
- [Trade-credit account history and `client_id`](https://developers.wallex.ir/docs/trade-credit-sub-account-history)
- [Connect or disconnect the main wallet](https://developers.wallex.ir/docs/trade-credit-connect-wallet)
- [Active trade-credit packages](https://developers.wallex.ir/docs/trade-credit-active-packages)
- [Trade-credit package details and unavailable markets](https://developers.wallex.ir/docs/trade-credit-package-details)
- [Trade-credit eligibility check](https://developers.wallex.ir/docs/trade-credit-condition-check)
- [Create spot order](https://developers.wallex.ir/docs/spot-create-order)
- [Order detail and open orders](https://developers.wallex.ir/docs/spot-single-order-detail)
- [Historical candles](https://developers.wallex.ir/docs/basic-services-candles)
- [Centrifugo v2 sockets and recovery behavior](https://developers.wallex.ir/docs/socket-intro)

## Development checks

```powershell
bun run typecheck
bun test
```
