import Decimal from "decimal.js";
import type { Candle, ExchangeOrder, Fill, OrderProposal } from "../domain/types.ts";

export function simulateNextBarOpenFill(input: {
  order: OrderProposal;
  clientOrderId: string;
  signalCompletedAt: number;
  nextBar: Candle;
  feeBps: string;
  slippageBps: string;
  quoteCurrency: string;
}): { order: ExchangeOrder; fee: string; slippage: string } {
  if (!input.nextBar.complete) throw new Error("Backtest execution candle must be complete for deterministic replay.");
  if (input.nextBar.timestamp < input.signalCompletedAt) throw new Error("Backtest fill cannot use a bar that starts before the signal completed.");
  const basePrice = new Decimal(input.nextBar.open);
  const slippageRate = new Decimal(input.slippageBps).div(10_000);
  let price = input.order.side === "BUY" ? basePrice.mul(new Decimal(1).plus(slippageRate)) : basePrice.mul(new Decimal(1).minus(slippageRate));
  let quantity = new Decimal(input.order.quantity);
  if (input.order.type === "LIMIT" && input.order.price) {
    const limit = new Decimal(input.order.price);
    const marketableAtOpen = input.order.side === "BUY" ? basePrice.lte(limit) : basePrice.gte(limit);
    if (!marketableAtOpen) quantity = new Decimal(0);
    else price = input.order.side === "BUY" ? Decimal.min(price, limit) : Decimal.max(price, limit);
  }
  const notional = quantity.mul(price);
  const fee = notional.mul(new Decimal(input.feeBps).div(10_000));
  const fill: Fill | undefined = quantity.gt(0) ? {
    id: `${input.clientOrderId}:backtest:${input.nextBar.timestamp}`,
    orderClientId: input.clientOrderId, symbol: input.order.symbol, side: input.order.side,
    quantity: quantity.toFixed(), price: price.toFixed(), fee: fee.toFixed(), feeAsset: input.quoteCurrency,
    timestamp: input.nextBar.timestamp,
  } : undefined;
  return {
    fee: fee.toFixed(),
    slippage: quantity.gt(0) ? price.minus(basePrice).abs().mul(quantity).toFixed() : "0",
    order: {
      clientOrderId: input.clientOrderId, symbol: input.order.symbol, side: input.order.side,
      quantity: input.order.quantity, executedQuantity: quantity.toFixed(), averagePrice: quantity.gt(0) ? price.toFixed() : "0",
      status: quantity.eq(0) ? "CANCELED" : quantity.lt(input.order.quantity) ? "PARTIALLY_FILLED" : "FILLED",
      fills: fill ? [fill] : [], updatedAt: input.nextBar.timestamp,
    },
  };
}
