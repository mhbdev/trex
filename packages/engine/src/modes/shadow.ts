import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { EngineConfig } from "../domain/config.ts";
import type { ExchangeOrder, MarketQuote, OrderIntent, TradeDecision } from "../domain/types.ts";
import type { MarketDataPort, RunRepository } from "../application/ports.ts";
import { VirtualPortfolio } from "../application/portfolio.ts";
import { TradingWorkflow } from "../application/trading-workflow.ts";
import { buildRunReport, formatFeesByAsset } from "../application/reporting.ts";
import { applyVirtualFills, newWallexClientOrderId, simulateShadowFill } from "../application/live-execution.ts";
import { runConfigSnapshot } from "../application/run-config.ts";
import { ExecutionLeaseGuard } from "../application/execution-lease.ts";
import { auditFailure } from "../application/failure-audit.ts";
import { selectStrategy, type StrategyProfile } from "../domain/strategies.ts";

const ShadowFillInputsSchema = z.object({
  book: z.object({
    bids: z.array(z.tuple([z.string(), z.string()])),
    asks: z.array(z.tuple([z.string(), z.string()])),
    observedAt: z.number().int(),
  }),
  fallbackPrice: z.string(),
  slippageBps: z.string(),
  feeBps: z.string(),
  quoteCurrency: z.string(),
  filledAt: z.number().int(),
});

function ensureFreshQuote(quote: MarketQuote, now: number, maxAgeSeconds: number): void {
  const ageSeconds = (now - quote.observedAt) / 1000;
  if (ageSeconds > maxAgeSeconds) throw new Error(`Shadow mark quote is stale (${ageSeconds.toFixed(1)}s old).`);
  if (quote.observedAt > now + 1000) throw new Error("Shadow mark quote timestamp is in the future.");
}

function recoverShadowIntents(portfolio: VirtualPortfolio, repository: RunRepository, now: () => number, portfolioKey: string): void {
  for (const intent of repository.getPendingOrderIntents("shadow", portfolioKey)) {
    const category = `shadow_fill_inputs:${intent.clientOrderId}`;
    const inputs = ShadowFillInputsSchema.safeParse(repository.loadSnapshot(intent.runId, category));
    if (!inputs.success) {
      repository.updateOrderIntent(intent.clientOrderId, "rejected");
      repository.saveSnapshot({
        runId: intent.runId, category: "shadow_recovery_warning", source: "shadow-recovery",
        symbol: intent.order.symbol, observedAt: now(),
        payload: { clientOrderId: intent.clientOrderId, message: "Saved fill inputs are missing or invalid; no virtual fill was applied." },
      });
      repository.finishRun(intent.runId, now(), "failed", undefined, { name: "ShadowRecoveryError", message: "Saved shadow fill inputs were missing or invalid; no virtual fill was applied." });
      continue;
    }
    const fillInput = inputs.data;
    const portfolioBefore = portfolio.current();
    const replayDecision = {
      proposal: { order: intent.order }, orderClientId: intent.clientOrderId,
    } as TradeDecision;
    try {
      const simulated = simulateShadowFill({
        decision: replayDecision, book: fillInput.book, fallbackPrice: fillInput.fallbackPrice,
        slippageBps: fillInput.slippageBps, feeBps: fillInput.feeBps,
        quoteCurrency: fillInput.quoteCurrency, now: fillInput.filledAt,
      });
      applyVirtualFills(portfolio, simulated.order, fillInput.fallbackPrice);
      repository.saveShadowExecution(intent.clientOrderId, intent.runId, simulated.order, portfolio.current(), portfolioKey);
      repository.finishRun(intent.runId, now(), "failed", undefined, { name: "ShadowRecoveryError", message: "A pending paper order was recovered after interruption; the original run did not finalize normally." });
    } catch (error) {
      portfolio.restore(portfolioBefore);
      repository.updateOrderIntent(intent.clientOrderId, "rejected");
      repository.saveSnapshot({
        runId: intent.runId, category: "shadow_recovery_warning", source: "shadow-recovery",
        symbol: intent.order.symbol, observedAt: now(),
        payload: { clientOrderId: intent.clientOrderId, message: error instanceof Error ? error.name : "recovery error" },
      });
      repository.finishRun(intent.runId, now(), "failed", undefined, auditFailure(error));
    }
  }
}

