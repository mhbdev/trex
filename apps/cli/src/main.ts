import { randomUUID } from "node:crypto";
import { Command, Option } from "commander";
import { validateAutoTradeRequest, validateModeConfig, type EngineConfig } from "@trex/engine/domain/config";
import { ModeSchema } from "@trex/engine/domain/types";
import { ConfiguredJsonResearchProvider } from "@trex/engine/application/research-aggregator";
import { WallexMarketDataAdapter, WallexMarketStream } from "@trex/engine/adapters/wallex/rest";
import { SqliteRunRepository } from "@trex/engine/adapters/persistence/store";
import { parseQuoteFallbacks } from "@trex/engine/adapters/providers/quote-failover";
import { createLiveExecution, createRuntime, createProfileContext, getDatabaseUrl, loadEffectiveConfig, publicConfig } from "./runtime.ts";
import { ensureEncryptionKey, writeEncryptionKeyFile, type ResolvedEncryptionKey } from "@trex/engine/adapters/security/encryption-key-file";
import { buildDashboard, dashboardIsBuilt, openInBrowser, probeDashboard } from "./launcher.ts";
import { WallexOrderExecutionAdapter } from "@trex/engine/adapters/wallex/rest";
import { orderIntentState } from "@trex/engine/application/live-execution";
import { ExecutionLeaseGuard } from "@trex/engine/application/execution-lease";
import { runBacktest } from "@trex/engine/modes/backtest";
import { runLiveCycle } from "@trex/engine/modes/live";
import { runShadowCycle } from "@trex/engine/modes/shadow";
import { selectStrategy, type StrategyProfile } from "@trex/engine/domain/strategies";
import { normalizeMarketSymbol } from "@trex/engine/domain/market-symbol";
import type { RunReport } from "@trex/engine/domain/types";
import type { RunAuditDetails, RunRepository } from "@trex/engine/application/ports";
import { aggregateRunReports, compareRuns } from "@trex/engine/application/reporting";
import { renderBenchmarkHtml, writeBenchmarkHtml, type DashboardAuditData } from "@trex/engine/application/visualization";
import { LocalDashboardServer } from "@trex/engine/adapters/http/local-dashboard-server";
import { auditFailure } from "@trex/engine/application/failure-audit";
import { addConfigOptions, applyConfigOptions, configureEnvironment, hasConfigOverride, missingModeConfiguration, persistConfigValue, removeConfigValue } from "./configuration.ts";
import { startAdminServer, importDotenvFile } from "./admin-server.ts";
import { generateEncryptionKey, parseEncryptionKey, rotateProfileSecretEnvelopes } from "@trex/engine/adapters/security/secret-vault";
import { promptSecret } from "./configuration.ts";

const program = new Command();
program.name("trex").description("Trex crypto research, backtesting, shadow trading, and Wallex spot execution.").version("0.1.0");
program.option("--database-url <url>", "SQLite database location for this invocation (bootstrap only; not a profile setting)");
program.addHelpText("after", `
Quick start:
  trex configure --mode shadow
  trex doctor --mode shadow --check-wallex
  trex shadow --symbol BTCUSDT --watch --html reports/shadow.html
  trex report --html reports/recent-runs.html

Live orders require separate live enablement and the explicit live command. Autonomous
  one live cycle can submit a real order. Repeated live autotrading additionally
  requires --auto-trade and a separate configuration opt-in.
Use "trex <command> --help" to see command-specific options.
`);

function parseTime(value: string): number {
  const seconds = /^\d+$/.test(value) ? Number(value) : Math.floor(Date.parse(value) / 1000);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`Invalid timestamp: ${value}`);
  return seconds;
}

async function resolveModeConfig(mode: "backtest" | "shadow" | "live", options: Record<string, unknown>, autoTradeRequested = false): Promise<EngineConfig> {
  let errors = missingModeConfiguration(mode, autoTradeRequested);
  const config = loadEffectiveConfig();
  const explicitlyDisabledLive = mode === "live" && hasConfigOverride(options, "WALLEX_ENABLE_LIVE_TRADING") && !config.wallex.liveEnabled;
  const explicitlyDisabledAuto = autoTradeRequested && hasConfigOverride(options, "WALLEX_ENABLE_AUTOTRADING") && !config.wallex.autoTradingEnabled;
  if (errors.length > 0 && !explicitlyDisabledLive && !explicitlyDisabledAuto && options.prompt !== false && process.stdin.isTTY && process.stdout.isTTY) {
    await configureEnvironment(mode, { requireAutoTrading: autoTradeRequested });
    errors = missingModeConfiguration(mode, autoTradeRequested);
  }
  if (errors.length > 0) {
    const setup = process.stdin.isTTY ? "Finish the prompts or run `trex configure --mode " + mode + "`." : "Run `trex configure --mode " + mode + "` in a terminal.";
    throw new Error(`${errors.join("\n")}\n${setup}`);
  }
  return loadEffectiveConfig();
}

