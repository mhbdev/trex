import { createInterface } from "node:readline/promises";
import type { Command } from "commander";
import { engineEnvironmentKeys, loadConfig, validateModeConfig, type EngineEnvironmentKey } from "@trex/engine/domain/config";
import type { EngineMode } from "@trex/engine/domain/types";
import { createProfileContext, getInvocationConfiguration, loadEffectiveConfig, setInvocationConfiguration } from "./runtime.ts";

const allowedKeys = new Set<string>(engineEnvironmentKeys);

const optionEnvironmentKeys: Record<string, EngineEnvironmentKey> = {
  aiProvider: "AI_PROVIDER",
  aiModel: "AI_MODEL",
  aiApiKey: "AI_API_KEY",
  aiBaseUrl: "AI_BASE_URL",
  boxapiApiKey: "BOXAPI_API_KEY",
  boxapiBaseUrl: "BOXAPI_BASE_URL",
  liaraApiKey: "LIARA_API_KEY",
  liaraWorkspaceId: "LIARA_WORKSPACE_ID",
  liaraBaseUrl: "LIARA_BASE_URL",
  aiTimeoutSeconds: "AI_REQUEST_TIMEOUT_SECONDS",
  wallexBaseUrl: "WALLEX_BASE_URL",
  wallexApiKey: "WALLEX_API_KEY",
  wallexSubAccountClientId: "WALLEX_SUB_ACCOUNT_CLIENT_ID",
  wallexPackageId: "WALLEX_PACKAGE_ID",
  wallexAllowedMarkets: "WALLEX_ALLOWED_MARKETS",
  wallexQuoteCurrency: "WALLEX_QUOTE_CURRENCY",
  liveMaxGrossExposure: "LIVE_MAX_GROSS_EXPOSURE",
  liveTrading: "WALLEX_ENABLE_LIVE_TRADING",
  autoTrading: "WALLEX_ENABLE_AUTOTRADING",
  strategyProfilesJson: "ENGINE_STRATEGIES_JSON",
  maxDebateRounds: "ENGINE_MAX_DEBATE_ROUNDS",
  maxRiskDiscussRounds: "ENGINE_MAX_RISK_DISCUSS_ROUNDS",
  memoryHoldingPeriodBars: "MEMORY_HOLDING_PERIOD_BARS",
  memoryBenchmarkSymbol: "MEMORY_BENCHMARK_SYMBOL",
  paperInitialCash: "PAPER_INITIAL_CASH",
  riskKillSwitch: "RISK_KILL_SWITCH",
};

export function addConfigOptions(command: Command): Command {
  return command
    .option("--set <KEY=VALUE>", "override any configuration value for this command (repeatable)", (value: string, previous: string[] = []) => [...previous, value], [])
    .option("--ai-provider <provider>", "AI provider: openai, anthropic, google, compatible, boxapi, or liara")
    .option("--ai-model <model>", "AI model ID")
    .option("--ai-api-key <key>", "AI key override (may be stored in shell history; prefer configure)")
    .option("--ai-base-url <url>", "OpenAI-compatible provider URL")
    .option("--boxapi-api-key <key>", "BoxAPI key override (prefer configure)")
    .option("--boxapi-base-url <url>", "BoxAPI OpenAI-compatible base URL")
    .option("--liara-api-key <key>", "Liara AI API key override (prefer configure)")
    .option("--liara-workspace-id <id>", "Liara AI workspace ID")
    .option("--liara-base-url <url>", "Liara AI API origin")
    .option("--ai-timeout-seconds <seconds>", "AI request timeout")
    .option("--wallex-base-url <url>", "Wallex API URL")
    .option("--wallex-api-key <key>", "Wallex key override (may be stored in shell history; prefer configure)")
    .option("--wallex-sub-account-client-id <id>", "credit sub-account client ID")
    .option("--wallex-package-id <id>", "challenge trade-credit package ID")
    .option("--wallex-allowed-markets <pairs>", "comma-separated allowed Wallex spot pairs")
    .option("--wallex-quote-currency <asset>", "portfolio quote asset")
    .option("--live-max-gross-exposure <amount>", "hard total live position exposure cap in the configured quote currency")
    .option("--live-trading <enabled>", "set live order access to true or false")
    .option("--auto-trading <enabled>", "set autonomous trading opt-in to true or false")
    .option("--strategy-profiles-json <json>", "override configured strategy profiles")
    .option("--max-debate-rounds <rounds>", "Bull/bear debate cycles (1–10; each cycle is bull then bear)")
    .option("--max-risk-discuss-rounds <rounds>", "Risk discussion cycles (1–10; each runs aggressive, conservative, neutral)")
    .option("--memory-holding-period-bars <bars>", "Completed one-minute bars before scoring a decision (default 7200 = 5 days)")
    .option("--memory-benchmark-symbol <pair>", "Wallex benchmark pair (defaults to BTC in the same quote asset)")
    .option("--paper-initial-cash <amount>", "virtual portfolio starting cash")
    .option("--risk-kill-switch <enabled>", "set the risk kill switch to true or false")
    .option("--no-prompt", "fail with setup instructions instead of prompting for missing configuration");
}

