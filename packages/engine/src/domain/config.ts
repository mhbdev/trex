import { z } from "zod";
import Decimal from "decimal.js";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { ModeSchema, RoleSchema, type AgentRole, type EngineMode, type RiskLimits } from "./types.ts";
import { parseStrategyProfiles, type StrategyProfile } from "./strategies.ts";
import { normalizeMarketSymbol } from "./market-symbol.ts";
import { parsePairLimits } from "./pair-limits.ts";

export type AiProviderId = "openai" | "anthropic" | "google" | "compatible" | "boxapi" | "liara" | "openrouter";

const bool = (fallback: boolean) => z.preprocess((v) => {
  if (v === undefined || v === null || v === "") return fallback;
  if (typeof v === "boolean") return v;
  if (typeof v !== "string") return v;
  const normalized = v.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return v;
}, z.boolean());

const secureProviderUrl = z.url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
}, "must use HTTPS (or localhost HTTP for development)");
const httpsUrl = z.url().refine((value) => new URL(value).protocol === "https:", "must use HTTPS");
const wssUrl = z.url().refine((value) => new URL(value).protocol === "wss:", "must use WSS");

export function defaultDatabaseUrl(): string {
  let dataDirectory: string;
  if (process.platform === "win32") {
    dataDirectory = join(homedir(), "AppData", "Local");
  } else if (process.platform === "darwin") {
    dataDirectory = join(homedir(), "Library", "Application Support");
  } else {
    dataDirectory = join(homedir(), ".local", "share");
  }
  // Preserve databases created by the previous product name instead of silently starting with an empty Trex profile store.
  const legacyDatabase = join(dataDirectory, "wallex-trading-agents", "wallex.sqlite");
  const database = existsSync(legacyDatabase) ? legacyDatabase : join(dataDirectory, "trex", "trex.sqlite");
  return `file:${database}`;
}

