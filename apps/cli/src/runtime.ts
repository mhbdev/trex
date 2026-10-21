import { AiSdkModelAdapter } from "@trex/engine/adapters/ai/model";
import { SqliteRunRepository } from "@trex/engine/adapters/persistence/store";
import { ConfiguredJsonResearchProvider, HybridResearchAggregator } from "@trex/engine/application/research-aggregator";
import { TradingWorkflow } from "@trex/engine/application/trading-workflow";
import { QuoteFailoverMarketData } from "@trex/engine/adapters/providers/quote-failover";
import { WallexMarketDataAdapter, WallexOrderExecutionAdapter } from "@trex/engine/adapters/wallex/rest";
import { defaultDatabaseUrl, loadConfig, validateModeConfig, type EngineConfig } from "@trex/engine/domain/config";
import { ConfigurationProfileService } from "@trex/engine/application/configuration-profiles";
import type { EngineEnvironmentKey } from "@trex/engine/domain/config";

let invocationOverrides: Partial<Record<EngineEnvironmentKey, string>> = {};
let invocationDatabaseUrl: string | undefined;

export function setInvocationConfiguration(overrides: Partial<Record<EngineEnvironmentKey, string>>, databaseUrl?: string): void {
  invocationOverrides = { ...overrides };
  invocationDatabaseUrl = databaseUrl?.trim() || undefined;
}

export function getInvocationConfiguration(): Partial<Record<EngineEnvironmentKey, string>> {
  return { ...invocationOverrides };
}

export function getDatabaseUrl(): string {
  return invocationDatabaseUrl ?? defaultDatabaseUrl();
}

export function createProfileContext() {
  const databaseUrl = getDatabaseUrl();
  const repository = new SqliteRunRepository(databaseUrl);
  repository.migrate();
  const profiles = new ConfigurationProfileService(repository, Date.now, () => ({}), undefined, databaseUrl);
  profiles.list();
  return { repository, profiles };
}

export function loadEffectiveConfig(profileId?: string): EngineConfig {
  const context = createProfileContext();
  try {
    return loadConfig({ ...context.profiles.resolve(profileId), ...invocationOverrides, DATABASE_URL: getDatabaseUrl() });
  }
  finally { context.repository.close(); }
}

export function createRuntime(config = loadEffectiveConfig()) {
  const marketAdapter = new WallexMarketDataAdapter({
    baseUrl: config.wallex.baseUrl, wsUrl: config.wallex.wsUrl,
    ...(config.wallex.apiKey ? { apiKey: config.wallex.apiKey } : {}),
    ...(config.wallex.subAccountClientId ? { subAccountClientId: config.wallex.subAccountClientId } : {}),
    ...(config.wallex.packageId ? { packageId: config.wallex.packageId } : {}),
    allowedMarkets: config.wallex.allowedMarkets,
    quoteCurrency: config.wallex.quoteCurrency,
  });
  const marketData = new QuoteFailoverMarketData(marketAdapter, config.marketQuoteFallbacks);
  const researchProviders = ConfiguredJsonResearchProvider.parseMany(config.researchEndpoints);
  const aggregator = new HybridResearchAggregator(researchProviders);
  const repository = new SqliteRunRepository(config.databaseUrl);
  repository.migrate();
  const model = new AiSdkModelAdapter(config, fetch, repository);
  const workflow = new TradingWorkflow(config, marketData, aggregator, model, repository);
  return { config, marketAdapter, marketData, aggregator, model, repository, workflow };
}

export function createLiveExecution(config: EngineConfig) {
  const errors = validateModeConfig(config, "live");
  if (errors.length > 0) throw new Error(errors.join("\n"));
  return new WallexOrderExecutionAdapter({
    baseUrl: config.wallex.baseUrl, wsUrl: config.wallex.wsUrl,
    ...(config.wallex.apiKey ? { apiKey: config.wallex.apiKey } : {}),
    ...(config.wallex.subAccountClientId ? { subAccountClientId: config.wallex.subAccountClientId } : {}),
    ...(config.wallex.packageId ? { packageId: config.wallex.packageId } : {}),
    allowedMarkets: config.wallex.allowedMarkets,
  });
}

export function publicConfig(config: EngineConfig) {
  return {
    databaseUrl: config.databaseUrl, defaultMode: config.defaultMode,
    wallex: {
      baseUrl: config.wallex.baseUrl, wsUrl: config.wallex.wsUrl,
      subAccountConfigured: Boolean(config.wallex.subAccountClientId), apiKeyConfigured: Boolean(config.wallex.apiKey),
      liveEnabled: config.wallex.liveEnabled, allowedMarkets: config.wallex.allowedMarkets,
      autoTradingEnabled: config.wallex.autoTradingEnabled,
      packageIdConfigured: Boolean(config.wallex.packageId), quoteCurrency: config.wallex.quoteCurrency,
      liveMaxGrossExposure: config.wallex.liveMaxGrossExposure,
    },
    ai: {
      provider: config.ai.provider, model: config.ai.model,
      apiKeyConfigured: Boolean(config.ai.providerKeys[config.ai.provider] || config.ai.apiKey),
      requestTimeoutMs: config.ai.timeoutMs,
      boxapi: { baseUrl: config.ai.boxApiBaseUrl, apiKeyConfigured: Boolean(config.ai.providerKeys.boxapi) },
      liara: { baseUrl: config.ai.liaraBaseUrl, workspaceConfigured: Boolean(config.ai.liaraWorkspaceId), apiKeyConfigured: Boolean(config.ai.providerKeys.liara) },
      configuredProviders: ["openai", "anthropic", "google", "compatible", "boxapi", "liara"].filter((provider) =>
        Boolean(config.ai.providerKeys[provider as keyof typeof config.ai.providerKeys] || (provider === config.ai.provider && config.ai.apiKey))),
      roleModels: config.ai.roleModels,
      roleInstructions: config.ai.roleInstructions,
      roleMaxToolSteps: config.ai.roleMaxToolSteps,
      disabledRoles: config.ai.disabledRoles,
    },
    risk: config.risk,
    debate: { maxDebateRounds: config.maxDebateRounds, maxRiskDiscussRounds: config.maxRiskDiscussRounds },
    memory: {
      holdingPeriodBars: config.memory.holdingPeriodBars,
      ...(config.memory.benchmarkSymbol ? { benchmarkSymbol: config.memory.benchmarkSymbol } : { benchmark: "BTC in the analyzed market's quote currency" }),
    },
    paperInitialCash: config.paperInitialCash,
    backtestAssumptions: { feeBps: config.backtestFeeBps, slippageBps: config.backtestSlippageBps },
  };
}
