import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import type { EngineConfig } from "../domain/config.ts";
import type { Candle, ExchangeOrder, Fill, MarketQuote, PortfolioState, RunReport } from "../domain/types.ts";
import type { MarketDataPort, RunRepository } from "../application/ports.ts";
import { VirtualPortfolio } from "../application/portfolio.ts";
import { TradingWorkflow } from "../application/trading-workflow.ts";
import { buildRunReport, downsampleEquityCurve, formatFeesByAsset } from "../application/reporting.ts";
import { newWallexClientOrderId } from "../application/live-execution.ts";
import { simulateNextBarOpenFill } from "./backtest-fill.ts";
import { runConfigSnapshot } from "../application/run-config.ts";
import { auditFailure } from "../application/failure-audit.ts";
import type { StrategyProfile } from "../domain/strategies.ts";

export interface BacktestInput { symbol: string; fromSeconds: number; toSeconds: number; runId?: string; resume?: boolean; strategy?: StrategyProfile; dataset?: Candle[]; shouldStop?: () => boolean }

interface BacktestCheckpoint {
  nextIndex: number;
  portfolio: PortfolioState;
  initialEquity: string;
  acceptedProposals: number;
  /** Legacy checkpoint fields are accepted when resuming pre-v2 runs. */
  orders?: ExchangeOrder[];
  equityPath?: string[];
  fees: string;
  slippage: string;
  equityCurve?: { timestamp: number; equity: string }[];
}

function dateForCandle(candle: Candle): number { return candle.timestamp + 60_000; }

function appendEquityPoint(curve: { timestamp: number; equity: string }[], timestamp: number, equity: string): void {
  const last = curve.at(-1);
  if (last?.timestamp === timestamp) last.equity = equity;
  else curve.push({ timestamp, equity });
}

function buyAndHoldFinalEquity(candles: readonly Candle[], cash: string, feeBps: string, slippageBps: string): string {
  // The reference buy must be executable after the first completed signal bar, just like strategy fills.
  const first = candles[1] ?? candles[0], last = candles.at(-1);
  if (!first || !last) return cash;
  const slippage = new Decimal(slippageBps).div(10_000);
  const fee = new Decimal(feeBps).div(10_000);
  const entry = new Decimal(first.open).mul(new Decimal(1).plus(slippage));
  const exit = new Decimal(last.close).mul(new Decimal(1).minus(slippage));
  if (!entry.gt(0) || !exit.gt(0)) return cash;
  const quantity = new Decimal(cash).div(entry.mul(new Decimal(1).plus(fee)));
  return quantity.mul(exit).mul(new Decimal(1).minus(fee)).toFixed();
}

