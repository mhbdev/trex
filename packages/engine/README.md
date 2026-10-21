# Trex Engine

This document explains how the Trex trading engine behaves at runtime: how it collects market evidence, runs the multi-agent workflow, evaluates risk, simulates or submits orders, manages portfolio state, and records an auditable run. It is an operator and architecture guide for the engine package.

Trex uses Wallex for exchange market data and, when explicitly enabled, spot execution on a Wallex credit sub-account. Backtest and shadow modes use virtual portfolios and do not place orders.

## What the engine does

For each requested market and strategy, the engine:

1. Establishes the active market policy and obtains a quote, completed candles, contextual research, and the portfolio snapshot required by that mode.
2. Builds a decision context with source-backed evidence, indicator summaries, the selected strategy, portfolio state, and eligible memory lessons.
3. Runs independent analyst agents, investment debate, synthesis, a trader proposal, risk debate, and a final portfolio decision.
4. Validates the proposal against its schema and strategy mandate, then runs deterministic risk checks.
5. Rechecks risk at the execution boundary and either simulates a paper fill, submits a live order through Wallex, or leaves the portfolio unchanged.
6. Persists the inputs and outputs needed to review the decision, account for the portfolio, recover interrupted work, and reproduce the recorded result from stored data.

The model agents provide research and proposals. They do not have an order submission or cancellation tool. Only the application workflow can call the risk gate, and only the live execution coordinator can reach the order-write adapter.

## Runtime architecture

The engine is a modular monolith. Application use cases depend on typed ports; concrete providers and Wallex/database integrations live behind those ports. The CLI and local dashboard API call engine use cases instead of reimplementing trading decisions.

~~~mermaid
flowchart LR
  operator["Operator"] --> cli["CLI"]
  operator --> ui["Dashboard"]
  ui --> localApi["Loopback dashboard API"]
  cli --> useCases["Engine use cases"]
  localApi --> useCases

  subgraph engine["packages/engine"]
    useCases["Application workflows"]
    domain["Domain types, strategies, indicators, config"]
    workflow["TradingWorkflow"]
    risk["Deterministic risk gate"]
    modes["Backtest, shadow, live modes"]
    useCases --> workflow
    workflow --> domain
    workflow --> risk
    workflow --> modes
  end

  workflow --> modelPort["ModelPort"]
  workflow --> marketPort["MarketDataPort"]
  workflow --> researchPort["ResearchAggregatorPort"]
  modes --> executionPort["OrderExecutionPort"]
  modes --> repositoryPort["RunRepository"]

  modelPort --> aiAdapter["AI SDK model adapter"]
  marketPort --> wallexMarket["Wallex REST market adapter"]
  marketPort -. optional live updates .-> stream["Wallex Centrifugo v2 stream"]
  researchPort --> sources["Configured research providers"]
  executionPort --> wallexOrders["Wallex order adapter"]
  repositoryPort --> sqlite["Drizzle and Bun SQLite"]
~~~

### Important boundaries

- **Domain:** Defines modes, markets, quotes, candles, evidence, findings, proposals, risk results, portfolios, orders, fills, and strategy profiles. It contains deterministic indicators and strategy constraints.
- **Application:** Coordinates use cases. TradingWorkflow owns evidence preparation, agent ordering, memory, proposal validation, and risk checks. Mode runners own their distinct portfolio and execution lifecycle.
- **Ports:** MarketDataPort, ResearchAggregatorPort, ModelPort, OrderExecutionPort, and RunRepository describe capabilities. They keep the workflow independent of a specific provider or storage implementation.
- **Adapters:** Implement those capabilities for Wallex REST and Centrifugo, AI SDK providers, configured JSON research endpoints, encrypted profile secrets, and SQLite.
- **Interfaces:** Commander commands and the local dashboard server are entry points. They share engine services; neither should implement a second trading workflow.

## A decision, from market data to final proposal

### Market policy and evidence

The workflow loads Wallex spot market metadata and normalizes symbols before applying the configured allowlist. In shadow and live modes, if a Wallex package ID and package restriction lookup are configured, markets reported unavailable by that credit package are removed from the effective allowlist. A configured symbol must still be an active spot market and pass package restrictions.

A decision context includes:

- The requested market quote, with source and observation time.
- Completed one-minute candles and deterministic technical indicator summaries.
- Research items with evidence ID, category, source, observation time, confidence, and metadata.
- The current portfolio and selected strategy.
- Recent settled memory lessons for the current mode and strategy context.
- Previous agent findings when the current role is part of an ordered discussion.

