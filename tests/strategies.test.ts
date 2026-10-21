import { describe, expect, test } from "bun:test";
import { parseStrategyProfiles, selectStrategy, constrainProposal, strategyRiskLimits } from "../packages/engine/src/domain/strategies.ts";
import { loadConfig } from "../packages/engine/src/domain/config.ts";

describe("strategy profiles", () => {
  test("loads built-ins and merges validated user profiles by id", () => {
    const config = loadConfig({
      ENGINE_STRATEGIES_JSON: JSON.stringify([{ id: "momentum", name: "Strict trend", mandate: "Trade only when multiple completed bars confirm the selected trend.", minConfidence: 0.9, allowedOrderTypes: ["LIMIT"], maxOrderNotional: "12000", maxGrossExposure: "25000" }, { id: "breakout", name: "Breakout", mandate: "Trade confirmed breaks of a recent completed range with volume confirmation.", minConfidence: 0.7 }]),
    });
    expect(config.strategies.map(({ id }) => id)).toContain("agentic-balanced");
    expect(selectStrategy(config.strategies, "momentum").minConfidence).toBe(0.9);
    expect(strategyRiskLimits({ ...config.risk }, selectStrategy(config.strategies, "momentum")).maxOrderNotional).toBe("12000");
    expect(strategyRiskLimits({ ...config.risk }, selectStrategy(config.strategies, "momentum")).maxGrossExposure).toBe("25000");
    expect(selectStrategy(config.strategies, "breakout").allowedOrderTypes).toEqual(["MARKET", "LIMIT"]);
    expect(() => parseStrategyProfiles("not json")).toThrow();
  });

  test("converts strategy-incompatible proposals to auditable HOLD decisions", () => {
    const strategy = selectStrategy(loadConfig().strategies, "mean-reversion");
    const result = constrainProposal({
      action: "BUY", symbol: "BTCUSDT", confidence: 0.9, rationale: "Candidate trend buy.", evidenceIds: [],
      order: { symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: "0.1" },
    }, strategy);
    expect(result.proposal.action).toBe("HOLD");
    expect(result.proposal.order).toBeNull();
    expect(result.reasons[0]).toContain("does not permit MARKET");
    expect(result.proposal.rationale).toContain("Strategy gate");
  });
});