export function applyConfigOptions(options: Record<string, unknown>): void {
  const changes = new Map<EngineEnvironmentKey, string>();
  for (const assignment of (options.set as string[] | undefined) ?? []) {
    const separator = assignment.indexOf("=");
    if (separator < 1) throw new Error(`Invalid --set value ${JSON.stringify(assignment)}; expected KEY=VALUE.`);
    const key = assignment.slice(0, separator).trim().toUpperCase();
    if (!allowedKeys.has(key)) throw new Error(`Unknown configuration key ${key}. Run "trex config show" to inspect supported settings.`);
    changes.set(key as EngineEnvironmentKey, assignment.slice(separator + 1));
  }
  for (const [optionName, key] of Object.entries(optionEnvironmentKeys)) {
    const value = options[optionName];
    if (typeof value === "string") changes.set(key, value);
  }
  setInvocationConfiguration(Object.fromEntries(changes) as Partial<Record<EngineEnvironmentKey, string>>, typeof options.databaseUrl === "string" ? options.databaseUrl : undefined);
}

export function hasConfigOverride(options: Record<string, unknown>, key: EngineEnvironmentKey): boolean {
  if (((options.set as string[] | undefined) ?? []).some((assignment) => assignment.slice(0, assignment.indexOf("=")).trim().toUpperCase() === key)) return true;
  return Object.entries(optionEnvironmentKeys).some(([optionName, environmentKey]) => environmentKey === key && options[optionName] !== undefined);
}

function promptText(label: string, fallback = ""): Promise<string> {
  const suffix = fallback ? ` [${fallback}]` : "";
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return rl.question(`${label}${suffix}: `).then((answer) => answer.trim() || fallback).finally(() => rl.close());
}

export function promptSecret(label: string): Promise<string> {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== "function") {
    return Promise.reject(new Error("Secret prompts require an interactive terminal. Use `trex config set KEY` from a terminal or save the value in the dashboard."));
  }
  process.stdout.write(`${label}: `);
  try {
    input.setRawMode(true);
    input.resume();
  } catch (error) {
    try { input.setRawMode(false); } catch { /* terminal never entered raw mode */ }
    input.pause();
    return Promise.reject(new Error(`Could not enable hidden terminal input: ${error instanceof Error ? error.message : String(error)}. Use an interactive terminal or save the key in the dashboard.`));
  }
  return new Promise<string>((resolveSecret, rejectSecret) => {
    let secret = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      input.off("data", onData);
      input.off("end", onEnd);
      input.off("error", onError);
      try { input.setRawMode(false); } catch { /* terminal may already be closing */ }
      input.pause();
      process.stdout.write("\n");
      if (error) rejectSecret(error); else resolveSecret(secret);
    };
    const onData = (chunk: Buffer | string) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") { finish(new Error("Configuration prompt cancelled.")); return; }
        if (character === "\r" || character === "\n") { finish(); return; }
        if (character === "\u007f" || character === "\b") {
          if (secret.length > 0) { secret = secret.slice(0, -1); process.stdout.write("\b \b"); }
          continue;
        }
        if (character >= " ") { secret += character; process.stdout.write("*"); }
      }
    };
    const onEnd = () => finish(new Error("Terminal input ended before the secret was entered."));
    const onError = (error: Error) => finish(error);
    input.on("data", onData);
    input.once("end", onEnd);
    input.once("error", onError);
  });
}

