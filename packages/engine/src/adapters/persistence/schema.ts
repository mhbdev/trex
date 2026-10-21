import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  mode: text("mode", { enum: ["backtest", "shadow", "live"] }).notNull(),
  status: text("status").notNull(),
  configJson: text("config_json").notNull(),
  gitRevision: text("git_revision"),
  startedAt: integer("started_at").notNull(),
  endedAt: integer("ended_at"),
  reportJson: text("report_json"),
  failureName: text("failure_name"),
  failureMessage: text("failure_message"),
});

export const sourceSnapshots = sqliteTable("source_snapshots", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => runs.id),
  category: text("category").notNull(),
  source: text("source").notNull(),
  symbol: text("symbol").notNull(),
  observedAt: integer("observed_at").notNull(),
  payloadJson: text("payload_json").notNull(),
}, (table) => [index("source_snapshots_run_category_time_idx").on(table.runId, table.category, table.observedAt)]);

export const decisions = sqliteTable("decisions", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => runs.id),
  symbol: text("symbol").notNull(),
  decidedAt: integer("decided_at").notNull(),
  quoteJson: text("quote_json").notNull(),
  evidenceJson: text("evidence_json").notNull(),
  findingsJson: text("findings_json").notNull(),
  proposalJson: text("proposal_json").notNull(),
  riskJson: text("risk_json").notNull(),
  orderClientId: text("order_client_id"),
}, (table) => [index("decisions_run_symbol_time_idx").on(table.runId, table.symbol, table.decidedAt)]);

export const riskOutcomes = sqliteTable("risk_outcomes", {
  id: text("id").primaryKey(),
  decisionId: text("decision_id").notNull().references(() => decisions.id),
  approved: integer("approved", { mode: "boolean" }).notNull(),
  reasonsJson: text("reasons_json").notNull(),
  resultJson: text("result_json").notNull(),
  checkedAt: integer("checked_at").notNull(),
}, (table) => [index("risk_outcomes_decision_time_idx").on(table.decisionId, table.checkedAt)]);

export const orderIntents = sqliteTable("order_intents", {
  clientOrderId: text("client_order_id").primaryKey(),
  runId: text("run_id").notNull().references(() => runs.id),
  decisionId: text("decision_id").notNull().references(() => decisions.id),
  orderJson: text("order_json").notNull(),
  portfolioKey: text("portfolio_key").notNull().default("default"),
  state: text("state").notNull(),
  exchangeOrderJson: text("exchange_order_json"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [index("order_intents_run_state_time_idx").on(table.runId, table.state, table.createdAt)]);

export const fills = sqliteTable("fills", {
  id: text("id").primaryKey(),
  orderClientId: text("order_client_id").notNull().references(() => orderIntents.clientOrderId),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  quantity: text("quantity").notNull(),
  price: text("price").notNull(),
  fee: text("fee").notNull(),
  feeAsset: text("fee_asset").notNull(),
  timestamp: integer("timestamp").notNull(),
}, (table) => [index("fills_order_time_idx").on(table.orderClientId, table.timestamp)]);

export const portfolioSnapshots = sqliteTable("portfolio_snapshots", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => runs.id),
  portfolioKey: text("portfolio_key").notNull().default("default"),
  observedAt: integer("observed_at").notNull(),
  cash: text("cash").notNull(),
  equity: text("equity").notNull(),
  positionsJson: text("positions_json").notNull(),
  quoteCurrency: text("quote_currency").notNull(),
  highWatermark: text("high_watermark").notNull(),
  realizedPnlToday: text("realized_pnl_today").notNull(),
  dayStartEquity: text("day_start_equity").notNull(),
}, (table) => [index("portfolio_snapshots_run_time_idx").on(table.runId, table.observedAt), index("portfolio_snapshots_key_time_idx").on(table.portfolioKey, table.observedAt)]);

export const checkpoints = sqliteTable("checkpoints", {
  runId: text("run_id").notNull().references(() => runs.id),
  key: text("key").notNull(),
  payloadJson: text("payload_json").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.runId, table.key] }),
]);

