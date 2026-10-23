import { describe, expect, test } from "bun:test";
import { baseAssetOf, describePairHoldings } from "../packages/engine/src/application/holdings.ts";
import type { PortfolioState } from "../packages/engine/src/domain/types.ts";

const portfolio: PortfolioState = {
  quoteCurrency: "TMN", cash: "2500000", equity: "5000000", highWatermark: "5000000", realizedPnlToday: "0", observedAt: 1,
  positions: [
    { symbol: "BTCTMN", quantity: "0.02", availableQuantity: "0.015", averageEntryPrice: "100000000", markPrice: "125000000" },
    { symbol: "ETHTMN", quantity: "0", averageEntryPrice: "0" },
    { symbol: "USDTTMN", quantity: "10", averageEntryPrice: "100000" },
  ],
};

describe("pair holdings for agents", () => {
  test("derives the base asset from the pair and the quote currency", () => {
    expect(baseAssetOf("BTCTMN", "TMN")).toBe("BTC");
    expect(baseAssetOf("btcusdt", "usdt")).toBe("BTC");
    expect(baseAssetOf("TMN", "TMN")).toBe("TMN");
  });

  test("reports what can be sold and what can fund a buy for the selected pair", () => {
    const holdings = describePairHoldings("BTCTMN", portfolio);
    expect(holdings.baseAsset).toBe("BTC");
    expect(holdings.availableBase).toBe("0.015");
    expect(holdings.totalBase).toBe("0.02");
    expect(holdings.baseValueInQuote).toBe("2500000.00");
    expect(holdings.availableQuoteCash).toBe("2500000");
    expect(holdings.pairShareOfEquityPct).toBe("50.00");
    expect(holdings.otherPositions).toEqual([{ symbol: "USDTTMN", quantity: "10", valueInQuote: "1000000.00" }]);
    expect(holdings.constraints.some((line) => line.includes("at most the sellable BTC quantity (0.015)"))).toBe(true);
    expect(holdings.sellableNow).toBe("0.015");
    expect(holdings.reservedBase).toBe("0");
    expect(holdings.constraints.some((line) => line.includes("SELL is impossible"))).toBe(false);
  });

  test("tells the agents when a side is impossible with the current balances", () => {
    const noBase = describePairHoldings("ETHTMN", portfolio);
    expect(noBase.availableBase).toBe("0");
    expect(noBase.constraints.some((line) => line.includes("Nothing of ETH can be sold right now, so SELL is impossible"))).toBe(true);

    const noCash = describePairHoldings("BTCTMN", { ...portfolio, cash: "0" });
    expect(noCash.constraints.some((line) => line.includes("no available TMN to buy with, so BUY is impossible"))).toBe(true);
  });

  test("treats a missing position as zero holdings rather than failing", () => {
    const holdings = describePairHoldings("DOGETMN", { ...portfolio, positions: [] });
    expect(holdings.availableBase).toBe("0");
    expect(holdings.otherPositions).toEqual([]);
    expect(holdings.pairShareOfEquityPct).toBe("0.00");
  });
});
