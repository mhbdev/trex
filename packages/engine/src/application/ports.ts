import type {
  AgentFinding, AgentRole, Candle, DecisionProposal, EngineMode, ExchangeOrder, Fill,
  MarketQuote, MarketSpec, OrderIntent, OrderProposal, PortfolioState, ResearchCategory,
  ResearchItem, RiskResult, TradeDecision, PendingDecisionMemory, SettledDecisionMemory,
} from "../domain/types.ts";
import type { StrategyProfile } from "../domain/strategies.ts";

export interface MarketDataPort {
  listSpotMarkets(): Promise<MarketSpec[]>;
  getQuote(symbol: string): Promise<MarketQuote>;
  getDepth(symbol: string): Promise<{ bids: [string, string][]; asks: [string, string][]; observedAt: number }>;
  getCandles(symbol: string, fromSeconds: number, toSeconds: number, resolutionMinutes?: 1): Promise<Candle[]>;
  getAccountPortfolio?(): Promise<PortfolioState>;
  getPackageUnavailableMarkets?(packageId: string): Promise<string[]>;
  close?(): Promise<void>;
}

export interface OrderExecutionPort {
  submitOrder(order: OrderProposal, clientOrderId: string): Promise<ExchangeOrder>;
  getOrder(clientOrderId: string): Promise<ExchangeOrder | null>;
  cancelOrder(clientOrderId: string): Promise<ExchangeOrder | null>;
  listOpenOrders(symbol?: string): Promise<ExchangeOrder[]>;
}

export interface ResearchProvider {
  readonly id: string;
  readonly categories: readonly ResearchCategory[];
  readonly maxAgeSeconds?: number;
  fetch(symbol: string, categories: readonly ResearchCategory[], now: number): Promise<ResearchItem[]>;
}

export interface ResearchBundle {
  items: ResearchItem[];
  warnings: { provider: string; message: string }[];
}

export interface ResearchAggregatorPort {
  collect(symbol: string, now: number): Promise<ResearchBundle>;
}

export interface AgentContext {
  /** The owning engine run, used to attach model-call audit records. */
  runId?: string;
  symbol: string;
  quote: MarketQuote;
  candles: Candle[];
  research: ResearchItem[];
  priorFindings: AgentFinding[];
  recentReflections: string[];
  portfolio: PortfolioState;
  strategy?: StrategyProfile;
  discussionTurn?: { kind: "investment" | "risk"; round: number; totalRounds: number };
}

export interface AiModelCallRecord {
  id: string;
  operationId: string;
  runId: string;
  decisionId?: string;
  symbol: string;
  role: AgentRole;
  operation: "analyze" | "propose" | "reflect";
  provider: string;
  modelId: string;
  stepNumber: number;
  status: "completed" | "failed";
  startedAt: number;
  endedAt: number;
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
  finishReason?: string;
  responseId?: string;
  toolNames: string[];
  warnings: string[];
  errorName?: string;
  errorMessage?: string;
}

export interface RunAuditDetails {
  run: Record<string, unknown>;
  decisions: TradeDecision[];
  riskOutcomes: Array<{ id: string; decisionId: string; approved: boolean; reasons: string[]; result: RiskResult; checkedAt: number }>;
  orders: Array<{
    clientOrderId: string; decisionId: string; state: string; order: OrderProposal;
    exchangeOrder: ExchangeOrder | null; createdAt: number; updatedAt: number; fills: Fill[];
  }>;
  decisionMemories: Array<{
    decisionId: string; runId: string; symbol: string; contextKey: string; action: string; decisionText: string;
    entryReferencePrice: string; benchmarkSymbol: string; decidedAt: number; holdingPeriodBars: number; dueAt: number;
    status: string; entryPrice: string | null; exitPrice: string | null; benchmarkEntryPrice: string | null;
    benchmarkExitPrice: string | null; rawReturn: string | null; benchmarkReturn: string | null; alphaReturn: string | null;
    resolvedAt: number | null; reflection: string | null;
  }>;
  portfolioHistory: Array<{
    timestamp: number; portfolioKey: string; cash: string; equity: string; positions: PortfolioState["positions"];
    quoteCurrency: string; highWatermark: string; realizedPnlToday: string; dayStartEquity: string;
  }>;
  sourceSnapshots: Array<{ id: string; category: string; source: string; symbol: string; observedAt: number; payload: unknown }>;
  aiModelCalls: AiModelCallRecord[];
  backtestDataset?: unknown;
  memoryBenchmarkDataset?: unknown;
}

