import Decimal from "decimal.js";
import { z } from "zod";
import { normalizeMarketSymbol } from "./market-symbol.ts";
import type { PairRiskLimit } from "./types.ts";

const decimalString = z.string().regex(/^\d+(\.\d+)?$/, "must be a non-negative decimal number");
// Blank strings come from empty editor fields and mean "no limit".
const optionalDecimal = z.preprocess((value) => value === "" || value === null ? undefined : value, decimalString.optional());

/** Shape of one entry in RISK_PAIR_LIMITS_JSON. Every field is optional; blank fields are dropped. */
export const PairRiskLimitSchema = z.object({
  reservedBase: optionalDecimal,
  maxSellPct: z.preprocess((value) => value === "" || value === null ? undefined : value, decimalString.refine((value) => new Decimal(value).lte(100), "must be between 0 and 100").optional()),
  maxSellQuantity: optionalDecimal,
  maxBuyNotional: optionalDecimal,
}).strict();

/** Parse the profile JSON into limits keyed by normalized Wallex symbol. Throws on malformed input so bad limits never load silently. */
export function parsePairLimits(json: string | undefined): Record<string, PairRiskLimit> {
  const trimmed = json?.trim();
  const raw = z.record(z.string(), PairRiskLimitSchema).parse(JSON.parse(trimmed ? trimmed : "{}"));
  const result: Record<string, PairRiskLimit> = {};
  for (const [pair, limit] of Object.entries(raw)) {
    const cleaned = Object.fromEntries(Object.entries(limit).filter(([, value]) => value !== undefined && value !== "")) as PairRiskLimit;
    if (Object.keys(cleaned).length === 0) continue;
    result[normalizeMarketSymbol(pair)] = cleaned;
  }
  return result;
}

export interface SellCapacity {
  /** Base quantity that must remain after any sell. */
  reserved: Decimal;
  /** Largest base quantity one sell may take under the per-cycle caps, if any cap is set. */
  maxPerOrder: Decimal | undefined;
  /** What can actually be sold right now once the reserve and the per-cycle caps are applied. */
  sellableNow: Decimal;
}

/** Combine the reserve and the per-cycle caps with the current holding into one sellable quantity. */
export function sellCapacity(limit: PairRiskLimit | undefined, holding: Decimal, available: Decimal): SellCapacity {
  const reserved = new Decimal(limit?.reservedBase ?? "0");
  let maxPerOrder: Decimal | undefined;
  if (limit?.maxSellPct !== undefined) maxPerOrder = holding.mul(limit.maxSellPct).div(100);
  if (limit?.maxSellQuantity !== undefined) maxPerOrder = maxPerOrder === undefined ? new Decimal(limit.maxSellQuantity) : Decimal.min(maxPerOrder, limit.maxSellQuantity);
  // The reserve is measured against the whole holding, so locked amounts still count toward it.
  let sellableNow = Decimal.max(Decimal.min(available, holding.minus(reserved)), 0);
  if (maxPerOrder !== undefined) sellableNow = Decimal.min(sellableNow, maxPerOrder);
  return { reserved, maxPerOrder, sellableNow };
}

/** Live per-run overrides may only tighten: a higher reserve, lower sell caps, lower buy budget, and never a dropped pair. */
export function assertPairLimitsTighten(base: Record<string, PairRiskLimit>, override: Record<string, PairRiskLimit>): void {
  for (const [pair, current] of Object.entries(base)) {
    const next = override[pair];
    if (!next) throw new Error(`Live per-run override 'RISK_PAIR_LIMITS_JSON' must keep the profile's limits for ${pair}.`);
    const loosened =
      (current.reservedBase !== undefined && (next.reservedBase === undefined || new Decimal(next.reservedBase).lt(current.reservedBase)))
      || (current.maxSellPct !== undefined && (next.maxSellPct === undefined || new Decimal(next.maxSellPct).gt(current.maxSellPct)))
      || (current.maxSellQuantity !== undefined && (next.maxSellQuantity === undefined || new Decimal(next.maxSellQuantity).gt(current.maxSellQuantity)))
      || (current.maxBuyNotional !== undefined && (next.maxBuyNotional === undefined || new Decimal(next.maxBuyNotional).gt(current.maxBuyNotional)));
    if (loosened) throw new Error(`Live per-run override 'RISK_PAIR_LIMITS_JSON' cannot loosen the profile's limits for ${pair}.`);
  }
}
