import { describe, expect, test } from "bun:test";
import { simulateNextBarOpenFill } from "../packages/engine/src/modes/backtest-fill.ts";
import type { Candle } from "../packages/engine/src/domain/types.ts";

const nextBar: Candle = { symbol: "BTCUSDT", timestamp: 60_000, open: "100", high: "110", low: "90", close: "105", volume: "5", complete: true };

describe("backtest execution chronology", () => {
  test("fills no earlier than the next bar open and applies explicit fees and slippage", () => {
    const result = simulateNextBarOpenFill({
      order: { symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: "1" },
      clientOrderId: "WA_TEST", signalCompletedAt: 60_000, nextBar, feeBps: "10", slippageBps: "5", quoteCurrency: "USDT",
    });
    expect(result.order.fills[0]?.timestamp).toBe(nextBar.timestamp);
    expect(result.order.fills[0]?.price).toBe("100.05");
    expect(result.order.fills[0]?.fee).toBe("0.10005");
  });

  test("rejects a bar that starts before the completed signal and refuses incomplete fill bars", () => {
    expect(() => simulateNextBarOpenFill({ order: { symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: "1" }, clientOrderId: "WA_TEST", signalCompletedAt: 60_001, nextBar, feeBps: "0", slippageBps: "0", quoteCurrency: "USDT" })).toThrow("before the signal completed");
    expect(() => simulateNextBarOpenFill({ order: { symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: "1" }, clientOrderId: "WA_TEST", signalCompletedAt: 60_000, nextBar: { ...nextBar, complete: false }, feeBps: "0", slippageBps: "0", quoteCurrency: "USDT" })).toThrow("must be complete");
  });
});