const envSchema = z.object({
  // DATABASE_URL is accepted only as an explicit bootstrap argument. It is not a profile setting.
  DATABASE_URL: z.preprocess((value) => value === "" ? undefined : value, z.string().optional()),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  ENGINE_MODE: ModeSchema.default("shadow"),
  WALLEX_BASE_URL: httpsUrl.default("https://api.wallex.ir"),
  WALLEX_WS_URL: wssUrl.default("wss://api.wallex.ir/connection/websocket"),
  WALLEX_API_KEY: z.string().optional(),
  WALLEX_SUB_ACCOUNT_CLIENT_ID: z.string().optional(),
  WALLEX_ENABLE_LIVE_TRADING: bool(false),
  WALLEX_ENABLE_AUTOTRADING: bool(false),
  WALLEX_ALLOWED_MARKETS: z.string().default(""),
  WALLEX_PACKAGE_ID: z.string().optional(),
  WALLEX_QUOTE_CURRENCY: z.string().default("USDT"),
  LIVE_MAX_GROSS_EXPOSURE: z.string().regex(/^\d+(\.\d+)?$/).default("0"),
  AI_PROVIDER: z.enum(["openai", "anthropic", "google", "compatible", "boxapi", "liara", "openrouter"]).default("openai"),
  AI_MODEL: z.string().default("gpt-4.1-mini"),
  AI_API_KEY: z.string().optional(),
  AI_BASE_URL: z.preprocess((value) => value === "" ? undefined : value, secureProviderUrl.optional()),
  BOXAPI_API_KEY: z.string().optional(),
  BOXAPI_BASE_URL: httpsUrl.default("https://ai.boxapi.ir/ai/v1"),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_BASE_URL: httpsUrl.default("https://openrouter.ai/api/v1"),
  LIARA_API_KEY: z.string().optional(),
  LIARA_WORKSPACE_ID: z.string().optional(),
  TRONSCAN_API_KEY: z.string().optional(),
  LIARA_BASE_URL: httpsUrl.default("https://ai.liara.ir"),
  AI_REQUEST_TIMEOUT_SECONDS: z.coerce.number().int().min(5).max(300).default(60),
  AI_TOOL_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(120).default(15),
  AI_TIMEOUT_RETRIES: z.coerce.number().int().min(0).max(2).default(1),
  AI_PROVIDER_KEYS_JSON: z.string().default("{}"),
  AI_ROLE_MODELS_JSON: z.string().default("{}"),
  AI_ROLE_INSTRUCTIONS_JSON: z.string().default("{}"),
  AI_ROLE_MAX_TOOL_STEPS_JSON: z.string().default("{}"),
  AI_DISABLED_AGENTS_JSON: z.string().default("[]"),
  ENGINE_STRATEGIES_JSON: z.string().default("[]"),
  ENGINE_MAX_DEBATE_ROUNDS: z.coerce.number().int().min(1).max(10).default(1),
  ENGINE_MAX_RISK_DISCUSS_ROUNDS: z.coerce.number().int().min(1).max(10).default(1),
  MEMORY_HOLDING_PERIOD_BARS: z.coerce.number().int().min(1).max(100_000).default(7_200),
  MEMORY_BENCHMARK_SYMBOL: z.preprocess((value) => value === "" ? undefined : value, z.string().optional()),
  RESEARCH_REDDIT_ENABLED: bool(true),
  RESEARCH_STOCKTWITS_ENABLED: bool(false),
  RESEARCH_ENDPOINTS_JSON: z.preprocess((value) => value === "" ? undefined : value, z.string().optional()),
  MARKET_QUOTE_FALLBACKS_JSON: z.string().default("[]"),
  PAPER_INITIAL_CASH: z.string().regex(/^\d+(\.\d+)?$/).default("1000000"),
  BACKTEST_FEE_BPS: z.string().regex(/^\d+(\.\d+)?$/).default("10"),
  BACKTEST_SLIPPAGE_BPS: z.string().regex(/^\d+(\.\d+)?$/).default("5"),
  RISK_MAX_ORDER_NOTIONAL: z.string().regex(/^\d+(\.\d+)?$/).default("100000"),
  RISK_MAX_POSITION_NOTIONAL: z.string().regex(/^\d+(\.\d+)?$/).default("250000"),
  RISK_MAX_GROSS_EXPOSURE: z.string().regex(/^\d+(\.\d+)?$/).default("500000"),
  RISK_MAX_DRAWDOWN_PCT: z.string().regex(/^\d+(\.\d+)?$/).default("15"),
  RISK_MAX_DAILY_LOSS: z.string().regex(/^\d+(\.\d+)?$/).default("100000"),
  RISK_MAX_DATA_AGE_SECONDS: z.coerce.number().int().positive().default(30),
  RISK_FEE_BUFFER_BPS: z.string().regex(/^\d+(\.\d+)?$/).default("50"),
  RISK_MAX_MARKET_SLIPPAGE_BPS: z.string().regex(/^\d+(\.\d+)?$/).default("50"),
  RISK_KILL_SWITCH: bool(false),
  RISK_PAIR_LIMITS_JSON: z.string().default("{}"),
});

export type EngineEnvironmentKey = Exclude<keyof z.infer<typeof envSchema>, "DATABASE_URL">;
export const engineEnvironmentKeys = Object.keys(envSchema.shape).filter((key) => key !== "DATABASE_URL") as EngineEnvironmentKey[];

export interface EngineConfig {
  databaseUrl: string;
  logLevel: "debug" | "info" | "warn" | "error";
  defaultMode: EngineMode;
  wallex: {
    baseUrl: string;
    wsUrl: string;
    apiKey?: string;
    subAccountClientId?: string;
    liveEnabled: boolean;
    autoTradingEnabled: boolean;
    allowedMarkets: string[];
    packageId?: string;
    quoteCurrency: string;
    liveMaxGrossExposure: string;
  };
  ai: {
    provider: AiProviderId;
    model: string;
    apiKey?: string;
    baseUrl?: string;
    providerKeys: Partial<Record<AiProviderId, string>>;
    boxApiBaseUrl: string;
    openRouterBaseUrl: string;
    liaraBaseUrl: string;
    liaraWorkspaceId?: string;
    roleModels: Partial<Record<AgentRole, string>>;
    roleInstructions: Partial<Record<AgentRole, string>>;
    roleMaxToolSteps: Partial<Record<AgentRole, number>>;
    disabledRoles: AgentRole[];
    timeoutMs: number;
    toolTimeoutMs: number;
    timeoutRetries: number;
  };
  strategies: StrategyProfile[];
  maxDebateRounds: number;
  maxRiskDiscussRounds: number;
  memory: { holdingPeriodBars: number; benchmarkSymbol?: string };
  research: { redditEnabled: boolean; stocktwitsEnabled: boolean; tronscanApiKey?: string };
  researchEndpoints: string;
  marketQuoteFallbacks: string;
  paperInitialCash: string;
  backtestFeeBps: string;
  backtestSlippageBps: string;
  risk: RiskLimits;
}

