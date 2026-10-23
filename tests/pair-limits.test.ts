import { describe, expect, test } from "bun:test";
import Decimal from "decimal.js";
import { assertPairLimitsTighten, parsePairLimits, sellCapacity } from "../packages/engine/src/domain/pair-limits.ts";
import { loadConfig } from "../packages/engine/src/domain/config.ts";
import { describePairHoldings } from "../packages/engine/src/application/holdings.ts";

describe("per-pair sell limits", () => {
  test("parses and normalizes the profile JSON and rejects impossible values", () => {
    const limits = parsePairLimits('{"btc/tmn":{"reservedBase":"0.01","maxSellPct":"25","maxBuyNotional":""},"ETHTMN":{}}');
    expect(limits).toEqual({ BTCTMN: { reservedBase: "0.01", maxSellPct: "25" } });
    expect(parsePairLimits(undefined)).toEqual({});
    expect(() => parsePairLimits('{"BTCTMN":{"maxSellPct":"150"}}')).toThrow();
    expect(() => parsePairLimits('{"BTCTMN":{"reservedBase":"-1"}}')).toThrow();
    expect(() => parsePairLimits('{"BTCTMN":{"unknown":"1"}}')).toThrow();
    expect(loadConfig({ RISK_PAIR_LIMITS_JSON: '{"trx/tmn":{"maxSellQuantity":"100"}}' }).risk.pairLimits).toEqual({ TRXTMN: { maxSellQuantity: "100" } });
    expect(loadConfig({}).risk.pairLimits).toEqual({});
  });

  test("combines the reserve and the per-cycle caps into one sellable quantity", () => {
    const holding = new Decimal("2"), available = new Decimal("1.5");
    expect(sellCapacity(undefined, holding, available).sellableNow.toFixed()).toBe("1.5");
    const reserved = sellCapacity({ reservedBase: "1.2" }, holding, available);
    expect(reserved.sellableNow.toFixed()).toBe("0.8");
    expect(reserved.maxPerOrder).toBeUndefined();
    const capped = sellCapacity({ reservedBase: "0.5", maxSellPct: "25", maxSellQuantity: "0.4" }, holding, available);
    expect(capped.maxPerOrder?.toFixed()).toBe("0.4");
    expect(capped.sellableNow.toFixed()).toBe("0.4");
    expect(sellCapacity({ reservedBase: "5" }, holding, available).sellableNow.toFixed()).toBe("0");
  });

  test("live per-run overrides may only tighten the profile's pair limits", () => {
    const base = { BTCTMN: { reservedBase: "0.01", maxSellPct: "25", maxBuyNotional: "1000000" } };
    expect(() => assertPairLimitsTighten(base, { BTCTMN: { reservedBase: "0.02", maxSellPct: "10", maxBuyNotional: "500000" }, ETHTMN: { maxSellPct: "50" } })).not.toThrow();
    expect(() => assertPairLimitsTighten(base, { BTCTMN: { reservedBase: "0.005", maxSellPct: "25", maxBuyNotional: "1000000" } })).toThrow(/cannot loosen/);
    expect(() => assertPairLimitsTighten(base, { BTCTMN: { reservedBase: "0.01", maxSellPct: "40", maxBuyNotional: "1000000" } })).toThrow(/cannot loosen/);
    expect(() => assertPairLimitsTighten(base, { BTCTMN: { reservedBase: "0.01", maxSellPct: "25" } })).toThrow(/cannot loosen/);
    expect(() => assertPairLimitsTighten(base, {})).toThrow(/must keep/);
  });

  test("the holdings summary tells the agents the sellable amount, the reserve, and the buy budget", () => {
    const portfolio = { quoteCurrency: "TMN", cash: "3000000", equity: "8000000", highWatermark: "8000000", realizedPnlToday: "0", observedAt: 1,
      positions: [{ symbol: "BTCTMN", quantity: "0.04", availableQuantity: "0.04", averageEntryPrice: "125000000", markPrice: "125000000" }] };
    const holdings = describePairHoldings("BTCTMN", portfolio, { reservedBase: "0.03", maxSellPct: "50", maxBuyNotional: "1000000" });
    expect(holdings.reservedBase).toBe("0.03");
    expect(holdings.sellableNow).toBe("0.01");
    expect(holdings.buyBudget).toBe("1000000");
    expect(holdings.constraints.some((line) => line.includes("reserved 0.03 BTC"))).toBe(true);
    expect(holdings.constraints.some((line) => line.includes("at most 1000000 TMN"))).toBe(true);
    const locked = describePairHoldings("BTCTMN", portfolio, { reservedBase: "0.04" });
    expect(locked.sellableNow).toBe("0");
    expect(locked.constraints.some((line) => line.includes("SELL is impossible"))).toBe(true);
  });
});
