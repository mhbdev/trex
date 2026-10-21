import type { EngineConfig } from "../domain/config.ts";
import type { EngineMode } from "../domain/types.ts";
import type { StrategyProfile } from "../domain/strategies.ts";

function configuredIds(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => item && typeof item === "object" && "id" in item && typeof item.id === "string" ? [item.id] : []);
  } catch { return []; }
}

/** A replay/audit configuration snapshot that deliberately excludes credentials and provider URLs/headers. */
export function runConfigSnapshot(config: EngineConfig, mode: EngineMode, symbol: string, strategy?: StrategyProfile): Record<string, unknown> {
  return {
    mode,
    symbol: symbol.toUpperCase(),
    strategy: strategy ?? config.strategies[0],
    wallex: {
      baseUrl: config.wallex.baseUrl,
      quoteCurrency: config.wallex.quoteCurrency,
      allowedMarkets: [...config.wallex.allowedMarkets],
      packageId: config.wallex.packageId ?? null,
      liveMaxGrossExposure: config.wallex.liveMaxGrossExposure,
      apiKeyConfigured: Boolean(config.wallex.apiKey),
      subAccountClientConfigured: Boolean(config.wallex.subAccountClientId),
    },
    ai: {
      provider: config.ai.provider,
      model: config.ai.model,
      roleModels: { ...config.ai.roleModels },
      roleInstructions: { ...config.ai.roleInstructions },
      roleMaxToolSteps: { ...config.ai.roleMaxToolSteps },
      disabledRoles: [...config.ai.disabledRoles],
      timeoutMs: config.ai.timeoutMs,
    },
    researchProviders: configuredIds(config.researchEndpoints),
    quoteFallbackProviders: configuredIds(config.marketQuoteFallbacks),
    risk: { ...config.risk },
    debate: {
      maxDebateRounds: config.maxDebateRounds,
      maxRiskDiscussRounds: config.maxRiskDiscussRounds,
    },
    memory: {
      holdingPeriodBars: config.memory.holdingPeriodBars,
      configuredBenchmarkSymbol: config.memory.benchmarkSymbol ?? null,
      benchmarkRule: "BTC paired with the analyzed market quote asset unless explicitly configured",
    },
    paperInitialCash: config.paperInitialCash,
    backtestAssumptions: { feeBps: config.backtestFeeBps, slippageBps: config.backtestSlippageBps },
  };
}
