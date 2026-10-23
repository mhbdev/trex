import { randomUUID } from "node:crypto";
import { chmod, lstat, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, extname, resolve, sep } from "node:path";
import { parse as parseDotenv } from "dotenv";
import { z } from "zod";
import Decimal from "decimal.js";
import {
  BenchmarkQuerySchema, CreateProfileSchema, DiagnosticsRequestSchema, DotenvImportSchema, LiveRunRequestSchema,
  MarketListRequestSchema, OrderCancelSchema, RunListQuerySchema, ShadowRunRequestSchema,
  StartRunRequestSchema, StopRunRequestSchema, UpdateProfileSchema,
} from "@trex/contracts/admin";
import { SqliteRunRepository } from "@trex/engine/adapters/persistence/store";
import type { WorkflowProgress } from "@trex/engine/application/ports";
import { decryptProfileSecret, generateEncryptionKey, parseEncryptionKey, rotateProfileSecretEnvelopes } from "@trex/engine/adapters/security/secret-vault";
import { resolveEncryptionKey, writeEncryptionKeyFile } from "@trex/engine/adapters/security/encryption-key-file";
import { ConfigurationProfileService } from "@trex/engine/application/configuration-profiles";
import { ExecutionLeaseGuard } from "@trex/engine/application/execution-lease";
import { orderIntentState } from "@trex/engine/application/live-execution";
import { aggregateRunReports, compareRuns } from "@trex/engine/application/reporting";
import { renderBenchmarkHtml } from "@trex/engine/application/visualization";
import { engineEnvironmentKeys, loadConfig, validateAutoTradeRequest, validateModeConfig, type EngineConfig } from "@trex/engine/domain/config";
import { normalizeMarketSymbol } from "@trex/engine/domain/market-symbol";
import { assertPairLimitsTighten, parsePairLimits } from "@trex/engine/domain/pair-limits";
import { StrategyProfileSchema, selectStrategy } from "@trex/engine/domain/strategies";
import type { RunReport } from "@trex/engine/domain/types";
import { runBacktest } from "@trex/engine/modes/backtest";
import { runLiveCycle } from "@trex/engine/modes/live";
import { runShadowCycle } from "@trex/engine/modes/shadow";
import { createLiveExecution, createRuntime, getDatabaseUrl, publicConfig } from "./runtime.ts";

type Mode = "backtest" | "shadow" | "live";
type RunStatus = "starting" | "running" | "waiting" | "stopping" | "completed" | "failed" | "stopped";
interface ManagedRun {
  id: string; mode: Mode; profileId: string; state: RunStatus; phase: "setup" | "engine"; message: string; startedAt: number; updatedAt: number;
  symbols: string[]; strategyIds: string[]; error?: string; stopRequested: boolean; resumeRunId?: string; workflow?: WorkflowProgress;
}

const secretKeys = new Set([
  "AI_API_KEY", "WALLEX_API_KEY", "WALLEX_SUB_ACCOUNT_CLIENT_ID", "BOXAPI_API_KEY", "LIARA_API_KEY", "TRONSCAN_API_KEY",
  "AI_PROVIDER_KEYS_JSON", "RESEARCH_ENDPOINTS_JSON", "MARKET_QUOTE_FALLBACKS_JSON", "ENCRYPTION_KEY",
]);
const providerIds = ["openai", "anthropic", "google", "compatible", "boxapi", "liara"] as const;
const RekeySecretsSchema = z.object({ previousKey: z.string().min(1).optional(), replacementKey: z.string().min(1).optional() });
const settingGroups: Record<string, string> = {
  AI_PROVIDER: "AI & agents", AI_MODEL: "AI & agents", AI_BASE_URL: "AI & agents", AI_REQUEST_TIMEOUT_SECONDS: "AI & agents",
  AI_TOOL_TIMEOUT_SECONDS: "AI & agents", AI_TIMEOUT_RETRIES: "AI & agents",
  AI_ROLE_MODELS_JSON: "AI & agents", AI_PROVIDER_KEYS_JSON: "AI & agents", ENGINE_MAX_DEBATE_ROUNDS: "AI & agents",
  AI_ROLE_INSTRUCTIONS_JSON: "AI & agents", AI_ROLE_MAX_TOOL_STEPS_JSON: "AI & agents", AI_DISABLED_AGENTS_JSON: "AI & agents",
  ENGINE_MAX_RISK_DISCUSS_ROUNDS: "AI & agents", WALLEX_BASE_URL: "Wallex", WALLEX_WS_URL: "Wallex",
  WALLEX_ALLOWED_MARKETS: "Wallex", WALLEX_PACKAGE_ID: "Wallex", WALLEX_QUOTE_CURRENCY: "Wallex",
  WALLEX_ENABLE_LIVE_TRADING: "Wallex", WALLEX_ENABLE_AUTOTRADING: "Wallex", LIVE_MAX_GROSS_EXPOSURE: "Wallex",
  RISK_MAX_ORDER_NOTIONAL: "Risk & safety", RISK_MAX_POSITION_NOTIONAL: "Risk & safety", RISK_MAX_GROSS_EXPOSURE: "Risk & safety",
  RISK_MAX_DRAWDOWN_PCT: "Risk & safety", RISK_MAX_DAILY_LOSS: "Risk & safety", RISK_MAX_DATA_AGE_SECONDS: "Risk & safety",
  RISK_FEE_BUFFER_BPS: "Risk & safety", RISK_MAX_MARKET_SLIPPAGE_BPS: "Risk & safety", RISK_KILL_SWITCH: "Risk & safety", RISK_PAIR_LIMITS_JSON: "Risk & safety",
  ENGINE_STRATEGIES_JSON: "Strategies", MEMORY_HOLDING_PERIOD_BARS: "Memory", MEMORY_BENCHMARK_SYMBOL: "Memory",
  PAPER_INITIAL_CASH: "Simulation", BACKTEST_FEE_BPS: "Simulation", BACKTEST_SLIPPAGE_BPS: "Simulation",
  RESEARCH_REDDIT_ENABLED: "Data sources", RESEARCH_STOCKTWITS_ENABLED: "Data sources",
  TRONSCAN_API_KEY: "Data sources",
  MARKET_QUOTE_FALLBACKS_JSON: "Data sources",
  LOG_LEVEL: "Advanced", ENGINE_MODE: "Advanced", BOXAPI_BASE_URL: "AI & agents", LIARA_BASE_URL: "AI & agents",
  LIARA_WORKSPACE_ID: "AI & agents",
};

