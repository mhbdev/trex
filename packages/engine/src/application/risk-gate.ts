import Decimal from "decimal.js";
import type { MarketQuote, MarketSpec, OrderProposal, PortfolioState, RiskLimits, RiskResult } from "../domain/types.ts";
import { sellCapacity } from "../domain/pair-limits.ts";

export interface RiskCheckInput {
  order: OrderProposal;
  market: MarketSpec | undefined;
  quote: MarketQuote;
  depth?: { bids: [string, string][]; asks: [string, string][]; observedAt: number };
  portfolio: PortfolioState;
  allowedMarkets: ReadonlySet<string>;
  limits: RiskLimits;
  now: number;
  requireWallexPrice?: boolean;
  requireDepthFresh?: boolean;
  slippageBufferBps?: string;
}

const decimals = (value: string): number => {
  try { return new Decimal(value).decimalPlaces(); } catch { return Number.POSITIVE_INFINITY; }
};

function estimateMarketVwap(side: OrderProposal["side"], quantity: Decimal,
  depth: NonNullable<RiskCheckInput["depth"]>): Decimal | undefined {
  const source = side === "BUY" ? depth.asks : depth.bids;
  const levels = source.flatMap(([rawPrice, rawQuantity]) => {
    try {
      const price = new Decimal(rawPrice);
      const amount = new Decimal(rawQuantity);
      return price.isFinite() && price.gt(0) && amount.isFinite() && amount.gt(0) ? [{ price, amount }] : [];
    } catch { return []; }
  }).sort((a, b) => side === "BUY" ? a.price.cmp(b.price) : b.price.cmp(a.price));
  let remaining = quantity;
  let total = new Decimal(0);
  for (const level of levels) {
    const amount = Decimal.min(remaining, level.amount);
    total = total.plus(amount.mul(level.price));
    remaining = remaining.minus(amount);
    if (remaining.lte(0)) break;
  }
  return remaining.gt(0) ? undefined : total.div(quantity);
}