Live and shadow decisions reject stale or future-dated quotes before agents run. The deterministic risk gate repeats freshness checks when evaluating an order. Live execution requires a canonical Wallex price. Context providers are supplemental; they do not replace the exchange quote for live authorization.

The hybrid research aggregator calls configured providers concurrently. It validates response schemas, discards stale and future-dated items, deduplicates by an explicit key or by category, source, and title, limits context to five items per category, and returns provider failures as warnings. A failed optional source does not automatically discard successful sources. The warning and accepted source items are persisted for audit.

The AI model adapter uses the AI SDK provider registry and supports OpenAI, Anthropic, Google, OpenAI-compatible endpoints, BoxAPI, and Liara. A default provider/model can be configured, with provider/model routing per agent role. Provider-specific options are applied by the adapter rather than mixed into domain workflows.

### Multi-agent pipeline

The analyst roles run concurrently against the same initial context. Later stages are intentionally ordered because each receives prior findings. The number of bull/bear cycles and risk-review cycles is configurable.

~~~mermaid
flowchart TD
  start["Quote, completed candles, research, portfolio, strategy, memory"] --> analysts

  subgraph analysts["Parallel analyst stage"]
    market["Market and technical analyst"]
    news["News analyst"]
    sentiment["Sentiment analyst"]
    tokenomics["Tokenomics and on-chain analyst"]
  end

  analysts --> debate
  subgraph debate["Investment debate, repeated for configured rounds"]
    bull["Bull researcher"] --> bear["Bear researcher"]
    bear --> nextDebate{"More debate rounds?"}
    nextDebate -->|Yes| bull
  end

  debate --> manager["Research manager synthesizes evidence and disagreement"]
  manager --> trader["Trader proposes a candidate"]
  trader --> riskReview

  subgraph riskReview["Risk debate, repeated for configured rounds"]
    aggressive["Aggressive risk reviewer"] --> conservative["Conservative risk reviewer"]
    conservative --> neutral["Neutral risk reviewer"]
    neutral --> nextRisk{"More risk rounds?"}
    nextRisk -->|Yes| aggressive
  end

  riskReview --> portfolioManager["Portfolio manager creates final proposal"]
  portfolioManager --> schema{"Schema, evidence IDs, strategy constraints"}
  schema -->|Valid BUY or SELL| riskGate["Deterministic risk gate"]
  schema -->|HOLD or strategy constraint| record["Record decision and reasons"]
  riskGate -->|Rejected| record
  riskGate -->|Approved| modeBoundary["Mode-specific execution boundary"]
  modeBoundary --> record
~~~

The debate is real workflow state, not a single prompt labeled multi-agent: each researcher sees analyst work and earlier arguments; each risk reviewer sees the trader candidate and earlier risk findings; the portfolio manager sees the entire thread. The debate-round and risk-round settings change the number of calls and therefore affect latency and model usage.

The AI SDK ToolLoopAgent is used for read-only research tools such as searching supplied evidence and inspecting supplied candles. Findings and proposals are schema validated. Proposal validation also enforces consistency among action, symbol, side, and order presence. The strategy gate can convert a proposal to HOLD when confidence is below the strategy minimum or the order type is not allowed. Evidence IDs not present in the decision context are removed.

### Strategy profiles

A strategy profile is a mandate and a set of deterministic constraints, not an independent execution algorithm. It can specify minimum proposal confidence, allowed order types, and tighter order, position, or gross-exposure limits. Built-in profiles include agentic-balanced, momentum, mean-reversion, and capital-preservation. User-defined profiles can be added through configuration.

The same market evidence and agent workflow is used for the selected profile; the mandate is included in the model context, and hard strategy restrictions are enforced by the application after the model responds. The risk gate combines strategy limits with engine limits by taking the stricter applicable cap.

## The deterministic risk gate

An AI proposal is never an authorization. For a non-HOLD order, the risk gate validates:

- The symbol is allowlisted, active for spot, and available under the configured package policy where applicable.
- Quote currency matches the portfolio; quote is valid, matching, fresh, and not future-dated. Live requires a Wallex-sourced quote.
- Portfolio equity is positive, and drawdown and daily-loss constraints have not stopped new exposure.
- Order quantity and price are positive, finite, and within Wallex market precision and minimums.
- Order notional, resulting position notional, and gross exposure remain within configured caps.
- A spot sell does not exceed available position quantity.
- A buy is funded by available quote-currency cash including a fee buffer.
- Live market orders and all shadow orders have fresh visible order-book depth sufficient to estimate the requested quantity. Estimated adverse slippage must fit the configured bound.

