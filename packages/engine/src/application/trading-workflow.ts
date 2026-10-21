import Decimal from "decimal.js";
import { randomUUID } from "node:crypto";
import type { EngineConfig } from "../domain/config.ts";
import { computeTechnicalIndicators } from "../domain/indicators.ts";
import type {
  AgentFinding, AgentRole, DecisionProposal, Evidence, MarketQuote, PortfolioState,
  ResearchItem, RiskResult, TradeDecision,
} from "../domain/types.ts";
import type { AgentContext, MarketDataPort, ModelPort, ResearchAggregatorPort, RunRepository } from "./ports.ts";
import { evaluateOrderRisk } from "./risk-gate.ts";
import { constrainProposal, selectStrategy, strategyRiskLimits, type StrategyProfile } from "../domain/strategies.ts";
import { normalizeMarketSymbol } from "../domain/market-symbol.ts";
import { DecisionMemoryService, resolveMemoryBenchmark } from "./decision-memory.ts";
import type { Candle } from "../domain/types.ts";

const analystRoles: AgentRole[] = ["market_technical_analyst", "news_analyst", "sentiment_analyst", "tokenomics_analyst"];
const researcherRoles: AgentRole[] = ["bull_researcher", "bear_researcher"];
const riskRoles: AgentRole[] = ["aggressive_risk_analyst", "conservative_risk_analyst", "neutral_risk_analyst"];

export interface EvaluateInput {
  runId: string;
  symbol: string;
  portfolio: PortfolioState;
  now?: number;
  quote?: MarketQuote;
  candles?: AgentContext["candles"];
  research?: ResearchItem[];
  mode: "backtest" | "shadow" | "live";
  strategy?: StrategyProfile;
  memoryHistory?: ReadonlyMap<string, readonly Candle[]>;
}

export class TradingWorkflow {
  private marketCache: Awaited<ReturnType<MarketDataPort["listSpotMarkets"]>> | undefined;
  private effectiveMarkets: Set<string> | undefined;
  private readonly memory: DecisionMemoryService;
  constructor(
    private readonly config: EngineConfig,
    private readonly marketData: MarketDataPort,
    private readonly aggregator: ResearchAggregatorPort,
    private readonly model: ModelPort,
    private readonly repository: RunRepository,
    private readonly now: () => number = Date.now,
  ) { this.memory = new DecisionMemoryService(config, marketData, model, repository); }

  private riskLimits(mode: "backtest" | "shadow" | "live", strategy: StrategyProfile) {
    const simulatedExecutionBuffer = mode === "live" ? "0" : this.config.backtestFeeBps;
    const maxGrossExposure = mode === "live"
      ? Decimal.min(this.config.risk.maxGrossExposure, this.config.wallex.liveMaxGrossExposure).toFixed()
      : this.config.risk.maxGrossExposure;
    return strategyRiskLimits({
      ...this.config.risk,
      maxGrossExposure,
      feeBufferBps: new Decimal(this.config.risk.feeBufferBps).plus(simulatedExecutionBuffer).toFixed(),
    }, strategy);
  }

  async initializeMarketPolicy(mode?: "backtest" | "shadow" | "live"): Promise<void> {
    this.marketCache = await this.marketData.listSpotMarkets();
    const allowlist = new Set(this.config.wallex.allowedMarkets.map(normalizeMarketSymbol));
    if (mode !== "backtest" && this.config.wallex.packageId && this.marketData.getPackageUnavailableMarkets) {
      const blocked = new Set((await this.marketData.getPackageUnavailableMarkets(this.config.wallex.packageId)).map(normalizeMarketSymbol));
      for (const symbol of blocked) allowlist.delete(symbol);
    }
    this.effectiveMarkets = allowlist;
  }

  memoryBenchmarkFor(symbol: string): string {
    const normalized = normalizeMarketSymbol(symbol);
    const market = this.marketCache?.find((item) => normalizeMarketSymbol(item.symbol) === normalized);
    return resolveMemoryBenchmark(normalized, market?.quoteAsset ?? this.config.wallex.quoteCurrency, this.config.memory.benchmarkSymbol);
  }

