import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { SqliteRunRepository } from "../packages/engine/src/adapters/persistence/store.ts";
import type { MarketDataPort, ModelPort, ResearchAggregatorPort } from "../packages/engine/src/application/ports.ts";
import { DecisionMemoryService } from "../packages/engine/src/application/decision-memory.ts";
import { TradingWorkflow } from "../packages/engine/src/application/trading-workflow.ts";
import { loadConfig } from "../packages/engine/src/domain/config.ts";
import type { Candle, DecisionProposal, TradeDecision } from "../packages/engine/src/domain/types.ts";

function candles(symbol: string, closes: string[]): Candle[] {
  return closes.map((close, index) => ({
    symbol, timestamp: (index + 1) * 60_000, open: close, high: close, low: close, close,
    volume: "10", complete: true,
  }));
}

const portfolio = {
  quoteCurrency: "USDT", cash: "1000", positions: [], equity: "1000", highWatermark: "1000",
  realizedPnlToday: "0", observedAt: 60_000,
};

describe("agent debate, risk review, and decision memory", () => {
  test("alternates bull/bear turns and cycles risk reviewers in reference order", async () => {
    const repository = new SqliteRunRepository("file::memory:");
    try {
      repository.migrate(resolve("packages/engine/drizzle"));
      repository.createRun({ id: "debate-run", mode: "shadow", config: {}, startedAt: 60_000 });
      const config = loadConfig({
        AI_API_KEY: "test-key", WALLEX_ALLOWED_MARKETS: "BTCUSDT",
        ENGINE_MAX_DEBATE_ROUNDS: "2", ENGINE_MAX_RISK_DISCUSS_ROUNDS: "2",
      });
      const marketData: MarketDataPort = {
        listSpotMarkets: async () => [{ symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", pricePrecision: 2, quantityPrecision: 4, minQuantity: "0", minNotional: "0", spotEnabled: true }],
        getQuote: async (symbol) => ({ symbol, price: "100", observedAt: 60_000, source: "fixture" }),
        getDepth: async () => ({ bids: [], asks: [], observedAt: 60_000 }),
        getCandles: async () => [],
      };
      const aggregator: ResearchAggregatorPort = { collect: async () => ({ items: [], warnings: [] }) };
      const calls: { role: string; round: number; prior: string[] }[] = [];
      const model: ModelPort = {
        analyze: async (role, context) => {
          calls.push({ role, round: context.discussionTurn?.round ?? 0, prior: context.priorFindings.map((finding) => finding.role) });
          return { role, summary: `${role} round ${context.discussionTurn?.round ?? 0}`, confidence: 0.7, evidenceIds: [], createdAt: 60_000 };
        },
        propose: async (_role, _instruction, context): Promise<DecisionProposal> => ({
          action: "HOLD", symbol: context.symbol, confidence: 0.5, rationale: "No order for this fixture.", evidenceIds: [], order: null,
        }),
        reflect: async () => "Fixture reflection.",
      };
      await new TradingWorkflow(config, marketData, aggregator, model, repository, () => 60_000).evaluate({
        runId: "debate-run", symbol: "BTCUSDT", portfolio, now: 60_000,
        quote: { symbol: "BTCUSDT", price: "100", observedAt: 60_000, source: "fixture" },
        candles: [], research: [], mode: "shadow",
      });

      const researchers = calls.filter((call) => call.role === "bull_researcher" || call.role === "bear_researcher");
      expect(researchers.map(({ role, round }) => `${role}:${round}`)).toEqual([
        "bull_researcher:1", "bear_researcher:1", "bull_researcher:2", "bear_researcher:2",
      ]);
      expect(researchers[1]!.prior).toContain("bull_researcher");
      expect(researchers[2]!.prior.slice(-2)).toEqual(["bull_researcher", "bear_researcher"]);
      const risk = calls.filter((call) => call.role.includes("risk_analyst"));
      expect(risk.map(({ role, round }) => `${role}:${round}`)).toEqual([
        "aggressive_risk_analyst:1", "conservative_risk_analyst:1", "neutral_risk_analyst:1",
        "aggressive_risk_analyst:2", "conservative_risk_analyst:2", "neutral_risk_analyst:2",
      ]);
      expect(risk[1]!.prior.at(-1)).toBe("aggressive_risk_analyst");
      expect(risk[3]!.prior.slice(-3)).toEqual(["aggressive_risk_analyst", "conservative_risk_analyst", "neutral_risk_analyst"]);
    } finally { repository.close(); }
  });

  test("settles only after the full holding window and exposes outcome lessons as-of resolution", async () => {
    const repository = new SqliteRunRepository("file::memory:");
    try {
      repository.migrate(resolve("packages/engine/drizzle"));
      repository.createRun({ id: "memory-run", mode: "backtest", config: {}, startedAt: 60_000 });
      const config = loadConfig({ AI_API_KEY: "test-key", MEMORY_HOLDING_PERIOD_BARS: "2" });
      let reflections = 0;
      const marketData: MarketDataPort = {
        listSpotMarkets: async () => [], getQuote: async () => { throw new Error("not used"); },
        getDepth: async () => ({ bids: [], asks: [], observedAt: 0 }), getCandles: async () => [],
      };
      const model: ModelPort = {
        analyze: async () => { throw new Error("not used"); },
        propose: async () => { throw new Error("not used"); },
        reflect: async (input) => {
          reflections++;
          expect(Number(input.rawReturn)).toBeCloseTo(0.2, 8);
          expect(Number(input.benchmarkReturn)).toBeCloseTo(0.1, 8);
          expect(Number(input.alphaReturn)).toBeCloseTo(0.1, 8);
          return "The BUY outperformed the BTC benchmark over the measured window.";
        },
      };
      const decision: TradeDecision = {
        id: "memory-decision", runId: "memory-run", symbol: "ETHUSDT", decidedAt: 60_000,
        quote: { symbol: "ETHUSDT", price: "105", observedAt: 60_000, source: "fixture" }, evidence: [], findings: [],
        proposal: { action: "BUY", symbol: "ETHUSDT", confidence: 0.8, rationale: "Fixture buy thesis.", evidenceIds: [], order: { symbol: "ETHUSDT", side: "BUY", type: "MARKET", quantity: "1" } },
        risk: { approved: true, reasons: [], checkedAt: 60_000 },
      };
      const memoryService = new DecisionMemoryService(config, marketData, model, repository);
      const memory = memoryService.createPending({
        id: decision.id, runId: decision.runId, symbol: decision.symbol, decidedAt: decision.decidedAt,
        action: "BUY", rationale: decision.proposal.rationale, confidence: decision.proposal.confidence,
        risk: decision.risk, quotePrice: decision.quote.price,
      }, "memory:backtest:test", "BTCUSDT");
      repository.saveDecisionAndMemory(decision, memory);
      const history = new Map<string, readonly Candle[]>([
        ["ETHUSDT", candles("ETHUSDT", ["100", "110", "120"])],
        ["BTCUSDT", candles("BTCUSDT", ["50", "55", "55"])],
      ]);

      const tooEarly = await memoryService.settleMatured(memory.contextKey, 239_999, history);
      expect(tooEarly.settled).toBe(0);
      expect(reflections).toBe(0);
      expect(repository.getDecisionMemoryLessons("ETHUSDT", memory.contextKey, 240_000, 5, 3)).toEqual([]);

      const due = await memoryService.settleMatured(memory.contextKey, 240_000, history);
      expect(due.settled).toBe(1);
      expect(reflections).toBe(1);
      expect(repository.getDecisionMemoryLessons("ETHUSDT", memory.contextKey, 239_999, 5, 3)).toEqual([]);
      expect(repository.getDecisionMemoryLessons("ETHUSDT", memory.contextKey, 240_000, 5, 3)).toHaveLength(1);
      expect(repository.getDecisionMemoryLessons("BTCUSDT", memory.contextKey, 240_000, 5, 3)[0]).toContain("ETHUSDT");
      const details = repository.getRunDetails("memory-run") as { decisionMemories: Array<{ status: string; rawReturn: string; alphaReturn: string }> };
      expect(details.decisionMemories).toEqual([expect.objectContaining({ status: "settled", rawReturn: "0.200000000000", alphaReturn: "0.100000000000" })]);

      const duplicate = await memoryService.settleMatured(memory.contextKey, 300_000, history);
      expect(duplicate.settled).toBe(0);
      expect(reflections).toBe(1);
    } finally { repository.close(); }
  });

  test("leaves a mature decision pending when reflection fails and retries it later", async () => {
    const repository = new SqliteRunRepository("file::memory:");
    try {
      repository.migrate(resolve("packages/engine/drizzle"));
      repository.createRun({ id: "retry-memory-run", mode: "shadow", config: {}, startedAt: 60_000 });
      const config = loadConfig({ AI_API_KEY: "test-key", MEMORY_HOLDING_PERIOD_BARS: "1" });
      let attempts = 0;
      const marketData: MarketDataPort = {
        listSpotMarkets: async () => [], getQuote: async () => { throw new Error("not used"); },
        getDepth: async () => ({ bids: [], asks: [], observedAt: 0 }), getCandles: async () => [],
      };
      const model: ModelPort = {
        analyze: async () => { throw new Error("not used"); }, propose: async () => { throw new Error("not used"); },
        reflect: async () => { attempts++; if (attempts === 1) throw new Error("temporary provider outage"); return "Retry succeeded."; },
      };
      const decision: TradeDecision = {
        id: "retry-memory-decision", runId: "retry-memory-run", symbol: "ETHUSDT", decidedAt: 60_000,
        quote: { symbol: "ETHUSDT", price: "100", observedAt: 60_000, source: "fixture" }, evidence: [], findings: [],
        proposal: { action: "HOLD", symbol: "ETHUSDT", confidence: 0.5, rationale: "Wait for better evidence.", evidenceIds: [], order: null },
        risk: { approved: false, reasons: ["HOLD"], checkedAt: 60_000 },
      };
      const service = new DecisionMemoryService(config, marketData, model, repository);
      const memory = service.createPending({
        id: decision.id, runId: decision.runId, symbol: decision.symbol, decidedAt: decision.decidedAt,
        action: "HOLD", rationale: decision.proposal.rationale, confidence: decision.proposal.confidence,
        risk: decision.risk, quotePrice: decision.quote.price,
      }, "memory:shadow:test", "BTCUSDT");
      repository.saveDecisionAndMemory(decision, memory);
      const history = new Map<string, readonly Candle[]>([
        ["ETHUSDT", candles("ETHUSDT", ["100", "101"])],
        ["BTCUSDT", candles("BTCUSDT", ["50", "51"])],
      ]);
      const first = await service.settleMatured(memory.contextKey, memory.dueAt, history);
      expect(first.settled).toBe(0);
      expect(first.warnings[0]).toContain("reflection failed");
      expect((repository.getRunDetails("retry-memory-run") as { decisionMemories: Array<{ status: string }> }).decisionMemories[0]!.status).toBe("pending");
      const retry = await service.settleMatured(memory.contextKey, memory.dueAt, history);
      expect(retry.settled).toBe(1);
      expect(attempts).toBe(2);
    } finally { repository.close(); }
  });
});