async function promptYesNo(label: string, fallback: boolean): Promise<boolean> {
  for (;;) {
    const answer = await promptText(`${label} (${fallback ? "Y/n" : "y/N"})`, "");
    if (!answer) return fallback;
    if (["y", "yes"].includes(answer.toLowerCase())) return true;
    if (["n", "no"].includes(answer.toLowerCase())) return false;
    process.stdout.write("Please enter y or n.\n");
  }
}

function effectiveProviderKey(env: NodeJS.ProcessEnv, provider: string): string | undefined {
  const keys = JSON.parse(env.AI_PROVIDER_KEYS_JSON ?? "{}") as Record<string, string>;
  const dedicated = provider === "boxapi" ? env.BOXAPI_API_KEY : provider === "liara" ? env.LIARA_API_KEY : undefined;
  return dedicated || keys[provider] || (env.AI_PROVIDER === provider ? env.AI_API_KEY : undefined);
}

export async function configureEnvironment(
  mode: EngineMode,
  options: { requireAutoTrading?: boolean; askAutoTrading?: boolean } = {},
): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Interactive setup requires a terminal. Use `trex config set` or CLI --set overrides instead.");
  const profileContext = createProfileContext();
  const env: NodeJS.ProcessEnv = { ...profileContext.profiles.resolve(), ...getInvocationConfiguration() };
  const updates: Partial<Record<EngineEnvironmentKey, string>> = {};
  let provider: string;
  for (;;) {
    provider = await promptText("AI provider (openai, anthropic, google, compatible, boxapi, liara)", env.AI_PROVIDER ?? "openai");
    if (["openai", "anthropic", "google", "compatible", "boxapi", "liara"].includes(provider)) break;
    process.stdout.write("Choose openai, anthropic, google, compatible, boxapi, or liara.\n");
  }
  const model = await promptText("AI model ID", env.AI_MODEL ?? "gpt-4.1-mini");
  updates.AI_PROVIDER = provider;
  updates.AI_MODEL = model;
  const roleModels = JSON.parse(env.AI_ROLE_MODELS_JSON ?? "{}") as Record<string, string>;
  const providers = new Set([provider, ...Object.values(roleModels).map((selection) => selection.split(":")[0]!).filter(Boolean)]);
  if (providers.has("compatible")) {
    updates.AI_BASE_URL = await promptText("OpenAI-compatible base URL", env.AI_BASE_URL ?? "http://localhost:1234/v1");
  }
  if (providers.has("boxapi")) {
    updates.BOXAPI_BASE_URL = await promptText("BoxAPI base URL", env.BOXAPI_BASE_URL ?? "https://ai.boxapi.ir/ai/v1");
  }
  if (providers.has("liara")) {
    updates.LIARA_BASE_URL = await promptText("Liara AI API origin", env.LIARA_BASE_URL ?? "https://ai.liara.ir");
    updates.LIARA_WORKSPACE_ID = await promptText("Liara AI workspace ID", env.LIARA_WORKSPACE_ID ?? "");
  }
  const providerKeys = JSON.parse(env.AI_PROVIDER_KEYS_JSON ?? "{}") as Record<string, string>;
  for (const requiredProvider of providers) {
    if (!effectiveProviderKey({ ...env, ...updates }, requiredProvider)) {
      const key = await promptSecret(`Enter ${requiredProvider} API key for configured models (input hidden)`);
      if (key) providerKeys[requiredProvider] = key;
    }
  }
  if (Object.keys(providerKeys).length > 0) updates.AI_PROVIDER_KEYS_JSON = JSON.stringify(providerKeys);

  const allowedMarkets = await promptText("Approved Wallex spot markets (comma separated)", env.WALLEX_ALLOWED_MARKETS ?? "");
  if (allowedMarkets) updates.WALLEX_ALLOWED_MARKETS = allowedMarkets;
  updates.WALLEX_QUOTE_CURRENCY = await promptText("Portfolio quote currency", env.WALLEX_QUOTE_CURRENCY ?? "USDT");
  updates.PAPER_INITIAL_CASH = await promptText("Virtual starting cash", env.PAPER_INITIAL_CASH ?? "1000000");
  updates.ENGINE_MAX_DEBATE_ROUNDS = await promptText("Bull/bear debate cycles", env.ENGINE_MAX_DEBATE_ROUNDS ?? "1");
  updates.ENGINE_MAX_RISK_DISCUSS_ROUNDS = await promptText("Risk discussion cycles", env.ENGINE_MAX_RISK_DISCUSS_ROUNDS ?? "1");
  updates.MEMORY_HOLDING_PERIOD_BARS = await promptText("Memory holding period in one-minute bars", env.MEMORY_HOLDING_PERIOD_BARS ?? "7200");
  const benchmark = await promptText("Memory benchmark pair (blank = BTC in the same quote asset)", env.MEMORY_BENCHMARK_SYMBOL ?? "");
  if (benchmark) updates.MEMORY_BENCHMARK_SYMBOL = benchmark;
  if (mode === "live") {
    updates.LIVE_MAX_GROSS_EXPOSURE = await promptText(
      `Hard live gross-exposure ceiling in ${updates.WALLEX_QUOTE_CURRENCY} (0 keeps live trading disabled)`,
      env.LIVE_MAX_GROSS_EXPOSURE ?? "0",
    );
  }

  const existingPackageId = env.WALLEX_PACKAGE_ID ?? "";
  const needsWallexCredentials = mode === "live" || Boolean(existingPackageId);
  const configureWallex = needsWallexCredentials || await promptYesNo("Configure authenticated Wallex credit-account credentials?", false);
  if (configureWallex) {
    if (mode === "live" || existingPackageId) {
      if (!env.WALLEX_API_KEY) {
        const key = await promptSecret("Wallex credit-account API key (input hidden)");
        if (key) updates.WALLEX_API_KEY = key;
      }
    } else if (await promptYesNo("Set a Wallex API key now?", false)) {
      const key = await promptSecret("Wallex API key (input hidden)");
      if (key) updates.WALLEX_API_KEY = key;
    }
    const accountId = await promptText("Wallex sub-account client ID (client_id on the active credit-history row)", env.WALLEX_SUB_ACCOUNT_CLIENT_ID ?? "");
    if (accountId) updates.WALLEX_SUB_ACCOUNT_CLIENT_ID = accountId;
    const packageId = await promptText("Wallex package ID (plan details ID; not the loan amount or client ID)", env.WALLEX_PACKAGE_ID ?? "");
    if (packageId) updates.WALLEX_PACKAGE_ID = packageId;
  }

  if (mode === "live") {
    const liveAlreadyEnabled = ["true", "1", "yes", "on"].includes((env.WALLEX_ENABLE_LIVE_TRADING ?? "").toLowerCase());
    const allowLive = await promptYesNo("Enable live order submission? This permits real orders only through the explicit live command.", liveAlreadyEnabled);
    updates.WALLEX_ENABLE_LIVE_TRADING = String(allowLive);
    const autoAlreadyEnabled = ["true", "1", "yes", "on"].includes((env.WALLEX_ENABLE_AUTOTRADING ?? "").toLowerCase());
    if (options.askAutoTrading || (options.requireAutoTrading && !autoAlreadyEnabled)) {
      const allowAuto = await promptYesNo("Enable autonomous live trading? The live command still requires --auto-trade.", autoAlreadyEnabled);
      updates.WALLEX_ENABLE_AUTOTRADING = String(allowAuto);
    }
  }

  const candidate = { ...env, ...updates };
  loadConfig(candidate);
  const settings: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) continue;
    if (key === "AI_PROVIDER_KEYS_JSON") {
      const providerKeys = JSON.parse(value) as Record<string, string>;
      for (const [providerId, providerKey] of Object.entries(providerKeys)) secrets[`AI_PROVIDER_KEY:${providerId}`] = providerKey;
    } else if (["AI_API_KEY", "WALLEX_API_KEY", "WALLEX_SUB_ACCOUNT_CLIENT_ID", "BOXAPI_API_KEY", "LIARA_API_KEY", "RESEARCH_ENDPOINTS_JSON", "MARKET_QUOTE_FALLBACKS_JSON"].includes(key)) secrets[key] = value;
    else settings[key] = value;
  }
  profileContext.profiles.update(profileContext.profiles.activeId(), { settings, secrets });
  const activeName = profileContext.profiles.get(profileContext.profiles.activeId()).name;
  profileContext.repository.close();
  process.stdout.write(`Saved configuration to profile '${activeName}'.\n`);
  const errors = missingModeConfiguration(mode, Boolean(options.requireAutoTrading));
  if (errors.length > 0) process.stdout.write(`Configuration still needs attention:\n${errors.map((error) => `- ${error}`).join("\n")}\n`);
}

