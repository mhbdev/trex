import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Database } from "bun:sqlite";
import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { eq, desc } from "drizzle-orm";
import * as schema from "./schema.ts";
import type { EngineMode, ExchangeOrder, OrderIntent, PortfolioState, RiskResult, RunReport, TradeDecision, PendingDecisionMemory, SettledDecisionMemory } from "../../domain/types.ts";
import type { AiModelCallRecord, RunAuditDetails, RunRepository, StoredConfigProfile, StoredSecretEnvelope } from "../../application/ports.ts";

export class SqliteRunRepository implements RunRepository {
  private readonly sqlite: Database;
  private readonly db: BunSQLiteDatabase<typeof schema>;

  constructor(databaseUrl: string) {
    const filePath = databaseUrl.startsWith("file:") ? databaseUrl.slice(5) : databaseUrl;
    if (filePath !== ":memory:") mkdirSync(dirname(resolve(filePath)), { recursive: true });
    this.sqlite = new Database(filePath);
    this.sqlite.run("PRAGMA journal_mode = WAL");
    this.sqlite.run("PRAGMA synchronous = FULL");
    this.sqlite.run("PRAGMA busy_timeout = 5000");
    this.sqlite.run("PRAGMA foreign_keys = ON");
    this.db = drizzle(this.sqlite, { schema });
  }

  migrate(folder = resolve(import.meta.dir, "../../../drizzle")): void { migrate(this.db, { migrationsFolder: folder }); }

