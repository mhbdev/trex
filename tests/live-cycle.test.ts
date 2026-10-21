import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { SqliteRunRepository } from "../packages/engine/src/adapters/persistence/store.ts";
import type { MarketDataPort, ModelPort, OrderExecutionPort, ResearchAggregatorPort } from "../packages/engine/src/application/ports.ts";
import { TradingWorkflow } from "../packages/engine/src/application/trading-workflow.ts";
import { loadConfig } from "../packages/engine/src/domain/config.ts";
import type { DecisionProposal, ExchangeOrder, Fill, PortfolioState } from "../packages/engine/src/domain/types.ts";
import { runLiveCycle } from "../packages/engine/src/modes/live.ts";

describe("live cycle orchestration", () => {
  test("leases the runner, rechecks risk, and persists the submitted order and fill", async () => {
    const repository = new SqliteRunRepository("file::memory:");
    try {
      repository.migrate(resolve("packages/engine/drizzle"));
      const config = loadConfig({
        AI_API_KEY: "test-key", WALLEX_API_KEY: "credit-key", WALLEX_SUB_ACCOUNT_CLIENT_ID: "credit-account",
        WALLEX_PACKAGE_ID: "10", WALLEX_ALLOWED_MARKETS: "BTCUSDT", WALLEX_ENABLE_LIVE_TRADING: "true",
        LIVE_MAX_GROSS_EXPOSURE: "1000",
        PAPER_INITIAL_CASH: "1000", RISK_FEE_BUFFER_BPS: "50",
      });
      const account: PortfolioState = {
        quoteCurrency: "USDT", cash: "1000", positions: [], equity: "1000", highWatermark: "1000",
        realizedPnlToday: "0", dayStartEquity: "1000", observedAt: 10_000,
      };
      const marketData: MarketDataPort = {
        listSpotMarkets: async () => [{ symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", pricePrecision: 2, quantityPrecision: 4, minQuantity: "0.0001", minNotional: "1", spotEnabled: true }],
        getQuote: async (symbol) => ({ symbol, price: "100", observedAt: 10_000, source: "wallex-rest" }),
        getDepth: async () => ({ bids: [["99", "10"]], asks: [["100.1", "10"]], observedAt: 10_000 }),
        getCandles: async () => [],
        getAccountPortfolio: async () => account,
        getPackageUnavailableMarkets: async () => [],
      };
      const aggregator: ResearchAggregatorPort = { collect: async () => ({ items: [], warnings: [] }) };
      const model: ModelPort = {
        analyze: async (role) => ({ role, summary: "No adverse source evidence.", confidence: 0.7, evidenceIds: [], createdAt: 10_000 }),
        propose: async (role, _instruction, context): Promise<DecisionProposal> => role === "portfolio_manager"
          ? { action: "BUY", symbol: context.symbol, confidence: 0.9, rationale: "Fixture live proposal", evidenceIds: [], order: { symbol: context.symbol, side: "BUY", type: "MARKET", quantity: "0.1" } }
          : { action: "BUY", symbol: context.symbol, confidence: 0.8, rationale: "Fixture candidate", evidenceIds: [], order: { symbol: context.symbol, side: "BUY", type: "MARKET", quantity: "0.1" } },
        reflect: async () => "Fixture reflection.",
      };
      const workflow = new TradingWorkflow(config, marketData, aggregator, model, repository, () => 10_000);
      const fill: Fill = { id: "fill-1", orderClientId: "WA_LIVE_TEST", symbol: "BTCUSDT", side: "BUY", quantity: "0.1", price: "100", fee: "0.1", feeAsset: "USDT", timestamp: 10_001 };
      const exchangeOrder: ExchangeOrder = { clientOrderId: "WA_LIVE_TEST", symbol: "BTCUSDT", side: "BUY", status: "FILLED", quantity: "0.1", executedQuantity: "0.1", averagePrice: "100", fills: [fill], updatedAt: 10_001 };
      let submissions = 0;
      const execution: OrderExecutionPort = {
        submitOrder: async (_order, clientOrderId) => {
          submissions++;
          return { ...exchangeOrder, clientOrderId, fills: [{ ...fill, id: `${clientOrderId}:0`, orderClientId: clientOrderId }] };
        },
        getOrder: async () => exchangeOrder,
        cancelOrder: async () => null,
        listOpenOrders: async () => [],
      };
      expect(repository.acquireExecutionLease("wallex-live", "other-runner", 10_000, 60_000)).toBe(true);
      await expect(runLiveCycle("BTCUSDT", config, marketData, execution, workflow, repository, () => 10_000)).rejects.toThrow("lease");
      expect(repository.getRecentRuns(5)).toHaveLength(0);
      repository.releaseExecutionLease("wallex-live", "other-runner");
      await expect(runLiveCycle("BTCUSDT", config, marketData, execution, workflow, repository, () => 10_000, () => true)).rejects.toThrow("no order was sent");
      expect(submissions).toBe(0);
      const result = await runLiveCycle("BTCUSDT", config, marketData, execution, workflow, repository, () => 10_000);
      expect(submissions).toBe(1);
      expect(result.order?.status).toBe("FILLED");
      expect(result.report.tradeCount).toBe(1);
      const details = repository.getRunDetails(result.report.runId) as { decisions: unknown[]; orders: Array<{ state: string; fills: unknown[] }> };
      expect(details.decisions).toHaveLength(1);
      expect(details.orders[0]?.state).toBe("resolved");
      expect(details.orders[0]?.fills).toHaveLength(1);
      expect(repository.acquireExecutionLease("wallex-live", "other-runner", 10_001, 60_000)).toBe(true);
      repository.releaseExecutionLease("wallex-live", "other-runner");
    } finally { repository.close(); }
  });
});

