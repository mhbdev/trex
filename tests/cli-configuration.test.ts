import { describe, expect, test } from "bun:test";
import { parse as parseDotenv } from "dotenv";
import { loadConfig } from "../packages/engine/src/domain/config.ts";
import { applyConfigOptions, hasConfigOverride } from "../apps/cli/src/configuration.ts";
import { publicConfig } from "../apps/cli/src/runtime.ts";

describe("CLI configuration", () => {
  test("applies command options after generic overrides and validates the resulting configuration", () => {
    const env: NodeJS.ProcessEnv = {};
    applyConfigOptions({
      set: ["WALLEX_ALLOWED_MARKETS=BTCUSDT,ETHUSDT", "WALLEX_ENABLE_LIVE_TRADING=false"],
      aiProvider: "compatible", aiModel: "local-model", aiApiKey: "local-secret",
      aiBaseUrl: "http://localhost:1234/v1", liveTrading: "true", paperInitialCash: "25000", liveMaxGrossExposure: "100000",
      maxDebateRounds: "2", maxRiskDiscussRounds: "3", memoryHoldingPeriodBars: "90", memoryBenchmarkSymbol: "BTC/TMN",
    }, env);
    const config = loadConfig(env);
    expect(config.ai.provider).toBe("compatible");
    expect(config.ai.model).toBe("local-model");
    expect(config.ai.apiKey).toBe("local-secret");
    expect(config.wallex.allowedMarkets).toEqual(["BTCUSDT", "ETHUSDT"]);
    expect(config.wallex.liveEnabled).toBe(true);
    expect(config.wallex.liveMaxGrossExposure).toBe("100000");
    expect(config.paperInitialCash).toBe("25000");
    expect(config.maxDebateRounds).toBe(2);
    expect(config.maxRiskDiscussRounds).toBe(3);
    expect(config.memory.holdingPeriodBars).toBe(90);
    expect(config.memory.benchmarkSymbol).toBe("BTCTMN");
  });

  test("rejects unsupported --set keys and malformed assignments", () => {
    expect(() => applyConfigOptions({ set: ["NOT_A_SETTING=x"] }, {})).toThrow("Unknown configuration key");
    expect(() => applyConfigOptions({ set: ["missing-equals"] }, {})).toThrow("expected KEY=VALUE");
  });

  test("detects explicit safety-flag overrides so prompts cannot reverse a CLI opt-out", () => {
    expect(hasConfigOverride({ liveTrading: "false" }, "WALLEX_ENABLE_LIVE_TRADING")).toBe(true);
    expect(hasConfigOverride({ set: ["WALLEX_ENABLE_AUTOTRADING=false"] }, "WALLEX_ENABLE_AUTOTRADING")).toBe(true);
    expect(hasConfigOverride({}, "WALLEX_ENABLE_LIVE_TRADING")).toBe(false);
  });

  test("reads JSON settings written by the previous escaped-dotenv format", () => {
    const legacyLine = `AI_PROVIDER_KEYS_JSON=${JSON.stringify(JSON.stringify({ boxapi: "legacy-test-key" }))}`;
    const legacyValue = parseDotenv(legacyLine).AI_PROVIDER_KEYS_JSON!;
    expect(loadConfig({ AI_PROVIDER_KEYS_JSON: legacyValue }).ai.providerKeys.boxapi).toBe("legacy-test-key");
  });

  test("configuration summaries report credential presence without exposing secret values", () => {
    const config = loadConfig({ AI_API_KEY: "private-ai-value", WALLEX_API_KEY: "private-wallex-value", BOXAPI_API_KEY: "private-boxapi-value", LIARA_API_KEY: "private-liara-value", LIARA_WORKSPACE_ID: "workspace-id" });
    const summary = JSON.stringify(publicConfig(config));
    expect(summary).toContain('"apiKeyConfigured":true');
    expect(summary).not.toContain("private-ai-value");
    expect(summary).not.toContain("private-wallex-value");
    expect(summary).not.toContain("private-boxapi-value");
    expect(summary).not.toContain("private-liara-value");
  });
});