const jsonEnvironmentKeys = [
  "AI_PROVIDER_KEYS_JSON",
  "AI_ROLE_MODELS_JSON",
  "AI_ROLE_INSTRUCTIONS_JSON",
  "AI_ROLE_MAX_TOOL_STEPS_JSON",
  "AI_DISABLED_AGENTS_JSON",
  "ENGINE_STRATEGIES_JSON",
  "RESEARCH_ENDPOINTS_JSON",
  "MARKET_QUOTE_FALLBACKS_JSON",
  "RISK_PAIR_LIMITS_JSON",
] as const;

/** Recover legacy JSON settings written with dotenv's unsupported escaped-quote form. */
export function normalizeJsonEnvironmentValue(value: string, key: string): string {
  try {
    JSON.parse(value);
    return value;
  } catch {
    try {
      const decoded: unknown = JSON.parse(`"${value}"`);
      if (typeof decoded === "string") {
        JSON.parse(decoded);
        return decoded;
      }
    } catch {
      // Do not include the setting value in diagnostics because JSON settings can hold secrets.
    }
    throw new Error(`${key} must contain valid JSON.`);
  }
}

export function loadConfig(env: Readonly<Record<string, string | undefined>> = {}): EngineConfig {
  const normalizedEnv = { ...env };
  for (const key of jsonEnvironmentKeys) {
    const value = normalizedEnv[key];
    if (typeof value === "string" && value !== "") normalizedEnv[key] = normalizeJsonEnvironmentValue(value, key);
  }
  const parsed = envSchema.parse(normalizedEnv);
  const providerKeys = z.partialRecord(z.enum(["openai", "anthropic", "google", "compatible", "boxapi", "liara", "openrouter"]), z.string().min(1)).parse(JSON.parse(parsed.AI_PROVIDER_KEYS_JSON));
  if (parsed.BOXAPI_API_KEY) providerKeys.boxapi = parsed.BOXAPI_API_KEY;
  if (parsed.OPENROUTER_API_KEY) providerKeys.openrouter = parsed.OPENROUTER_API_KEY;
  if (parsed.LIARA_API_KEY) providerKeys.liara = parsed.LIARA_API_KEY;
  const rawRoleModels = z.record(z.string(), z.string().min(1)).parse(JSON.parse(parsed.AI_ROLE_MODELS_JSON));
  const roleModels: Partial<Record<AgentRole, string>> = {};
  for (const [rawRole, model] of Object.entries(rawRoleModels)) {
    const role = RoleSchema.parse(rawRole);
    const [provider, modelId, extra] = model.split(":");
    if (!provider || !modelId || extra !== undefined || !["openai", "anthropic", "google", "compatible", "boxapi", "liara", "openrouter"].includes(provider)) {
      throw new Error(`AI_ROLE_MODELS_JSON value for ${role} must use provider:model syntax.`);
    }
    roleModels[role] = model;
  }
  const rawRoleInstructions = z.record(z.string(), z.string().max(2_000)).parse(JSON.parse(parsed.AI_ROLE_INSTRUCTIONS_JSON));
  const roleInstructions: Partial<Record<AgentRole, string>> = {};
  for (const [rawRole, instructions] of Object.entries(rawRoleInstructions)) {
    const role = RoleSchema.parse(rawRole);
    if (instructions.trim()) roleInstructions[role] = instructions.trim();
  }
  const rawRoleMaxToolSteps = z.record(z.string(), z.number().int().min(1).max(8)).parse(JSON.parse(parsed.AI_ROLE_MAX_TOOL_STEPS_JSON));
  const roleMaxToolSteps: Partial<Record<AgentRole, number>> = {};
  for (const [rawRole, steps] of Object.entries(rawRoleMaxToolSteps)) {
    roleMaxToolSteps[RoleSchema.parse(rawRole)] = steps;
  }
  const rawDisabledRoles = z.array(RoleSchema).max(RoleSchema.options.length).parse(JSON.parse(parsed.AI_DISABLED_AGENTS_JSON));
  const optionalRoles = new Set<AgentRole>(["news_analyst", "sentiment_analyst", "tokenomics_analyst", "reflector"]);
  const disabledRoles = [...new Set(rawDisabledRoles)];
  const requiredDisabledRoles = disabledRoles.filter((role) => !optionalRoles.has(role));
  if (requiredDisabledRoles.length) {
    throw new Error(`AI_DISABLED_AGENTS_JSON may disable only optional roles: ${[...optionalRoles].join(", ")}. Required debate, execution, risk, portfolio, and market-technical roles cannot be disabled.`);
  }
  const cfg: EngineConfig = {
    databaseUrl: parsed.DATABASE_URL ?? defaultDatabaseUrl(),
    logLevel: parsed.LOG_LEVEL,
    defaultMode: parsed.ENGINE_MODE,
    wallex: {
      baseUrl: parsed.WALLEX_BASE_URL.replace(/\/$/, ""),
      wsUrl: parsed.WALLEX_WS_URL,
      liveEnabled: parsed.WALLEX_ENABLE_LIVE_TRADING,
      autoTradingEnabled: parsed.WALLEX_ENABLE_AUTOTRADING,
      allowedMarkets: parsed.WALLEX_ALLOWED_MARKETS.split(",").map((s) => s.trim()).filter(Boolean).map(normalizeMarketSymbol),
      quoteCurrency: parsed.WALLEX_QUOTE_CURRENCY.toUpperCase(),
      liveMaxGrossExposure: parsed.LIVE_MAX_GROSS_EXPOSURE,
      ...(parsed.WALLEX_API_KEY ? { apiKey: parsed.WALLEX_API_KEY } : {}),
      ...(parsed.WALLEX_SUB_ACCOUNT_CLIENT_ID ? { subAccountClientId: parsed.WALLEX_SUB_ACCOUNT_CLIENT_ID } : {}),
      ...(parsed.WALLEX_PACKAGE_ID ? { packageId: parsed.WALLEX_PACKAGE_ID } : {}),
    },
    ai: {
      provider: parsed.AI_PROVIDER,
      model: parsed.AI_MODEL,
      ...(parsed.AI_API_KEY ? { apiKey: parsed.AI_API_KEY } : {}),
      ...(parsed.AI_BASE_URL ? { baseUrl: parsed.AI_BASE_URL } : {}),
      providerKeys,
      boxApiBaseUrl: parsed.BOXAPI_BASE_URL.replace(/\/$/, ""),
      openRouterBaseUrl: parsed.OPENROUTER_BASE_URL.replace(/\/$/, ""),
      liaraBaseUrl: parsed.LIARA_BASE_URL.replace(/\/$/, ""),
      ...(parsed.LIARA_WORKSPACE_ID ? { liaraWorkspaceId: parsed.LIARA_WORKSPACE_ID } : {}),
      roleModels,
      roleInstructions,
      roleMaxToolSteps,
      disabledRoles,
      timeoutMs: parsed.AI_REQUEST_TIMEOUT_SECONDS * 1000,
      toolTimeoutMs: parsed.AI_TOOL_TIMEOUT_SECONDS * 1000,
      timeoutRetries: parsed.AI_TIMEOUT_RETRIES,
    },
    strategies: parseStrategyProfiles(parsed.ENGINE_STRATEGIES_JSON),
    maxDebateRounds: parsed.ENGINE_MAX_DEBATE_ROUNDS,
    maxRiskDiscussRounds: parsed.ENGINE_MAX_RISK_DISCUSS_ROUNDS,
    memory: {
      holdingPeriodBars: parsed.MEMORY_HOLDING_PERIOD_BARS,
      ...(parsed.MEMORY_BENCHMARK_SYMBOL ? { benchmarkSymbol: normalizeMarketSymbol(parsed.MEMORY_BENCHMARK_SYMBOL) } : {}),
    },
    research: {
      redditEnabled: parsed.RESEARCH_REDDIT_ENABLED, stocktwitsEnabled: parsed.RESEARCH_STOCKTWITS_ENABLED,
      ...(parsed.TRONSCAN_API_KEY ? { tronscanApiKey: parsed.TRONSCAN_API_KEY } : {}),
    },
    researchEndpoints: parsed.RESEARCH_ENDPOINTS_JSON ?? "[]",
    marketQuoteFallbacks: parsed.MARKET_QUOTE_FALLBACKS_JSON,
    paperInitialCash: parsed.PAPER_INITIAL_CASH,
    backtestFeeBps: parsed.BACKTEST_FEE_BPS,
    backtestSlippageBps: parsed.BACKTEST_SLIPPAGE_BPS,
    risk: {
      maxOrderNotional: parsed.RISK_MAX_ORDER_NOTIONAL,
      maxPositionNotional: parsed.RISK_MAX_POSITION_NOTIONAL,
      maxGrossExposure: parsed.RISK_MAX_GROSS_EXPOSURE,
      maxDrawdownPct: parsed.RISK_MAX_DRAWDOWN_PCT,
      maxDailyLoss: parsed.RISK_MAX_DAILY_LOSS,
      maxDataAgeSeconds: parsed.RISK_MAX_DATA_AGE_SECONDS,
      feeBufferBps: parsed.RISK_FEE_BUFFER_BPS,
      maxMarketSlippageBps: parsed.RISK_MAX_MARKET_SLIPPAGE_BPS,
      killSwitch: parsed.RISK_KILL_SWITCH,
      pairLimits: parsePairLimits(parsed.RISK_PAIR_LIMITS_JSON),
    },
  };
  return cfg;
}

