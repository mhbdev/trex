import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { validateModeConfig, type EngineConfig } from "../domain/config.ts";
import type { ExchangeOrder, PortfolioState } from "../domain/types.ts";
import type { MarketDataPort, OrderExecutionPort, RunRepository } from "../application/ports.ts";
import { LiveExecutionCoordinator } from "../application/live-execution.ts";
import { TradingWorkflow } from "../application/trading-workflow.ts";
import { buildRunReport, formatFeesByAsset } from "../application/reporting.ts";
import { runConfigSnapshot } from "../application/run-config.ts";
import { ExecutionLeaseGuard } from "../application/execution-lease.ts";
import { auditFailure } from "../application/failure-audit.ts";
import { selectStrategy, type StrategyProfile } from "../domain/strategies.ts";

function applyAccountRiskHistory(current: PortfolioState, baseline: PortfolioState): PortfolioState {
  const sameUtcDay = new Date(current.observedAt).toISOString().slice(0, 10) === new Date(baseline.observedAt).toISOString().slice(0, 10);
  const dayStartEquity = sameUtcDay ? (baseline.dayStartEquity ?? baseline.equity) : current.equity;
  return {
    ...current,
    highWatermark: Decimal.max(current.equity, baseline.highWatermark).toFixed(),
    dayStartEquity,
    // The credit-account balance endpoint does not provide realized PnL; use total mark-to-market change as a conservative proxy.
    realizedPnlToday: new Decimal(current.equity).minus(dayStartEquity).toFixed(),
  };
}

export async function runLiveCycle(symbol: string, config: EngineConfig, marketData: MarketDataPort,
  execution: OrderExecutionPort, workflow: TradingWorkflow, repository: RunRepository, now: () => number = Date.now,
  shouldStop: () => boolean = () => false, strategyInput?: StrategyProfile) {
  const strategy = strategyInput ?? selectStrategy(config.strategies);
  const configErrors = validateModeConfig(config, "live");
  if (configErrors.length > 0) throw new Error(configErrors.join("\n"));
  const leaseOwner = randomUUID();
  const leaseMs = 5 * 60_000;
  const leaseStartedAt = now();
  if (!repository.acquireExecutionLease("wallex-live", leaseOwner, leaseStartedAt, leaseMs)) {
    throw new Error("Another engine process currently holds the Wallex live-execution lease.");
  }
  const leaseGuard = new ExecutionLeaseGuard(repository, "wallex-live", leaseOwner, now, leaseMs);
  const runId = randomUUID();
  const startedAt = now();
  const coordinator = new LiveExecutionCoordinator(execution, repository);
  let initial: PortfolioState | undefined;
  let runCreated = false;
  try {
    leaseGuard.assertHeld();
    repository.failInterruptedRuns("live", startedAt);
    repository.createRun({ id: runId, mode: "live", config: runConfigSnapshot(config, "live", symbol, strategy), startedAt });
    runCreated = true;
    await workflow.initializeMarketPolicy("live");
    leaseGuard.assertHeld();
    const reconciliation = await coordinator.reconcilePending();
    if (reconciliation.unresolved.length > 0) {
      throw new Error(`Live trading paused: active or unresolved Wallex order intents require reconciliation (${reconciliation.unresolved.join(", ")}).`);
    }
    const exchangePortfolio = await marketData.getAccountPortfolio!();
    const previousPortfolio = repository.getLatestPortfolio("live");
    initial = applyAccountRiskHistory(exchangePortfolio, previousPortfolio ?? exchangePortfolio);
    const quote = await marketData.getQuote(symbol);
    const candleWindowEnd = now();
    const candles = await marketData.getCandles(symbol, Math.floor((candleWindowEnd - 120 * 60_000) / 1000), Math.floor(candleWindowEnd / 1000), 1);
    const decisionAt = now();
    const decision = await workflow.evaluate({ runId, symbol, portfolio: initial, quote, candles, now: decisionAt, mode: "live", strategy });
    leaseGuard.assertHeld();
    let order: ExchangeOrder | undefined;
    let executionReferencePrice: string | undefined;
    if (decision.risk.approved && decision.proposal.order) {
      const latestAccount = await marketData.getAccountPortfolio!();
      const executionPortfolio = applyAccountRiskHistory(latestAccount, initial);
      const latestQuote = await marketData.getQuote(symbol);
      executionReferencePrice = latestQuote.price;
      const executionRisk = await workflow.riskAtExecution(decision, executionPortfolio, latestQuote, now(), "live", undefined, strategy);
      repository.saveRiskOutcome(decision.id, executionRisk);
      decision.risk = executionRisk;
      if (executionRisk.approved) {
        if (shouldStop()) throw new Error("Live cycle stopped before order submission; no order was sent.");
        leaseGuard.assertHeld();
        order = await coordinator.execute(decision, latestQuote);
      }
    }
    leaseGuard.assertHeld();
    let finalPortfolio = initial;
    try {
      const latest = await marketData.getAccountPortfolio!();
      finalPortfolio = applyAccountRiskHistory(latest, initial);
    } catch { /* Preserve the last known account snapshot. */ }
    leaseGuard.assertHeld();
    repository.savePortfolio(runId, finalPortfolio);
    const report = buildRunReport({
      runId, mode: "live", startedAt, initialEquity: initial.equity, finalEquity: finalPortfolio.equity,
      equityPath: [initial.equity, finalPortfolio.equity], acceptedProposals: order ? 1 : 0,
      orders: order ? [order] : [], fees: formatFeesByAsset(order?.fills ?? []),
      slippage: order && new Decimal(order.executedQuantity).gt(0) && order.fills.length === 0 ? "unavailable" :
        order && executionReferencePrice ? order.fills.reduce((sum, fill) =>
          sum.plus(new Decimal(fill.quantity).mul(new Decimal(fill.price).minus(executionReferencePrice!).abs())), new Decimal(0)).toFixed() : "0",
      assumptions: ["Wallex credit-account spot execution.", "Sub-account-specific API key and sub-account-client-id are required.", "The exchange order and fill records are authoritative."],
      symbol: symbol.toUpperCase(), strategyId: strategy.id, quoteCurrency: finalPortfolio.quoteCurrency,
      equityCurve: [{ timestamp: startedAt, equity: initial.equity }, { timestamp: finalPortfolio.observedAt, equity: finalPortfolio.equity }],
    }, now());
    repository.finishRun(runId, report.endedAt, "completed", report as unknown as Record<string, unknown>);
    return { report, decision, order };
  } catch (error) {
    if (runCreated) repository.finishRun(runId, now(), "failed", undefined, auditFailure(error));
    throw error;
  } finally {
    leaseGuard.close();
    repository.releaseExecutionLease("wallex-live", leaseOwner);
  }
}