let encryptionKeyState: ResolvedEncryptionKey | undefined;

function activeEncryptionKey(): ResolvedEncryptionKey {
  if (!encryptionKeyState) throw new Error("The encryption key has not been initialized for this command.");
  return encryptionKeyState;
}

program.hook("preAction", async (_thisCommand, actionCommand) => {
  const options = actionCommand.optsWithGlobals() as Record<string, unknown>;
  applyConfigOptions(options);
  // Printing a fresh key for an external secret manager must not create or read the managed key file.
  if (actionCommand.name() === "generate-key") return;
  // Operators may still supply ENCRYPTION_KEY; otherwise the key lives in a file beside the database and is created on first use.
  encryptionKeyState = ensureEncryptionKey(getDatabaseUrl());
  if (encryptionKeyState.created && encryptionKeyState.path) {
    console.error(`Created a new encryption key at ${encryptionKeyState.path}. Back up that file: without it, credentials stored in the database cannot be recovered.`);
  }
});

function parseList(value: string | undefined, label: string, fallback?: string): string[] {
  const source = value ?? fallback;
  if (!source) throw new Error(`Provide --${label} or --${label}s.`);
  const values = source.split(",").map((item) => item.trim()).filter(Boolean).map(normalizeMarketSymbol);
  if (values.length === 0 || new Set(values).size !== values.length) throw new Error(`--${label}s must contain a non-empty, comma-separated list without duplicates.`);
  return values;
}

function chooseStrategies(config: EngineConfig, one?: string, many?: string): StrategyProfile[] {
  if (one && many) throw new Error("Use either --strategy or --strategies, not both.");
  return parseList(many, "strategy", one ?? "agentic-balanced").map((id) => selectStrategy(config.strategies, id.toLowerCase()));
}

function enforceMarketAllowlist(config: EngineConfig, symbols: readonly string[]): void {
  const denied = symbols.map(normalizeMarketSymbol).filter((symbol) => !config.wallex.allowedMarkets.includes(symbol));
  if (denied.length > 0) throw new Error(`Markets must be explicitly listed in WALLEX_ALLOWED_MARKETS: ${denied.join(", ")}.`);
}

function reportsFromDetails(value: unknown): RunReport[] {
  const object = (item: unknown): Record<string, unknown> => item !== null && typeof item === "object" ? item as Record<string, unknown> : {};
  const candidate = object(value);
  if (Array.isArray(value)) return value.flatMap((item) => {
    const report = object(object(item).report);
    return typeof report.runId === "string" ? [report as unknown as RunReport] : [];
  });
  const report = object(object(candidate.run).report);
  return typeof report.runId === "string" ? [report as unknown as RunReport] : [];
}

function parseAuditLimit(value: string | undefined, fallback = 100): number {
  const limit = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) throw new Error("--audit-limit must be an integer from 1 to 1000.");
  return limit;
}

function auditForRunIds(repository: RunRepository, runIds: readonly string[], totalRuns = runIds.length): DashboardAuditData {
  const runs = runIds.map((id) => repository.getRunDetails(id)).filter((run): run is RunAuditDetails => run !== null);
  return { runs, totalRuns };
}

function auditForScope(repository: RunRepository, mode: "backtest" | "shadow" | "live", symbols: readonly string[], strategies: readonly StrategyProfile[], limit: number): DashboardAuditData {
  const selected = repository.getRecentRunIds(mode, symbols, strategies.map((strategy) => strategy.id), limit);
  return auditForRunIds(repository, selected.runIds, selected.total);
}

function shadowPerformanceForScope(repository: RunRepository, symbols: readonly string[], strategies: readonly StrategyProfile[]): RunReport[] {
  return symbols.flatMap((symbol) => strategies.flatMap((strategy) => {
    const aggregate = aggregateRunReports(repository.getRunReportsForPortfolioKey("shadow", symbol, strategy.id));
    return aggregate ? [aggregate] : [];
  }));
}

function createMarketAdapter(config: EngineConfig) {
  return new WallexMarketDataAdapter({
    baseUrl: config.wallex.baseUrl, wsUrl: config.wallex.wsUrl,
    ...(config.wallex.apiKey ? { apiKey: config.wallex.apiKey } : {}),
    ...(config.wallex.subAccountClientId ? { subAccountClientId: config.wallex.subAccountClientId } : {}),
    ...(config.wallex.packageId ? { packageId: config.wallex.packageId } : {}),
    allowedMarkets: config.wallex.allowedMarkets,
    quoteCurrency: config.wallex.quoteCurrency,
  });
}

const configureCommand = addConfigOptions(program.command("configure")
  .description("Interactively configure AI, Wallex, and virtual-portfolio settings; secrets are masked.")
  .addOption(new Option("--mode <mode>", "setup target: backtest, shadow, or live").choices(["backtest", "shadow", "live"]).default("shadow")));
