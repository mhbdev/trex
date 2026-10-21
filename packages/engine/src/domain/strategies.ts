import { z } from "zod";
import Decimal from "decimal.js";
import type { DecisionProposal } from "./types.ts";
import type { RiskLimits } from "./types.ts";

export const StrategyProfileSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/),
  name: z.string().min(1).max(80),
  mandate: z.string().min(20).max(2_000),
  minConfidence: z.number().min(0).max(1).default(0.5),
  allowedOrderTypes: z.array(z.enum(["MARKET", "LIMIT"])).min(1).default(["MARKET", "LIMIT"]),
  maxOrderNotional: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  maxPositionNotional: z.string().regex(/^\d+(\.\d+)?$/).optional(),
  maxGrossExposure: z.string().regex(/^\d+(\.\d+)?$/).optional(),
}).superRefine((profile, context) => {
  for (const field of ["maxOrderNotional", "maxPositionNotional", "maxGrossExposure"] as const) {
    const value = profile[field];
    if (value !== undefined && !new Decimal(value).gt(0)) {
      context.addIssue({ code: "custom", path: [field], message: `${field} must be positive.` });
    }
  }
});

export type StrategyProfile = z.infer<typeof StrategyProfileSchema>;

export const builtInStrategies: readonly StrategyProfile[] = [
  {
    id: "agentic-balanced",
    name: "Agentic balanced",
    mandate: "Use the full analyst debate to balance return opportunities against downside, liquidity, and uncertainty. Prefer HOLD when evidence conflicts or is incomplete.",
    minConfidence: 0.5,
    allowedOrderTypes: ["MARKET", "LIMIT"],
  },
  {
    id: "momentum",
    name: "Momentum",
    mandate: "Favor trades supported by persistent directional price action and confirming volume or momentum indicators. Do not chase an extended move; explain invalidation evidence and prefer HOLD when trend confirmation is absent.",
    minConfidence: 0.65,
    allowedOrderTypes: ["MARKET", "LIMIT"],
  },
  {
    id: "mean-reversion",
    name: "Mean reversion",
    mandate: "Favor only evidence of a stretched move and a plausible reversion toward a measured mean, using supplied indicators and completed candles. Do not assume a reversal from a single oversold or overbought reading; prefer HOLD without confirmation.",
    minConfidence: 0.65,
    allowedOrderTypes: ["LIMIT"],
  },
  {
    id: "capital-preservation",
    name: "Capital preservation",
    mandate: "Prioritize preservation of capital over participation. Require strong, mutually consistent evidence, reject weak risk-adjusted opportunities, and prefer HOLD whenever downside, liquidity, or data uncertainty is material.",
    minConfidence: 0.8,
    allowedOrderTypes: ["LIMIT"],
  },
];

export function parseStrategyProfiles(raw: string): StrategyProfile[] {
  let configured: unknown;
  try { configured = JSON.parse(raw); }
  catch { throw new Error("ENGINE_STRATEGIES_JSON must be valid JSON."); }
  const parsed = z.array(StrategyProfileSchema).parse(configured);
  const profiles = new Map(builtInStrategies.map((profile) => [profile.id, profile]));
  for (const profile of parsed) profiles.set(profile.id, profile);
  return [...profiles.values()];
}

export function selectStrategy(profiles: readonly StrategyProfile[], id = "agentic-balanced"): StrategyProfile {
  const selected = profiles.find((profile) => profile.id === id);
  if (!selected) throw new Error(`Unknown strategy '${id}'. Available strategies: ${profiles.map(({ id: available }) => available).join(", ")}.`);
  return selected;
}

export function constrainProposal(proposal: DecisionProposal, strategy: StrategyProfile): { proposal: DecisionProposal; reasons: string[] } {
  const reasons: string[] = [];
  if (proposal.order && !strategy.allowedOrderTypes.includes(proposal.order.type)) {
    reasons.push(`${strategy.name} strategy does not permit ${proposal.order.type} orders.`);
  }
  if (proposal.order && proposal.confidence < strategy.minConfidence) {
    reasons.push(`Proposal confidence ${proposal.confidence.toFixed(2)} is below the ${strategy.name} minimum of ${strategy.minConfidence.toFixed(2)}.`);
  }
  if (reasons.length === 0) return { proposal, reasons };
  return {
    proposal: { ...proposal, action: "HOLD", order: null, rationale: `${proposal.rationale} Strategy gate: ${reasons.join(" ")}` },
    reasons,
  };
}

export function strategyRiskLimits(limits: RiskLimits, strategy: StrategyProfile): RiskLimits {
  return {
    ...limits,
    maxOrderNotional: strategy.maxOrderNotional ? Decimal.min(limits.maxOrderNotional, strategy.maxOrderNotional).toFixed() : limits.maxOrderNotional,
    maxPositionNotional: strategy.maxPositionNotional ? Decimal.min(limits.maxPositionNotional, strategy.maxPositionNotional).toFixed() : limits.maxPositionNotional,
    maxGrossExposure: strategy.maxGrossExposure ? Decimal.min(limits.maxGrossExposure, strategy.maxGrossExposure).toFixed() : limits.maxGrossExposure,
  };
}
