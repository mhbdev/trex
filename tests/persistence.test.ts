import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { SqliteRunRepository } from "../packages/engine/src/adapters/persistence/store.ts";
import type { OrderIntent, TradeDecision } from "../packages/engine/src/domain/types.ts";

describe("Drizzle Bun SQLite persistence", () => {
  test("applies migrations and stores source snapshots, checkpoints, and isolated portfolios", () => {
    const repository = new SqliteRunRepository("file::memory:");
    try {
      repository.migrate(resolve("packages/engine/drizzle"));
      repository.createRun({ id: "live-1", mode: "live", config: { symbol: "BTCUSDT" }, startedAt: 100 });
      repository.createRun({ id: "shadow-1", mode: "shadow", config: { symbol: "BTCUSDT" }, startedAt: 101 });
      repository.createRun({ id: "shadow-2", mode: "shadow", config: { symbol: "ETHUSDT" }, startedAt: 102 });
      repository.createRun({ id: "backtest-1", mode: "backtest", config: { symbol: "BTCUSDT" }, startedAt: 103 });
      repository.createRun({ id: "shadow-btc-momentum", mode: "shadow", config: { symbol: "BTCUSDT", strategy: { id: "momentum" } }, startedAt: 104 });
      repository.createRun({ id: "shadow-eth-momentum", mode: "shadow", config: { symbol: "ETHUSDT", strategy: { id: "momentum" } }, startedAt: 105 });
      repository.createRun({ id: "shadow-failed", mode: "shadow", config: { symbol: "SOLUSDT" }, startedAt: 106 });
      const report = { runId: "shadow-btc-momentum", mode: "shadow", symbol: "BTCUSDT", strategyId: "momentum", startedAt: 104, endedAt: 106, initialEquity: "100", finalEquity: "101", netReturnPct: "1", maxDrawdownPct: "0", tradeCount: 0, acceptedProposals: 0, volume: "0", averageTradeSize: "0", executionReliabilityPct: "100", fees: "0", slippage: "0", assumptions: [] };
      repository.finishRun("shadow-btc-momentum", 106, "completed", report);
      repository.finishRun("shadow-eth-momentum", 107, "completed", { ...report, runId: "shadow-eth-momentum", symbol: "ETHUSDT" });
      repository.finishRun("shadow-1", 108, "completed", { ...report, runId: "shadow-1", startedAt: 101, endedAt: 108, strategyId: undefined, symbol: undefined });
      repository.finishRun("shadow-failed", 109, "failed", undefined, { name: "FixtureError", message: "Market feed timed out." });
      repository.saveSnapshot({ runId: "live-1", category: "quote", source: "wallex", symbol: "BTCUSDT", observedAt: 102, payload: { price: "10" } });
      const historicalData = [{ timestamp: 60_000, close: "10" }];
      repository.saveSnapshot({ runId: "backtest-1", category: "backtest_dataset", source: "wallex-candles", symbol: "BTCUSDT", observedAt: 103, payload: historicalData });
      repository.saveCheckpoint("live-1", "resume", { offset: 3 }, 103);
      repository.saveReflection("shadow-1", "BTCUSDT", "momentum memory", 103, "shadow:BTCUSDT:momentum");
      const decision: TradeDecision = {
        id: "decision-1", runId: "live-1", symbol: "BTCUSDT", decidedAt: 103,
        quote: { symbol: "BTCUSDT", price: "10", observedAt: 103, source: "wallex-rest" },
        evidence: [{ id: "source-1", summary: "quote at 10", source: "wallex", observedAt: 103, confidence: 1 }],
        findings: [], proposal: { action: "HOLD", symbol: "BTCUSDT", confidence: 0.5, rationale: "wait", evidenceIds: ["source-1"], order: null },
        risk: { approved: false, reasons: ["hold"], checkedAt: 103 },
      };
      repository.saveDecision(decision);
      repository.savePortfolio("live-1", {
        quoteCurrency: "USDT", cash: "90", positions: [{ symbol: "BTCUSDT", quantity: "1", averageEntryPrice: "10" }],
        equity: "100", highWatermark: "110", realizedPnlToday: "-2", dayStartEquity: "102", observedAt: 104,
      });
      repository.savePortfolio("shadow-1", {
        quoteCurrency: "USDT", cash: "200", positions: [], equity: "200", highWatermark: "200", realizedPnlToday: "0", dayStartEquity: "200", observedAt: 105,
      });
      repository.savePortfolio("shadow-1", {
        quoteCurrency: "USDT", cash: "80", positions: [{ symbol: "BTCUSDT", quantity: "1", averageEntryPrice: "20" }],
        equity: "100", highWatermark: "100", realizedPnlToday: "0", dayStartEquity: "100", observedAt: 106,
      }, "shadow:BTCUSDT:momentum");
      repository.savePortfolio("shadow-2", {
        quoteCurrency: "USDT", cash: "300", positions: [], equity: "300", highWatermark: "300", realizedPnlToday: "0", dayStartEquity: "300", observedAt: 107,
      }, "shadow:ETHUSDT:momentum");
      expect(repository.loadSnapshot("live-1", "quote")).toEqual({ price: "10" });
      expect(repository.loadCheckpoint("live-1", "resume")).toEqual({ offset: 3 });
      expect(repository.getReflections("BTCUSDT", 5, "shadow:BTCUSDT:momentum")).toEqual(["momentum memory"]);
      expect(repository.getReflections("BTCUSDT", 5, "shadow:BTCUSDT:mean-reversion")).toEqual([]);
      expect(repository.getDecisionAt("live-1", "BTCUSDT", 103)?.proposal.rationale).toBe("wait");
      expect(repository.getRunDetails("live-1")?.decisions).toHaveLength(1);
      expect(repository.getRunDetails("shadow-failed")?.run.failureName).toBe("FixtureError");
      expect(repository.getRunDetails("shadow-failed")?.run.failureMessage).toBe("Market feed timed out.");
      expect((repository.getRunDetails("live-1") as { portfolioHistory: Array<{ equity: string }> }).portfolioHistory.at(-1)?.equity).toBe("100");
      expect((repository.getRunDetails("backtest-1", true) as { backtestDataset: unknown[] }).backtestDataset).toEqual(historicalData);
      expect(repository.getLatestPortfolio("live")?.highWatermark).toBe("110");
      expect(repository.getLatestPortfolio("shadow")?.cash).toBe("200");
      expect(repository.getLatestPortfolio("shadow", "shadow:BTCUSDT:momentum")?.equity).toBe("100");
      expect(repository.getLatestPortfolio("shadow", "shadow:ETHUSDT:momentum")?.cash).toBe("300");
      expect(repository.getLatestPortfolio("shadow", "shadow:BTCUSDT:agentic-balanced")).toBeNull();
      expect(repository.getRunReportsForPortfolioKey("shadow", "BTCUSDT", "momentum").map((item) => item.runId)).toEqual(["shadow-btc-momentum"]);
      expect(repository.getRecentRunIds("shadow", ["BTCUSDT"], ["momentum"], 10)).toEqual({ runIds: ["shadow-btc-momentum"], total: 1 });
      const legacyShadowReport = repository.getRunReportsForPortfolioKey("shadow", "BTCUSDT", "agentic-balanced")[0];
      expect(legacyShadowReport?.symbol).toBe("BTCUSDT");
      expect(legacyShadowReport?.strategyId).toBe("agentic-balanced");
      expect(repository.getPendingOrderIntents("live")).toEqual([]);
      expect(repository.getPendingOrderIntents("shadow")).toEqual([]);
      expect(repository.acquireExecutionLease("wallex-live", "owner-a", 100, 1000)).toBe(true);
      expect(repository.acquireExecutionLease("wallex-live", "owner-b", 101, 1000)).toBe(false);
      expect(repository.acquireExecutionLease("wallex-live", "owner-b", 1101, 1000)).toBe(true);
      repository.releaseExecutionLease("wallex-live", "owner-a");
      expect(repository.acquireExecutionLease("wallex-live", "owner-c", 1102, 1000)).toBe(false);
      const intent: OrderIntent = {
        clientOrderId: "WA_RESERVE_1", runId: "live-1", decisionId: "decision-1",
        order: { symbol: "BTCUSDT", side: "BUY", type: "LIMIT", quantity: "0.1", price: "10" },
        state: "pending", createdAt: 1110,
      };
      expect(repository.createOrderIntent(intent)).toBe(true);
      expect(repository.createOrderIntent(intent)).toBe(false);
      expect(repository.getOrderIntent(intent.clientOrderId)?.runId).toBe("live-1");
      expect(repository.getPendingOrderIntents("live")).toHaveLength(1);
    } finally { repository.close(); }
  });
});