configureCommand.action(async (options: { mode: string }) => {
  const mode = ModeSchema.parse(options.mode);
  await configureEnvironment(mode, { askAutoTrading: mode === "live" });
  console.log(JSON.stringify({ config: publicConfig(loadEffectiveConfig()) }, null, 2));
});

const profileCommand = program.command("profile").description("Manage encrypted local configuration profiles.");
profileCommand.command("list").description("List named profiles and their configured secret status.").action(() => {
  const context = createProfileContext();
  try { console.log(JSON.stringify({ activeProfileId: context.profiles.activeId(), profiles: context.profiles.list() }, null, 2)); }
  finally { context.repository.close(); }
});
profileCommand.command("create").description("Create a configuration profile.").argument("<name>").option("--copy <profile-id>", "copy settings and re-encrypt secrets from a profile")
  .action((name: string, options: { copy?: string }) => {
    const context = createProfileContext();
    try { console.log(JSON.stringify(context.profiles.create(name, options.copy), null, 2)); }
    finally { context.repository.close(); }
  });
profileCommand.command("use").description("Activate a configuration profile.").argument("<profile-id>").action((id: string) => {
  const context = createProfileContext();
  try { console.log(JSON.stringify(context.profiles.activate(id), null, 2)); }
  finally { context.repository.close(); }
});
profileCommand.command("delete").description("Delete an inactive configuration profile.").argument("<profile-id>").action((id: string) => {
  const context = createProfileContext();
  try { context.profiles.delete(id); console.log("Profile deleted."); }
  finally { context.repository.close(); }
});
profileCommand.command("import-dotenv").description("Import settings into an encrypted profile and scrub secret assignments after verification.")
  .argument("<path>", "local .env or .env.<name> path")
  .requiredOption("--name <name>", "name for the imported profile")
  .option("--profile-id <id>", "replace settings in an existing profile")
  .action(async (path: string, options: { name: string; profileId?: string }) => {
    const context = createProfileContext();
    try { console.log(JSON.stringify(await importDotenvFile({ path, name: options.name, ...(options.profileId ? { profileId: options.profileId } : {}) }, context.profiles, context.repository), null, 2)); }
    finally { context.repository.close(); }
  });

const secretsCommand = program.command("secrets").description("Manage the profile-encryption key. Trex keeps it in a key file beside the database unless ENCRYPTION_KEY is supplied.");
secretsCommand.command("status").description("Show where the active encryption key comes from.")
  .action(() => {
    const state = activeEncryptionKey();
    if (state.source === "file") console.log(`Encryption key: managed key file at ${state.path}\nBack up that file together with the database. The key itself is never printed.`);
    else if (state.source === "environment") console.log("Encryption key: supplied through the ENCRYPTION_KEY environment variable.");
    else console.log("Encryption key: temporary key for an in-memory database.");
  });
secretsCommand.command("generate-key").description("Print a random 32-byte key for operators who prefer to supply ENCRYPTION_KEY themselves.")
  .action(() => console.log(generateEncryptionKey()));
secretsCommand.command("rekey").description("Re-encrypt stored profile secrets with a new key. With the managed key file, a fresh key is generated and the file is replaced; with ENCRYPTION_KEY supplied, that value becomes the new key and the previous key is prompted.")
  .action(async () => {
    const state = activeEncryptionKey();
    const context = createProfileContext();
    try {
      const profileIds = context.profiles.list().map(({ id }) => ({ id }));
      if (state.source === "file" && state.path) {
        const replacement = generateEncryptionKey();
        const count = rotateProfileSecretEnvelopes(profileIds, context.repository, parseEncryptionKey(state.key), parseEncryptionKey(replacement));
        writeEncryptionKeyFile(state.path, replacement);
        process.env.ENCRYPTION_KEY = replacement;
        console.log(`Re-encrypted ${count} profile secret(s) and replaced the key file at ${state.path}. Refresh any backup copies of that file.`);
        return;
      }
      const newKey = parseEncryptionKey(state.key);
      const oldKey = parseEncryptionKey(await promptSecret("Enter previous ENCRYPTION_KEY (input hidden)"));
      const count = rotateProfileSecretEnvelopes(profileIds, context.repository, oldKey, newKey);
      console.log(`Re-encrypted ${count} profile secret(s).`);
    } finally { context.repository.close(); }
  });

function parsePort(value: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error("--port must be an integer from 0 to 65535.");
  return port;
}

program.command("ui").description("Start the local full-featured admin dashboard and API.")
  .option("--port <port>", "local loopback port", "4173")
  .option("--open", "open the dashboard in your default browser once it is running")
  .action(async (options: { port: string; open?: boolean }) => {
    const instance = await startAdminServer({ port: parsePort(options.port) });
    if (options.open) openInBrowser(instance.address);
  });