function envValue(config: EngineConfig): Record<string, string> {
  return {
    LOG_LEVEL: config.logLevel, ENGINE_MODE: config.defaultMode,
    WALLEX_BASE_URL: config.wallex.baseUrl, WALLEX_WS_URL: config.wallex.wsUrl,
    WALLEX_ENABLE_LIVE_TRADING: String(config.wallex.liveEnabled), WALLEX_ENABLE_AUTOTRADING: String(config.wallex.autoTradingEnabled),
    WALLEX_ALLOWED_MARKETS: config.wallex.allowedMarkets.join(","), WALLEX_PACKAGE_ID: config.wallex.packageId ?? "",
    WALLEX_QUOTE_CURRENCY: config.wallex.quoteCurrency, LIVE_MAX_GROSS_EXPOSURE: config.wallex.liveMaxGrossExposure,
    AI_PROVIDER: config.ai.provider, AI_MODEL: config.ai.model, AI_BASE_URL: config.ai.baseUrl ?? "",
    AI_REQUEST_TIMEOUT_SECONDS: String(config.ai.timeoutMs / 1000), AI_TOOL_TIMEOUT_SECONDS: String(config.ai.toolTimeoutMs / 1000),
    AI_TIMEOUT_RETRIES: String(config.ai.timeoutRetries), AI_ROLE_MODELS_JSON: JSON.stringify(config.ai.roleModels, null, 2),
    AI_ROLE_INSTRUCTIONS_JSON: JSON.stringify(config.ai.roleInstructions, null, 2),
    AI_ROLE_MAX_TOOL_STEPS_JSON: JSON.stringify(config.ai.roleMaxToolSteps, null, 2),
    AI_DISABLED_AGENTS_JSON: JSON.stringify(config.ai.disabledRoles, null, 2),
    AI_PROVIDER_KEYS_JSON: "[set using encrypted provider-key fields]", BOXAPI_BASE_URL: config.ai.boxApiBaseUrl,
    LIARA_BASE_URL: config.ai.liaraBaseUrl, LIARA_WORKSPACE_ID: config.ai.liaraWorkspaceId ?? "",
    ENGINE_STRATEGIES_JSON: JSON.stringify(config.strategies, null, 2),
    ENGINE_MAX_DEBATE_ROUNDS: String(config.maxDebateRounds), ENGINE_MAX_RISK_DISCUSS_ROUNDS: String(config.maxRiskDiscussRounds),
    MEMORY_HOLDING_PERIOD_BARS: String(config.memory.holdingPeriodBars), MEMORY_BENCHMARK_SYMBOL: config.memory.benchmarkSymbol ?? "",
    RESEARCH_REDDIT_ENABLED: String(config.research.redditEnabled), RESEARCH_STOCKTWITS_ENABLED: String(config.research.stocktwitsEnabled),
    RESEARCH_ENDPOINTS_JSON: "[set using encrypted data-source settings]", MARKET_QUOTE_FALLBACKS_JSON: "[set using encrypted data-source settings]",
    PAPER_INITIAL_CASH: config.paperInitialCash, BACKTEST_FEE_BPS: config.backtestFeeBps, BACKTEST_SLIPPAGE_BPS: config.backtestSlippageBps,
    RISK_MAX_ORDER_NOTIONAL: config.risk.maxOrderNotional, RISK_MAX_POSITION_NOTIONAL: config.risk.maxPositionNotional,
    RISK_MAX_GROSS_EXPOSURE: config.risk.maxGrossExposure, RISK_MAX_DRAWDOWN_PCT: config.risk.maxDrawdownPct,
    RISK_MAX_DAILY_LOSS: config.risk.maxDailyLoss, RISK_MAX_DATA_AGE_SECONDS: String(config.risk.maxDataAgeSeconds),
    RISK_FEE_BUFFER_BPS: config.risk.feeBufferBps, RISK_MAX_MARKET_SLIPPAGE_BPS: config.risk.maxMarketSlippageBps,
    RISK_KILL_SWITCH: String(config.risk.killSwitch),
    RISK_PAIR_LIMITS_JSON: JSON.stringify(config.risk.pairLimits ?? {}, null, 2),
  };
}

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/((?:api[_-]?key|authorization|token|secret)\s*[:=]\s*)[^\s,;"']+/gi, "$1[redacted]")
    .slice(0, 1200);
}

function json(data: unknown, status = 200): Response {
  return Response.json(redactResponse(data), { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}

function redactResponse(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactResponse);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => {
    if (typeof item === "string" && /^(?:api[_-]?key|secret|password|authorization|subAccountClientId)$/i.test(key)) return [key, "[redacted]"];
    return [key, redactResponse(item)];
  }));
  return typeof value === "string" ? safeMessage(value) : value;
}

function parseJsonBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  return request.json().then((body) => schema.parse(body));
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function getProfileId(url: URL, activeId: string): string {
  return url.searchParams.get("profileId") ?? activeId;
}

function normalizeSymbols(values: readonly string[], config: EngineConfig): string[] {
  const symbols = values.map(normalizeMarketSymbol);
  if (new Set(symbols).size !== symbols.length) throw new Error("Symbols must not contain duplicates.");
  const disallowed = symbols.filter((symbol) => !config.wallex.allowedMarkets.includes(symbol));
  if (disallowed.length) throw new Error(`Markets must be allowlisted in this profile: ${disallowed.join(", ")}.`);
  if (symbols.length * config.strategies.length > 32) throw new Error("A run matrix is limited to 32 pair/strategy cases.");
  return symbols;
}

class RunManager {
  readonly runs = new Map<string, ManagedRun>();
  private readonly tasks = new Map<string, Promise<void>>();
  constructor(private readonly profiles: ConfigurationProfileService, private readonly repository: SqliteRunRepository) {
    repository.failInterruptedManagedRunAttempts(Date.now());
  }

  list(): ManagedRun[] {
    const all = new Map<string, ManagedRun>(this.repository.getRecentManagedRunAttempts(200).map((run) => [run.id, { ...run, stopRequested: false }]));
    for (const run of this.runs.values()) all.set(run.id, run);
    return [...all.values()].sort((a, b) => b.startedAt - a.startedAt);
  }

  private persist(run: ManagedRun): void {
    this.repository.saveManagedRunAttempt({
      id: run.id, mode: run.mode, profileId: run.profileId, state: run.state, phase: run.phase,
      message: run.message, startedAt: run.startedAt, updatedAt: run.updatedAt,
      symbols: run.symbols, strategyIds: run.strategyIds,
      ...(run.error ? { error: safeMessage(run.error) } : {}),
      ...(run.workflow ? { workflow: run.workflow } : {}),
    });
  }