  async evaluate(input: EvaluateInput): Promise<TradeDecision> {
    if (!this.marketCache || !this.effectiveMarkets) await this.initializeMarketPolicy(input.mode);
    const now = input.now ?? this.now();
    const symbol = normalizeMarketSymbol(input.symbol);
    const strategy = input.strategy ?? selectStrategy(this.config.strategies);
    const quote = input.quote ?? await this.marketData.getQuote(symbol);
    if (input.mode !== "backtest") {
      const quoteAgeSeconds = (now - quote.observedAt) / 1000;
      if (quoteAgeSeconds > this.config.risk.maxDataAgeSeconds) throw new Error(`Market quote is stale (${quoteAgeSeconds.toFixed(1)}s old); no decision was made.`);
      if (quote.observedAt > now + 1000) throw new Error("Market quote timestamp is in the future; no decision was made.");
    }
    const candles = input.candles ?? await this.marketData.getCandles(symbol, Math.floor((now - 120 * 60_000) / 1000), Math.floor(now / 1000), 1);
    const researchBundle = input.research ? { items: input.research, warnings: [] } : await this.aggregator.collect(symbol, now);
    const completedCandles = candles.filter((item) => item.complete);
    const indicators = computeTechnicalIndicators(completedCandles);
    const candleEvidence: Evidence = {
      id: `candles:${symbol}:${quote.observedAt}`, source: "wallex-candle-history",
      summary: `${completedCandles.length} completed 1m OHLCV candles; latest close=${completedCandles.at(-1)?.close ?? "unavailable"}.`,
      observedAt: completedCandles.at(-1)?.timestamp ?? quote.observedAt,
      confidence: completedCandles.length > 0 ? 1 : 0,
    };
    const researchItems: ResearchItem[] = [
      ...researchBundle.items,
      ...(indicators ? [{
        id: `indicators:${symbol}:${quote.observedAt}`, category: "technical" as const,
        title: "Deterministic technical indicators", content: JSON.stringify(indicators),
        source: "wallex-candle-indicators", observedAt: completedCandles.at(-1)?.timestamp ?? quote.observedAt,
        confidence: completedCandles.length >= 26 ? 0.9 : 0.55, metadata: {},
      }] : []),
      {
        id: candleEvidence.id, category: "technical", title: "Completed Wallex one-minute candles",
        content: candleEvidence.summary, source: candleEvidence.source, observedAt: candleEvidence.observedAt,
        confidence: candleEvidence.confidence, metadata: {},
      },
    ];
    const evidence: Evidence[] = researchItems.map((item) => ({
      id: item.id, summary: `${item.title}: ${item.content}`, source: item.source,
      observedAt: item.observedAt, confidence: item.confidence,
    }));
    this.repository.saveSnapshot({ runId: input.runId, category: "market_quote", source: quote.source, symbol, observedAt: quote.observedAt, payload: quote });
    if (input.mode !== "backtest") {
      this.repository.saveSnapshot({ runId: input.runId, category: "candles", source: "wallex-rest", symbol, observedAt: now, payload: candles });
    }
    for (const item of researchBundle.items) this.repository.saveSnapshot({ runId: input.runId, category: item.category, source: item.source, symbol, observedAt: item.observedAt, payload: item });
    for (const warning of researchBundle.warnings) this.repository.saveSnapshot({ runId: input.runId, category: "provider_warning", source: warning.provider, symbol, observedAt: now, payload: warning });

    const reflectionScope = `memory:${input.mode}:${strategy.id}`;
    const settlement = await this.memory.settleMatured(reflectionScope, now, input.memoryHistory, input.runId);
    for (const warning of settlement.warnings) this.repository.saveSnapshot({
      runId: input.runId, category: "memory_settlement_warning", source: "decision-memory", symbol,
      observedAt: now, payload: { warning },
    });
    const recentReflections = this.repository.getDecisionMemoryLessons(symbol, reflectionScope, now, 5, 3);
    const base: AgentContext = {
      runId: input.runId, symbol, quote, candles: completedCandles, research: researchItems,
      priorFindings: [], recentReflections, portfolio: input.portfolio, strategy,
    };
    const activeAnalystRoles = analystRoles.filter((role) => !this.config.ai.disabledRoles.includes(role));
    const analysts = await Promise.all(activeAnalystRoles.map((role) => this.model.analyze(role, base)));
    const researchers: AgentFinding[] = [];
    for (let round = 1; round <= this.config.maxDebateRounds; round++) {
      for (const role of researcherRoles) {
        const finding = await this.model.analyze(role, {
          ...base,
          priorFindings: [...analysts, ...researchers],
          discussionTurn: { kind: "investment", round, totalRounds: this.config.maxDebateRounds },
        });
        researchers.push(finding);
      }
    }
    const researchManager = await this.model.analyze("research_manager", { ...base, priorFindings: [...analysts, ...researchers] });
    const traderContext: AgentContext = { ...base, priorFindings: [...analysts, ...researchers, researchManager] };
    const traderProposal = await this.model.propose("trader", "Create an initial candidate proposal for the debate. Do not execute it.", traderContext);
    const traderFinding: AgentFinding = {
      role: "trader", summary: `Initial proposal: ${JSON.stringify(traderProposal)}`,
      confidence: traderProposal.confidence, evidenceIds: traderProposal.evidenceIds, createdAt: now,
    };
    const riskFindings: AgentFinding[] = [];
    for (let round = 1; round <= this.config.maxRiskDiscussRounds; round++) {
      for (const role of riskRoles) {
        const finding = await this.model.analyze(role, {
          ...base,
          priorFindings: [...analysts, ...researchers, researchManager, traderFinding, ...riskFindings],
          discussionTurn: { kind: "risk", round, totalRounds: this.config.maxRiskDiscussRounds },
        });
        riskFindings.push(finding);
      }
    }
    const allFindings = [...analysts, ...researchers, researchManager, traderFinding, ...riskFindings];
    const finalProposal: DecisionProposal = await this.model.propose("portfolio_manager", [
      "Make a final portfolio proposal after reviewing the entire analyst and risk debate.",
      `Trader candidate: ${JSON.stringify(traderProposal)}`,
      `Risk reviews: ${riskFindings.map((finding) => finding.summary).join(" | ")}`,
      "If any important evidence is missing or risk reviews identify unresolved material risk, return HOLD.",
      `Follow the selected strategy profile: ${strategy.name} (${strategy.id}). ${strategy.mandate}`,
    ].join("\n"), { ...base, priorFindings: allFindings });
    const evidenceIds = new Set(evidence.map((item) => item.id));
    const { proposal: constrainedProposal, reasons: proposalReasons } = constrainProposal(finalProposal, strategy);
    const proposal: DecisionProposal = { ...constrainedProposal, evidenceIds: constrainedProposal.evidenceIds.filter((id) => evidenceIds.has(id)) };
    const order = proposal.order;
    const depth = order && (input.mode === "shadow" || (input.mode === "live" && order.type === "MARKET"))
      ? await this.marketData.getDepth(symbol) : undefined;
    const riskCheckedAt = input.mode === "backtest" ? now : Math.max(now, this.now());
    const market = this.marketCache?.find((item) => item.symbol === symbol);
    const risk = order ? evaluateOrderRisk({
      order, market, quote, ...(depth ? { depth } : {}), portfolio: input.portfolio, allowedMarkets: this.effectiveMarkets!, limits: this.riskLimits(input.mode, strategy), now: riskCheckedAt,
      requireWallexPrice: input.mode === "live",
      requireDepthFresh: input.mode === "shadow",
      ...(input.mode !== "live" ? { slippageBufferBps: this.config.backtestSlippageBps } : {}),
    }) : { approved: false, reasons: proposalReasons.length > 0 ? proposalReasons : ["Portfolio manager returned HOLD; no order is eligible."], checkedAt: now };
    const decision: TradeDecision = {
      id: randomUUID(), runId: input.runId, symbol, decidedAt: now, quote, evidence,
      findings: allFindings, proposal, risk,
      ...(risk.approved ? { orderClientId: `WA_${randomUUID().replaceAll("-", "").toUpperCase()}` } : {}),
    };
    const memory = this.memory.createPending({
      id: decision.id, runId: decision.runId, symbol: decision.symbol, decidedAt: decision.decidedAt,
      action: decision.proposal.action, rationale: decision.proposal.rationale,
      confidence: decision.proposal.confidence, risk: decision.risk, quotePrice: decision.quote.price,
    }, reflectionScope, this.memoryBenchmarkFor(symbol));
    this.repository.saveDecisionAndMemory(decision, memory);
    this.repository.saveRiskOutcome(decision.id, risk);
    return decision;
  }