program.command("start").description("One-step launch: build the dashboard on first run, create the encryption key if needed, start the local service, and open it in your browser. If Trex is already running, only the browser is opened.")
  .option("--port <port>", "local loopback port", "4173")
  .option("--no-open", "do not open a browser window")
  .option("--rebuild", "rebuild the dashboard bundle before starting")
  .action(async (options: { port: string; open: boolean; rebuild?: boolean }) => {
    const port = parsePort(options.port);
    const address = `http://127.0.0.1:${port}`;
    const show = (url: string) => {
      if (options.open && openInBrowser(url)) console.log(`Opened ${url} in your browser.`);
      else console.log(`Open ${url} in your browser.`);
    };
    if (port !== 0) {
      const state = await probeDashboard(address);
      if (state === "running") { console.log(`Trex is already running at ${address}.`); show(address); return; }
      if (state === "occupied") throw new Error(`Port ${port} is used by another program. Start Trex on another port, for example \`trex start --port 4174\`.`);
    }
    if (options.rebuild || !dashboardIsBuilt()) await buildDashboard();
    const instance = await startAdminServer({ port });
    show(instance.address);
  });

const configCommand = program.command("config").description("Inspect or update local CLI configuration.");
configCommand.command("show")
  .description("Show effective settings with secrets redacted.")
  .action(() => console.log(JSON.stringify(publicConfig(loadEffectiveConfig()), null, 2)));
configCommand.command("set")
  .description("Set a supported setting in the active configuration profile; omit value to enter it interactively.")
  .argument("<key>", "configuration key, e.g. AI_API_KEY or WALLEX_ALLOWED_MARKETS")
  .argument("[value]", "new setting value; secret values are safer to enter at the prompt")
  .action(async (key: string, value?: string) => persistConfigValue(key, value));
configCommand.command("unset")
  .description("Remove one setting from the active configuration profile.")
  .argument("<key>", "configuration key")
  .action(async (key: string) => removeConfigValue(key));

const validateCommand = addConfigOptions(program.command("validate")
  .description("Validate active database settings and mode-specific safety requirements.")
  .addOption(new Option("--mode <mode>", "backtest, shadow, or live").choices(["backtest", "shadow", "live"]).default("shadow")));
validateCommand.action(async (options: { mode: string } & Record<string, unknown>) => {
  const mode = ModeSchema.parse(options.mode);
  const config = await resolveModeConfig(mode, options);
  ConfiguredJsonResearchProvider.parseMany(config.researchEndpoints);
  parseQuoteFallbacks(config.marketQuoteFallbacks);
  console.log(JSON.stringify({ valid: true, mode, config: publicConfig(config) }, null, 2));
});

const doctorCommand = addConfigOptions(program.command("doctor")
  .description("Check local configuration and persistence; optionally verify read-only Wallex market connectivity.")
  .addOption(new Option("--mode <mode>", "mode-specific safety configuration to inspect").choices(["backtest", "shadow", "live"]).default("shadow"))
  .option("--check-wallex", "read public Wallex market metadata and check the configured allowlist")
  .option("--json", "print machine-readable diagnostics"));
doctorCommand.action(async (options: { mode: string; checkWallex?: boolean; json?: boolean }) => {
  const checks: Array<{ name: string; status: "pass" | "fail" | "skip"; detail: string }> = [];
  let config: EngineConfig | undefined;
  try {
    config = loadEffectiveConfig();
    checks.push({ name: "configuration", status: "pass", detail: `settings parsed for ${options.mode} mode` });
  } catch (error) {
    checks.push({ name: "configuration", status: "fail", detail: error instanceof Error ? error.message : String(error) });
  }

  if (config) {
    const mode = ModeSchema.parse(options.mode);
    const modeErrors = validateModeConfig(config, mode);
    if (config.wallex.allowedMarkets.length === 0) modeErrors.push("WALLEX_ALLOWED_MARKETS must list approved symbols.");
    checks.push(modeErrors.length === 0
      ? { name: "mode safety", status: "pass", detail: `${mode} requirements and provider credentials are configured` }
      : { name: "mode safety", status: "fail", detail: modeErrors.join("; ") });

    try {
      const repository = new SqliteRunRepository(config.databaseUrl);
      try {
        repository.migrate();
        repository.getRecentRuns(1);
        checks.push({ name: "database", status: "pass", detail: `SQLite opened and migrations are current (${config.databaseUrl})` });
      } finally { repository.close(); }
    } catch (error) {
      checks.push({ name: "database", status: "fail", detail: error instanceof Error ? error.message : String(error) });
    }

    if (options.checkWallex) {
      const market = createMarketAdapter(config);
      try {
        const markets = await market.listSpotMarkets();
        const active = new Set(markets.map((item) => item.symbol));
        const unavailable = config.wallex.allowedMarkets.filter((symbol) => !active.has(symbol));
        checks.push(unavailable.length === 0
          ? { name: "Wallex public API", status: "pass", detail: `${markets.length} active spot markets received; all configured markets are active` }
          : { name: "Wallex public API", status: "fail", detail: `configured markets are not active: ${unavailable.join(", ")}` });
      } catch (error) {
        checks.push({ name: "Wallex public API", status: "fail", detail: error instanceof Error ? error.message : String(error) });
      } finally { await market.close?.(); }
    } else {
      checks.push({ name: "Wallex public API", status: "skip", detail: "not checked; pass --check-wallex to test public read access" });
    }
  }

  const failures = checks.filter((check) => check.status === "fail").length;
  if (options.json) {
    console.log(JSON.stringify({ healthy: failures === 0, mode: options.mode, checks,
      notes: ["No AI inference request or exchange write operation is performed by doctor."] }, null, 2));
  } else {
    console.log(`Trex diagnostics (${options.mode})`);
    for (const check of checks) {
      const marker = check.status === "pass" ? "PASS" : check.status === "fail" ? "FAIL" : "SKIP";
      console.log(`${marker.padEnd(4)} ${check.name}: ${check.detail}`);
    }
    console.log(failures === 0 ? "\nChecks completed. AI inference and exchange trading were not invoked." : `\n${failures} check(s) failed. Fix them and run doctor again.`);
  }
  if (failures > 0) process.exitCode = 1;
});