  async start(body: unknown): Promise<ManagedRun> {
    const request = StartRunRequestSchema.parse(body);
    const runId = randomUUID();
    const symbols = request.mode === "live" ? [request.symbol] : request.symbols;
    const strategyIds = request.mode === "live" ? [request.strategyId] : request.strategyIds;
    const run: ManagedRun = {
      id: runId, mode: request.mode, profileId: request.profileId, state: "starting", phase: "setup", message: "Validating the selected profile and run settings.",
      startedAt: Date.now(), updatedAt: Date.now(), symbols: [...symbols], strategyIds: [...strategyIds], stopRequested: false,
    };
    this.runs.set(run.id, run);
    this.persist(run);
    this.launch(run, request);
    return run;
  }

  resumeBacktest(runId: string, profileId: string, savedConfig: Record<string, unknown>): ManagedRun {
    const symbol = z.string().min(3).max(24).parse(savedConfig.symbol);
    const strategyId = z.string().min(1).parse(object(savedConfig.strategy).id);
    const from = z.number().int().positive().parse(savedConfig.fromSeconds);
    const to = z.number().int().positive().parse(savedConfig.toSeconds);
    const request = StartRunRequestSchema.parse({ mode: "backtest", profileId, symbols: [symbol], strategyIds: [strategyId], from, to });
    const run: ManagedRun = {
      id: randomUUID(), mode: "backtest", profileId, state: "starting", phase: "setup", message: `Recovering checkpoint for ${runId}.`,
      startedAt: Date.now(), updatedAt: Date.now(), symbols: [symbol], strategyIds: [strategyId], stopRequested: false, resumeRunId: runId,
    };
    this.runs.set(run.id, run);
    this.persist(run);
    this.launch(run, request);
    return run;
  }

  stop(id: string, reason?: string): ManagedRun {
    const run = this.runs.get(id);
    if (!run) throw new Error(`Managed run '${id}' was not found in this service session.`);
    if (!["starting", "running", "waiting"].includes(run.state)) return run;
    run.stopRequested = true;
    run.state = "stopping";
    run.message = reason?.trim() || "Stop requested; completing the current safe operation.";
    run.updatedAt = Date.now();
    this.persist(run);
    return run;
  }

  async shutdown(): Promise<void> {
    for (const run of this.list()) if (["starting", "running", "waiting"].includes(run.state)) this.stop(run.id, "Local service is shutting down; finishing the current safe operation.");
    for (const waiters of runWaiters.values()) for (const waiter of [...waiters]) waiter();
    await Promise.allSettled([...this.tasks.values()]);
  }

  private launch(run: ManagedRun, request: z.infer<typeof StartRunRequestSchema>): void {
    const task = this.execute(run, request).catch((error) => {
      run.state = run.stopRequested ? "stopped" : "failed";
      if (run.stopRequested) delete run.error;
      else run.error = safeMessage(error);
      if (run.workflow) {
        const currentStage = run.workflow.currentStage;
        const stage = run.workflow.stages[currentStage];
        if (stage?.status === "active") run.workflow.stages[currentStage] = {
          ...stage, status: run.stopRequested ? "skipped" : "failed", updatedAt: Date.now(),
          ...(!run.stopRequested ? { detail: safeMessage(error).slice(0, 240) } : {}),
        };
        run.workflow.activeAgents = [];
        run.workflow.updatedAt = Date.now();
      }
      run.message = run.stopRequested ? "Stopped safely. Backtest checkpoints are available for recovery." : "Run failed; inspect the audit and diagnostics for details.";
      run.updatedAt = Date.now();
      this.persist(run);
    }).finally(() => { this.tasks.delete(run.id); });
    this.tasks.set(run.id, task);
  }