export interface StoredConfigProfile {
  id: string;
  name: string;
  settings: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

export interface StoredSecretEnvelope {
  key: string;
  algorithm: "aes-256-gcm";
  keyVersion: number;
  nonce: string;
  ciphertext: string;
  authTag: string;
  updatedAt: number;
}

export interface ModelPort {
  analyze(role: AgentRole, context: AgentContext): Promise<AgentFinding>;
  propose(role: AgentRole, instruction: string, context: AgentContext): Promise<DecisionProposal>;
  reflect(input: Pick<SettledDecisionMemory, "action" | "decisionText" | "rawReturn" | "benchmarkReturn" | "alphaReturn" | "benchmarkSymbol" | "holdingPeriodBars"> & {
    auditRunId?: string; auditDecisionId?: string; auditSymbol?: string;
  }): Promise<string>;
}

export interface RunRepository {
  createRun(input: { id: string; mode: EngineMode; config: Record<string, unknown>; startedAt: number; gitRevision?: string }): void;
  failInterruptedRuns(mode: EngineMode, endedAt: number): void;
  finishRun(id: string, endedAt: number, status: "completed" | "failed", report?: Record<string, unknown>, failure?: { name: string; message: string }): void;
  saveSnapshot(input: { runId: string; category: string; source: string; symbol: string; observedAt: number; payload: unknown }): string;
  loadSnapshot(runId: string, category: string): unknown | null;
  saveDecision(decision: TradeDecision): void;
  saveDecisionAndMemory(decision: TradeDecision, memory: PendingDecisionMemory): void;
  getDecisionAt(runId: string, symbol: string, decidedAt: number): TradeDecision | null;
  saveRiskOutcome(decisionId: string, result: RiskResult): void;
  createOrderIntent(intent: OrderIntent): boolean;
  saveOrderIntent(intent: OrderIntent): void;
  getOrderIntent(clientOrderId: string): OrderIntent | null;
  getPendingOrderIntents(mode: EngineMode, portfolioKey?: string): OrderIntent[];
  getLatestPortfolio(mode: EngineMode, portfolioKey?: string): PortfolioState | null;
  getPortfolioHistory(runId: string, throughTimestamp?: number): { timestamp: number; equity: string }[];
  getOrderHistory(runId: string): ExchangeOrder[];
  getRunReportsForPortfolioKey(mode: EngineMode, symbol: string, strategyId: string): import("../domain/types.ts").RunReport[];
  updateOrderIntent(clientOrderId: string, state: OrderIntent["state"], order?: ExchangeOrder): void;
  saveFills(order: ExchangeOrder): void;
  saveShadowExecution(clientOrderId: string, portfolioRunId: string, order: ExchangeOrder, portfolio: PortfolioState, portfolioKey?: string): void;
  savePortfolio(runId: string, portfolio: PortfolioState, portfolioKey?: string): void;
  saveCheckpoint(runId: string, key: string, payload: unknown, updatedAt: number): void;
  loadCheckpoint(runId: string, key: string): unknown | null;
  saveReflection(runId: string, symbol: string, content: string, createdAt: number, contextKey?: string): void;
  getReflections(symbol: string, limit: number, contextKey?: string): string[];
  savePendingDecisionMemory(memory: PendingDecisionMemory): void;
  getMaturedDecisionMemories(contextKey: string, asOf: number): PendingDecisionMemory[];
  settleDecisionMemory(decisionId: string, outcome: Omit<SettledDecisionMemory, keyof PendingDecisionMemory | "status"> & { resolvedAt: number; reflection: string }): boolean;
  getDecisionMemoryLessons(symbol: string, contextKey: string, asOf: number, sameSymbolLimit: number, crossSymbolLimit: number): string[];
  getRun(id: string): Record<string, unknown> | null;
  getRunDetails(id: string, includeBacktestData?: boolean): RunAuditDetails | null;
  getRecentRuns(limit: number): Record<string, unknown>[];
  getRecentRunIds(mode: EngineMode, symbols: readonly string[], strategyIds: readonly string[], limit: number): { runIds: string[]; total: number };
  recordAiModelCall(call: AiModelCallRecord): void;
  acquireExecutionLease(name: string, owner: string, now: number, leaseMs: number): boolean;
  releaseExecutionLease(name: string, owner: string): void;
  listConfigProfiles(): StoredConfigProfile[];
  getConfigProfile(id: string): StoredConfigProfile | null;
  getActiveConfigProfileId(): string | null;
  createConfigProfile(profile: StoredConfigProfile): void;
  createConfigProfileWithSecrets(profile: StoredConfigProfile, secrets: StoredSecretEnvelope[]): void;
  updateConfigProfile(profile: StoredConfigProfile): void;
  saveConfigProfile(profile: StoredConfigProfile, secrets?: StoredSecretEnvelope[]): void;
  deleteConfigProfile(id: string): void;
  setActiveConfigProfileId(id: string): void;
  getConfigProfileSecrets(profileId: string): StoredSecretEnvelope[];
  replaceConfigProfileSecrets(profileId: string, secrets: StoredSecretEnvelope[]): void;
  replaceConfigProfileSecretsBatch(profiles: Array<{ profileId: string; secrets: StoredSecretEnvelope[] }>): void;
  close(): void;
}

export interface PortfolioServicePort {
  current(): PortfolioState;
  applyFill(fill: Fill, markPrice: string): PortfolioState;
}

export interface LoggerPort {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}