const marketsCommand = addConfigOptions(program.command("markets")
  .description("Inspect Wallex spot markets and configured challenge allowlist.")
  .option("--all", "show all active spot markets"));
marketsCommand.action(async (options: { all?: boolean }) => {
    const config = loadEffectiveConfig();
    const market = createMarketAdapter(config);
    try {
      const markets = await market.listSpotMarkets();
      const filtered = options.all ? markets : markets.filter((item) => config.wallex.allowedMarkets.includes(item.symbol));
      console.log(JSON.stringify({ markets: filtered, configuredAllowlist: config.wallex.allowedMarkets }, null, 2));
    } finally { await market.close?.(); }
  });

const backtestCommand = addConfigOptions(program.command("backtest")
  .description("Replay completed Wallex one-minute candles with next-bar-open fills.")
  .option("--symbol <symbol>", "one Wallex spot pair, e.g. BTCUSDT")
  .option("--symbols <symbols>", "comma-separated pair list for a comparison matrix")
  .option("--strategy <id>", "one configured strategy profile")
  .option("--strategies <ids>", "comma-separated configured strategies for a comparison matrix")
  .requiredOption("--from <time>", "start as Unix seconds or ISO timestamp")
  .requiredOption("--to <time>", "end as Unix seconds or ISO timestamp")
  .option("--resume <run-id>", "resume from a saved checkpoint")
  .option("--html <path>", "write a standalone visual benchmark report"));
backtestCommand.action(async (options: { symbol?: string; symbols?: string; strategy?: string; strategies?: string; from: string; to: string; resume?: string; html?: string } & Record<string, unknown>) => {
    const config = await resolveModeConfig("backtest", options);
    if (options.symbol && options.symbols) throw new Error("Use either --symbol or --symbols, not both.");
    const symbols = parseList(options.symbols, "symbol", options.symbol).map((symbol) => symbol.toUpperCase());
    const strategies = chooseStrategies(config, options.strategy, options.strategies);
    enforceMarketAllowlist(config, symbols);
    if (options.resume && (symbols.length !== 1 || strategies.length !== 1)) throw new Error("--resume applies to exactly one pair and one strategy.");
    if (symbols.length * strategies.length > 32) throw new Error("A comparison matrix is limited to 32 pair/strategy cases per command.");
    const fromSeconds = parseTime(options.from), toSeconds = parseTime(options.to);
    const runtime = createRuntime(config);
    try {
      const reports: RunReport[] = [];
      for (const symbol of symbols) {
        const dataset = options.resume ? undefined : await runtime.marketData.getCandles(symbol, fromSeconds, toSeconds, 1);
        for (const strategy of strategies) {
          reports.push(await runBacktest({ symbol, fromSeconds, toSeconds, strategy, ...(dataset ? { dataset } : {}),
            ...(options.resume ? { runId: options.resume, resume: true } : {}) }, config, runtime.marketData, runtime.workflow, runtime.repository));
        }
      }
      const htmlFile = options.html ? await writeBenchmarkHtml(options.html, reports, "Trex backtest comparison", undefined,
        auditForRunIds(runtime.repository, reports.map((report) => report.runId))) : undefined;
      console.log(JSON.stringify({ runs: reports, comparison: compareRuns(reports), ...(htmlFile ? { htmlFile } : {}) }, null, 2));
    } finally { runtime.repository.close(); await runtime.marketData.close?.(); }
  });