  private async execute(run: ManagedRun, request: z.infer<typeof StartRunRequestSchema>): Promise<void> {
    const baseEnvironment = this.profiles.resolve(run.profileId);
    const overrideKeys = Object.keys(request.overrides);
    for (const key of overrideKeys) {
      if (!engineEnvironmentKeys.includes(key as never) || secretKeys.has(key) || ["DATABASE_URL", "LOG_LEVEL", "ENGINE_MODE", "WALLEX_ENABLE_LIVE_TRADING", "WALLEX_ENABLE_AUTOTRADING"].includes(key)) {
        throw new Error(`Per-run override '${key}' is not allowed.`);
      }
    }
    const baseConfig = loadConfig(baseEnvironment);
    if (request.mode === "live") {
      const liveOverrideKeys = new Set(["RISK_MAX_ORDER_NOTIONAL", "RISK_MAX_POSITION_NOTIONAL", "RISK_MAX_GROSS_EXPOSURE", "RISK_MAX_DRAWDOWN_PCT", "RISK_MAX_DAILY_LOSS", "LIVE_MAX_GROSS_EXPOSURE", "RISK_KILL_SWITCH", "RISK_PAIR_LIMITS_JSON"]);
      for (const key of overrideKeys) {
        if (!liveOverrideKeys.has(key)) throw new Error(`Live per-run override '${key}' is not permitted. Live overrides may only tighten risk limits.`);
        if (key === "RISK_KILL_SWITCH") {
          if (baseConfig.risk.killSwitch && request.overrides[key] !== "true") throw new Error("A per-run setting cannot disable the profile kill switch.");
          continue;
        }
        if (key === "RISK_PAIR_LIMITS_JSON") {
          assertPairLimitsTighten(baseConfig.risk.pairLimits ?? {}, parsePairLimits(request.overrides[key]));
          continue;
        }
        const base = key === "LIVE_MAX_GROSS_EXPOSURE" ? baseConfig.wallex.liveMaxGrossExposure
          : key === "RISK_MAX_ORDER_NOTIONAL" ? baseConfig.risk.maxOrderNotional
          : key === "RISK_MAX_POSITION_NOTIONAL" ? baseConfig.risk.maxPositionNotional
          : key === "RISK_MAX_GROSS_EXPOSURE" ? baseConfig.risk.maxGrossExposure
          : key === "RISK_MAX_DRAWDOWN_PCT" ? baseConfig.risk.maxDrawdownPct
          : baseConfig.risk.maxDailyLoss;
        if (new Decimal(request.overrides[key]!).gt(base)) throw new Error(`Live per-run override '${key}' cannot exceed the selected profile's risk limit.`);
      }
    }
    const config = loadConfig({ ...baseEnvironment, ...request.overrides });
    const errors = validateModeConfig(config, request.mode);
    if (request.mode === "live" && request.autoTrade) errors.push(...validateAutoTradeRequest(config, true));
    if (errors.length) throw new Error(errors.join("\n"));
    const strategies = request.mode === "live"
      ? [selectStrategy(config.strategies, request.strategyId)]
      : request.strategyIds.map((id) => selectStrategy(config.strategies, id));
    const symbols = normalizeSymbols(symbolsFor(request), config);
    if (request.mode === "live" && (request.autoTrade && (symbols.length !== 1 || strategies.length !== 1))) throw new Error("Autonomous live trading is limited to one pair and one strategy per service.");
    const runtime = createRuntime(config);
    try {
      runtime.workflow.setProgressListener((workflow) => {
        run.workflow = workflow;
        run.updatedAt = workflow.updatedAt;
        this.persist(run);
      });
      run.state = "running"; run.phase = "engine"; run.message = request.mode === "live" ? "Live run is preparing its pre-trade checks." : `Running ${request.mode} for ${symbols.join(", ")}.`; run.updatedAt = Date.now(); this.persist(run);
      if (request.mode === "backtest") {
        const reports: RunReport[] = [];
        for (const symbol of symbols) for (const strategy of strategies) {
          if (run.stopRequested) throw new Error("Run stopped by operator.");
          const candles = run.resumeRunId ? undefined : await runtime.marketData.getCandles(symbol, request.from, request.to, 1);
          reports.push(await runBacktest({ symbol, fromSeconds: request.from, toSeconds: request.to, strategy,
            ...(candles ? { dataset: candles } : {}), ...(run.resumeRunId ? { runId: run.resumeRunId, resume: true } : {}),
            shouldStop: () => run.stopRequested }, config, runtime.marketData, runtime.workflow, runtime.repository));
          run.message = `Completed ${reports.length} of ${symbols.length * strategies.length} backtest cases.`; run.updatedAt = Date.now();
          this.persist(run);
        }
        run.state = run.stopRequested ? "stopped" : "completed";
        run.message = run.stopRequested ? "Stopped safely; the most recent completed bar is checkpointed for recovery." : `${reports.length} backtest case(s) completed.`;
        run.updatedAt = Date.now(); this.persist(run);
        return;
      }
      if (request.mode === "shadow") {
        const shadow = request as z.infer<typeof ShadowRunRequestSchema>;
        do {
          if (run.stopRequested) break;
          let completed = 0;
          for (const symbol of symbols) for (const strategy of strategies) {
            if (run.stopRequested) break;
            await runShadowCycle(symbol, config, runtime.marketData, runtime.workflow, runtime.repository, Date.now, strategy);
            completed++;
            run.message = `Completed ${completed} of ${symbols.length * strategies.length} shadow cycle(s).`; run.updatedAt = Date.now();
            this.persist(run);
          }
          if (!shadow.watch || run.stopRequested) break;
          run.state = "waiting"; run.message = `Cycle complete. Next cycle in ${shadow.intervalSeconds} seconds.`; run.updatedAt = Date.now();
          this.persist(run);
          await waitForStop(shadow.intervalSeconds * 1000, run);
          run.state = "running"; run.updatedAt = Date.now(); this.persist(run);
        } while (!run.stopRequested);
        run.state = run.stopRequested ? "stopped" : "completed";
        if (!run.stopRequested) run.message = "Shadow run completed successfully.";
        run.updatedAt = Date.now();
        this.persist(run);
        return;
      }
      const live = request as z.infer<typeof LiveRunRequestSchema>;
      do {
        if (run.stopRequested) break;
        await runLiveCycle(symbols[0]!, config, runtime.marketData, createLiveExecution(config), runtime.workflow, runtime.repository, Date.now, () => run.stopRequested, strategies[0]);
        run.message = "Live cycle completed; no further order is submitted unless the next risk-gated proposal passes."; run.updatedAt = Date.now();
        this.persist(run);
        if (!live.autoTrade || run.stopRequested) break;
        run.state = "waiting"; run.message = `Live cycle complete. Next evaluation in ${live.intervalSeconds} seconds.`; run.updatedAt = Date.now();
        this.persist(run);
        await waitForStop(live.intervalSeconds * 1000, run);
        run.state = "running"; run.updatedAt = Date.now(); this.persist(run);
      } while (!run.stopRequested);
    } finally {
      runtime.repository.close();
      await runtime.marketData.close?.();
    }
    run.state = run.stopRequested ? "stopped" : "completed";
    if (run.state === "completed") run.message = "Run completed successfully.";
    run.updatedAt = Date.now();
    this.persist(run);
  }
}

function symbolsFor(request: z.infer<typeof StartRunRequestSchema>): string[] {
  return request.mode === "live" ? [request.symbol] : request.symbols;
}

function waitForStop(milliseconds: number, run: ManagedRun): Promise<void> {
  return new Promise((resolveWait) => {
    let timer: ReturnType<typeof setTimeout>;
    const waiters = runWaiters.get(run.id) ?? new Set<() => void>();
    function done() {
      clearTimeout(timer); waiters.delete(done);
      if (waiters.size === 0) runWaiters.delete(run.id);
      resolveWait();
    }
    timer = setTimeout(done, milliseconds);
    waiters.add(done);
    runWaiters.set(run.id, waiters);
  });
}
const runWaiters = new Map<string, Set<() => void>>();

function summarizeProfile(profile: ReturnType<ConfigurationProfileService["get"]>) {
  return {
    ...profile,
    secrets: {
      aiApiKey: profile.secretState.aiApiKey,
      wallexApiKey: profile.secretState.wallexApiKey,
      subAccountClientId: profile.secretState.subAccountClientId,
      tronscanApiKey: profile.secretState.tronscanApiKey,
      providerKeys: Object.fromEntries(providerIds.map((id) => [id, Boolean(profile.secretState.providerKeys[id])])),
      researchEndpoints: profile.secretState.researchEndpoints,
      marketQuoteFallbacks: profile.secretState.marketQuoteFallbacks,
    },
  };
}

