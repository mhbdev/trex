import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { SqliteRunRepository } from "../packages/engine/src/adapters/persistence/store.ts";
import type { MarketDataPort, ModelPort, ResearchAggregatorPort } from "../packages/engine/src/application/ports.ts";
import { TradingWorkflow } from "../packages/engine/src/application/trading-workflow.ts";
import { loadConfig } from "../packages/engine/src/domain/config.ts";
import type { DecisionProposal } from "../packages/engine/src/domain/types.ts";

describe("workflow execution-time risk clock", () => {
  test("checks freshly fetched depth against the time it was observed", async () => {
    const repository = new SqliteRunRepository("file::memory:");
    try {
      repository.migrate(resolve("packages/engine/drizzle"));
      repository.createRun({ id: "clock-run", mode: "shadow", config: {}, startedAt: 10_000 });
      const config = loadConfig({ AI_API_KEY: "test-key", WALLEX_ALLOWED_MARKETS: "BTCUSDT" });
      const marketData: MarketDataPort = {
        listSpotMarkets: async () => [{ symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", pricePrecision: 2, quantityPrecision: 4, minQuantity: "0.0001", minNotional: "1", spotEnabled: true }],
        getQuote: async (symbol) => ({ symbol, price: "100", observedAt: 10_000, source: "wallex-rest" }),
        getDepth: async () => ({ bids: [["99.9", "10"]], asks: [["100.1", "10"]], observedAt: 20_000 }),
        getCandles: async () => [],
      };
      const aggregator: ResearchAggregatorPort = { collect: async () => ({ items: [], warnings: [] }) };
      const model: ModelPort = {
        analyze: async (role) => ({ role, summary: "Evidence is adequate.", confidence: 0.8, evidenceIds: [], createdAt: 10_000 }),
        propose: async (role, _instruction, context): Promise<DecisionProposal> => ({
          action: "BUY", symbol: context.symbol, confidence: 0.8, rationale: `Proposal from ${role}.`, evidenceIds: [],
          order: { symbol: context.symbol, side: "BUY", type: "MARKET", quantity: "0.1" },
        }),
        reflect: async () => "Fixture reflection.",
      };
      const workflow = new TradingWorkflow(config, marketData, aggregator, model, repository, () => 20_000);
      const decision = await workflow.evaluate({
        runId: "clock-run", symbol: "BTCUSDT",
        portfolio: { quoteCurrency: "USDT", cash: "1000", positions: [], equity: "1000", highWatermark: "1000", realizedPnlToday: "0", observedAt: 10_000 },
        now: 10_000, quote: { symbol: "BTCUSDT", price: "100", observedAt: 10_000, source: "wallex-rest" },
        candles: [], research: [], mode: "shadow",
      });
      expect(decision.risk.approved).toBe(true);
      expect(decision.risk.checkedAt).toBe(20_000);
    } finally { repository.close(); }
  });

  test("applies the explicit live exposure ceiling independently of backtest and shadow budgets", async () => {
    const repository = new SqliteRunRepository("file::memory:");
    try {
      repository.migrate(resolve("packages/engine/drizzle"));
      repository.createRun({ id: "live-cap-run", mode: "live", config: {}, startedAt: 10_000 });
      const config = loadConfig({
        AI_API_KEY: "test-key", WALLEX_ALLOWED_MARKETS: "BTC/TMN", WALLEX_QUOTE_CURRENCY: "TMN",
        LIVE_MAX_GROSS_EXPOSURE: "50", RISK_MAX_GROSS_EXPOSURE: "1000000",
      });
      const marketData: MarketDataPort = {
        listSpotMarkets: async () => [{ symbol: "BTCTMN", baseAsset: "BTC", quoteAsset: "TMN", pricePrecision: 0, quantityPrecision: 4, minQuantity: "0.0001", minNotional: "1", spotEnabled: true }],
        getQuote: async (symbol) => ({ symbol, price: "100", observedAt: 20_000, source: "wallex-rest" }),
        getDepth: async () => ({ bids: [["99", "10"]], asks: [["100", "10"]], observedAt: 20_000 }),
        getCandles: async () => [],
      };
      const aggregator: ResearchAggregatorPort = { collect: async () => ({ items: [], warnings: [] }) };
      const model: ModelPort = {
        analyze: async (role) => ({ role, summary: "Evidence is adequate.", confidence: 0.8, evidenceIds: [], createdAt: 20_000 }),
        propose: async (role, _instruction, context): Promise<DecisionProposal> => ({
          action: "BUY", symbol: context.symbol, confidence: 0.8, rationale: `Proposal from ${role}.`, evidenceIds: [],
          order: { symbol: context.symbol, side: "BUY", type: "MARKET", quantity: "1" },
        }),
        reflect: async () => "Fixture reflection.",
      };
      const workflow = new TradingWorkflow(config, marketData, aggregator, model, repository, () => 20_000);
      const decision = await workflow.evaluate({
        runId: "live-cap-run", symbol: "BTC/TMN",
        portfolio: { quoteCurrency: "TMN", cash: "1000", positions: [], equity: "1000", highWatermark: "1000", realizedPnlToday: "0", observedAt: 20_000 },
        now: 20_000, quote: { symbol: "BTCTMN", price: "100", observedAt: 20_000, source: "wallex-rest" },
        candles: [], research: [], mode: "live",
      });
      expect(decision.risk.approved).toBe(false);
      expect(decision.risk.reasons.join(" ")).toContain("Maximum gross exposure exceeded");
    } finally { repository.close(); }
  });
});