export async function persistConfigValue(keyInput: string, suppliedValue?: string): Promise<void> {
  const key = keyInput.trim().toUpperCase();
  if (!allowedKeys.has(key)) throw new Error(`Unknown configuration key ${key}.`);
  const secret = [
    "AI_API_KEY", "WALLEX_API_KEY", "WALLEX_SUB_ACCOUNT_CLIENT_ID", "BOXAPI_API_KEY", "LIARA_API_KEY",
    "AI_PROVIDER_KEYS_JSON", "RESEARCH_ENDPOINTS_JSON", "MARKET_QUOTE_FALLBACKS_JSON",
  ].includes(key);
  const value = suppliedValue ?? (secret ? await promptSecret(`${key} (input hidden)`) : await promptText(key));
  const context = createProfileContext();
  try {
    const activeId = context.profiles.activeId();
    const candidate = { ...context.profiles.resolve(activeId), [key]: value };
    loadConfig(candidate);
    if (key === "AI_PROVIDER_KEYS_JSON") {
      const next = JSON.parse(value) as Record<string, string>;
      const secrets: Record<string, string | null> = {};
      const currentProviders = new Set(Object.keys(next));
      const existing = context.profiles.get(activeId).secretState.providerKeys;
      for (const provider of Object.keys(existing)) if (!currentProviders.has(provider)) secrets[`AI_PROVIDER_KEY:${provider}`] = null;
      for (const [provider, providerKey] of Object.entries(next)) secrets[`AI_PROVIDER_KEY:${provider}`] = providerKey;
      context.profiles.update(activeId, { secrets });
    } else if (["AI_API_KEY", "WALLEX_API_KEY", "WALLEX_SUB_ACCOUNT_CLIENT_ID", "BOXAPI_API_KEY", "LIARA_API_KEY", "RESEARCH_ENDPOINTS_JSON", "MARKET_QUOTE_FALLBACKS_JSON"].includes(key)) {
      context.profiles.update(activeId, { secrets: { [key]: value } });
    } else context.profiles.update(activeId, { settings: { [key]: value } });
    process.stdout.write(`Saved ${key} in the active encrypted configuration profile.\n`);
  } finally { context.repository.close(); }
}