async function loopMode(mode: "shadow" | "live", config: EngineConfig, symbols: string[], strategies: StrategyProfile[], continuous: boolean, intervalSeconds: number, htmlPath?: string, auditLimit = 100, dashboardPort = 4_173) {
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 1 || intervalSeconds > 86_400) throw new Error("--interval-seconds must be an integer from 1 to 86400.");
  enforceMarketAllowlist(config, symbols);
  if (mode === "live") {
    const autoTradeErrors = validateAutoTradeRequest(config, continuous);
    if (autoTradeErrors.length > 0) throw new Error(autoTradeErrors.join("\n"));
  }
  if (symbols.length * strategies.length > 32) throw new Error("A comparison matrix is limited to 32 pair/strategy cases per command.");
  if (mode === "live" && continuous && (symbols.length !== 1 || strategies.length !== 1)) throw new Error("Autonomous live trading accepts exactly one pair and one strategy per process.");
  const runtime = createRuntime(config);
  let stream: WallexMarketStream | undefined;
  let dashboard: LocalDashboardServer | undefined;
  let stopping = false;
  const requestStop = () => { stopping = true; };
  process.on("SIGINT", requestStop);
  process.on("SIGTERM", requestStop);
  try {
    if (mode === "shadow" && continuous && htmlPath) {
      const existingPerformance = shadowPerformanceForScope(runtime.repository, symbols, strategies);
      const initialAudit = auditForScope(runtime.repository, "shadow", symbols, strategies, auditLimit);
      dashboard = new LocalDashboardServer(dashboardPort,
        renderBenchmarkHtml(existingPerformance, "Cumulative shadow portfolio performance", undefined, initialAudit, true));
      console.log(`Live shadow dashboard: ${dashboard.start()}`);
      await writeBenchmarkHtml(htmlPath, existingPerformance, "Cumulative shadow portfolio performance", intervalSeconds, initialAudit);
      console.log(`Standalone report snapshot: ${htmlPath}`);
    }
    if (continuous) {
      dashboard?.publishStatus("connecting", "Connecting to Wallex public market data.");
      stream = new WallexMarketStream(config.wallex.wsUrl, runtime.marketAdapter, {
        onPrice: (quote) => runtime.marketAdapter.ingestStreamQuote(quote),
        onDepthSnapshot: (depthSymbol, depth) => runtime.marketAdapter.ingestDepthSnapshot(depthSymbol, depth),
        onReconnect: (at) => console.warn(`Wallex stream reconnected at ${new Date(at).toISOString()}; REST market state was resynchronized.`),
      });
      stream.start(symbols);
    }
    do {
      if (stopping) break;
      const results: Array<{ report: RunReport; decision: unknown }> = [];
      for (const symbol of symbols) for (const strategy of strategies) {
        if (stopping) break;
        dashboard?.publishStatus("evaluating", `Running the ${strategy.id} shadow cycle for ${symbol}.`);
        const result = mode === "shadow"
          ? await runShadowCycle(symbol, config, runtime.marketData, runtime.workflow, runtime.repository, Date.now, strategy)
          : await runLiveCycle(symbol, config, runtime.marketData, createLiveExecution(config), runtime.workflow, runtime.repository, Date.now, () => stopping, strategy);
        results.push({ report: result.report, decision: result.decision });
      }
      const performance = mode === "shadow"
        ? shadowPerformanceForScope(runtime.repository, symbols, strategies)
        : results.map(({ report }) => report);
      const htmlFile = htmlPath ? await writeBenchmarkHtml(htmlPath, performance,
        mode === "shadow" ? "Cumulative shadow portfolio performance" : "Live performance comparison",
        continuous && mode === "shadow" ? intervalSeconds : undefined,
        auditForScope(runtime.repository, mode, symbols, strategies, auditLimit)) : undefined;
      if (dashboard && mode === "shadow") {
        const audit = auditForScope(runtime.repository, "shadow", symbols, strategies, auditLimit);
        dashboard.publishHtml(renderBenchmarkHtml(performance, "Cumulative shadow portfolio performance", undefined, audit, true));
        dashboard.publishStatus("waiting", stopping ? "The watcher is stopping after this cycle." : `Cycle complete. Next cycle starts in about ${intervalSeconds} seconds.`);
      }
      console.log(JSON.stringify({ runs: results, performance, comparison: compareRuns(performance), ...(htmlFile ? { htmlFile } : {}) }, null, 2));
      if (!continuous || stopping) break;
      await new Promise<void>((resolve) => {
        const onStop = () => {
          clearTimeout(timer);
          process.off("SIGINT", onStop);
          process.off("SIGTERM", onStop);
          resolve();
        };
        const timer = setTimeout(onStop, intervalSeconds * 1000);
        process.once("SIGINT", onStop);
        process.once("SIGTERM", onStop);
      });
    } while (!stopping);
  } catch (error) {
    const failure = auditFailure(error);
    if (mode === "shadow") {
      const performance = shadowPerformanceForScope(runtime.repository, symbols, strategies);
      const audit = auditForScope(runtime.repository, "shadow", symbols, strategies, auditLimit);
      dashboard?.publishHtml(renderBenchmarkHtml(performance, "Cumulative shadow portfolio performance", undefined, audit, true));
      if (htmlPath) {
        try { await writeBenchmarkHtml(htmlPath, performance, "Cumulative shadow portfolio performance", continuous ? intervalSeconds : undefined, audit); }
        catch { /* Preserve the original cycle failure; the in-memory dashboard still receives the saved audit. */ }
      }
    }
    dashboard?.publishStatus("failed", `${failure.name}: ${failure.message}`);
    throw error;
  } finally {
    process.off("SIGINT", requestStop);
    process.off("SIGTERM", requestStop);
    stream?.close();
    await dashboard?.stop();
    runtime.repository.close(); await runtime.marketData.close?.();
  }
}