  async riskAtExecution(decision: TradeDecision, portfolio: PortfolioState, quote: MarketQuote, now: number,
    mode: "backtest" | "shadow" | "live",
    depthSnapshot?: { bids: [string, string][]; asks: [string, string][]; observedAt: number }, strategyInput?: StrategyProfile): Promise<RiskResult> {
    if (!decision.proposal.order) return { approved: false, reasons: ["No order was proposed."], checkedAt: now };
    const strategy = strategyInput ?? selectStrategy(this.config.strategies);
    if (mode === "live" || mode === "shadow") await this.initializeMarketPolicy(mode);
    else if (!this.marketCache || !this.effectiveMarkets) await this.initializeMarketPolicy(mode);
    const needsDepth = mode === "shadow" || (mode === "live" && decision.proposal.order.type === "MARKET");
    const depth = depthSnapshot ?? (needsDepth ? await this.marketData.getDepth(decision.symbol) : undefined);
    const riskCheckedAt = mode === "backtest" ? now : Math.max(now, this.now());
    return evaluateOrderRisk({
      order: decision.proposal.order, market: this.marketCache!.find((item) => item.symbol === decision.symbol),
      quote, ...(depth ? { depth } : {}), portfolio, allowedMarkets: this.effectiveMarkets!, limits: this.riskLimits(mode, strategy), now: riskCheckedAt,
      requireWallexPrice: mode === "live",
      requireDepthFresh: mode === "shadow",
      ...(mode !== "live" ? { slippageBufferBps: this.config.backtestSlippageBps } : {}),
    });
  }
}