export function validateModeConfig(config: EngineConfig, mode: EngineMode): string[] {
  const errors: string[] = [];
  if (mode === "live") {
    if (!config.wallex.liveEnabled) errors.push("WALLEX_ENABLE_LIVE_TRADING must be true for live mode.");
    if (!config.wallex.apiKey) errors.push("WALLEX_API_KEY is required for live mode.");
    if (!config.wallex.subAccountClientId) errors.push("WALLEX_SUB_ACCOUNT_CLIENT_ID is required for credit-account spot trading.");
    if (!config.wallex.packageId) errors.push("WALLEX_PACKAGE_ID is required to enforce package market restrictions.");
    if (config.wallex.allowedMarkets.length === 0) errors.push("WALLEX_ALLOWED_MARKETS must list approved symbols.");
    if (!new Decimal(config.wallex.liveMaxGrossExposure).isFinite() || !new Decimal(config.wallex.liveMaxGrossExposure).gt(0)) {
      errors.push("LIVE_MAX_GROSS_EXPOSURE must be greater than zero for live mode; set a hard quote-currency exposure ceiling before enabling real orders.");
    }
    if (config.risk.killSwitch) errors.push("RISK_KILL_SWITCH is enabled; live execution cannot start.");
  }
  if (mode === "shadow" && config.wallex.packageId && !config.wallex.apiKey) errors.push("WALLEX_API_KEY is required to refresh challenge package market restrictions.");
  const providers = new Set<AiProviderId>();
  for (const role of RoleSchema.options.filter((candidate) => !config.ai.disabledRoles.includes(candidate))) {
    const selection = config.ai.roleModels[role];
    providers.add((selection?.split(":")[0] as AiProviderId | undefined) ?? config.ai.provider);
  }
  for (const provider of providers) {
    if (!config.ai.providerKeys[provider] && !(provider === config.ai.provider && config.ai.apiKey)) errors.push(`An API key is required for AI provider ${provider} (AI_PROVIDER_KEYS_JSON or AI_API_KEY).`);
  }
  if (providers.has("compatible") && !config.ai.baseUrl) errors.push("AI_BASE_URL is required for an OpenAI-compatible provider.");
  if (providers.has("liara") && !config.ai.liaraWorkspaceId) errors.push("LIARA_WORKSPACE_ID is required for Liara AI inference.");
  return errors;
}

export function validateAutoTradeRequest(config: EngineConfig, requested: boolean): string[] {
  if (requested && !config.wallex.autoTradingEnabled) {
    return ["Autonomous live trading requires both the explicit --auto-trade flag and WALLEX_ENABLE_AUTOTRADING=true."];
  }
  return [];
}
