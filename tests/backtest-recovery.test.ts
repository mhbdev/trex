import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { SqliteRunRepository } from "../packages/engine/src/adapters/persistence/store.ts";
import type { RunRepository, MarketDataPort, ModelPort, ResearchAggregatorPort } from "../packages/engine/src/application/ports.ts";
import { TradingWorkflow } from "../packages/engine/src/application/trading-workflow.ts";
import { loadConfig } from "../packages/engine/src/domain/config.ts";
import type { Candle, DecisionProposal } from "../packages/engine/src/domain/types.ts";
import { runBacktest } from "../packages/engine/src/modes/backtest.ts";

describe("backtest restart recovery", () => {
  test("reuses stored decisions and does not duplicate fills when a step checkpoint fails", async () => {
    const repository = new SqliteRunRepository("file::memory:");
    try {
      repository.migrate(resolve("packages/engine/drizzle"));
      const config = loadConfig({
        AI_API_KEY: "test-key", WALLEX_ALLOWED_MARKETS: "BTCUSDT",
        PAPER_INITIAL_CASH: "1000", BACKTEST_FEE_BPS: "0", BACKTEST_SLIPPAGE_BPS: "0",
      });
      const candles: Candle[] = [
        { symbol: "BTCUSDT", timestamp: 0, open: "99", high: "101", low: "98", close: "100", volume: "10", complete: true },
        { symbol: "BTCUSDT", timestamp: 60_000, open: "105", high: "111", low: "104", close: "110", volume: "10", complete: true },
        { symbol: "BTCUSDT", timestamp: 120_000, open: "115", high: "121", low: "114", close: "120", volume: "10", complete: true },
      ];
      const marketData: MarketDataPort = {
        listSpotMarkets: async () => [{ symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", pricePrecision: 2, quantityPrecision: 4, minQuantity: "0.0001", minNotional: "1", spotEnabled: true }],
        getQuote: async (symbol) => ({ symbol, price: "100", observedAt: 0, source: "wallex-rest" }),
        getDepth: async () => ({ bids: [], asks: [], observedAt: 0 }),
        getCandles: async () => candles,
      };
      const aggregator: ResearchAggregatorPort = { collect: async () => ({ items: [], warnings: [] }) };
      let portfolioProposals = 0;
      const model: ModelPort = {
        analyze: async (role) => ({ role, summary: "No extra evidence.", confidence: 0.5, evidenceIds: [], createdAt: 0 }),
        propose: async (role, _instruction, context): Promise<DecisionProposal> => {
          if (role === "portfolio_manager") portfolioProposals++;
          const buy = role !== "portfolio_manager" || portfolioProposals === 1;
          return buy
            ? { action: "BUY", symbol: context.symbol, confidence: 0.8, rationale: "Fixture buy signal", evidenceIds: [], order: { symbol: context.symbol, side: "BUY", type: "MARKET", quantity: "0.1" } }
            : { action: "HOLD", symbol: context.symbol, confidence: 0.6, rationale: "Fixture hold", evidenceIds: [], order: null };
        },
        reflect: async () => "Fixture reflection.",
      };
      const workflow = new TradingWorkflow(config, marketData, aggregator, model, repository, () => 0);
      let injectedFailure = false;
      const flakyRepository = new Proxy(repository, {
        get(target, property) {
          if (property === "saveCheckpoint") return (runId: string, key: string, payload: unknown, updatedAt: number) => {
            if (!injectedFailure && (payload as { nextIndex?: number }).nextIndex === 1) {
              injectedFailure = true;
              throw new Error("simulated process failure before checkpoint commit");
            }
            return target.saveCheckpoint(runId, key, payload, updatedAt);
          };
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as RunRepository;
      const input = { symbol: "BTCUSDT", fromSeconds: 0, toSeconds: 180, runId: "backtest-recovery", resume: false };

      await expect(runBacktest(input, config, marketData, workflow, flakyRepository, () => 0)).rejects.toThrow("simulated process failure");
      expect(portfolioProposals).toBe(1);

      const report = await runBacktest({ ...input, resume: true }, config, marketData, workflow, repository, () => 0);
      expect(portfolioProposals).toBe(2);
      expect(report.tradeCount).toBe(1);
      expect(report.finalEquity).toBe("1001.5");
      const details = repository.getRunDetails("backtest-recovery") as { decisions: unknown[]; orders: Array<{ fills: unknown[] }> };
      expect(details.decisions).toHaveLength(2);
      expect(details.orders).toHaveLength(1);
      expect(details.orders[0]?.fills).toHaveLength(1);
      await expect(runBacktest({ ...input, toSeconds: 240, resume: true }, config, marketData, workflow, repository, () => 0))
        .rejects.toThrow("configuration does not match");
    } finally { repository.close(); }
  });
});