For live mode, the effective gross-exposure ceiling is the tightest of the general risk cap, strategy cap, and explicit live gross-exposure cap. Live configuration validation also requires explicit live enablement and required credentials/configuration.

Risk is checked after the portfolio manager's proposal and checked again immediately before the mode's fill or live submission using the latest available state. Each check and its reasons are persisted. HOLD has no eligible order; a rejected BUY/SELL retains its proposal and rejection reasons for review.

Risk limits stop new orders; they do not automatically liquidate an existing position or guarantee an exit price. A quote-currency exposure ceiling does not cap losses elsewhere in a credit account or override Wallex credit/liquidation rules.

## The three operating modes

All three modes use the same agent and deterministic risk workflow. They differ in the time source, portfolio, and what can happen after risk approval.

~~~mermaid
flowchart LR
  request["Run symbol and strategy"] --> common["Shared evidence and multi-agent workflow"]
  common --> proposal["Final proposal"]
  proposal --> risk["Deterministic proposal risk check"]

  risk --> backtestMode
  subgraph backtestMode["Backtest"]
    history["Historical completed Wallex 1m candles"] --> replay["Replay at each completed bar"]
    replay --> nextOpen["Earliest simulated fill: next bar open"]
    nextOpen --> backPortfolio["Backtest virtual portfolio"]
  end

  risk --> shadowMode
  subgraph shadowMode["Shadow"]
    liveData["Current Wallex market data"] --> book["Fresh visible depth"]
    book --> paperFill["Estimated paper fill"]
    paperFill --> shadowPortfolio["Persistent virtual portfolio per market and strategy"]
  end

  risk --> liveMode
  subgraph liveMode["Live"]
    liveAccount["Wallex credit sub-account balance"] --> freshState["Refresh account, quote, and risk"]
    freshState --> intent["Persist idempotent order intent"]
    intent --> exchange["Wallex order submission"]
    exchange --> livePortfolio["Wallex balance and fill records"]
  end

  backPortfolio --> report["Persist audit trail and report"]
  shadowPortfolio --> report
  livePortfolio --> report
~~~

### Backtest

A backtest fetches or accepts a fixed dataset of completed Wallex one-minute candles, filters it to the requested interval, sorts it, and stores the exact dataset with the run. For each bar, it:

1. Marks the virtual portfolio using that completed bar's close.
2. Makes the decision with candles available only through that bar.
3. Rechecks the proposal against the simulated portfolio at the next bar's open.
4. Simulates a fill at that next open with configured fee and slippage assumptions and updates the portfolio.
5. Saves the equity point and a recovery checkpoint before advancing to the next bar.

The last bar is used for final valuation; it cannot create a new fill because no following bar is available. A resumed run uses the stored dataset, previous decisions, and checkpoint. This avoids regenerating completed decisions and simulated fills after a restart.

Current news, sentiment, tokenomics, and on-chain feeds are not replayed as historical; doing so would introduce lookahead bias. The backtest therefore assesses candle/indicator-driven behavior, not access to today's contextual sources in the past. Historical OHLCV cannot recreate the historical order book, queue position, or exchange latency. Fees and slippage are explicit assumptions in the run configuration and report.

~~~mermaid
sequenceDiagram
  participant Replay as Candle replay
  participant Agents as Trading workflow
  participant Risk as Risk gate
  participant Sim as Fill simulator
  participant Portfolio as Virtual portfolio
  participant Store as Run repository

  Replay->>Replay: Complete bar t
  Replay->>Portfolio: Mark at close of bar t
  Replay->>Agents: Supply bars only through t
  Agents-->>Replay: Persisted decision proposal
  Replay->>Risk: Recheck using next bar t+1 open
  Risk-->>Replay: Approved or rejected
  alt Approved and valid
    Replay->>Sim: Apply fee and slippage assumptions
    Sim-->>Portfolio: Simulated fill, no exchange order
  end
  Replay->>Store: Save portfolio, equity point, checkpoint
  Note over Replay,Sim: No fill can occur before the next bar
~~~

### Shadow

Shadow mode uses live Wallex market data and a dedicated virtual portfolio keyed by market and strategy. It marks existing positions from current quotes, runs the decision workflow, and if an order passes the initial and execution-time risk checks, estimates a paper fill by walking the visible book. Configured fees and slippage are applied, then the simulated fill updates virtual cash, positions, realized P&L, equity, and high-water mark.