export async function importDotenvFile(input: { path: string; name: string; profileId?: string }, profiles: ConfigurationProfileService, repository: SqliteRunRepository) {
  const path = resolve(input.path);
  if (!/(^|[\\/])\.env(?:\.[^\\/]*)?$/i.test(path)) throw new Error("Choose a dotenv file named .env or .env.<name>.");
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("The selected dotenv path must be a regular file, not a link.");
  const original = await readFile(path, "utf8");
  const parsed = parseDotenv(original);
  // Encryption keys belong in the process secret manager. Scrub a legacy dotenv copy without importing it.
  delete parsed.ENCRYPTION_KEY;
  const profile = profiles.replaceFromImportedEnvironment(input.name, parsed, input.profileId);
  const envelopes = repository.getConfigProfileSecrets(profile.id);
  if (envelopes.length > 0) {
    const key = parseEncryptionKey();
    for (const envelope of envelopes) decryptProfileSecret(profile.id, envelope, key);
  }
  profiles.effectiveConfig(profile.id);
  const configurationKeys = new Set<string>([...engineEnvironmentKeys, "DATABASE_URL", "ENCRYPTION_KEY"]);
  const lines = original.split(/(?<=\n)/);
  const keptLines: string[] = [];
  let removingQuotedValue: string | undefined;
  for (const line of lines) {
    if (removingQuotedValue) {
      if (dotenvQuoteCloses(line, removingQuotedValue, 0)) removingQuotedValue = undefined;
      continue;
    }
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=([\s\S]*)$/);
    if (!match || !configurationKeys.has(match[1]!)) {
      keptLines.push(line);
      continue;
    }
    const value = match[2]!.trimStart();
    const quote = value[0];
    if ((quote === "\"" || quote === "'" || quote === "`") && !dotenvQuoteCloses(value, quote, 1)) {
      removingQuotedValue = quote;
    }
  }
  const scrubbed = keptLines.join("");
  if (scrubbed !== original) {
    const latestInfo = await lstat(path);
    const latest = await readFile(path, "utf8");
    if (latestInfo.ino !== info.ino || latest !== original) throw new Error("The dotenv file changed during import; it was not modified. Review it and retry.");
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, scrubbed, { mode: info.mode & 0o777 });
      await chmod(temp, info.mode & 0o777);
      await rename(temp, path);
    } catch (error) {
      await unlink(temp).catch(() => undefined);
      throw error;
    }
  }
  return { profile: summarizeProfile(profiles.get(profile.id)), removedConfigurationAssignments: original.split(/\r?\n/).filter((line) => {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    return match && configurationKeys.has(match[1]!);
  }).length, file: basename(path) };
}

function dotenvQuoteCloses(value: string, quote: string, startAt: number): boolean {
  let escaped = false;
  for (let index = startAt; index < value.length; index += 1) {
    const character = value[index]!;
    if (quote === "\"" && character === "\\") {
      escaped = !escaped;
      continue;
    }
    if (character === quote && !escaped) return true;
    escaped = false;
  }
  return false;
}