const shadowCommand = addConfigOptions(program.command("shadow")
  .description("Use live Wallex prices and a separate virtual portfolio; never submits exchange orders.")
  .option("--symbol <symbol>", "one allowlisted Wallex spot market")
  .option("--symbols <symbols>", "comma-separated allowlisted pairs to compare")
  .option("--strategy <id>", "one configured strategy profile")
  .option("--strategies <ids>", "comma-separated configured strategies to compare")
  .option("--watch", "repeat at the configured interval and subscribe to Wallex v2 market updates")
  .option("--interval-seconds <seconds>", "decision interval while watching", "60")
  .option("--audit-limit <runs>", "number of recent run audits to include in the HTML dashboard (1-1000)", "100")
  .option("--html <path>", "write a standalone report; with --watch, also serve a live local dashboard")
  .option("--dashboard-port <port>", "local dashboard port; use 0 to choose an available port", "4173"));
shadowCommand.action(async (options: { symbol?: string; symbols?: string; strategy?: string; strategies?: string; watch?: boolean; intervalSeconds: string; auditLimit: string; html?: string; dashboardPort: string } & Record<string, unknown>) => {
    if (options.symbol && options.symbols) throw new Error("Use either --symbol or --symbols, not both.");
    const config = await resolveModeConfig("shadow", options);
    const symbols = parseList(options.symbols, "symbol", options.symbol).map((symbol) => symbol.toUpperCase());
    const auditLimit = parseAuditLimit(options.auditLimit);
    const dashboardPort = Number(options.dashboardPort);
    if (!Number.isInteger(dashboardPort) || dashboardPort < 0 || dashboardPort > 65_535) throw new Error("--dashboard-port must be an integer from 0 to 65535.");
    return loopMode("shadow", config, symbols, chooseStrategies(config, options.strategy, options.strategies), Boolean(options.watch), Number(options.intervalSeconds), options.html, auditLimit, dashboardPort);
  });

const liveCommand = addConfigOptions(program.command("live")
  .description("Explicitly enabled live execution on the configured Wallex credit sub-account.")
  .requiredOption("--symbol <symbol>", "allowlisted Wallex spot market, e.g. BTCTMN or BTC/TMN")
  .option("--strategy <id>", "configured strategy profile", "agentic-balanced")
  .option("--auto-trade", "autonomously repeat live decisions and execution; requires WALLEX_ENABLE_AUTOTRADING=true")
  .option("--interval-seconds <seconds>", "interval between autonomous cycles", "60"));
liveCommand.action(async (options: { symbol: string; strategy: string; autoTrade?: boolean; intervalSeconds: string } & Record<string, unknown>) => {
    const config = await resolveModeConfig("live", options, Boolean(options.autoTrade));
    const symbols = [normalizeMarketSymbol(options.symbol)];
    return loopMode("live", config, symbols, [selectStrategy(config.strategies, options.strategy)], Boolean(options.autoTrade), Number(options.intervalSeconds));
  });