The shadow runner does not construct or receive an OrderExecutionPort; it cannot place or cancel a Wallex order. Order intents and fill inputs are still persisted so an interrupted paper execution can be recovered without repeating the model decision or losing the virtual accounting event. An execution lease prevents concurrent runners from mutating the same shadow state.

Shadow is useful for live operational checks: market discovery, freshness, strategy behavior, agent/model calls, risk checks, depth availability, portfolio accounting, and report generation. It is not a guarantee of live execution. Visible depth can change; the estimate does not model queue priority, hidden liquidity, real network latency, actual exchange acceptance, or unmodeled market impact.

### Live and autonomous auto-trading

A live cycle is one decision cycle. It validates live configuration, acquires the live execution lease, loads package market restrictions, reconciles pending order intents, reads the credit sub-account portfolio, gets fresh market data, and runs the same agent and risk workflow. Before a live order, it reads the account and quote again and runs the execution-time risk gate against refreshed state.

Only after these checks can the coordinator call Wallex. A successful submission is not assumed to be a fill: exchange order state and fill records remain authoritative. The cycle refreshes the account after execution when possible and records its portfolio snapshot and report.

Autonomous auto-trading is the operator explicitly scheduling repeated live cycles for the selected market and strategy. It is not an additional AI permission or a separate path around risk: each cycle must independently pass current market policy, portfolio checks, and the deterministic risk gate. Live enablement and auto-trading enablement are separate settings. The interface should clearly identify one-shot live execution versus repeated autonomous operation and require explicit opt-in for both.

### Mode comparison

| Property | Backtest | Shadow | Live |
| --- | --- | --- | --- |
| Price and candles | Stored historical Wallex one-minute candles | Current Wallex market data | Current Wallex market data |
| Portfolio | Backtest-only virtual portfolio | Persistent virtual portfolio per market and strategy | Wallex credit sub-account state |
| Research context | Historical candles and derived evidence; current contextual feeds omitted | Configured current contextual feeds may be included | Configured current contextual feeds may be included |
| Fill basis | Next bar open, with configured fee and slippage | Visible depth snapshot plus configured fee and slippage | Wallex order and fill responses |
| Order-write capability | None | None | Wallex order adapter |
| Primary validation | Historical strategy behavior under declared assumptions | Current end-to-end decisions, operations, and paper accounting | Actual exchange interaction and order lifecycle |
| Key limitation | Candle replay cannot model historical book/queue | Paper execution is an estimate | Exchange execution and credit-account risk are real |

## Live order safety and restart recovery

The live coordinator follows a durable intent protocol. It records the unique client order ID and proposed order before sending an order-write request. An ambiguous response is reconciled by client ID through order detail and open orders. It does not automatically issue a second create-order request for that ID. If status cannot be confirmed, the intent remains unresolved and later live cycles pause until reconciliation resolves it.

~~~mermaid
sequenceDiagram
  participant Gate as Risk-approved workflow
  participant DB as SQLite repository
  participant Coordinator as Live execution coordinator
  participant Wallex as Wallex REST

  Gate->>Coordinator: Approved normalized order
  Coordinator->>DB: Create durable intent with unique client ID
  DB-->>Coordinator: Intent stored
  Coordinator->>Wallex: Submit order once
  alt Definitive rejection
    Wallex-->>Coordinator: Rejected response
    Coordinator->>DB: Mark intent rejected
  else Response received
    Wallex-->>Coordinator: Order state and fills
    Coordinator->>DB: Persist state and fills
  else Timeout or ambiguous response
    Wallex--xCoordinator: Response unknown
    Coordinator->>Wallex: Query order detail by client ID
    Coordinator->>Wallex: Check open orders if needed
    alt Found
      Wallex-->>Coordinator: Exchange state
      Coordinator->>DB: Persist reconciled state and fills
    else Still unknown
      Coordinator->>DB: Keep intent unresolved
      Note over Coordinator,DB: Do not resubmit; pause later live cycles
    end
  end
~~~

Live and shadow runners use SQLite execution leases to avoid concurrent state mutation. Leases have an expiry and a guard that renews ownership. On startup, interrupted runs are marked failed for audit, and live order reconciliation is performed before new trading. Shadow recovery replays previously persisted fill inputs against its virtual portfolio when a paper intent was pending.

