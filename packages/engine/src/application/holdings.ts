import Decimal from "decimal.js";
import type { PortfolioState } from "../domain/types.ts";

/** What the account actually holds for one pair, in the terms an agent needs to size a spot order. */
export interface PairHoldings {
  pair: string;
  baseAsset: string;
  quoteCurrency: string;
  /** Base-asset quantity that can be sold right now (excludes amounts locked in open orders). */
  availableBase: string;
  totalBase: string;
  /** Marked value of the base position in the quote currency. */
  baseValueInQuote: string;
  /** Quote-currency cash that can fund a buy right now. */
  availableQuoteCash: string;
  equity: string;
  /** Share of total equity already in this pair, as a percentage. */
  pairShareOfEquityPct: string;
  /** Other non-zero holdings, so the agents see concentration across the account. */
  otherPositions: Array<{ symbol: string; quantity: string; valueInQuote: string }>;
  constraints: string[];
}

function safe(value: string | undefined, fallback = "0"): Decimal {
  const decimal = new Decimal(value ?? fallback);
  return decimal.isFinite() ? decimal : new Decimal(fallback);
}

export function baseAssetOf(symbol: string, quoteCurrency: string): string {
  const upper = symbol.toUpperCase(), quote = quoteCurrency.toUpperCase();
  return upper.endsWith(quote) && upper.length > quote.length ? upper.slice(0, -quote.length) : upper;
}

/** Summarize the portfolio from the point of view of the pair under decision. Pure and deterministic. */
export function describePairHoldings(symbol: string, portfolio: PortfolioState): PairHoldings {
  const pair = symbol.toUpperCase();
  const quoteCurrency = portfolio.quoteCurrency.toUpperCase();
  const baseAsset = baseAssetOf(pair, quoteCurrency);
  const position = portfolio.positions.find((item) => item.symbol.toUpperCase() === pair);
  const totalBase = safe(position?.quantity);
  const availableBase = position?.availableQuantity !== undefined ? safe(position.availableQuantity) : totalBase;
  const markPrice = safe(position?.markPrice ?? position?.averageEntryPrice);
  const baseValue = totalBase.mul(markPrice);
  const equity = safe(portfolio.equity);
  const cash = safe(portfolio.cash);
  const share = equity.gt(0) ? baseValue.div(equity).mul(100) : new Decimal(0);
  const otherPositions = portfolio.positions
    .filter((item) => item.symbol.toUpperCase() !== pair && safe(item.quantity).gt(0))
    .map((item) => ({ symbol: item.symbol.toUpperCase(), quantity: safe(item.quantity).toFixed(), valueInQuote: safe(item.quantity).mul(safe(item.markPrice ?? item.averageEntryPrice)).toFixed(2) }));
  const constraints = [
    `Spot only: no margin, borrowing, or shorting. A SELL can use at most the available ${baseAsset} quantity (${availableBase.toFixed()}).`,
    `A BUY must fit within the available ${quoteCurrency} cash (${cash.toFixed()}) after fees; size orders from these balances, not from equity.`,
  ];
  if (availableBase.lte(0)) constraints.push(`The account holds no ${baseAsset} available to sell, so SELL is impossible; choose BUY or HOLD.`);
  if (cash.lte(0)) constraints.push(`The account has no available ${quoteCurrency} cash, so BUY is impossible; choose SELL or HOLD.`);
  return {
    pair, baseAsset, quoteCurrency,
    availableBase: availableBase.toFixed(), totalBase: totalBase.toFixed(), baseValueInQuote: baseValue.toFixed(2),
    availableQuoteCash: cash.toFixed(), equity: equity.toFixed(2), pairShareOfEquityPct: share.toFixed(2),
    otherPositions, constraints,
  };
}