  createRun(input: { id: string; mode: EngineMode; config: Record<string, unknown>; startedAt: number; gitRevision?: string }): void {
    this.db.insert(schema.runs).values({
      id: input.id, mode: input.mode, status: "running", configJson: JSON.stringify(input.config),
      gitRevision: input.gitRevision ?? null, startedAt: input.startedAt,
    }).run();
  }
  failInterruptedRuns(mode: EngineMode, endedAt: number): void {
    this.sqlite.query("UPDATE runs SET status = 'failed', ended_at = ?, failure_name = 'InterruptedRun', failure_message = 'The run did not finalize before recovery by a later engine process; inspect the original process output for its cause.' WHERE mode = ? AND status = 'running'").run(endedAt, mode);
  }
  finishRun(id: string, endedAt: number, status: "completed" | "failed", report?: Record<string, unknown>, failure?: { name: string; message: string }): void {
    this.db.update(schema.runs).set({
      endedAt, status, reportJson: report ? JSON.stringify(report) : null,
      failureName: status === "failed" ? failure?.name ?? "UnknownError" : null,
      failureMessage: status === "failed" ? failure?.message ?? "The run failed without a captured error detail." : null,
    }).where(eq(schema.runs.id, id)).run();
  }
  saveSnapshot(input: { runId: string; category: string; source: string; symbol: string; observedAt: number; payload: unknown }): string {
    const id = randomUUID();
    const { payload, ...row } = input;
    this.db.insert(schema.sourceSnapshots).values({ id, ...row, payloadJson: JSON.stringify(payload) }).run();
    return id;
  }
  loadSnapshot(runId: string, category: string): unknown | null {
    const row = this.sqlite.query("SELECT payload_json FROM source_snapshots WHERE run_id = ? AND category = ? ORDER BY observed_at DESC LIMIT 1").get(runId, category) as { payload_json: string } | null;
    return row ? JSON.parse(row.payload_json) : null;
  }
  saveDecision(decision: TradeDecision): void {
    this.db.insert(schema.decisions).values({
      id: decision.id, runId: decision.runId, symbol: decision.symbol, decidedAt: decision.decidedAt,
      quoteJson: JSON.stringify(decision.quote), evidenceJson: JSON.stringify(decision.evidence),
      findingsJson: JSON.stringify(decision.findings), proposalJson: JSON.stringify(decision.proposal),
      riskJson: JSON.stringify(decision.risk), orderClientId: decision.orderClientId ?? null,
    }).run();
  }
  saveDecisionAndMemory(decision: TradeDecision, memory: PendingDecisionMemory): void {
    this.sqlite.transaction(() => {
      this.saveDecision(decision);
      this.savePendingDecisionMemory(memory);
    })();
  }
  getDecisionAt(runId: string, symbol: string, decidedAt: number): TradeDecision | null {
    const row = this.sqlite.query(`SELECT * FROM decisions WHERE run_id = ? AND symbol = ? AND decided_at = ? ORDER BY rowid LIMIT 1`)
      .get(runId, symbol, decidedAt) as {
        id: string; run_id: string; symbol: string; decided_at: number; quote_json: string; evidence_json: string;
        findings_json: string; proposal_json: string; risk_json: string; order_client_id: string | null;
      } | null;
    if (!row) return null;
    return {
      id: row.id, runId: row.run_id, symbol: row.symbol, decidedAt: row.decided_at,
      quote: JSON.parse(row.quote_json), evidence: JSON.parse(row.evidence_json), findings: JSON.parse(row.findings_json),
      proposal: JSON.parse(row.proposal_json), risk: JSON.parse(row.risk_json),
      ...(row.order_client_id ? { orderClientId: row.order_client_id } : {}),
    };
  }
  saveRiskOutcome(decisionId: string, result: RiskResult): void {
    this.db.insert(schema.riskOutcomes).values({
      id: randomUUID(), decisionId, approved: result.approved, reasonsJson: JSON.stringify(result.reasons),
      resultJson: JSON.stringify(result), checkedAt: result.checkedAt,
    }).run();
  }
  saveOrderIntent(intent: OrderIntent): void {
    this.db.insert(schema.orderIntents).values({
      clientOrderId: intent.clientOrderId, runId: intent.runId, decisionId: intent.decisionId,
      orderJson: JSON.stringify(intent.order), portfolioKey: intent.portfolioKey ?? "default", state: intent.state, exchangeOrderJson: null,
      createdAt: intent.createdAt, updatedAt: intent.createdAt,
    }).onConflictDoNothing().run();
  }
  createOrderIntent(intent: OrderIntent): boolean {
    const result = this.sqlite.query(`INSERT INTO order_intents
      (client_order_id, run_id, decision_id, order_json, portfolio_key, state, exchange_order_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?) ON CONFLICT(client_order_id) DO NOTHING`)
      .run(intent.clientOrderId, intent.runId, intent.decisionId, JSON.stringify(intent.order), intent.portfolioKey ?? "default", intent.state, intent.createdAt, intent.createdAt);
    return result.changes === 1;
  }
  getOrderIntent(clientOrderId: string): OrderIntent | null {
    const row = this.sqlite.query("SELECT * FROM order_intents WHERE client_order_id = ?").get(clientOrderId) as {
      client_order_id: string; run_id: string; decision_id: string; order_json: string; portfolio_key: string; state: OrderIntent["state"]; created_at: number;
    } | null;
    return row ? {
      clientOrderId: row.client_order_id, runId: row.run_id, decisionId: row.decision_id,
      order: JSON.parse(row.order_json), state: row.state, createdAt: row.created_at, portfolioKey: row.portfolio_key,
    } : null;
  }
  getPendingOrderIntents(mode: EngineMode, portfolioKey?: string): OrderIntent[] {
    const rows = this.sqlite.query(`SELECT oi.* FROM order_intents oi JOIN runs r ON r.id = oi.run_id
      WHERE r.mode = ? AND oi.state IN ('pending', 'submitted', 'reconciling') AND (? IS NULL OR oi.portfolio_key = ?) ORDER BY oi.created_at`)
      .all(mode, portfolioKey ?? null, portfolioKey ?? null) as Array<{
      client_order_id: string; run_id: string; decision_id: string; order_json: string; portfolio_key: string; state: OrderIntent["state"]; created_at: number;
    }>;
    return rows.map((row) => ({
      clientOrderId: row.client_order_id, runId: row.run_id, decisionId: row.decision_id,
      order: JSON.parse(row.order_json), state: row.state, createdAt: row.created_at, portfolioKey: row.portfolio_key,
    }));
  }
  updateOrderIntent(clientOrderId: string, state: OrderIntent["state"], order?: ExchangeOrder): void {
    this.db.update(schema.orderIntents).set({
      state, exchangeOrderJson: order ? JSON.stringify(order) : undefined, updatedAt: Date.now(),
    }).where(eq(schema.orderIntents.clientOrderId, clientOrderId)).run();
  }
  saveFills(order: ExchangeOrder): void {
    for (const fill of order.fills) {
      this.db.insert(schema.fills).values({
        id: fill.id, orderClientId: fill.orderClientId, symbol: fill.symbol, side: fill.side,
        quantity: fill.quantity, price: fill.price, fee: fill.fee, feeAsset: fill.feeAsset, timestamp: fill.timestamp,
      }).onConflictDoNothing().run();
    }
  }
  saveShadowExecution(clientOrderId: string, portfolioRunId: string, order: ExchangeOrder, portfolio: PortfolioState, portfolioKey = "default"): void {
    this.sqlite.transaction(() => {
      this.sqlite.query("UPDATE order_intents SET state = 'resolved', exchange_order_json = ?, updated_at = ? WHERE client_order_id = ?")
        .run(JSON.stringify(order), order.updatedAt, clientOrderId);
      for (const fill of order.fills) {
        this.sqlite.query(`INSERT OR IGNORE INTO fills (id, order_client_id, symbol, side, quantity, price, fee, fee_asset, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(fill.id, fill.orderClientId, fill.symbol, fill.side, fill.quantity, fill.price, fill.fee, fill.feeAsset, fill.timestamp);
      }
      this.sqlite.query(`INSERT INTO portfolio_snapshots (id, run_id, portfolio_key, observed_at, cash, equity, positions_json, quote_currency, high_watermark, realized_pnl_today, day_start_equity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(randomUUID(), portfolioRunId, portfolioKey, portfolio.observedAt, portfolio.cash, portfolio.equity, JSON.stringify(portfolio.positions), portfolio.quoteCurrency,
          portfolio.highWatermark, portfolio.realizedPnlToday, portfolio.dayStartEquity ?? portfolio.equity);
    })();
  }
  savePortfolio(runId: string, portfolio: PortfolioState, portfolioKey = "default"): void {
    this.db.insert(schema.portfolioSnapshots).values({
      id: randomUUID(), runId, portfolioKey, observedAt: portfolio.observedAt, cash: portfolio.cash, equity: portfolio.equity,
      positionsJson: JSON.stringify(portfolio.positions), quoteCurrency: portfolio.quoteCurrency, highWatermark: portfolio.highWatermark,
      realizedPnlToday: portfolio.realizedPnlToday, dayStartEquity: portfolio.dayStartEquity ?? portfolio.equity,
    }).run();
  }
  getLatestPortfolio(mode: EngineMode, portfolioKey = "default"): PortfolioState | null {
    const row = this.sqlite.query("SELECT p.* FROM portfolio_snapshots p JOIN runs r ON r.id = p.run_id WHERE r.mode = ? AND p.portfolio_key = ? ORDER BY p.observed_at DESC LIMIT 1").get(mode, portfolioKey) as {
      observed_at: number; cash: string; equity: string; positions_json: string; quote_currency: string; high_watermark: string; realized_pnl_today: string; day_start_equity: string;
    } | null;
    if (!row) return null;
    return {
      quoteCurrency: row.quote_currency, cash: row.cash, equity: row.equity, positions: JSON.parse(row.positions_json),
      highWatermark: row.high_watermark, realizedPnlToday: row.realized_pnl_today,
      dayStartEquity: row.day_start_equity, observedAt: row.observed_at,
    };
  }
  getPortfolioHistory(runId: string, throughTimestamp = Number.MAX_SAFE_INTEGER): { timestamp: number; equity: string }[] {
    return this.sqlite.query("SELECT observed_at, equity FROM portfolio_snapshots WHERE run_id = ? AND observed_at <= ? ORDER BY observed_at, rowid")
      .all(runId, throughTimestamp).map((row) => {
        const point = row as { observed_at: number; equity: string };
        return { timestamp: point.observed_at, equity: point.equity };
      });
  }
  getOrderHistory(runId: string): ExchangeOrder[] {
    const rows = this.sqlite.query("SELECT exchange_order_json FROM order_intents WHERE run_id = ? AND exchange_order_json IS NOT NULL ORDER BY created_at, rowid")
      .all(runId) as Array<{ exchange_order_json: string }>;
    return rows.map((row) => JSON.parse(row.exchange_order_json) as ExchangeOrder);
  }
  getRunReportsForPortfolioKey(mode: EngineMode, symbol: string, strategyId: string): RunReport[] {
    const rows = this.sqlite.query(`SELECT r.report_json, r.config_json FROM runs r
      WHERE r.mode = ? AND r.status = 'completed' AND r.report_json IS NOT NULL
        AND upper(json_extract(r.config_json, '$.symbol')) = upper(?)
        AND coalesce(json_extract(r.config_json, '$.strategy.id'), 'agentic-balanced') = ?
      ORDER BY r.started_at, r.id`).all(mode, symbol, strategyId) as Array<{ report_json: string; config_json: string }>;
    return rows.map((row) => {
      const report = JSON.parse(row.report_json) as RunReport;
      const config = JSON.parse(row.config_json) as { symbol?: string; strategy?: { id?: string }; wallex?: { quoteCurrency?: string } };
      const normalizedSymbol = report.symbol ?? config.symbol;
      const normalizedStrategy = report.strategyId ?? config.strategy?.id ?? "agentic-balanced";
      const normalizedQuoteCurrency = report.quoteCurrency ?? config.wallex?.quoteCurrency;
      return {
        ...report,
        ...(normalizedSymbol ? { symbol: normalizedSymbol } : {}),
        strategyId: normalizedStrategy,
        ...(normalizedQuoteCurrency ? { quoteCurrency: normalizedQuoteCurrency } : {}),
      };
    });
  }
  saveCheckpoint(runId: string, key: string, payload: unknown, updatedAt: number): void {
    this.sqlite.query("INSERT INTO checkpoints (run_id, key, payload_json, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(run_id, key) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at")
      .run(runId, key, JSON.stringify(payload), updatedAt);
  }
  loadCheckpoint(runId: string, key: string): unknown | null {
    const row = this.sqlite.query("SELECT payload_json FROM checkpoints WHERE run_id = ? AND key = ?").get(runId, key) as { payload_json: string } | null;
    return row ? JSON.parse(row.payload_json) : null;
  }
  saveReflection(runId: string, symbol: string, content: string, createdAt: number, contextKey = "legacy"): void {
    this.db.insert(schema.reflections).values({ id: randomUUID(), runId, symbol, content, contextKey, createdAt }).run();
  }
  getReflections(symbol: string, limit: number, contextKey = "legacy"): string[] {
    return this.sqlite.query("SELECT content FROM reflections WHERE symbol = ? AND context_key = ? ORDER BY created_at DESC LIMIT ?")
      .all(symbol, contextKey, limit).map((row) => (row as { content: string }).content);
  }
  savePendingDecisionMemory(memory: PendingDecisionMemory): void {
    this.db.insert(schema.decisionMemories).values({
      decisionId: memory.decisionId, runId: memory.runId, symbol: memory.symbol, contextKey: memory.contextKey,
      action: memory.action, decisionText: memory.decisionText, entryReferencePrice: memory.entryReferencePrice,
      benchmarkSymbol: memory.benchmarkSymbol, decidedAt: memory.decidedAt, holdingPeriodBars: memory.holdingPeriodBars,
      dueAt: memory.dueAt, status: "pending",
    }).onConflictDoNothing().run();
  }
  getMaturedDecisionMemories(contextKey: string, asOf: number): PendingDecisionMemory[] {
    const rows = this.sqlite.query(`SELECT decision_id, run_id, symbol, context_key, action, decision_text,
      entry_reference_price, benchmark_symbol, decided_at, holding_period_bars, due_at
      FROM decision_memories WHERE context_key = ? AND status = 'pending' AND due_at <= ? ORDER BY due_at, decided_at`)
      .all(contextKey, asOf) as Array<{
        decision_id: string; run_id: string; symbol: string; context_key: string; action: PendingDecisionMemory["action"];
        decision_text: string; entry_reference_price: string; benchmark_symbol: string; decided_at: number;
        holding_period_bars: number; due_at: number;
      }>;
    return rows.map((row) => ({
      decisionId: row.decision_id, runId: row.run_id, symbol: row.symbol, contextKey: row.context_key,
      action: row.action, decisionText: row.decision_text, entryReferencePrice: row.entry_reference_price,
      benchmarkSymbol: row.benchmark_symbol, decidedAt: row.decided_at, holdingPeriodBars: row.holding_period_bars,
      dueAt: row.due_at,
    }));
  }
  settleDecisionMemory(decisionId: string, outcome: Omit<SettledDecisionMemory, "decisionId" | "runId" | "symbol" | "contextKey" | "action" | "decisionText" | "entryReferencePrice" | "benchmarkSymbol" | "decidedAt" | "holdingPeriodBars" | "dueAt" | "status">): boolean {
    return this.sqlite.transaction(() => {
      const update = this.sqlite.query(`UPDATE decision_memories SET status = 'settled', entry_price = ?, exit_price = ?,
        benchmark_entry_price = ?, benchmark_exit_price = ?, raw_return = ?, benchmark_return = ?, alpha_return = ?,
        resolved_at = ?, reflection = ? WHERE decision_id = ? AND status = 'pending' AND due_at <= ?`)
        .run(outcome.entryPrice, outcome.exitPrice, outcome.benchmarkEntryPrice, outcome.benchmarkExitPrice,
          outcome.rawReturn, outcome.benchmarkReturn, outcome.alphaReturn, outcome.resolvedAt, outcome.reflection,
          decisionId, outcome.resolvedAt);
      if (update.changes !== 1) return false;
      const memory = this.sqlite.query("SELECT run_id, symbol, context_key FROM decision_memories WHERE decision_id = ?")
        .get(decisionId) as { run_id: string; symbol: string; context_key: string };
      this.db.insert(schema.reflections).values({
        id: randomUUID(), runId: memory.run_id, symbol: memory.symbol, contextKey: memory.context_key,
        content: outcome.reflection, createdAt: outcome.resolvedAt,
      }).run();
      return true;
    })();
  }
  getDecisionMemoryLessons(symbol: string, contextKey: string, asOf: number, sameSymbolLimit: number, crossSymbolLimit: number): string[] {
    const read = (sameSymbol: boolean, limit: number) => this.sqlite.query(`SELECT symbol, action, decision_text, raw_return,
      benchmark_return, alpha_return, benchmark_symbol, holding_period_bars, resolved_at, reflection
      FROM decision_memories WHERE context_key = ? AND status = 'settled' AND resolved_at <= ?
      AND ${sameSymbol ? "symbol = ?" : "symbol != ?"} ORDER BY resolved_at DESC, decision_id DESC LIMIT ?`)
      .all(contextKey, asOf, symbol, limit) as Array<{
        symbol: string; action: "BUY" | "SELL" | "HOLD"; decision_text: string; raw_return: string;
        benchmark_return: string; alpha_return: string; benchmark_symbol: string; holding_period_bars: number;
        resolved_at: number; reflection: string;
      }>;
    const format = (row: ReturnType<typeof read>[number]) =>
      `[resolved ${new Date(row.resolved_at).toISOString()}; ${row.symbol}; ${row.action}; ` +
      `market return ${(Number(row.raw_return) * 100).toFixed(2)}%; ${row.benchmark_symbol} return ${(Number(row.benchmark_return) * 100).toFixed(2)}%; ` +
      `alpha ${(Number(row.alpha_return) * 100).toFixed(2)}%; horizon ${row.holding_period_bars} one-minute bars]\n` +
      `Decision: ${row.decision_text}\nLesson: ${row.reflection}`;
    const same = sameSymbolLimit > 0 ? read(true, sameSymbolLimit) : [];
    const cross = crossSymbolLimit > 0 ? read(false, crossSymbolLimit) : [];
    return [...same, ...cross].map(format);
  }
  getRun(id: string): Record<string, unknown> | null {
    const row = this.db.select().from(schema.runs).where(eq(schema.runs.id, id)).get();
    return row ? { ...row, config: JSON.parse(row.configJson), report: row.reportJson ? JSON.parse(row.reportJson) : null } : null;
  }
  getRunDetails(id: string, includeBacktestData = false): RunAuditDetails | null {
    const run = this.getRun(id);
    if (!run) return null;
    const decisions = this.sqlite.query(`SELECT * FROM decisions WHERE run_id = ? ORDER BY decided_at, rowid`).all(id) as Array<{
      id: string; run_id: string; symbol: string; decided_at: number; quote_json: string; evidence_json: string; findings_json: string;
      proposal_json: string; risk_json: string; order_client_id: string | null;
    }>;
    const snapshots = this.sqlite.query(`SELECT id, category, source, symbol, observed_at, payload_json FROM source_snapshots
      WHERE run_id = ? AND category NOT IN ('backtest_dataset', 'memory_benchmark_dataset') ORDER BY observed_at, rowid`).all(id) as Array<{
      id: string; category: string; source: string; symbol: string; observed_at: number; payload_json: string;
    }>;
    const riskOutcomes = this.sqlite.query(`SELECT ro.* FROM risk_outcomes ro JOIN decisions d ON d.id = ro.decision_id WHERE d.run_id = ? ORDER BY ro.checked_at, ro.rowid`).all(id) as Array<{
      id: string; decision_id: string; approved: number; reasons_json: string; result_json: string; checked_at: number;
    }>;
    const intents = this.sqlite.query(`SELECT * FROM order_intents WHERE run_id = ? ORDER BY created_at, rowid`).all(id) as Array<{
      client_order_id: string; decision_id: string; order_json: string; state: string; exchange_order_json: string | null;
      created_at: number; updated_at: number;
    }>;
    const orders = intents.map((intent) => {
      const fillRows = this.sqlite.query(`SELECT * FROM fills WHERE order_client_id = ? ORDER BY timestamp, rowid`).all(intent.client_order_id) as Array<{
        id: string; order_client_id: string; symbol: string; side: "BUY" | "SELL"; quantity: string; price: string;
        fee: string; fee_asset: string; timestamp: number;
      }>;
      return {
        clientOrderId: intent.client_order_id, decisionId: intent.decision_id, state: intent.state,
        order: JSON.parse(intent.order_json), exchangeOrder: intent.exchange_order_json ? JSON.parse(intent.exchange_order_json) : null,
        createdAt: intent.created_at, updatedAt: intent.updated_at,
        fills: fillRows.map((fill) => ({
          id: fill.id, orderClientId: fill.order_client_id, symbol: fill.symbol, side: fill.side,
          quantity: fill.quantity, price: fill.price, fee: fill.fee, feeAsset: fill.fee_asset, timestamp: fill.timestamp,
        })),
      };
    });
    const decisionMemories = this.sqlite.query("SELECT * FROM decision_memories WHERE run_id = ? ORDER BY decided_at, decision_id").all(id) as Array<{
      decision_id: string; run_id: string; symbol: string; context_key: string; action: string; decision_text: string;
      entry_reference_price: string; benchmark_symbol: string; decided_at: number; holding_period_bars: number; due_at: number;
      status: string; entry_price: string | null; exit_price: string | null; benchmark_entry_price: string | null;
      benchmark_exit_price: string | null; raw_return: string | null; benchmark_return: string | null; alpha_return: string | null;
      resolved_at: number | null; reflection: string | null;
    }>;
    const portfolioHistory = this.sqlite.query(`SELECT observed_at, portfolio_key, cash, equity, positions_json, quote_currency, high_watermark, realized_pnl_today, day_start_equity
      FROM portfolio_snapshots WHERE run_id = ? ORDER BY observed_at, rowid`).all(id) as Array<{
      observed_at: number; portfolio_key: string; cash: string; equity: string; positions_json: string; quote_currency: string;
      high_watermark: string; realized_pnl_today: string; day_start_equity: string;
    }>;
    const backtestDataset = includeBacktestData
      ? this.sqlite.query("SELECT payload_json FROM source_snapshots WHERE run_id = ? AND category = 'backtest_dataset' ORDER BY observed_at DESC LIMIT 1").get(id) as { payload_json: string } | null
      : null;
    const memoryBenchmarkDataset = includeBacktestData
      ? this.sqlite.query("SELECT symbol, payload_json FROM source_snapshots WHERE run_id = ? AND category = 'memory_benchmark_dataset' ORDER BY observed_at DESC LIMIT 1").get(id) as { symbol: string; payload_json: string } | null
      : null;
    const aiModelCalls = this.sqlite.query(`SELECT * FROM ai_model_calls WHERE run_id = ? ORDER BY started_at, operation_id, step_number`).all(id) as Array<{
      id: string; operation_id: string; run_id: string; decision_id: string | null; symbol: string; role: string;
      operation: AiModelCallRecord["operation"]; provider: string; model_id: string; step_number: number;
      status: AiModelCallRecord["status"]; started_at: number; ended_at: number; input_tokens: number | null;
      output_tokens: number | null; reasoning_tokens: number | null; total_tokens: number | null; finish_reason: string | null;
      response_id: string | null; tool_names_json: string; warnings_json: string; error_name: string | null; error_message: string | null;
    }>;
    return {
      run,
      decisions: decisions.map((decision) => ({
        id: decision.id, runId: decision.run_id, symbol: decision.symbol, decidedAt: decision.decided_at,
        quote: JSON.parse(decision.quote_json), evidence: JSON.parse(decision.evidence_json),
        findings: JSON.parse(decision.findings_json), proposal: JSON.parse(decision.proposal_json),
        risk: JSON.parse(decision.risk_json), ...(decision.order_client_id ? { orderClientId: decision.order_client_id } : {}),
      })),
      riskOutcomes: riskOutcomes.map((outcome) => ({
        id: outcome.id, decisionId: outcome.decision_id, approved: Boolean(outcome.approved),
        reasons: JSON.parse(outcome.reasons_json), result: JSON.parse(outcome.result_json), checkedAt: outcome.checked_at,
      })),
      orders,
      decisionMemories: decisionMemories.map((memory) => ({
        decisionId: memory.decision_id, runId: memory.run_id, symbol: memory.symbol, contextKey: memory.context_key,
        action: memory.action, decisionText: memory.decision_text, entryReferencePrice: memory.entry_reference_price,
        benchmarkSymbol: memory.benchmark_symbol, decidedAt: memory.decided_at, holdingPeriodBars: memory.holding_period_bars,
        dueAt: memory.due_at, status: memory.status, entryPrice: memory.entry_price, exitPrice: memory.exit_price,
        benchmarkEntryPrice: memory.benchmark_entry_price, benchmarkExitPrice: memory.benchmark_exit_price,
        rawReturn: memory.raw_return, benchmarkReturn: memory.benchmark_return, alphaReturn: memory.alpha_return,
        resolvedAt: memory.resolved_at, reflection: memory.reflection,
      })),
      portfolioHistory: portfolioHistory.map((snapshot) => ({
        timestamp: snapshot.observed_at, portfolioKey: snapshot.portfolio_key,
        cash: snapshot.cash, equity: snapshot.equity, positions: JSON.parse(snapshot.positions_json), quoteCurrency: snapshot.quote_currency,
        highWatermark: snapshot.high_watermark, realizedPnlToday: snapshot.realized_pnl_today, dayStartEquity: snapshot.day_start_equity,
      })),
      ...(backtestDataset ? { backtestDataset: JSON.parse(backtestDataset.payload_json) } : {}),
      ...(memoryBenchmarkDataset ? { memoryBenchmarkDataset: {
        symbol: memoryBenchmarkDataset.symbol, candles: JSON.parse(memoryBenchmarkDataset.payload_json),
      } } : {}),
      sourceSnapshots: snapshots.map((snapshot) => ({
        id: snapshot.id, category: snapshot.category, source: snapshot.source, symbol: snapshot.symbol,
        observedAt: snapshot.observed_at, payload: JSON.parse(snapshot.payload_json),
      })),
      aiModelCalls: aiModelCalls.map((call) => ({
        id: call.id, operationId: call.operation_id, runId: call.run_id,
        ...(call.decision_id ? { decisionId: call.decision_id } : {}), symbol: call.symbol,
        role: call.role as AiModelCallRecord["role"], operation: call.operation,
        provider: call.provider, modelId: call.model_id, stepNumber: call.step_number, status: call.status,
        startedAt: call.started_at, endedAt: call.ended_at,
        ...(call.input_tokens === null ? {} : { inputTokens: call.input_tokens }),
        ...(call.output_tokens === null ? {} : { outputTokens: call.output_tokens }),
        ...(call.reasoning_tokens === null ? {} : { reasoningTokens: call.reasoning_tokens }),
        ...(call.total_tokens === null ? {} : { totalTokens: call.total_tokens }),
        ...(call.finish_reason ? { finishReason: call.finish_reason } : {}),
        ...(call.response_id ? { responseId: call.response_id } : {}),
        toolNames: JSON.parse(call.tool_names_json), warnings: JSON.parse(call.warnings_json),
        ...(call.error_name ? { errorName: call.error_name } : {}),
        ...(call.error_message ? { errorMessage: call.error_message } : {}),
      })),
    };
  }
  getRecentRuns(limit: number): Record<string, unknown>[] {
    return this.db.select().from(schema.runs).orderBy(desc(schema.runs.startedAt)).limit(limit).all().map((row) => ({
      ...row, config: JSON.parse(row.configJson), report: row.reportJson ? JSON.parse(row.reportJson) : null,
    }));
  }
  getRecentRunIds(mode: EngineMode, symbols: readonly string[], strategyIds: readonly string[], limit: number): { runIds: string[]; total: number } {
    if (symbols.length === 0 || strategyIds.length === 0) return { runIds: [], total: 0 };
    const symbolPlaceholders = symbols.map(() => "?").join(",");
    const strategyPlaceholders = strategyIds.map(() => "?").join(",");
    const where = `mode = ?
      AND upper(json_extract(config_json, '$.symbol')) IN (${symbolPlaceholders})
      AND coalesce(json_extract(config_json, '$.strategy.id'), 'agentic-balanced') IN (${strategyPlaceholders})`;
    const args = [mode, ...symbols.map((symbol) => symbol.toUpperCase()), ...strategyIds];
    const count = this.sqlite.query(`SELECT count(*) AS total FROM runs WHERE ${where}`).get(...args) as { total: number };
    const rows = this.sqlite.query(`SELECT id FROM runs WHERE ${where} ORDER BY started_at DESC, id DESC LIMIT ?`)
      .all(...args, limit) as Array<{ id: string }>;
    return { runIds: rows.map((row) => row.id).reverse(), total: count.total };
  }
  recordAiModelCall(call: AiModelCallRecord): void {
    this.sqlite.query(`INSERT OR IGNORE INTO ai_model_calls (
      id, operation_id, run_id, decision_id, symbol, role, operation, provider, model_id, step_number,
      status, started_at, ended_at, input_tokens, output_tokens, reasoning_tokens, total_tokens,
      finish_reason, response_id, tool_names_json, warnings_json, error_name, error_message
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(call.id, call.operationId, call.runId, call.decisionId ?? null, call.symbol, call.role, call.operation,
        call.provider, call.modelId, call.stepNumber, call.status, call.startedAt, call.endedAt,
        call.inputTokens ?? null, call.outputTokens ?? null, call.reasoningTokens ?? null, call.totalTokens ?? null,
        call.finishReason ?? null, call.responseId ?? null, JSON.stringify(call.toolNames), JSON.stringify(call.warnings),
        call.errorName ?? null, call.errorMessage ?? null);
  }
  acquireExecutionLease(name: string, owner: string, now: number, leaseMs: number): boolean {
    const result = this.sqlite.query(`
      INSERT INTO execution_leases (name, owner, expires_at) VALUES (?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at
      WHERE execution_leases.expires_at <= ? OR execution_leases.owner = ?
    `).run(name, owner, now + leaseMs, now, owner);
    return result.changes === 1;
  }
  releaseExecutionLease(name: string, owner: string): void {
    this.sqlite.query(`DELETE FROM execution_leases WHERE name = ? AND owner = ?`).run(name, owner);
  }
  listConfigProfiles(): StoredConfigProfile[] {
    return (this.sqlite.query(`SELECT id, name, settings_json, created_at, updated_at FROM config_profiles ORDER BY name COLLATE NOCASE`)
      .all() as Array<{ id: string; name: string; settings_json: string; created_at: number; updated_at: number }>).map((row) => ({
        id: row.id, name: row.name, settings: JSON.parse(row.settings_json) as Record<string, string>,
        createdAt: row.created_at, updatedAt: row.updated_at,
      }));
  }
  getConfigProfile(id: string): StoredConfigProfile | null {
    const row = this.sqlite.query(`SELECT id, name, settings_json, created_at, updated_at FROM config_profiles WHERE id = ?`)
      .get(id) as { id: string; name: string; settings_json: string; created_at: number; updated_at: number } | null;
    return row ? { id: row.id, name: row.name, settings: JSON.parse(row.settings_json) as Record<string, string>, createdAt: row.created_at, updatedAt: row.updated_at } : null;
  }
  getActiveConfigProfileId(): string | null {
    return (this.sqlite.query(`SELECT value FROM app_settings WHERE key = 'active_config_profile'`).get() as { value: string } | null)?.value ?? null;
  }
  createConfigProfile(profile: StoredConfigProfile): void {
    this.sqlite.query(`INSERT INTO config_profiles (id, name, settings_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run(profile.id, profile.name, JSON.stringify(profile.settings), profile.createdAt, profile.updatedAt);
  }
  createConfigProfileWithSecrets(profile: StoredConfigProfile, secrets: StoredSecretEnvelope[]): void {
    this.sqlite.transaction(() => {
      this.createConfigProfile(profile);
      this.writeConfigProfileSecrets(profile.id, secrets);
    })();
  }
  updateConfigProfile(profile: StoredConfigProfile): void {
    const result = this.sqlite.query(`UPDATE config_profiles SET name = ?, settings_json = ?, updated_at = ? WHERE id = ?`)
      .run(profile.name, JSON.stringify(profile.settings), profile.updatedAt, profile.id);
    if (result.changes !== 1) throw new Error(`Configuration profile '${profile.id}' was not found.`);
  }
  saveConfigProfile(profile: StoredConfigProfile, secrets?: StoredSecretEnvelope[]): void {
    this.sqlite.transaction(() => {
      this.updateConfigProfile(profile);
      if (secrets !== undefined) this.writeConfigProfileSecrets(profile.id, secrets);
    })();
  }
  deleteConfigProfile(id: string): void {
    if (this.getActiveConfigProfileId() === id) throw new Error("Select a different active profile before deleting this one.");
    this.sqlite.query(`DELETE FROM config_profiles WHERE id = ?`).run(id);
  }
  setActiveConfigProfileId(id: string): void {
    if (!this.getConfigProfile(id)) throw new Error(`Configuration profile '${id}' was not found.`);
    this.sqlite.query(`INSERT INTO app_settings (key, value, updated_at) VALUES ('active_config_profile', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
      .run(id, Date.now());
  }
  getConfigProfileSecrets(profileId: string): StoredSecretEnvelope[] {
    return this.sqlite.query(`SELECT secret_key, algorithm, key_version, nonce, ciphertext, auth_tag, updated_at FROM config_profile_secrets WHERE profile_id = ? ORDER BY secret_key`)
      .all(profileId).map((row) => {
        const secret = row as { secret_key: string; algorithm: "aes-256-gcm"; key_version: number; nonce: string; ciphertext: string; auth_tag: string; updated_at: number };
        return { key: secret.secret_key, algorithm: secret.algorithm, keyVersion: secret.key_version, nonce: secret.nonce, ciphertext: secret.ciphertext, authTag: secret.auth_tag, updatedAt: secret.updated_at };
      });
  }
  replaceConfigProfileSecrets(profileId: string, secrets: StoredSecretEnvelope[]): void {
    this.sqlite.transaction(() => {
      this.writeConfigProfileSecrets(profileId, secrets);
    })();
  }
  replaceConfigProfileSecretsBatch(profiles: Array<{ profileId: string; secrets: StoredSecretEnvelope[] }>): void {
    this.sqlite.transaction(() => {
      for (const profile of profiles) this.writeConfigProfileSecrets(profile.profileId, profile.secrets);
    })();
  }
  private writeConfigProfileSecrets(profileId: string, secrets: StoredSecretEnvelope[]): void {
    if (!this.getConfigProfile(profileId)) throw new Error(`Configuration profile '${profileId}' was not found.`);
    this.sqlite.query(`DELETE FROM config_profile_secrets WHERE profile_id = ?`).run(profileId);
    const insert = this.sqlite.query(`INSERT INTO config_profile_secrets (profile_id, secret_key, algorithm, key_version, nonce, ciphertext, auth_tag, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const secret of secrets) insert.run(profileId, secret.key, secret.algorithm, secret.keyVersion, secret.nonce, secret.ciphertext, secret.authTag, secret.updatedAt);
  }
  close(): void { this.sqlite.close(); }
}