Use a Wallex API key scoped to the credit sub-account, with only the needed read and trade permissions. Never grant withdrawal permission to the engine key. The challenge package's unavailable markets are part of the live allowlist decision. The configured live exposure cap limits what the engine may hold under its own checks; it cannot guarantee a maximum account loss.

## Decision memory and reflection

Memory is a measured feedback loop, not an automatic strategy optimizer:

1. Every decision stores a pending memory record, including HOLD and risk-rejected proposals, with the action, rationale, confidence, decision quote, benchmark, context key, and configured holding period.
2. On later workflow evaluations, matured memories for that mode and strategy context are settled from completed Wallex candles. The benchmark is either configured or inferred as BTC in the same quote currency.
3. The engine computes the subject return, benchmark return, and excess return (alpha) over the memory holding period.
4. A reflector model writes a concise lesson using the recorded decision and measured outcome. The settled return and reflection are persisted and may be supplied as context to later decisions.

Recent lessons are selected with same-market and cross-market limits. If data is unavailable or a reflection call fails, the memory remains pending for a later attempt and a warning is recorded. Memory informs agent reasoning, but it does not change risk limits, confidence thresholds, or strategy settings automatically.

~~~mermaid
flowchart LR
  decision["Persist decision and pending memory"] --> wait["Wait until holding horizon is mature"]
  wait --> candles["Load completed subject and benchmark candles"]
  candles --> returns["Measure raw return, benchmark return, and alpha"]
  returns --> reflect["Reflector summarizes the outcome"]
  reflect --> lesson["Persist settled outcome and lesson"]
  lesson --> context["Supply selected lessons to later agent context"]
  context --> next["Next decision"]
  next --> decision
~~~

## Portfolio accounting and reports

Backtest and shadow use VirtualPortfolio, with decimal arithmetic for cash, positions, average entry, fees, realized P&L, marks, equity, high-water mark, and daily risk history. Shadow portfolios persist across cycles for each market/strategy key; they are separate from the exchange wallet. Live portfolio state is read from the Wallex credit sub-account and interpreted using actual account and fill responses.

Each report summarizes the portfolio path and execution outcomes. Depending on mode and available data, it includes:

- Initial and final equity, net return, and maximum drawdown.
- Fill count, traded volume, average fill size, fees by asset, and estimated or measured slippage.
- Accepted proposals and execution reliability when there were eligible proposals.
- Symbol, strategy, quote currency, timestamps, equity curve, and explicit simulation assumptions.
- For backtests, buy-and-hold comparison and excess return where available.

Detailed run audit data is available separately from headline metrics: per-decision evidence and findings, final proposal, all risk checks and reasons, order intent state, exchange order and fills, portfolio snapshots, memory outcome/reflection, source snapshots/provider warnings, and per-step AI model-call telemetry. AI call records include provider/model, operation and role, timing, token usage when returned, tool names, status, and sanitized error details.

A headline return alone is not sufficient to assess readiness. Inspect decisions and risk outcomes, check whether data sources were fresh and available, and compare simulated fill assumptions with target execution conditions. A shadow report is a paper-trading estimate; it does not assert that a live account would receive the same fills or return.

## Persistence and reproducibility

The SQLite schema and migrations are under drizzle/ and src/adapters/persistence/. The repository stores:

- Run configuration snapshots, status, report, code revision when supplied, and failure audit.
- Source snapshots for market inputs, research evidence, warnings, and mode-specific replay data.
- Agent decisions, evidence, findings, proposals, and risk outcomes.
- Durable order intents, Wallex exchange order state, and fills.
- Portfolio snapshots and backtest recovery checkpoints.
- Pending and settled decision memories and reflections.
- AI model call records and execution leases.
- Named configuration profiles and encrypted profile-secret envelopes.

A run config snapshot records the settings needed to understand the run while omitting secret values and sensitive provider URLs/headers. Keep a backup of SQLite with the project revision and dependency lockfile when preserving a reproducible audit package. Backtest candles and benchmark candles are persisted so a resumed replay does not silently fetch a different dataset.

Profile secrets are encrypted with AES-256-GCM. The encryption key must be supplied outside SQLite by the process environment or a secret manager. Without the correct key, secret access must fail closed.

## Provider and exchange adapters

### AI model providers

The AI adapter registers providers and chooses a provider/model for each role. The engine supports standard providers and OpenAI-compatible gateways such as BoxAPI and Liara. Role-specific model routing permits using a lower-cost model for simple analysis and a stronger model for the portfolio manager without changing the workflow.