export async function runShadowCycle(symbol: string, config: EngineConfig, marketData: MarketDataPort,
  workflow: TradingWorkflow, repository: RunRepository, now: () => number = Date.now, strategyInput?: StrategyProfile) {
  const strategy = strategyInput ?? selectStrategy(config.strategies);
  const normalizedSymbol = symbol.toUpperCase();
  const portfolioKey = `shadow:${normalizedSymbol}:${strategy.id}`;
  const leaseOwner = randomUUID();
  const leaseMs = 5 * 60_000;
  const leaseStartedAt = now();
  if (!repository.acquireExecutionLease("wallex-shadow", leaseOwner, leaseStartedAt, leaseMs)) {
    throw new Error("Another engine process currently holds the shadow portfolio lease.");
  }
  const leaseGuard = new ExecutionLeaseGuard(repository, "wallex-shadow", leaseOwner, now, leaseMs);
  const runId = randomUUID();
  const startedAt = now();
  let runCreated = false;
  try {
    leaseGuard.assertHeld();
    repository.failInterruptedRuns("shadow", startedAt);
    const portfolio = new VirtualPortfolio(config.paperInitialCash, config.wallex.quoteCurrency, startedAt);
    const savedPortfolio = repository.getLatestPortfolio("shadow", portfolioKey);
    if (savedPortfolio) {
      if (savedPortfolio.quoteCurrency !== config.wallex.quoteCurrency) throw new Error("Existing shadow portfolio uses a different quote currency; use a separate database or migrate it explicitly.");
      portfolio.restore(savedPortfolio);
    }
    recoverShadowIntents(portfolio, repository, now, portfolioKey);
    const initialEquity = portfolio.current().equity;
    repository.createRun({ id: runId, mode: "shadow", config: runConfigSnapshot(config, "shadow", symbol, strategy), startedAt });
    runCreated = true;
    workflow.beginPipeline(runId, symbol, "shadow");
    workflow.setStage("preparation", "active");
    await workflow.initializeMarketPolicy("shadow");
    workflow.setStage("preparation", "completed");
    workflow.setStage("market_data", "active");
    const quote = await marketData.getQuote(symbol);
    const markQuotes = new Map<string, MarketQuote>([[symbol.toUpperCase(), quote]]);
    for (const position of portfolio.current().positions) {
      if (position.symbol === symbol.toUpperCase()) continue;
      markQuotes.set(position.symbol, await marketData.getQuote(position.symbol));
    }
    const markAt = now();
    const marks = new Map<string, string>();
    for (const [markSymbol, markQuote] of markQuotes) {
      ensureFreshQuote(markQuote, markAt, config.risk.maxDataAgeSeconds);
      marks.set(markSymbol, markQuote.price);
    }
    portfolio.mark(marks, markAt);
    const candleWindowEnd = now();
    const candles = await marketData.getCandles(symbol, Math.floor((candleWindowEnd - 120 * 60_000) / 1000), Math.floor(candleWindowEnd / 1000), 1);
    workflow.setStage("market_data", "completed", `${candles.filter((candle) => candle.complete).length} completed candles loaded`);
    const decisionAt = now();
    const decision = await workflow.evaluate({ runId, symbol, portfolio: portfolio.current(), quote, candles, now: decisionAt, mode: "shadow", strategy });
    workflow.setStage("outcome", "active", `Handling the ${decision.proposal.action} decision and virtual portfolio`);
    leaseGuard.assertHeld();
    const orders: ExchangeOrder[] = [];
    let acceptedProposals = 0;
    let slippage = "0";
    if (decision.risk.approved && decision.proposal.order) {
      acceptedProposals++;
      workflow.setStage("final_gate", "active", "Checking the latest quote and order book before virtual fill");
      const currentQuote: MarketQuote = await marketData.getQuote(symbol);
      const book = await marketData.getDepth(symbol);
      const currentRisk = await workflow.riskAtExecution(decision, portfolio.current(), currentQuote, now(), "shadow", book, strategy);
      repository.saveRiskOutcome(decision.id, currentRisk);
      decision.risk = currentRisk;
      workflow.setStage("final_gate", "completed", currentRisk.approved ? "Final risk recheck passed" : "Final risk recheck blocked the proposal");
      if (currentRisk.approved && currentRisk.normalizedOrder) {
        leaseGuard.assertHeld();
        workflow.setStage("outcome", "active", "Estimating a virtual fill from the visible order book");
        const clientOrderId = decision.orderClientId ?? newWallexClientOrderId();
        decision.orderClientId = clientOrderId;
        const filledAt = now();
        const fillInputs = {
          book, fallbackPrice: currentQuote.price, slippageBps: config.backtestSlippageBps,
          feeBps: config.backtestFeeBps, quoteCurrency: portfolio.current().quoteCurrency, filledAt,
        };
        repository.saveSnapshot({
          runId, category: `shadow_fill_inputs:${clientOrderId}`, source: "wallex-rest-depth",
          symbol: symbol.toUpperCase(), observedAt: book.observedAt, payload: fillInputs,
        });
        repository.saveOrderIntent({ clientOrderId, runId, decisionId: decision.id, order: currentRisk.normalizedOrder, state: "pending", createdAt: filledAt, portfolioKey });
        const simulated = simulateShadowFill({
          decision, book, fallbackPrice: currentQuote.price,
          slippageBps: config.backtestSlippageBps, feeBps: config.backtestFeeBps,
          quoteCurrency: portfolio.current().quoteCurrency, now: filledAt,
        });
        orders.push(simulated.order);
        applyVirtualFills(portfolio, simulated.order, currentQuote.price);
        repository.saveShadowExecution(clientOrderId, runId, simulated.order, portfolio.current(), portfolioKey);
        if (simulated.order.fills.length > 0) slippage = simulated.slippage;
      }
    }
    const finalState = portfolio.current();
    leaseGuard.assertHeld();
    repository.savePortfolio(runId, finalState, portfolioKey);
    const report = buildRunReport({
      runId, mode: "shadow", startedAt, initialEquity, finalEquity: finalState.equity,
      equityPath: [initialEquity, finalState.equity], acceptedProposals, orders,
      fees: formatFeesByAsset(orders.flatMap((order) => order.fills)), slippage,
      assumptions: ["Live Wallex market data; no order-write adapter is constructed in shadow mode.", "Virtual portfolio is isolated from the exchange wallet.", "Paper fills are estimates from the visible depth snapshot; configured slippage and fees are applied.", "Shadow fills do not model queue priority, exchange latency, hidden liquidity, actual order acceptance, or market impact beyond configured slippage; shadow results do not guarantee live execution or returns."],
      symbol: normalizedSymbol, strategyId: strategy.id, quoteCurrency: finalState.quoteCurrency,
      equityCurve: [{ timestamp: startedAt, equity: initialEquity }, { timestamp: finalState.observedAt, equity: finalState.equity }],
    }, now());
    repository.finishRun(runId, report.endedAt, "completed", report as unknown as Record<string, unknown>);
    workflow.setStage("outcome", "completed", orders.length > 0 ? "Virtual fill and report recorded" : `Decision ${decision.proposal.action}; no virtual order was filled. Report recorded.`);
    return { report, decision };
  } catch (error) {
    if (runCreated) repository.finishRun(runId, now(), "failed", undefined, auditFailure(error));
    throw error;
  } finally {
    leaseGuard.close();
    repository.releaseExecutionLease("wallex-shadow", leaseOwner);
  }
}
