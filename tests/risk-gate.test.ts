import { describe, expect, test } from "bun:test";
import { evaluateOrderRisk } from "../packages/engine/src/application/risk-gate.ts";
import type { MarketQuote, MarketSpec, PortfolioState, RiskLimits } from "../packages/engine/src/domain/types.ts";

const market: MarketSpec = { symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", pricePrecision: 2, quantityPrecision: 4, minQuantity: "0.0001", minNotional: "10", spotEnabled: true };
const quote: MarketQuote = { symbol: "BTCUSDT", price: "100", observedAt: 10_000, source: "wallex-rest" };
const portfolio: PortfolioState = { quoteCurrency: "USDT", cash: "10000", positions: [{ symbol: "BTCUSDT", quantity: "2", averageEntryPrice: "90" }], equity: "10200", highWatermark: "10200", realizedPnlToday: "0", observedAt: 10_000 };
const limits: RiskLimits = { maxOrderNotional: "1000", maxPositionNotional: "5000", maxGrossExposure: "10000", maxDrawdownPct: "15", maxDailyLoss: "1000", maxDataAgeSeconds: 30, feeBufferBps: "50", maxMarketSlippageBps: "50", killSwitch: false };

describe("deterministic risk gate", () => {
  test("approves a valid allowlisted spot order", () => {
    const result = evaluateOrderRisk({ order: { symbol: "BTCUSDT", side: "BUY", type: "LIMIT", quantity: "1.0000", price: "100.00" }, market, quote, portfolio, allowedMarkets: new Set(["BTCUSDT"]), limits, now: 10_001 });
    expect(result.approved).toBe(true);
    expect(result.normalizedOrder?.quantity).toBe("1.0000");
  });

  test("rejects an unapproved symbol, excess precision, stale quote, and kill switch", () => {
    const order = { symbol: "BTCUSDT", side: "BUY" as const, type: "MARKET" as const, quantity: "0.00001" };
    const result = evaluateOrderRisk({ order, market, quote: { ...quote, observedAt: 1 }, portfolio, allowedMarkets: new Set(), limits: { ...limits, killSwitch: true }, now: 100_000 });
    expect(result.approved).toBe(false);
    expect(result.reasons.join(" ")).toContain("not allowlisted");
    expect(result.reasons.join(" ")).toContain("stale");
    expect(result.reasons.join(" ")).toContain("kill switch");
    expect(result.reasons.join(" ")).toContain("precision");
  });

  test("blocks spot shorting and non-Wallex live prices", () => {
    const sell = evaluateOrderRisk({ order: { symbol: "BTCUSDT", side: "SELL", type: "MARKET", quantity: "3" }, market, quote, portfolio, allowedMarkets: new Set(["BTCUSDT"]), limits, now: 10_000, requireWallexPrice: true });
    expect(sell.reasons.join(" ")).toContain("exceeds the available position");
    const fallback = evaluateOrderRisk({ order: { symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: "1" }, market, quote: { ...quote, source: "fallback:other" }, portfolio, allowedMarkets: new Set(["BTCUSDT"]), limits, now: 10_000, requireWallexPrice: true });
    expect(fallback.reasons.join(" ")).toContain("canonical Wallex");
  });

  test("rejects a market whose quote asset differs from the portfolio currency", () => {
    const result = evaluateOrderRisk({
      order: { symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: "1" },
      market: { ...market, quoteAsset: "USDC" }, quote, portfolio,
      allowedMarkets: new Set(["BTCUSDT"]), limits, now: 10_000,
    });
    expect(result.approved).toBe(false);
    expect(result.reasons.join(" ")).toContain("does not match portfolio currency");
  });

  test("requires fresh visible depth and enforces market-order slippage before live authorization", () => {
    const order = { symbol: "BTCUSDT", side: "BUY" as const, type: "MARKET" as const, quantity: "2" };
    const common = { order, market, quote, portfolio, allowedMarkets: new Set(["BTCUSDT"]), limits, now: 10_000, requireWallexPrice: true };
    expect(evaluateOrderRisk(common).reasons.join(" ")).toContain("require a fresh visible order-book");
    const result = evaluateOrderRisk({ ...common, depth: { bids: [["99", "10"]], asks: [["101", "1"]], observedAt: 10_000 } });
    expect(result.reasons.join(" ")).toContain("cannot fill the complete market order");
    const slipped = evaluateOrderRisk({ ...common, depth: { bids: [["99", "10"]], asks: [["101", "10"]], observedAt: 10_000 } });
    expect(slipped.reasons.join(" ")).toContain("exceeds the configured 50 bps limit");
  });

  test("applies fresh-book and assumed-slippage checks to shadow market orders", () => {
    const input = {
      order: { symbol: "BTCUSDT", side: "BUY" as const, type: "MARKET" as const, quantity: "1" },
      market, quote, portfolio, allowedMarkets: new Set(["BTCUSDT"]), limits: { ...limits, maxDataAgeSeconds: 1 }, now: 10_000,
      requireDepthFresh: true,
    };
    const stale = evaluateOrderRisk({ ...input, depth: { bids: [["99", "10"]], asks: [["100", "10"]], observedAt: 1 } });
    expect(stale.reasons.join(" ")).toContain("depth is stale");
    const slipped = evaluateOrderRisk({
      ...input, slippageBufferBps: "60",
      depth: { bids: [["99", "10"]], asks: [["100", "10"]], observedAt: 10_000 },
    });
    expect(slipped.reasons.join(" ")).toContain("exceeds the configured 50 bps limit");
  });

  test("uses current marks for gross exposure in other positions", () => {
    const result = evaluateOrderRisk({
      order: { symbol: "BTCUSDT", side: "SELL", type: "LIMIT", quantity: "1", price: "100" }, market, quote,
      portfolio: { ...portfolio, positions: [
        { symbol: "BTCUSDT", quantity: "2", averageEntryPrice: "90", markPrice: "100" },
        { symbol: "ETHUSDT", quantity: "1", averageEntryPrice: "10", markPrice: "1000" },
      ] },
      allowedMarkets: new Set(["BTCUSDT"]), limits: { ...limits, maxGrossExposure: "500" }, now: 10_001,
    });
    expect(result.reasons.join(" ")).toContain("Maximum gross exposure exceeded");
  });
});


describe("per-pair sell limits in the risk gate", () => {
  const allowed = new Set(["BTCUSDT"]);
  const pairLimits = { BTCUSDT: { reservedBase: "1.5", maxSellPct: "50", maxBuyNotional: "150" } };
  const limited: RiskLimits = { ...limits, pairLimits };

  test("keeps the reserved holding and caps one sell at the per-cycle limit", () => {
    const small = evaluateOrderRisk({ order: { symbol: "BTCUSDT", side: "SELL", type: "LIMIT", quantity: "0.4", price: "100.00" }, market, quote, portfolio, allowedMarkets: allowed, limits: limited, now: 10_000 });
    expect(small.approved).toBe(true);
    const intoReserve = evaluateOrderRisk({ order: { symbol: "BTCUSDT", side: "SELL", type: "LIMIT", quantity: "0.6", price: "100.00" }, market, quote, portfolio, allowedMarkets: allowed, limits: limited, now: 10_000 });
    expect(intoReserve.approved).toBe(false);
    expect(intoReserve.reasons.join(" ")).toContain("reserved 1.5 BTC holding");
    const tooLarge = evaluateOrderRisk({ order: { symbol: "BTCUSDT", side: "SELL", type: "LIMIT", quantity: "1.2", price: "100.00" }, market, quote, portfolio, allowedMarkets: allowed, limits: limited, now: 10_000 });
    expect(tooLarge.reasons.join(" ")).toContain("per-cycle sell limit for BTCUSDT (1 BTC)");
  });

  test("caps one buy at the per-pair budget and ignores pairs without limits", () => {
    const withinBudget = evaluateOrderRisk({ order: { symbol: "BTCUSDT", side: "BUY", type: "LIMIT", quantity: "1", price: "100.00" }, market, quote, portfolio, allowedMarkets: allowed, limits: limited, now: 10_000 });
    expect(withinBudget.approved).toBe(true);
    const overBudget = evaluateOrderRisk({ order: { symbol: "BTCUSDT", side: "BUY", type: "LIMIT", quantity: "2", price: "100.00" }, market, quote, portfolio, allowedMarkets: allowed, limits: limited, now: 10_000 });
    expect(overBudget.approved).toBe(false);
    expect(overBudget.reasons.join(" ")).toContain("per-pair buy budget for BTCUSDT (150 USDT)");
    const unaffected = evaluateOrderRisk({ order: { symbol: "BTCUSDT", side: "BUY", type: "LIMIT", quantity: "2", price: "100.00" }, market, quote, portfolio, allowedMarkets: allowed, limits: { ...limits, pairLimits: { ETHUSDT: { maxBuyNotional: "1" } } }, now: 10_000 });
    expect(unaffected.approved).toBe(true);
  });
});
