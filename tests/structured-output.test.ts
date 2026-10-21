import { describe, expect, test } from "bun:test";
import { DecisionProposalSchema } from "../packages/engine/src/domain/types.ts";

describe("agent proposal schema", () => {
  test("rejects action/order mismatches and validates a HOLD proposal", () => {
    expect(DecisionProposalSchema.safeParse({ action: "BUY", symbol: "BTCUSDT", confidence: 0.9, rationale: "up", evidenceIds: [], order: null }).success).toBe(false);
    expect(DecisionProposalSchema.safeParse({ action: "HOLD", symbol: "BTCUSDT", confidence: 0.4, rationale: "uncertain", evidenceIds: [], order: null }).success).toBe(true);
  });
});

