import { z } from "zod";

export const ModeSchema = z.enum(["backtest", "shadow", "live"]);
export type EngineMode = z.infer<typeof ModeSchema>;
export const SideSchema = z.enum(["BUY", "SELL"]);
export type Side = z.infer<typeof SideSchema>;

export const RoleSchema = z.enum([
  "market_technical_analyst",
  "news_analyst",
  "sentiment_analyst",
  "tokenomics_analyst",
  "bull_researcher",
  "bear_researcher",
  "research_manager",
  "trader",
  "aggressive_risk_analyst",
  "conservative_risk_analyst",
  "neutral_risk_analyst",
  "portfolio_manager",
  "reflector",
]);
export type AgentRole = z.infer<typeof RoleSchema>;

export const MarketSpecSchema = z.object({
  symbol: z.string().regex(/^[A-Z0-9_-]+$/),
  baseAsset: z.string(),
  quoteAsset: z.string(),
  baseAssetIconUrl: z.string().url().optional(),
  quoteAssetIconUrl: z.string().url().optional(),
  pricePrecision: z.number().int().nonnegative(),
  quantityPrecision: z.number().int().nonnegative(),
  minQuantity: z.string().default("0"),
  minNotional: z.string().default("0"),
  spotEnabled: z.boolean().default(true),
});
export type MarketSpec = z.infer<typeof MarketSpecSchema>;

export const CandleSchema = z.object({
  symbol: z.string(),
  timestamp: z.number().int(),
  open: z.string(),
  high: z.string(),
  low: z.string(),
  close: z.string(),
  volume: z.string(),
  complete: z.boolean(),
});
export type Candle = z.infer<typeof CandleSchema>;

export const QuoteSchema = z.object({
  symbol: z.string(),
  price: z.string(),
  bid: z.string().optional(),
  ask: z.string().optional(),
  observedAt: z.number().int(),
  source: z.string(),
});
export type MarketQuote = z.infer<typeof QuoteSchema>;

export const ResearchCategorySchema = z.enum([
  "market",
  "technical",
  "news",
  "sentiment",
  "tokenomics",
  "on_chain",
  "macro",
  "prediction_market",
]);
export type ResearchCategory = z.infer<typeof ResearchCategorySchema>;

