import { describe, expect, test } from "bun:test";
import { loadConfig, validateAutoTradeRequest, validateModeConfig } from "../packages/engine/src/domain/config.ts";

describe("production configuration validation", () => {
  test("rejects malformed boolean values instead of silently disabling safety flags", () => {
    expect(() => loadConfig({ RISK_KILL_SWITCH: "tru" })).toThrow();
    expect(() => loadConfig({ WALLEX_BASE_URL: "http://api.wallex.ir" })).toThrow();
  });

  test("accepts blank optional values in the shipped dotenv template and chooses a portable database default", () => {
    const config = loadConfig({ AI_BASE_URL: "", RESEARCH_ENDPOINTS_JSON: "" });
    expect(config.ai.baseUrl).toBeUndefined();
    expect(config.researchEndpoints).toBe("[]");
    expect(config.databaseUrl.startsWith("file:")).toBe(true);
    expect(config.databaseUrl.length).toBeGreaterThan("file:".length);
    expect(config.maxDebateRounds).toBe(1);
    expect(config.maxRiskDiscussRounds).toBe(1);
    expect(config.memory.holdingPeriodBars).toBe(7_200);
  });

  test("validates bounded debate cycles and crypto memory horizons", () => {
    const config = loadConfig({ ENGINE_MAX_DEBATE_ROUNDS: "3", ENGINE_MAX_RISK_DISCUSS_ROUNDS: "2", MEMORY_HOLDING_PERIOD_BARS: "120", MEMORY_BENCHMARK_SYMBOL: "BTC/TMN" });
    expect(config.maxDebateRounds).toBe(3);
    expect(config.maxRiskDiscussRounds).toBe(2);
    expect(config.memory.holdingPeriodBars).toBe(120);
    expect(config.memory.benchmarkSymbol).toBe("BTCTMN");
    expect(() => loadConfig({ ENGINE_MAX_DEBATE_ROUNDS: "11" })).toThrow();
    expect(() => loadConfig({ MEMORY_HOLDING_PERIOD_BARS: "0" })).toThrow();
  });

  test("configures BoxAPI and Liara as independent AI SDK providers", () => {
    const boxapi = loadConfig({ AI_PROVIDER: "boxapi", AI_MODEL: "gpt-6-astra", BOXAPI_API_KEY: "box-key" });
    expect(boxapi.ai.boxApiBaseUrl).toBe("https://ai.boxapi.ir/ai/v1");
    expect(boxapi.ai.providerKeys.boxapi).toBe("box-key");
    expect(validateModeConfig(boxapi, "shadow")).toEqual([]);

    const liara = loadConfig({ AI_PROVIDER: "liara", AI_MODEL: "openai/gpt-5", LIARA_API_KEY: "liara-key", LIARA_WORKSPACE_ID: "workspace-123" });
    expect(liara.ai.liaraWorkspaceId).toBe("workspace-123");
    expect(liara.ai.providerKeys.liara).toBe("liara-key");
    expect(validateModeConfig(liara, "shadow")).toEqual([]);

    const missingWorkspace = loadConfig({ AI_PROVIDER: "liara", LIARA_API_KEY: "liara-key" });
    expect(validateModeConfig(missingWorkspace, "shadow").join(" ")).toContain("LIARA_WORKSPACE_ID");
  });

  test("blocks live mode while the kill switch is enabled", () => {
    const config = loadConfig({
      AI_API_KEY: "test-key",
      WALLEX_API_KEY: "credit-key",
      WALLEX_SUB_ACCOUNT_CLIENT_ID: "sub-account",
      WALLEX_PACKAGE_ID: "10",
      WALLEX_ALLOWED_MARKETS: "BTCUSDT",
      WALLEX_ENABLE_LIVE_TRADING: "true",
      LIVE_MAX_GROSS_EXPOSURE: "100000",
      RISK_KILL_SWITCH: "yes",
    });
    expect(validateModeConfig(config, "live")).toContain("RISK_KILL_SWITCH is enabled; live execution cannot start.");
  });

  test("keeps live mode disabled until an absolute live exposure ceiling is configured and normalizes pair input", () => {
    const config = loadConfig({
      AI_API_KEY: "test-key",
      WALLEX_API_KEY: "credit-key",
      WALLEX_SUB_ACCOUNT_CLIENT_ID: "sub-account",
      WALLEX_PACKAGE_ID: "10",
      WALLEX_ALLOWED_MARKETS: "BTC/TMN, ETH/TMN",
      WALLEX_ENABLE_LIVE_TRADING: "true",
    });
    expect(config.wallex.allowedMarkets).toEqual(["BTCTMN", "ETHTMN"]);
    expect(validateModeConfig(config, "live").join(" ")).toContain("LIVE_MAX_GROSS_EXPOSURE");
    expect(() => loadConfig({ LIVE_MAX_GROSS_EXPOSURE: "-1" })).toThrow();
  });

  test("requires a separate opt-in for autonomous live trading", () => {
    const disabled = loadConfig({ AI_API_KEY: "test-key" });
    expect(validateAutoTradeRequest(disabled, true)[0]).toContain("WALLEX_ENABLE_AUTOTRADING=true");
    const enabled = loadConfig({ AI_API_KEY: "test-key", WALLEX_ENABLE_AUTOTRADING: "true" });
    expect(validateAutoTradeRequest(enabled, true)).toEqual([]);
    expect(validateAutoTradeRequest(disabled, false)).toEqual([]);
  });
});

