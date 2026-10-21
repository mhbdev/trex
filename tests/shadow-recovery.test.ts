import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { SqliteRunRepository } from "../packages/engine/src/adapters/persistence/store.ts";
import type { MarketDataPort, ModelPort, ResearchAggregatorPort, RunRepository } from "../packages/engine/src/application/ports.ts";
import { TradingWorkflow } from "../packages/engine/src/application/trading-workflow.ts";
import { loadConfig } from "../packages/engine/src/domain/config.ts";
import type { DecisionProposal } from "../packages/engine/src/domain/types.ts";
import { runShadowCycle } from "../packages/engine/src/modes/shadow.ts";

describe("shadow fill recovery", () => {
  test("replays a pending simulated fill atomically after a crash", async () => {
    const repository = new SqliteRunRepository("file::memory:");
    try {
      repository.migrate(resolve("packages/engine/drizzle"));
      const config = loadConfig({
        AI_API_KEY: "test-key", WALLEX_ALLOWED_MARKETS: "BTCUSDT", PAPER_INITIAL_CASH: "1000",
        BACKTEST_FEE_BPS: "100", BACKTEST_SLIPPAGE_BPS: "0",
      });
      const portfolioKey = "shadow:BTCUSDT:agentic-balanced";
      const marketData: MarketDataPort = {
        listSpotMarkets: async () => [{ symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", pricePrecision: 2, quantityPrecision: 4, minQuantity: "0.0001", minNotional: "1", spotEnabled: true }],
        getQuote: async (symbol) => ({ symbol, price: "100", observedAt: 10_000, source: "wallex-rest" }),
        getDepth: async () => ({ bids: [["99.9", "10"]], asks: [["100", "10"]], observedAt: 10_000 }),
        getCandles: async () => [],
      };
      const aggregator: ResearchAggregatorPort = { collect: async () => ({ items: [], warnings: [] }) };
      let portfolioProposals = 0;
      const model: ModelPort = {
        analyze: async (role) => ({ role, summary: "Fixture evidence.", confidence: 0.5, evidenceIds: [], createdAt: 10_000 }),
        propose: async (role, _instruction, context): Promise<DecisionProposal> => {
          if (role === "portfolio_manager") portfolioProposals++;
          const buy = role !== "portfolio_manager" || portfolioProposals === 1;
          return buy
            ? { action: "BUY", symbol: context.symbol, confidence: 0.8, rationale: "Fixture shadow buy", evidenceIds: [], order: { symbol: context.symbol, side: "BUY", type: "MARKET", quantity: "0.1" } }
            : { action: "HOLD", symbol: context.symbol, confidence: 0.5, rationale: "Fixture hold", evidenceIds: [], order: null };
        },
        reflect: async () => "Fixture reflection.",
      };
      const workflow = new TradingWorkflow(config, marketData, aggregator, model, repository, () => 10_000);
      let injectedFailure = false;
      const flakyRepository = new Proxy(repository, {
        get(target, property) {
          if (property === "saveShadowExecution") return () => {
            if (!injectedFailure) { injectedFailure = true; throw new Error("simulated crash before atomic shadow write"); }
          };
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as RunRepository;

      await expect(runShadowCycle("BTCUSDT", config, marketData, workflow, flakyRepository, () => 10_000)).rejects.toThrow("simulated crash");
      expect(repository.getPendingOrderIntents("shadow", portfolioKey)).toHaveLength(1);
      await runShadowCycle("BTCUSDT", config, marketData, workflow, repository, () => 10_000);
      expect(repository.getPendingOrderIntents("shadow", portfolioKey)).toHaveLength(0);
      const finalPortfolio = repository.getLatestPortfolio("shadow", portfolioKey);
      expect(finalPortfolio?.positions[0]?.quantity).toBe("0.1");
      expect(finalPortfolio?.cash).toBe("989.9");
      expect(finalPortfolio?.equity).toBe("999.9");
      expect(finalPortfolio?.positions[0]?.averageEntryPrice).toBe("101");
      const previousRun = repository.getRecentRuns(5).find((run) => run.mode === "shadow" && (run.status === "failed"));
      expect(previousRun).toBeDefined();
      const details = repository.getRunDetails(String(previousRun?.id)) as { orders: Array<{ fills: unknown[]; state: string }> };
      expect(details.orders).toHaveLength(1);
      expect(details.orders[0]?.fills).toHaveLength(1);
      expect(details.orders[0]?.state).toBe("resolved");
    } finally { repository.close(); }
  });
});