export async function removeConfigValue(keyInput: string): Promise<void> {
  const key = keyInput.trim().toUpperCase();
  if (!allowedKeys.has(key)) throw new Error(`Unknown configuration key ${key}.`);
  const context = createProfileContext();
  try {
    const profileId = context.profiles.activeId();
    if (["AI_API_KEY", "WALLEX_API_KEY", "WALLEX_SUB_ACCOUNT_CLIENT_ID", "BOXAPI_API_KEY", "LIARA_API_KEY", "RESEARCH_ENDPOINTS_JSON", "MARKET_QUOTE_FALLBACKS_JSON"].includes(key)) context.profiles.update(profileId, { secrets: { [key]: null } });
    else if (key === "AI_PROVIDER_KEYS_JSON") {
      const secrets = Object.fromEntries(Object.keys(context.profiles.get(profileId).secretState.providerKeys).map((provider) => [`AI_PROVIDER_KEY:${provider}`, null]));
      context.profiles.update(profileId, { secrets });
    } else {
      const settings = { ...context.profiles.get(profileId).settings };
      delete settings[key];
      context.profiles.update(profileId, { settings });
    }
    process.stdout.write(`Removed ${key} from the active configuration profile. The built-in default now applies unless a one-run CLI override is supplied.\n`);
  } finally { context.repository.close(); }
}

export function missingModeConfiguration(mode: EngineMode, autoTradeRequested = false): string[] {
  const config = loadEffectiveConfig();
  const errors = validateModeConfig(config, mode);
  if (config.wallex.allowedMarkets.length === 0) errors.push("WALLEX_ALLOWED_MARKETS must list approved symbols.");
  if (autoTradeRequested && !config.wallex.autoTradingEnabled) errors.push("Autonomous live trading requires WALLEX_ENABLE_AUTOTRADING=true.");
  return errors;
}

