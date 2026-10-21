import { describe, expect, test } from "bun:test";
import { computeTechnicalIndicators } from "../packages/engine/src/domain/indicators.ts";
import type { Candle } from "../packages/engine/src/domain/types.ts";

function candles(count: number): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index;
    return { symbol: "BTCUSDT", timestamp: index * 60_000, open: String(close - 0.5), high: String(close + 1), low: String(close - 1), close: String(close), volume: "10", complete: true };
  });
}

describe("technical indicators", () => {
  test("computes common crypto candle indicators and excludes incomplete candles", () => {
    const completed = candles(40);
    const withFutureBar = [...completed, { ...completed.at(-1)!, timestamp: 40 * 60_000, close: "999999", high: "999999", complete: false }];
    const indicators = computeTechnicalIndicators(withFutureBar)!;
    expect(indicators.sampleSize).toBe(40);
    expect(indicators.sma7).toBe("136");
    expect(indicators.ema26).not.toBeNull();
    expect(indicators.macdSignal).not.toBeNull();
    expect(indicators.rsi14).toBe("100.0000");
    expect(indicators.close).toBe("139");
  });
});