addConfigOptions(program.command("status")
  .description("List recent engine runs.")
  .option("--limit <n>", "number of runs", "20"))
  .action((options: { limit: string }) => {
    const limit = Number(options.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("--limit must be an integer from 1 to 1000.");
    const repository = new SqliteRunRepository(loadEffectiveConfig().databaseUrl);
    try { repository.migrate(); console.log(JSON.stringify(repository.getRecentRuns(limit), null, 2)); }
    finally { repository.close(); }
  });

addConfigOptions(program.command("report")
  .description("Show the stored report for a run, or recent runs when no id is supplied.")
  .argument("[run-id]", "run identifier")
  .option("--html <path>", "write a standalone performance visualization")
  .option("--audit-limit <runs>", "number of recent run audits to include when reporting multiple runs (1-1000)", "50")
  .option("--include-backtest-data", "include the complete stored OHLCV dataset in JSON output"))
  .action(async (runId?: string, options?: { html?: string; auditLimit?: string; includeBacktestData?: boolean }) => {
    if (options?.includeBacktestData && !runId) throw new Error("--include-backtest-data requires a specific run-id.");
    const auditLimit = parseAuditLimit(options?.auditLimit, 50);
    const repository = new SqliteRunRepository(loadEffectiveConfig().databaseUrl);
    try {
      repository.migrate();
      const output = runId ? repository.getRunDetails(runId, Boolean(options?.includeBacktestData)) : repository.getRecentRuns(auditLimit);
      if (!output) throw new Error(`Run ${runId} was not found.`);
      const reports = reportsFromDetails(output);
      const audit = runId
        ? { runs: [output as RunAuditDetails], totalRuns: 1 }
        : auditForRunIds(repository, (output as Array<{ id: string }>).map((run) => run.id), (output as Array<{ id: string }>).length);
      const htmlFile = options?.html ? await writeBenchmarkHtml(options.html, reports, runId ? `Run ${runId} performance` : "Recent run comparison", undefined, audit) : undefined;
      console.log(JSON.stringify({ report: output, comparison: compareRuns(reports), ...(htmlFile ? { htmlFile } : {}) }, null, 2));
    } finally { repository.close(); }
  });

addConfigOptions(program.command("cancel-order")
  .description("Cancel and reconcile an open live order created by this engine.")
  .argument("<client-order-id>", "Wallex clientOrderId from a persisted engine order intent"))
  .action(async (clientOrderId: string) => {
    const config = loadEffectiveConfig();
    if (!config.wallex.apiKey || !config.wallex.subAccountClientId) {
      throw new Error("WALLEX_API_KEY and WALLEX_SUB_ACCOUNT_CLIENT_ID are required to manage credit-account orders.");
    }
    const repository = new SqliteRunRepository(config.databaseUrl);
    const owner = randomUUID();
    try {
      repository.migrate();
      const intent = repository.getOrderIntent(clientOrderId);
      if (!intent) throw new Error(`Order intent ${clientOrderId} is not recorded by this engine.`);
      const run = repository.getRun(intent.runId);
      if (run?.mode !== "live") throw new Error("Only an engine live-mode order intent can be canceled with this command.");
      if (!(["pending", "submitted", "reconciling"] as const).includes(intent.state as "pending" | "submitted" | "reconciling")) {
        throw new Error(`Order intent ${clientOrderId} is already ${intent.state}; it is not eligible for cancellation.`);
      }
      const leaseMs = 5 * 60_000;
      const leaseStartedAt = Date.now();
      if (!repository.acquireExecutionLease("wallex-live", owner, leaseStartedAt, leaseMs)) {
        throw new Error("Another process currently holds the Wallex live-execution lease.");
      }
      const leaseGuard = new ExecutionLeaseGuard(repository, "wallex-live", owner, Date.now, leaseMs);
      try {
        leaseGuard.assertHeld();
        const exchange = new WallexOrderExecutionAdapter({
          baseUrl: config.wallex.baseUrl, wsUrl: config.wallex.wsUrl,
          apiKey: config.wallex.apiKey, subAccountClientId: config.wallex.subAccountClientId,
          allowedMarkets: config.wallex.allowedMarkets,
        });
        let order = await exchange.getOrder(clientOrderId);
        if (!order || order.status === "UNKNOWN") {
          const listedOrder = (await exchange.listOpenOrders(intent.order.symbol)).find((candidate) => candidate.clientOrderId === clientOrderId) ?? null;
          if (listedOrder) order = listedOrder;
        }
        if (!order) throw new Error(`Wallex did not return order ${clientOrderId}; intent remains unresolved and no second order was submitted.`);
        if (order.status === "NEW" || order.status === "PARTIALLY_FILLED") {
          leaseGuard.assertHeld();
          order = await exchange.cancelOrder(clientOrderId);
          if (!order) throw new Error(`Wallex did not confirm cancellation for ${clientOrderId}; intent remains unresolved.`);
        }
        leaseGuard.assertHeld();
        const state = orderIntentState(order);
        repository.updateOrderIntent(clientOrderId, state, order);
        repository.saveFills(order);
        console.log(JSON.stringify({ clientOrderId, state, order }, null, 2));
      } finally { leaseGuard.close(); repository.releaseExecutionLease("wallex-live", owner); }
    } finally { repository.close(); }
  });

const migrateCommand = addConfigOptions(program.command("db:migrate")
  .description("Apply Drizzle SQLite migrations."));
migrateCommand.action(() => {
    const repository = new SqliteRunRepository(loadEffectiveConfig().databaseUrl);
    try { repository.migrate(); console.log("Database migrations applied."); }
    finally { repository.close(); }
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