export async function runBacktest(input: BacktestInput, config: EngineConfig, marketData: MarketDataPort,
  workflow: TradingWorkflow, repository: RunRepository, now: () => number = Date.now) {
  const symbol = input.symbol.toUpperCase();
  if (input.fromSeconds >= input.toSeconds) throw new Error("Backtest start must be earlier than its end.");
  const runId = input.runId ?? randomUUID();
  const priorRun = input.resume ? repository.getRun(runId) : null;
  if (input.resume && !priorRun) throw new Error(`Run ${runId} was not found.`);
  if (input.resume && priorRun?.mode !== "backtest") throw new Error(`Run ${runId} is not a backtest run.`);
  const startedAt = typeof priorRun?.startedAt === "number" ? priorRun.startedAt : now();
  const initialCash = config.paperInitialCash;
  const runConfig = {
    ...runConfigSnapshot(config, "backtest", symbol, input.strategy),
    fromSeconds: input.fromSeconds, toSeconds: input.toSeconds,
    assumptions: "Wallex historical OHLCV; completed-bar decisions; next-bar-open fills",
  };
  if (input.resume && JSON.stringify(priorRun?.config) !== JSON.stringify(runConfig)) throw new Error("Backtest resume configuration does not match the original run.");
  if (input.resume && priorRun?.status === "completed" && priorRun.report) return priorRun.report as RunReport;
  const portfolio = new VirtualPortfolio(initialCash, config.wallex.quoteCurrency, startedAt);
  const resumed = input.resume ? repository.loadCheckpoint(runId, "backtest") as BacktestCheckpoint | null : null;
  if (input.resume && !resumed) throw new Error(`Run ${runId} has no backtest recovery checkpoint.`);
  if (!resumed) repository.createRun({ id: runId, mode: "backtest", config: runConfig, startedAt });
  else portfolio.restore(resumed.portfolio);
  try {
  workflow.beginPipeline(runId, symbol, "backtest");
  workflow.setStage("preparation", "active");
  await workflow.initializeMarketPolicy("backtest");
  workflow.setStage("preparation", "completed");

  let candles: Candle[];
  workflow.setStage("market_data", "active");
  if (input.resume) {
    const stored = repository.loadSnapshot(runId, "backtest_dataset");
    if (!Array.isArray(stored)) throw new Error(`Run ${runId} is missing its stored historical candle dataset.`);
    candles = stored as Candle[];
  } else {
    candles = (input.dataset ?? await marketData.getCandles(symbol, input.fromSeconds, input.toSeconds, 1))
      .filter((candle) => candle.complete && candle.timestamp >= input.fromSeconds * 1000 && candle.timestamp < input.toSeconds * 1000)
      .sort((a, b) => a.timestamp - b.timestamp);
    repository.saveSnapshot({ runId, category: "backtest_dataset", source: "wallex-rest-udf-history", symbol, observedAt: now(), payload: candles });
  }
  if (candles.length < 2) throw new Error("Backtest requires at least two completed one-minute candles.");
  workflow.setStage("market_data", "completed", `${candles.length} historical candles loaded`);
  const benchmarkSymbol = workflow.memoryBenchmarkFor(symbol);
  let benchmarkCandles: Candle[] = [];
  if (benchmarkSymbol === symbol) benchmarkCandles = candles;
  else if (input.resume) {
    const storedBenchmark = repository.loadSnapshot(runId, "memory_benchmark_dataset");
    if (Array.isArray(storedBenchmark) && storedBenchmark.length > 0) benchmarkCandles = storedBenchmark as Candle[];
    else {
      try { benchmarkCandles = await marketData.getCandles(benchmarkSymbol, input.fromSeconds, input.toSeconds, 1); }
      catch { benchmarkCandles = []; }
      repository.saveSnapshot({
        runId, category: "memory_benchmark_dataset", source: "wallex-rest-memory-benchmark",
        symbol: benchmarkSymbol, observedAt: now(), payload: benchmarkCandles,
      });
    }
  } else {
    try { benchmarkCandles = await marketData.getCandles(benchmarkSymbol, input.fromSeconds, input.toSeconds, 1); }
    catch { benchmarkCandles = []; }
    repository.saveSnapshot({
      runId, category: "memory_benchmark_dataset", source: "wallex-rest-memory-benchmark",
      symbol: benchmarkSymbol, observedAt: now(), payload: benchmarkCandles,
    });
  }
  const memoryHistory = new Map<string, readonly Candle[]>([[symbol, candles], [benchmarkSymbol, benchmarkCandles]]);
  const initialEquity = resumed?.initialEquity ?? portfolio.current().equity;
  const persistedHistory = resumed ? repository.getPortfolioHistory(runId, resumed.portfolio.observedAt) : [];
  let nextIndex = resumed?.nextIndex ?? 0;
  let acceptedProposals = resumed?.acceptedProposals ?? 0;
  const orders = resumed?.orders ?? repository.getOrderHistory(runId);
  const equityPath = resumed?.equityPath ?? [initialEquity, ...persistedHistory.map((point) => point.equity)];
  let fees = new Decimal(resumed?.fees ?? 0);
  let slippage = new Decimal(resumed?.slippage ?? 0);
  const equityCurve = resumed?.equityCurve ?? [
    { timestamp: candles[0]!.timestamp, equity: initialEquity },
    ...persistedHistory.map((point) => ({ timestamp: point.timestamp, equity: point.equity })),
  ];

  if (!resumed) repository.saveCheckpoint(runId, "backtest", {
    nextIndex: 0, portfolio: portfolio.current(), initialEquity, acceptedProposals,
    fees: fees.toFixed(), slippage: slippage.toFixed(),
  } satisfies BacktestCheckpoint, now());

  for (let index = nextIndex; index < candles.length - 1; index++) {
    if (input.shouldStop?.()) throw new Error("Backtest stopped by operator; the latest completed bar checkpoint is available for recovery.");
    const bar = candles[index]!;
    const nextBar = candles[index + 1]!;
    const decisionAt = dateForCandle(bar);
    portfolio.mark(new Map([[symbol, bar.close]]), decisionAt);
    const quote: MarketQuote = { symbol, price: bar.close, observedAt: decisionAt, source: "wallex-historical-1m-close" };
    workflow.setStage("market_data", "active", `Historical candle ${index + 1} of ${candles.length - 1}`);
    workflow.setStage("market_data", "completed", `Historical candle ${index + 1} of ${candles.length - 1} ready`);
    const decision = repository.getDecisionAt(runId, symbol, decisionAt) ?? await workflow.evaluate({
        runId, symbol, portfolio: portfolio.current(), now: decisionAt, quote,
        candles: candles.slice(Math.max(0, index - 119), index + 1), research: [],
        memoryHistory,
        mode: "backtest", ...(input.strategy ? { strategy: input.strategy } : {}),
      });
    workflow.setStage("outcome", "active", `Processing the ${decision.proposal.action} decision for historical candle ${index + 1}`);

    if (decision.risk.approved && decision.proposal.order) {
      acceptedProposals++;
      workflow.setStage("final_gate", "active", "Rechecking the proposal against the next completed bar");
      const executionAt = nextBar.timestamp;
      const executionQuote: MarketQuote = { symbol, price: nextBar.open, observedAt: executionAt, source: "wallex-historical-next-bar-open" };
      const executionRisk = await workflow.riskAtExecution(decision, portfolio.current(), executionQuote, executionAt, "backtest", undefined, input.strategy);
      repository.saveRiskOutcome(decision.id, executionRisk);
      workflow.setStage("final_gate", "completed", executionRisk.approved ? "Historical next-bar risk recheck passed" : "Historical next-bar risk recheck blocked the proposal");
      if (executionRisk.approved && executionRisk.normalizedOrder) {
        workflow.setStage("outcome", "active", "Simulating the fill at the next bar open");
        const clientOrderId = decision.orderClientId ?? newWallexClientOrderId();
        const orderProposal = executionRisk.normalizedOrder;
        const simulated = simulateNextBarOpenFill({
          order: orderProposal, clientOrderId, signalCompletedAt: decisionAt, nextBar,
          feeBps: config.backtestFeeBps, slippageBps: config.backtestSlippageBps,
          quoteCurrency: portfolio.current().quoteCurrency,
        });
        const exchangeOrder = simulated.order;
        repository.saveOrderIntent({ clientOrderId, runId, decisionId: decision.id, order: orderProposal, state: "pending", createdAt: decisionAt });
        if (exchangeOrder.fills.length > 0) {
          portfolio.applyFill(exchangeOrder.fills[0]!, nextBar.open);
          fees = fees.plus(simulated.fee);
          slippage = slippage.plus(simulated.slippage);
        }
        repository.updateOrderIntent(clientOrderId, "resolved", exchangeOrder);
        repository.saveFills(exchangeOrder);
        if (!orders.some((item) => item.clientOrderId === exchangeOrder.clientOrderId)) orders.push(exchangeOrder);
        decision.orderClientId = clientOrderId;
      }
    }
    if (!decision.proposal.order) workflow.setStage("outcome", "completed", `Decision ${decision.proposal.action}; no fill was simulated for this candle`);
    const state = portfolio.current();
    appendEquityPoint(equityCurve, state.observedAt, state.equity);
    repository.savePortfolio(runId, state);
    equityPath.push(state.equity);
    const checkpoint: BacktestCheckpoint = { nextIndex: index + 1, portfolio: state, initialEquity, acceptedProposals, fees: fees.toFixed(), slippage: slippage.toFixed() };
    repository.saveCheckpoint(runId, "backtest", checkpoint, now());
  }

  // Include a final mark using only the final candle's completed close.
  const last = candles.at(-1)!;
  const finalState = portfolio.mark(new Map([[symbol, last.close]]), dateForCandle(last));
  equityPath.push(finalState.equity);
  appendEquityPoint(equityCurve, finalState.observedAt, finalState.equity);
  repository.savePortfolio(runId, finalState);
  workflow.setStage("outcome", "active", "Preparing the final performance report");
  const report = buildRunReport({
    runId, mode: "backtest", startedAt, initialEquity, finalEquity: finalState.equity, equityPath,
    acceptedProposals, orders, fees: formatFeesByAsset(orders.flatMap((order) => order.fills)), slippage: slippage.toFixed(),
    symbol, strategyId: input.strategy?.id ?? config.strategies[0]!.id, quoteCurrency: config.wallex.quoteCurrency,
    equityCurve: downsampleEquityCurve(equityCurve), buyAndHoldFinalEquity: buyAndHoldFinalEquity(candles, initialCash, config.backtestFeeBps, config.backtestSlippageBps),
    assumptions: ["Market decisions use completed Wallex 1-minute bars only.", "External news, sentiment, tokenomics, and on-chain feeds are not replayed historically because current feeds would introduce lookahead bias.", "Simulated fills occur at the next bar open at earliest.", `Fee: ${config.backtestFeeBps} bps; slippage: ${config.backtestSlippageBps} bps.`, "Historical candles do not reproduce historical order-book depth or queue position."],
  }, now());
  repository.finishRun(runId, report.endedAt, "completed", report as unknown as Record<string, unknown>);
  workflow.setStage("outcome", "completed", "Backtest report and final portfolio recorded");
  return report;
  } catch (error) {
    repository.finishRun(runId, now(), "failed", undefined, auditFailure(error));
    throw error;
  }
}