export const ResearchItemSchema = z.object({
  id: z.string().min(1).max(500),
  category: ResearchCategorySchema,
  title: z.string().min(1).max(500),
  content: z.string().max(2_000),
  source: z.string().min(1).max(500),
  sourceUrl: z.url().optional(),
  observedAt: z.number().int(),
  confidence: z.number().min(0).max(1),
  dedupKey: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type ResearchItem = z.infer<typeof ResearchItemSchema>;

export const EvidenceSchema = z.object({
  id: z.string(),
  summary: z.string(),
  source: z.string(),
  observedAt: z.number().int(),
  confidence: z.number().min(0).max(1),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const OrderProposalSchema = z.object({
  symbol: z.string(),
  side: SideSchema,
  type: z.enum(["LIMIT", "MARKET"]),
  quantity: z.string().regex(/^\d+(\.\d+)?$/),
  price: z.string().regex(/^\d+(\.\d+)?$/).optional(),
}).superRefine((order, context) => {
  if (order.type === "LIMIT" && order.price === undefined) context.addIssue({ code: "custom", message: "LIMIT orders require a price." });
});
export type OrderProposal = z.infer<typeof OrderProposalSchema>;

export const DecisionProposalSchema = z.object({
  action: z.enum(["BUY", "SELL", "HOLD"]),
  symbol: z.string(),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1),
  evidenceIds: z.array(z.string()).default([]),
  /** Evidence fetched on demand by read-only tools during proposal generation. */
  additionalEvidence: z.array(ResearchItemSchema).optional(),
  order: OrderProposalSchema.nullable(),
}).superRefine((proposal, context) => {
  if (proposal.action === "HOLD" && proposal.order !== null) context.addIssue({ code: "custom", message: "HOLD proposals must not include an order." });
  if (proposal.action !== "HOLD" && proposal.order === null) context.addIssue({ code: "custom", message: "BUY/SELL proposals require an order." });
  if (proposal.order && (proposal.order.side !== proposal.action || proposal.order.symbol !== proposal.symbol)) {
    context.addIssue({ code: "custom", message: "Proposal action, side, and symbol must match." });
  }
});
export type DecisionProposal = z.infer<typeof DecisionProposalSchema>;

export interface Position {
  symbol: string;
  quantity: string;
  availableQuantity?: string;
  averageEntryPrice: string;
  markPrice?: string;
}

export interface PortfolioState {
  quoteCurrency: string;
  cash: string;
  positions: Position[];
  equity: string;
  highWatermark: string;
  realizedPnlToday: string;
  dayStartEquity?: string;
  observedAt: number;
}

/** Optional per-pair limits: a base quantity that is never sold, caps on one sell, and a buy budget. */
export interface PairRiskLimit {
  reservedBase?: string;
  maxSellPct?: string;
  maxSellQuantity?: string;
  maxBuyNotional?: string;
}

export interface RiskLimits {
  maxOrderNotional: string;
  maxPositionNotional: string;
  maxGrossExposure: string;
  maxDrawdownPct: string;
  maxDailyLoss: string;
  maxDataAgeSeconds: number;
  feeBufferBps: string;
  maxMarketSlippageBps: string;
  killSwitch: boolean;
  /** Per-pair reserved holdings, sell caps, and buy budgets keyed by normalized symbol. */
  pairLimits?: Record<string, PairRiskLimit>;
}

export interface RiskResult {
  approved: boolean;
  reasons: string[];
  normalizedOrder?: OrderProposal;
  checkedAt: number;
  notional?: string;
}

export interface Fill {
  id: string;
  orderClientId: string;
  symbol: string;
  side: Side;
  quantity: string;
  price: string;
  fee: string;
  feeAsset: string;
  timestamp: number;
}

export interface ExchangeOrder {
  clientOrderId: string;
  symbol: string;
  side: Side;
  status: "NEW" | "PARTIALLY_FILLED" | "FILLED" | "CANCELED" | "REJECTED" | "UNKNOWN";
  quantity: string;
  executedQuantity: string;
  averagePrice: string;
  fills: Fill[];
  updatedAt: number;
}

export interface OrderIntent {
  clientOrderId: string;
  runId: string;
  decisionId: string;
  order: OrderProposal;
  state: "pending" | "submitted" | "reconciling" | "resolved" | "rejected";
  createdAt: number;
  portfolioKey?: string;
}

export interface AgentFinding {
  role: AgentRole;
  summary: string;
  confidence: number;
  evidenceIds: string[];
  /** Evidence fetched on demand by read-only tools during analysis. */
  additionalEvidence?: ResearchItem[];
  createdAt: number;
}

export interface TradeDecision {
  id: string;
  runId: string;
  symbol: string;
  decidedAt: number;
  quote: MarketQuote;
  evidence: Evidence[];
  findings: AgentFinding[];
  proposal: DecisionProposal;
  risk: RiskResult;
  orderClientId?: string;
}

export type MemoryAction = "BUY" | "SELL" | "HOLD";
export interface PendingDecisionMemory {
  decisionId: string;
  runId: string;
  symbol: string;
  contextKey: string;
  action: MemoryAction;
  decisionText: string;
  entryReferencePrice: string;
  benchmarkSymbol: string;
  decidedAt: number;
  holdingPeriodBars: number;
  dueAt: number;
}

export interface SettledDecisionMemory extends PendingDecisionMemory {
  status: "settled";
  rawReturn: string;
  benchmarkReturn: string;
  alphaReturn: string;
  entryPrice: string;
  exitPrice: string;
  benchmarkEntryPrice: string;
  benchmarkExitPrice: string;
  resolvedAt: number;
  reflection: string;
}

export interface RunReport {
  runId: string;
  mode: EngineMode;
  startedAt: number;
  endedAt: number;
  initialEquity: string;
  finalEquity: string;
  netReturnPct: string;
  maxDrawdownPct: string;
  tradeCount: number;
  acceptedProposals?: number;
  volume: string;
  averageTradeSize: string;
  /** Null means no execution proposal was eligible, so reliability was not exercised. */
  executionReliabilityPct: string | null;
  fees: string;
  slippage: string;
  assumptions: string[];
  symbol?: string;
  strategyId?: string;
  quoteCurrency?: string;
  equityCurve?: { timestamp: number; equity: string }[];
  buyAndHoldReturnPct?: string;
  excessReturnPct?: string;
}