export const reflections = sqliteTable("reflections", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => runs.id),
  symbol: text("symbol").notNull(),
  contextKey: text("context_key").notNull().default("legacy"),
  content: text("content").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [index("reflections_scope_time_idx").on(table.contextKey, table.symbol, table.createdAt)]);

export const decisionMemories = sqliteTable("decision_memories", {
  decisionId: text("decision_id").primaryKey().references(() => decisions.id),
  runId: text("run_id").notNull().references(() => runs.id),
  symbol: text("symbol").notNull(),
  contextKey: text("context_key").notNull(),
  action: text("action", { enum: ["BUY", "SELL", "HOLD"] }).notNull(),
  decisionText: text("decision_text").notNull(),
  entryReferencePrice: text("entry_reference_price").notNull(),
  benchmarkSymbol: text("benchmark_symbol").notNull(),
  decidedAt: integer("decided_at").notNull(),
  holdingPeriodBars: integer("holding_period_bars").notNull(),
  dueAt: integer("due_at").notNull(),
  status: text("status", { enum: ["pending", "settled"] }).notNull().default("pending"),
  entryPrice: text("entry_price"),
  exitPrice: text("exit_price"),
  benchmarkEntryPrice: text("benchmark_entry_price"),
  benchmarkExitPrice: text("benchmark_exit_price"),
  rawReturn: text("raw_return"),
  benchmarkReturn: text("benchmark_return"),
  alphaReturn: text("alpha_return"),
  resolvedAt: integer("resolved_at"),
  reflection: text("reflection"),
}, (table) => [
  index("decision_memories_pending_due_idx").on(table.contextKey, table.status, table.dueAt),
  index("decision_memories_lessons_idx").on(table.contextKey, table.status, table.resolvedAt, table.symbol),
]);

export const aiModelCalls = sqliteTable("ai_model_calls", {
  id: text("id").primaryKey(),
  operationId: text("operation_id").notNull(),
  runId: text("run_id").notNull().references(() => runs.id),
  decisionId: text("decision_id").references(() => decisions.id),
  symbol: text("symbol").notNull(),
  role: text("role").notNull(),
  operation: text("operation").notNull(),
  provider: text("provider").notNull(),
  modelId: text("model_id").notNull(),
  stepNumber: integer("step_number").notNull(),
  status: text("status").notNull(),
  startedAt: integer("started_at").notNull(),
  endedAt: integer("ended_at").notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  reasoningTokens: integer("reasoning_tokens"),
  totalTokens: integer("total_tokens"),
  finishReason: text("finish_reason"),
  responseId: text("response_id"),
  toolNamesJson: text("tool_names_json").notNull(),
  warningsJson: text("warnings_json").notNull(),
  errorName: text("error_name"),
  errorMessage: text("error_message"),
}, (table) => [
  uniqueIndex("ai_model_calls_operation_step_idx").on(table.operationId, table.stepNumber),
  index("ai_model_calls_run_time_idx").on(table.runId, table.startedAt),
  index("ai_model_calls_run_role_idx").on(table.runId, table.role, table.startedAt),
]);

export const executionLeases = sqliteTable("execution_leases", {
  name: text("name").primaryKey(),
  owner: text("owner").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const configProfiles = sqliteTable("config_profiles", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  settingsJson: text("settings_json").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const configProfileSecrets = sqliteTable("config_profile_secrets", {
  profileId: text("profile_id").notNull().references(() => configProfiles.id, { onDelete: "cascade" }),
  secretKey: text("secret_key").notNull(),
  algorithm: text("algorithm", { enum: ["aes-256-gcm"] }).notNull(),
  keyVersion: integer("key_version").notNull().default(1),
  nonce: text("nonce").notNull(),
  ciphertext: text("ciphertext").notNull(),
  authTag: text("auth_tag").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [primaryKey({ columns: [table.profileId, table.secretKey] })]);

export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
