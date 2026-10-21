import { describe, expect, test } from "bun:test";
import { loadConfig } from "../packages/engine/src/domain/config.ts";
import { TradingWorkflow } from "../packages/engine/src/application/trading-workflow.ts";
import { runShadowCycle } from "../packages/engine/src/modes/shadow.ts";
import type { MarketDataPort, ModelPort, ResearchAggregatorPort, RunRepository } from "../packages/engine/src/application/ports.ts";

describe("shadow isolation", () => {
  test("runs a virtual portfolio with only a read-only market-data port", async () => {
    const config = loadConfig({ AI_API_KEY: "test-key", WALLEX_ALLOWED_MARKETS: "BTCUSDT" });
    const marketData: MarketDataPort = {
      listSpotMarkets: async () => [{ symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", pricePrecision: 2, quantityPrecision: 4, minQuantity: "0", minNotional: "0", spotEnabled: true }],
      getQuote: async (symbol) => ({ symbol, price: "100", observedAt: 1_000, source: "wallex-rest" }),
      getDepth: async () => ({ bids: [], asks: [], observedAt: 1_000 }),
      getCandles: async () => [],
    };
    const aggregator: ResearchAggregatorPort = { collect: async () => ({ items: [], warnings: [] }) };
    const model: ModelPort = {
      analyze: async (role) => ({ role, summary: "No relevant evidence.", confidence: 0.2, evidenceIds: [], createdAt: 1_000 }),
      propose: async (_role) => ({ action: "HOLD", symbol: "BTCUSDT", confidence: 0.2, rationale: "No signal.", evidenceIds: [], order: null }),
      reflect: async () => "Fixture reflection.",
    };
    let savedIntents = 0;
    const repository = {
      createRun: () => undefined, finishRun: () => undefined, saveSnapshot: () => "snapshot",
      saveDecision: () => undefined, saveDecisionAndMemory: () => undefined, saveRiskOutcome: () => undefined,
      createOrderIntent: () => true, getOrderIntent: () => null,
      saveOrderIntent: () => { savedIntents++; }, getPendingOrderIntents: () => [],
      updateOrderIntent: () => undefined, saveFills: () => undefined, savePortfolio: () => undefined,
      saveCheckpoint: () => undefined, loadCheckpoint: () => null, saveReflection: () => undefined,
      savePendingDecisionMemory: () => undefined, getMaturedDecisionMemories: () => [], settleDecisionMemory: () => true,
      getDecisionMemoryLessons: () => [],
      getLatestPortfolio: () => null, getReflections: () => [], getRun: () => null, getRecentRuns: () => [], close: () => undefined,
      getDecisionAt: () => null, getRunDetails: () => null, acquireExecutionLease: () => true, releaseExecutionLease: () => undefined,
      saveShadowExecution: () => undefined, failInterruptedRuns: () => undefined,
    } as unknown as RunRepository;
    const workflow = new TradingWorkflow(config, marketData, aggregator, model, repository, () => 1_000);
    const result = await runShadowCycle("BTCUSDT", config, marketData, workflow, repository, () => 1_000);
    expect(result.decision.proposal.action).toBe("HOLD");
    expect(savedIntents).toBe(0);
    expect("submitOrder" in marketData).toBe(false);
  });
});