export async function startAdminServer(options: { host?: string; port?: number; open?: boolean; environment?: NodeJS.ProcessEnv; databaseUrl?: string } = {}) {
  const host = options.host ?? "127.0.0.1";
  if (host !== "127.0.0.1") throw new Error("The local admin API may only bind to 127.0.0.1.");
  const environment = options.environment ?? process.env;
  const databaseUrl = options.databaseUrl ?? getDatabaseUrl();
  // Operator-supplied ENCRYPTION_KEY wins; otherwise the key is managed in a file beside the database and created on first use.
  const encryptionKey = resolveEncryptionKey({ databaseUrl, environment });
  environment.ENCRYPTION_KEY = encryptionKey.key;
  const managedKeyFile = encryptionKey.source === "file" ? encryptionKey.path : undefined;
  if (encryptionKey.created && managedKeyFile) console.log(`Created a new encryption key at ${managedKeyFile}. Back up that file: without it, stored credentials cannot be recovered.`);
  const baseConfig = loadConfig({ DATABASE_URL: databaseUrl });
  const repository = new SqliteRunRepository(baseConfig.databaseUrl);
  repository.migrate();
  const profiles = new ConfigurationProfileService(repository, Date.now, () => ({}), () => parseEncryptionKey(environment.ENCRYPTION_KEY ?? ""), databaseUrl);
  profiles.list();
  const runs = new RunManager(profiles, repository);
  const token = randomUUID() + randomUUID();
  const allowedOrigins = new Set<string>();
  const dashboardOrigin = `http://127.0.0.1:${options.port ?? 4173}`;
  allowedOrigins.add(dashboardOrigin);
  allowedOrigins.add(`http://localhost:${options.port ?? 4173}`);
  // Vite is available only for local development; the API remains loopback-only and requires its per-session token.
  allowedOrigins.add("http://127.0.0.1:5173"); allowedOrigins.add("http://localhost:5173");
  const dist = resolve(import.meta.dir, "../../dashboard/dist");
  const isAllowedOrigin = (origin: string): boolean => {
    if (allowedOrigins.has(origin)) return true;
    try {
      const parsed = new URL(origin);
      return parsed.protocol === "http:" && (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") && parsed.port === String(server.port);
    } catch { return false; }
  };

  function configFields(profileId: string) {
    const config = profiles.effectiveConfig(profileId);
    const profile = profiles.get(profileId);
    const values = envValue(config);
    return engineEnvironmentKeys.map((key) => ({
      key, group: settingGroups[key] ?? "Advanced", value: secretKeys.has(key) ? "" : profile.settings[key] ?? values[key] ?? "",
      source: profile.settings[key] !== undefined ? "profile" : "default",
      writable: !secretKeys.has(key),
      secret: secretKeys.has(key),
    }));
  }

  async function diagnostics(mode: Mode, checkWallex: boolean, config: EngineConfig) {
    const checks: Array<{ name: string; status: "pass" | "fail" | "skip"; detail: string }> = [];
    try { checks.push({ name: "Configuration", status: "pass", detail: `${mode} settings parsed successfully.` }); }
    catch (error) { checks.push({ name: "Configuration", status: "fail", detail: safeMessage(error) }); }
    const issues = validateModeConfig(config, mode);
    if (!config.wallex.allowedMarkets.length) issues.push("Add approved markets to WALLEX_ALLOWED_MARKETS.");
    checks.push(issues.length ? { name: "Mode safety", status: "fail", detail: issues.join("; ") } : { name: "Mode safety", status: "pass", detail: "Required providers and safety gates are configured." });
    try { repository.getRecentRuns(1); checks.push({ name: "Database", status: "pass", detail: "SQLite is available and migrations are current." }); }
    catch (error) { checks.push({ name: "Database", status: "fail", detail: safeMessage(error) }); }
    if (checkWallex) {
      const market = createRuntime(config);
      try {
        const markets = await market.marketData.listSpotMarkets();
        const active = new Set(markets.map((item) => item.symbol));
        const unavailable = config.wallex.allowedMarkets.filter((symbol) => !active.has(symbol));
        checks.push(unavailable.length ? { name: "Wallex read API", status: "fail", detail: `Inactive allowlisted markets: ${unavailable.join(", ")}.` } : { name: "Wallex read API", status: "pass", detail: `${markets.length} active spot markets received.` });
      } catch (error) { checks.push({ name: "Wallex read API", status: "fail", detail: safeMessage(error) }); }
      finally { market.repository.close(); await market.marketData.close?.(); }
    } else checks.push({ name: "Wallex read API", status: "skip", detail: "Not checked. Enable the read-only connection check to test Wallex." });
    checks.push({ name: "Order write safety", status: "pass", detail: "Diagnostics never submits or cancels exchange orders." });
    return { healthy: checks.every((item) => item.status !== "fail"), mode, checks };
  }

  const server = Bun.serve({
    hostname: host, port: options.port ?? 4173, idleTimeout: 255, maxRequestBodySize: 1_048_576,
    async fetch(request, server) {
      const url = new URL(request.url);
      const hostHeader = request.headers.get("host")?.split(":")[0]?.toLowerCase();
      if (hostHeader !== "127.0.0.1" && hostHeader !== "localhost") return new Response("Not found", { status: 404 });
      const origin = request.headers.get("origin");
      const isSessionRoute = url.pathname === "/api/session";
      if (request.method !== "GET" && (!origin || !isAllowedOrigin(origin))) return json({ error: { code: "origin_rejected", message: "Request origin is not allowed." } }, 403);
      if (origin && !isAllowedOrigin(origin)) return json({ error: { code: "origin_rejected", message: "Request origin is not allowed." } }, 403);
      if (url.pathname.startsWith("/api/") && !isSessionRoute && request.headers.get("x-trex-session") !== token && url.searchParams.get("token") !== token) {
        return json({ error: { code: "session_required", message: "Open the dashboard from the local service URL and retry." } }, 401);
      }
      try {
        if (url.pathname === "/api/session" && request.method === "GET") return json({ token, locale: "fa" });
        if (url.pathname === "/api/bootstrap" && request.method === "GET") {
          const profileId = getProfileId(url, profiles.activeId());
          const config = profiles.effectiveConfig(profileId);
          const runsList = repository.getRecentRuns(30);
          return json({ profiles: profiles.list().map((item) => summarizeProfile(item)), activeProfileId: profiles.activeId(), selectedProfileId: profileId,
            config: publicConfig(config), encryptionKeyConfigured: (() => { try { if (!environment.ENCRYPTION_KEY) return false; parseEncryptionKey(environment.ENCRYPTION_KEY); return true; } catch { return false; } })(),
            encryptionKeySource: encryptionKey.source, encryptionKeyPath: managedKeyFile ?? null,
            fields: configFields(profileId), strategies: config.strategies,
            runs: runsList, managedRuns: runs.list(), database: { url: config.databaseUrl, migrationCommand: "db:migrate" } });
        }
        if (url.pathname === "/api/profiles" && request.method === "GET") return json({ profiles: profiles.list().map(summarizeProfile), activeProfileId: profiles.activeId() });
        if (url.pathname === "/api/profiles" && request.method === "POST") {
          const input = await parseJsonBody(request, CreateProfileSchema);
          return json({ profile: summarizeProfile(profiles.create(input.name, input.copyFrom)) }, 201);
        }
        const profileMatch = url.pathname.match(/^\/api\/profiles\/([^/]+)$/);
        if (profileMatch && request.method === "PUT") {
          const input = await parseJsonBody(request, UpdateProfileSchema);
          const secrets: Record<string, string | null> = {};
          if (input.secrets?.aiApiKey !== undefined) secrets.AI_API_KEY = input.secrets.aiApiKey;
          if (input.secrets?.wallexApiKey !== undefined) secrets.WALLEX_API_KEY = input.secrets.wallexApiKey;
          if (input.secrets?.subAccountClientId !== undefined) secrets.WALLEX_SUB_ACCOUNT_CLIENT_ID = input.secrets.subAccountClientId;
          if (input.secrets?.tronscanApiKey !== undefined) secrets.TRONSCAN_API_KEY = input.secrets.tronscanApiKey;
          if (input.secrets?.researchEndpoints !== undefined) secrets.RESEARCH_ENDPOINTS_JSON = input.secrets.researchEndpoints;
          if (input.secrets?.marketQuoteFallbacks !== undefined) secrets.MARKET_QUOTE_FALLBACKS_JSON = input.secrets.marketQuoteFallbacks;
          for (const provider of providerIds) if (input.secrets?.providerKeys?.[provider] !== undefined) secrets[`AI_PROVIDER_KEY:${provider}`] = input.secrets.providerKeys[provider]!;
          const profile = profiles.update(decodeURIComponent(profileMatch[1]!), { ...(input.name ? { name: input.name } : {}), ...(input.settings ? { settings: input.settings } : {}), ...(Object.keys(secrets).length ? { secrets } : {}) });
          return json({ profile: summarizeProfile(profile) });
        }
        if (profileMatch && request.method === "DELETE") {
          profiles.delete(decodeURIComponent(profileMatch[1]!));
          return json({ deleted: true });
        }
        const activateMatch = url.pathname.match(/^\/api\/profiles\/([^/]+)\/activate$/);
        if (activateMatch && request.method === "POST") return json({ profile: summarizeProfile(profiles.activate(decodeURIComponent(activateMatch[1]!))) });
        if (url.pathname === "/api/profiles/import-dotenv" && request.method === "POST") {
          const input = await parseJsonBody(request, DotenvImportSchema);
          return json(await importDotenvFile({ path: input.path, name: input.name, ...(input.profileId ? { profileId: input.profileId } : {}) }, profiles, repository));
        }
        if (url.pathname === "/api/diagnostics" && request.method === "POST") {
          const input = await parseJsonBody(request, DiagnosticsRequestSchema);
          return json(await diagnostics(input.mode, input.checkWallex, profiles.effectiveConfig(getProfileId(url, profiles.activeId()))));
        }
        if (url.pathname === "/api/markets" && request.method === "GET") {
          const input = MarketListRequestSchema.parse({ all: url.searchParams.get("all") === "true" });
          const config = profiles.effectiveConfig(getProfileId(url, profiles.activeId()));
          const runtime = createRuntime(config);
          try {
            const markets = await runtime.marketData.listSpotMarkets();
            const filtered = input.all ? markets : markets.filter((item) => config.wallex.allowedMarkets.includes(item.symbol));
            return json({ markets: filtered, configuredAllowlist: config.wallex.allowedMarkets });
          } finally { runtime.repository.close(); await runtime.marketData.close?.(); }
        }
        if (url.pathname === "/api/account" && request.method === "GET") {
          const config = profiles.effectiveConfig(getProfileId(url, profiles.activeId()));
          if (!config.wallex.apiKey || !config.wallex.subAccountClientId) throw new Error("Wallex credit-account read credentials are required for this read-only balance request.");
          const runtime = createRuntime(config);
          try { return json({ portfolio: await runtime.marketData.getAccountPortfolio!(), observedAt: Date.now(), label: "actual Wallex credit-account balance" }); }
          finally { runtime.repository.close(); await runtime.marketData.close?.(); }
        }
        if (url.pathname === "/api/secrets/generate-key" && request.method === "POST") return json({ key: generateEncryptionKey(), notice: "Copy this key to an external secret manager. It is not stored by this application." });
        if (url.pathname === "/api/secrets/rekey" && request.method === "POST") {
          const body = await parseJsonBody(request, RekeySecretsSchema);
          // With the managed key file both keys are optional: the current key is known and a replacement is generated here.
          const previousKey = body.previousKey ?? (managedKeyFile ? environment.ENCRYPTION_KEY ?? "" : "");
          const replacementKey = body.replacementKey ?? (managedKeyFile ? generateEncryptionKey() : "");
          if (!previousKey || !replacementKey) throw new Error("previousKey and replacementKey are required when ENCRYPTION_KEY is supplied by the operator.");
          const newKey = parseEncryptionKey(replacementKey), oldKey = parseEncryptionKey(previousKey);
          const count = rotateProfileSecretEnvelopes(profiles.list().map(({ id }) => ({ id })), repository, oldKey, newKey);
          if (managedKeyFile) writeEncryptionKeyFile(managedKeyFile, replacementKey);
          environment.ENCRYPTION_KEY = replacementKey;
          return json({
            reencryptedSecretCount: count, restartRequired: !managedKeyFile, keyFileUpdated: Boolean(managedKeyFile),
            message: managedKeyFile
              ? `Secrets were re-encrypted and the key file at ${managedKeyFile} was replaced. Refresh any backup copies of that file.`
              : "Secrets were re-encrypted. Update ENCRYPTION_KEY in your process secret manager and restart the service.",
          });
        }
        if (url.pathname === "/api/settings" && request.method === "PUT") {
          const body = z.object({ profileId: z.string(), settings: z.record(z.string(), z.string()) }).parse(await request.json());
          for (const key of Object.keys(body.settings)) {
            if (!engineEnvironmentKeys.includes(key as never) || secretKeys.has(key)) throw new Error(`Setting ${key} is not writable here. Secrets use the dedicated encrypted fields.`);
          }
          const profile = profiles.update(body.profileId, { settings: body.settings });
          return json({ profile: summarizeProfile(profile), fields: configFields(body.profileId), config: publicConfig(profiles.effectiveConfig(body.profileId)) });
        }
        if (url.pathname === "/api/strategies" && request.method === "PUT") {
          const body = z.object({ profileId: z.string(), strategies: z.array(StrategyProfileSchema).max(100) }).parse(await request.json());
          const profile = profiles.get(body.profileId);
          const updated = profiles.update(body.profileId, { settings: { ...profile.settings, ENGINE_STRATEGIES_JSON: JSON.stringify(body.strategies) } });
          return json({ profile: summarizeProfile(updated), strategies: profiles.effectiveConfig(body.profileId).strategies });
        }
        if (url.pathname === "/api/validate" && request.method === "GET") {
          const mode = z.enum(["backtest", "shadow", "live"]).default("shadow").parse(url.searchParams.get("mode") ?? undefined);
          const config = profiles.effectiveConfig(getProfileId(url, profiles.activeId()));
          const errors = validateModeConfig(config, mode);
          if (!config.wallex.allowedMarkets.length) errors.push("WALLEX_ALLOWED_MARKETS must list at least one approved spot market.");
          return json({ valid: errors.length === 0, mode, errors, config: publicConfig(config), fields: configFields(getProfileId(url, profiles.activeId())) });
        }
        if (url.pathname === "/api/markets/configured" && request.method === "GET") return json({ allowlist: profiles.effectiveConfig(getProfileId(url, profiles.activeId())).wallex.allowedMarkets });
        if (url.pathname === "/api/runs" && request.method === "GET") {
          const { limit } = RunListQuerySchema.parse({ limit: url.searchParams.get("limit") ?? undefined });
          return json({ runs: repository.getRecentRuns(limit), managedRuns: runs.list() });
        }
        if (url.pathname === "/api/runs" && request.method === "POST") return json({ run: await runs.start(await request.json()) }, 202);
        const resumeMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/resume$/);
        if (resumeMatch && request.method === "POST") {
          const body = z.object({ profileId: z.string().min(1) }).parse(await request.json());
          const id = decodeURIComponent(resumeMatch[1]!);
          const stored = repository.getRun(id);
          if (!stored || stored.mode !== "backtest" || !repository.loadCheckpoint(id, "backtest")) throw new Error("This run has no recoverable backtest checkpoint.");
          return json({ run: runs.resumeBacktest(id, body.profileId, object(stored.config)) }, 202);
        }
        const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
        if (runMatch && request.method === "GET") {
          const id = decodeURIComponent(runMatch[1]!);
          const run = repository.getRunDetails(id);
          if (!run) return json({ error: { code: "not_found", message: "Run not found." } }, 404);
          return json({ run });
        }
        const managedMatch = url.pathname.match(/^\/api\/managed-runs\/([^/]+)\/stop$/);
        if (managedMatch && request.method === "POST") {
          const body = await parseJsonBody(request, StopRunRequestSchema);
          const stopped = runs.stop(decodeURIComponent(managedMatch[1]!), body.reason);
          for (const waiter of [...(runWaiters.get(stopped.id) ?? [])]) waiter();
          return json({ run: stopped });
        }
        if (url.pathname === "/api/reports" && request.method === "GET") {
          const limit = z.coerce.number().int().min(1).max(200).default(50).parse(url.searchParams.get("limit") ?? undefined);
          const runId = url.searchParams.get("runId");
          const selectedRuns = runId ? [repository.getRun(runId)].filter(Boolean) : repository.getRecentRuns(limit);
          const details = selectedRuns.flatMap((item) => {
            if (!item) return [];
            const detail = repository.getRunDetails(String(item.id));
            return detail ? [detail] : [];
          });
          const reports = details.flatMap((item) => {
            const report = (item.run.report ?? null) as RunReport | null;
            return report ? [report] : [];
          });
          return json({ runs: details, reports, comparison: compareRuns(reports) });
        }
        if (url.pathname === "/api/benchmarks" && request.method === "GET") {
          const { limit } = BenchmarkQuerySchema.parse({ limit: url.searchParams.get("limit") ?? undefined });
          const reports = repository.getRecentRuns(limit).flatMap((item) => {
            const report = object(item.report);
            return typeof report.runId === "string" && ["backtest", "shadow", "live"].includes(String(report.mode))
              ? [report as unknown as RunReport]
              : [];
          });
          const shadowGroups = new Map<string, RunReport[]>();
          const oneOffReports: RunReport[] = [];
          for (const report of reports) {
            if (report.mode !== "shadow" || !report.symbol || !report.strategyId) { oneOffReports.push(report); continue; }
            const key = `${report.symbol}\0${report.strategyId}\0${report.quoteCurrency ?? ""}`;
            const group = shadowGroups.get(key) ?? [];
            group.push(report); shadowGroups.set(key, group);
          }
          const aggregates = [...shadowGroups.values()].flatMap((group) => {
            const aggregate = aggregateRunReports(group);
            return aggregate ? [aggregate] : [];
          });
          return json({ comparison: compareRuns([...oneOffReports, ...aggregates]), sampledRuns: reports.length, limit });
        }
        if (url.pathname === "/api/reports/export" && request.method === "GET") {
          const runId = url.searchParams.get("runId");
          const limit = z.coerce.number().int().min(1).max(200).default(50).parse(url.searchParams.get("limit") ?? undefined);
          const selected = runId ? [repository.getRunDetails(runId)].filter(Boolean) : repository.getRecentRuns(limit).flatMap((item) => [repository.getRunDetails(String(item.id))].filter(Boolean));
          const audit = { runs: selected.filter((item): item is NonNullable<typeof item> => item !== null), totalRuns: selected.length };
          const reports = selected.flatMap((item) => item?.run.report ? [item.run.report as RunReport] : []);
          const html = renderBenchmarkHtml(reports, runId ? `Run ${runId} audit` : "Trex trading audit", undefined, audit, false);
          return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "content-disposition": "attachment; filename=trex-report.html", "cache-control": "no-store" } });
        }
        if (url.pathname === "/api/orders" && request.method === "GET") {
          const openOnly = url.searchParams.get("open") === "true";
          const records = repository.getRecentRuns(200).flatMap((run) => {
            const details = repository.getRunDetails(String(run.id));
            return (details?.orders ?? []).map((order) => ({ ...order, mode: (details?.run.mode ?? "unknown"), symbol: order.order.symbol }));
          }).sort((a, b) => b.createdAt - a.createdAt);
          return json({ orders: openOnly ? records.filter((order) => ["pending", "submitted", "reconciling", "NEW", "PARTIALLY_FILLED"].includes(order.state)) : records });
        }
        if (url.pathname === "/api/orders/cancel" && request.method === "POST") {
          const { clientOrderId } = await parseJsonBody(request, OrderCancelSchema);
          const intent = repository.getOrderIntent(clientOrderId);
          if (!intent) throw new Error("This order intent is not recorded by the engine.");
          const run = repository.getRun(intent.runId);
          if (run?.mode !== "live") throw new Error("Only an engine live-mode order can be canceled here.");
          if (!("pending submitted reconciling".split(" ").includes(intent.state))) throw new Error(`Order is already ${intent.state}; it cannot be canceled.`);
          const config = profiles.effectiveConfig(getProfileId(url, profiles.activeId()));
          const errors = validateModeConfig(config, "live");
          if (errors.length) throw new Error(errors.join("\n"));
          const owner = randomUUID(), leaseMs = 300_000;
          if (!repository.acquireExecutionLease("wallex-live", owner, Date.now(), leaseMs)) throw new Error("Another process currently holds the live-execution lease.");
          const lease = new ExecutionLeaseGuard(repository, "wallex-live", owner, Date.now, leaseMs);
          try {
            const exchange = createLiveExecution(config);
            let order = await exchange.getOrder(clientOrderId);
            if (!order || order.status === "UNKNOWN") order = (await exchange.listOpenOrders(intent.order.symbol)).find((entry) => entry.clientOrderId === clientOrderId) ?? null;
            if (!order) throw new Error("Wallex did not confirm the order; its intent remains unresolved.");
            if (["NEW", "PARTIALLY_FILLED"].includes(order.status)) { lease.assertHeld(); order = await exchange.cancelOrder(clientOrderId); }
            if (!order) throw new Error("Wallex did not confirm cancellation; its intent remains unresolved.");
            lease.assertHeld(); repository.updateOrderIntent(clientOrderId, orderIntentState(order), order); repository.saveFills(order);
            return json({ order });
          } finally { lease.close(); repository.releaseExecutionLease("wallex-live", owner); }
        }
        if (url.pathname === "/api/db/migrate" && request.method === "POST") { repository.migrate(); return json({ migrated: true }); }
        if (url.pathname === "/api/events" && request.method === "GET") {
          let timer: ReturnType<typeof setInterval> | undefined;
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              const encoder = new TextEncoder();
              const send = () => {
                try { controller.enqueue(encoder.encode(`event: state\ndata: ${JSON.stringify({ managedRuns: runs.list(), recentRuns: repository.getRecentRuns(30) })}\n\n`)); }
                catch { if (timer) clearInterval(timer); }
              };
              send();
              timer = setInterval(send, 2000);
            },
            cancel() { if (timer) clearInterval(timer); },
          });
          return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" } });
        }
        if (url.pathname.startsWith("/api/")) return json({ error: { code: "not_found", message: "API route not found." } }, 404);
      } catch (error) {
        const status = error instanceof z.ZodError ? 400 : 400;
        return json({ error: { code: error instanceof z.ZodError ? "validation_error" : "request_failed", message: safeMessage(error), ...(error instanceof z.ZodError ? { details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })) } : {}) } }, status);
      }

      if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
      const requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
      const candidate = resolve(dist, `.${requested}`);
      if (!candidate.startsWith(dist + sep) && candidate !== resolve(dist, "index.html")) return new Response("Not found", { status: 404 });
      let staticPath = candidate;
      let file = Bun.file(staticPath);
      if (!(await file.exists())) { staticPath = resolve(dist, "index.html"); file = Bun.file(staticPath); }
      if (!(await file.exists())) return new Response("Dashboard is not built. Run `bun run build`, or use the Vite development server.", { status: 503 });
      const securityHeaders = { "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "content-security-policy": "default-src 'self'; connect-src 'self' http://127.0.0.1:* http://localhost:*; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" };
      if (staticPath.endsWith("index.html")) {
        const content = (await file.text()).replace("</head>", `<meta name="trex-admin-token" content="${token}"></head>`);
        return new Response(content, { headers: { ...securityHeaders, "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
      }
      const mimeTypes: Record<string, string> = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json" };
      return new Response(file, { headers: { ...securityHeaders, "content-type": mimeTypes[extname(staticPath)] ?? "application/octet-stream", "cache-control": "public, max-age=31536000, immutable" } });
    },
  });
  const address = `http://127.0.0.1:${server.port}`;
  console.log(`Trex dashboard: ${address}`);
  console.log("Local-only service is running. Press Ctrl+C to stop it.");
  let shutdownTask: Promise<void> | undefined;
  const shutdown = (): Promise<void> => {
    if (shutdownTask) return shutdownTask;
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    server.stop(true);
    shutdownTask = runs.shutdown().finally(() => repository.close());
    return shutdownTask;
  };
  const onSignal = () => { void shutdown(); };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  return { server, address, profiles, repository, runs, token, close: shutdown };
}