Provider compatibility varies. Structured output and tool use depend on the configured endpoint/model; they are not universal guarantees. The adapter schema-validates returned findings and proposals, and unsupported provider options or tool calls fail the model step rather than authorizing a trade. Model call telemetry is attached to the run for cost and latency inspection.

### Wallex market data and order execution

The Wallex REST adapter supplies spot market metadata and precision, canonical quotes, depth, one-minute candles, credit-account portfolio state, package restrictions, and order lifecycle operations. The public Centrifugo v2 adapter handles configured price and book updates and obtains REST snapshots on connection and reconnect to resynchronize because stream channels may not replay missed events.

For credit-account spot requests, the adapter uses the dedicated sub-account API key and sends the configured sub-account client ID in Wallex's sub-account header. The package ID identifies the active credit package whose market restrictions are checked; it is distinct from the sub-account client ID and is not a trading credential. The configured market allowlist is intersected with active spot markets and any package-unavailable markets before an order can pass risk checks.

Market data and order writes are separate ports. Backtest and shadow runners receive market data and a repository but no order execution adapter. Live receives the execution adapter only after live configuration validation and explicit operator selection.

### Research providers

Configured JSON endpoints implement the research-provider port. Each endpoint declares supported categories, timeout and maximum item age, and can supply headers. Responses are size-limited and schema-validated. Sources should return item-level source and time metadata; the engine cannot independently prove the truth of provider claims.

## Operations and failure behavior

- **Stale market data:** Live/shadow decisions are rejected or not produced when quotes are stale; relevant order depth must also be fresh at risk time.
- **Optional research outage:** Successful providers continue; provider warning snapshots remain attached to the run. Agents are told to lower confidence when data is inadequate, and deterministic proposal/risk rules still apply.
- **Invalid model response:** Schema errors fail that model operation; they do not become a default trade.
- **Exchange market or precision change:** Current market metadata and normalized precision are used by the risk check; a disabled or invalid market is rejected.
- **Order timeout:** Reconcile by the persisted client ID. Do not repeat an ambiguous order submission.
- **Process interruption:** Backtest resumes from dataset, decisions, and checkpoints. Shadow attempts to recover pending paper fills from saved inputs. Live reconciles exchange intents before allowing another cycle.
- **Kill switch:** Rejects new trade proposals at the deterministic risk gate. It does not close open positions.
- **Stop request:** A backtest checks between bars; a live cycle checks before submitting an approved order. A stop cannot undo an order already accepted by Wallex.

## Code map

| Area | Implementation |
| --- | --- |
| Domain entities, modes, evidence, risk and proposal schemas | **src/domain/types.ts** |
| Strategy schemas, built-ins, constraints and limits | **src/domain/strategies.ts** |
| Market symbol normalization and technical indicators | **src/domain/market-symbol.ts**, **src/domain/indicators.ts** |
| Configuration schema and mode validation | **src/domain/config.ts** |
| Full agent pipeline and proposal/execution risk checks | **src/application/trading-workflow.ts** |
| Research validation, filtering, deduplication and aggregation | **src/application/research-aggregator.ts** |
| Deterministic order-risk calculations | **src/application/risk-gate.ts** |
| Virtual portfolio math | **src/application/portfolio.ts** |
| Live order intent, reconciliation and simulated shadow fills | **src/application/live-execution.ts** |
| Decision memory settlement and reflections | **src/application/decision-memory.ts** |
| Backtest replay and checkpoint recovery | **src/modes/backtest.ts**, **src/modes/backtest-fill.ts** |
| Shadow portfolio cycle and paper-fill recovery | **src/modes/shadow.ts** |
| Live cycle lifecycle | **src/modes/live.ts** |
| AI SDK registry, tools, schema output and telemetry | **src/adapters/ai/model.ts** |
| Wallex REST and Centrifugo adapters | **src/adapters/wallex/rest.ts** |
| Drizzle SQLite schema and repository | **src/adapters/persistence/schema.ts**, **src/adapters/persistence/store.ts** |
| Secret encryption for profiles | **src/adapters/security/secret-vault.ts** |
| Local dashboard API | **src/adapters/http/local-dashboard-server.ts** |

## Reading this alongside the project README

This document focuses on engine runtime and trading behavior. The repository [README](../../README.md) covers installation, CLI commands, configuration setup, Wallex credit identifiers, and operator-facing workflows.

