import { describe, expect, test } from "bun:test";
import Decimal from "decimal.js";
import { VirtualPortfolio } from "../packages/engine/src/application/portfolio.ts";

describe("virtual portfolio accounting", () => {
  test("allocates quote fees to cost basis so equity, unrealized P&L, and realized P&L reconcile", () => {
    const portfolio = new VirtualPortfolio("1000", "USDT", 1_000);
    portfolio.applyFill({
      id: "buy", orderClientId: "order-1", symbol: "BTCUSDT", side: "BUY",
      quantity: "0.1", price: "100", fee: "0.1", feeAsset: "USDT", timestamp: 2_000,
    }, "100");
    expect(portfolio.current().cash).toBe("989.9");
    expect(portfolio.current().positions[0]?.averageEntryPrice).toBe("101");
    expect(portfolio.current().equity).toBe("999.9");

    portfolio.mark(new Map([["BTCUSDT", "110"]]), 3_000);
    expect(portfolio.current().equity).toBe("1000.9");
    const unrealized = new Decimal("0.1").mul(new Decimal("110").minus(portfolio.current().positions[0]!.averageEntryPrice));
    expect(unrealized.toFixed()).toBe("0.9");

    portfolio.applyFill({
      id: "sell", orderClientId: "order-2", symbol: "BTCUSDT", side: "SELL",
      quantity: "0.1", price: "110", fee: "0.11", feeAsset: "USDT", timestamp: 4_000,
    }, "110");
    expect(portfolio.current().cash).toBe("1000.79");
    expect(portfolio.current().equity).toBe("1000.79");
    expect(portfolio.current().realizedPnlToday).toBe("0.79");
    expect(portfolio.current().positions).toHaveLength(0);
  });
});