export function evaluateOrderRisk(input: RiskCheckInput): RiskResult {
  const reasons: string[] = [];
  const { order, market, quote, portfolio, limits, now } = input;
  if (limits.killSwitch) reasons.push("Trading kill switch is enabled.");
  if (!input.allowedMarkets.has(order.symbol)) reasons.push(`Market ${order.symbol} is not allowlisted.`);
  if (!market || !market.spotEnabled) reasons.push(`Market ${order.symbol} is not an active spot market.`);
  let quotePrice: Decimal | undefined;
  try { quotePrice = new Decimal(quote.price); } catch { /* Invalid provider payload. */ }
  if (quote.symbol !== order.symbol || !quotePrice?.isFinite() || quotePrice.lte(0)) {
    reasons.push("A valid matching market quote is required.");
  }
  if (input.requireWallexPrice && !quote.source.startsWith("wallex-")) reasons.push("Live execution requires a canonical Wallex price.");
  const ageSeconds = Math.max(0, now - quote.observedAt) / 1000;
  if (ageSeconds > limits.maxDataAgeSeconds) reasons.push(`Market quote is stale (${ageSeconds.toFixed(1)}s old).`);
  if (quote.observedAt > now + 1_000) reasons.push("Market quote timestamp is in the future.");
  if (portfolio.equity === "0" || new Decimal(portfolio.equity).lte(0)) reasons.push("Portfolio equity is not positive.");
  if (new Decimal(portfolio.highWatermark).gt(0)) {
    const drawdownPct = new Decimal(portfolio.highWatermark).minus(portfolio.equity)
      .div(portfolio.highWatermark).mul(100);
    if (drawdownPct.gt(limits.maxDrawdownPct)) reasons.push(`Maximum drawdown exceeded (${drawdownPct.toFixed(2)}%).`);
  }
  if (new Decimal(portfolio.realizedPnlToday).lt(0) && new Decimal(portfolio.realizedPnlToday).abs().gte(limits.maxDailyLoss)) {
    reasons.push("Daily loss limit reached.");
  }
  if (!market) return { approved: false, reasons, checkedAt: now };
  if (market.quoteAsset.toUpperCase() !== portfolio.quoteCurrency.toUpperCase()) {
    reasons.push(`Market quote asset ${market.quoteAsset} does not match portfolio currency ${portfolio.quoteCurrency}.`);
  }

  let quantity: Decimal;
  let price: Decimal;
  try {
    quantity = new Decimal(order.quantity);
    price = new Decimal(order.price ?? quote.price);
  } catch {
    return { approved: false, reasons: [...reasons, "Order quantity or price is invalid."], checkedAt: now };
  }
  const depthRequired = Boolean(input.requireDepthFresh || (order.type === "MARKET" && input.requireWallexPrice));
  if (depthRequired && !input.depth) reasons.push("A fresh visible order-book snapshot is required.");
  if (depthRequired && input.depth) {
    const depthAgeSeconds = Math.max(0, now - input.depth.observedAt) / 1000;
    if (depthAgeSeconds > limits.maxDataAgeSeconds) reasons.push(`Market depth is stale (${depthAgeSeconds.toFixed(1)}s old).`);
    if (input.depth.observedAt > now + 1000) reasons.push("Market depth timestamp is in the future.");
  }
  if (order.type === "MARKET" && (input.requireWallexPrice || input.requireDepthFresh)) {
    if (!input.depth) reasons.push("Market orders require a fresh visible order-book snapshot.");
    else {
      const vwap = estimateMarketVwap(order.side, quantity, input.depth);
      if (!vwap) reasons.push("Visible order-book depth cannot fill the complete market order.");
      else {
        const slippageRate = new Decimal(input.slippageBufferBps ?? "0").div(10_000);
        price = order.side === "BUY" ? vwap.mul(new Decimal(1).plus(slippageRate)) : vwap.mul(new Decimal(1).minus(slippageRate));
        if (quotePrice?.isFinite() && quotePrice.gt(0)) {
          const adverseBps = order.side === "BUY"
            ? Decimal.max(price.minus(quotePrice), 0).div(quotePrice).mul(10_000)
            : Decimal.max(quotePrice.minus(price), 0).div(quotePrice).mul(10_000);
          if (adverseBps.gt(limits.maxMarketSlippageBps)) {
            reasons.push(`Estimated market slippage ${adverseBps.toFixed(2)} bps exceeds the configured ${limits.maxMarketSlippageBps} bps limit.`);
          }
        }
      }
    }
  } else if (order.type === "MARKET" && input.slippageBufferBps !== undefined && quotePrice?.isFinite() && quotePrice.gt(0)) {
    const slippageRate = new Decimal(input.slippageBufferBps).div(10_000);
    price = order.side === "BUY" ? quotePrice.mul(new Decimal(1).plus(slippageRate)) : quotePrice.mul(new Decimal(1).minus(slippageRate));
    const adverseBps = order.side === "BUY"
      ? Decimal.max(price.minus(quotePrice), 0).div(quotePrice).mul(10_000)
      : Decimal.max(quotePrice.minus(price), 0).div(quotePrice).mul(10_000);
    if (adverseBps.gt(limits.maxMarketSlippageBps)) {
      reasons.push(`Estimated market slippage ${adverseBps.toFixed(2)} bps exceeds the configured ${limits.maxMarketSlippageBps} bps limit.`);
    }
  }
  if (!quantity.isFinite() || quantity.lte(0)) reasons.push("Order quantity must be positive and finite.");
  if (!price.isFinite() || price.lte(0)) reasons.push("Order price must be positive and finite.");
  if (decimals(order.quantity) > market.quantityPrecision) reasons.push("Quantity exceeds market precision.");
  if (order.price !== undefined && decimals(order.price) > market.pricePrecision) reasons.push("Price exceeds market precision.");
  if (quantity.lt(market.minQuantity)) reasons.push(`Quantity is below the market minimum (${market.minQuantity}).`);
  const notional = quantity.mul(price);
  if (notional.lt(market.minNotional)) reasons.push(`Order is below the market minimum notional (${market.minNotional}).`);
  if (notional.gt(limits.maxOrderNotional)) reasons.push("Maximum order notional exceeded.");

  const currentPosition = portfolio.positions.find((p) => p.symbol === order.symbol);
  const currentQty = new Decimal(currentPosition?.quantity ?? "0");
  const sellableQty = new Decimal(currentPosition?.availableQuantity ?? currentPosition?.quantity ?? "0");
  const nextQty = order.side === "BUY" ? currentQty.plus(quantity) : currentQty.minus(quantity);
  if (order.side === "SELL" && quantity.gt(sellableQty)) reasons.push("Spot sell quantity exceeds the available position.");
  // Operator-defined per-pair limits: a reserved holding that is never sold, caps on one sell, and a buy budget.
  const pairLimit = limits.pairLimits?.[order.symbol];
  if (pairLimit && order.side === "SELL") {
    const capacity = sellCapacity(pairLimit, currentQty, sellableQty);
    if (capacity.reserved.gt(0) && currentQty.minus(quantity).lt(capacity.reserved)) reasons.push(`Sell would leave less than the reserved ${capacity.reserved.toFixed()} ${market.baseAsset} holding for ${order.symbol}.`);
    if (capacity.maxPerOrder !== undefined && quantity.gt(capacity.maxPerOrder)) reasons.push(`Sell quantity exceeds the per-cycle sell limit for ${order.symbol} (${capacity.maxPerOrder.toFixed()} ${market.baseAsset}).`);
  }
  if (pairLimit?.maxBuyNotional !== undefined && order.side === "BUY" && notional.gt(pairLimit.maxBuyNotional)) reasons.push(`Buy value exceeds the per-pair buy budget for ${order.symbol} (${pairLimit.maxBuyNotional} ${market.quoteAsset}).`);
  if (nextQty.mul(price).gt(limits.maxPositionNotional)) reasons.push("Maximum position notional exceeded.");
  const buyCashRequired = notional.plus(notional.mul(limits.feeBufferBps).div(10_000));
  if (order.side === "BUY" && buyCashRequired.gt(portfolio.cash)) reasons.push("Insufficient available quote-currency cash including the configured fee buffer.");
  const otherExposure = portfolio.positions
    .filter((p) => p.symbol !== order.symbol)
    .reduce((sum, p) => sum.plus(new Decimal(p.quantity).mul(p.markPrice ?? p.averageEntryPrice)), new Decimal(0));
  if (otherExposure.plus(Decimal.max(nextQty, 0).mul(price)).gt(limits.maxGrossExposure)) reasons.push("Maximum gross exposure exceeded.");

  const roundedOrder: OrderProposal = {
    ...order,
    quantity: quantity.toFixed(market.quantityPrecision),
    ...(order.type === "LIMIT" ? { price: price.toFixed(market.pricePrecision) } : {}),
  };
  return {
    approved: reasons.length === 0,
    reasons,
    checkedAt: now,
    notional: notional.toFixed(),
    ...(reasons.length === 0 ? { normalizedOrder: roundedOrder } : {}),
  };
}
