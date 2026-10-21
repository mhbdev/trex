import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import type { ExchangeOrder, Fill, MarketQuote, OrderIntent, TradeDecision } from "../domain/types.ts";
import type { OrderExecutionPort, RunRepository } from "./ports.ts";
import { VirtualPortfolio } from "./portfolio.ts";

export class AmbiguousWallexSubmissionError extends Error {
  constructor(readonly clientOrderId: string, message: string) { super(message); this.name = "AmbiguousWallexSubmissionError"; }
}

export class WallexSubmissionRejectedError extends Error {
  constructor(readonly clientOrderId: string, message: string) { super(message); this.name = "WallexSubmissionRejectedError"; }
}

export function newWallexClientOrderId(): string { return `WA_${randomUUID().replaceAll("-", "").toUpperCase()}`; }

export function orderIntentState(order: ExchangeOrder): OrderIntent["state"] {
  if (order.status === "NEW" || order.status === "PARTIALLY_FILLED") return "submitted";
  if (order.status === "UNKNOWN") return "reconciling";
  try {
    if (new Decimal(order.executedQuantity).gt(0) && order.fills.length === 0) return "reconciling";
  } catch { return "reconciling"; }
  return "resolved";
}

export class LiveExecutionCoordinator {
  constructor(private readonly exchange: OrderExecutionPort, private readonly repository: RunRepository) {}

  async reconcilePending(): Promise<{ resolved: number; unresolved: string[] }> {
    let resolved = 0;
    const unresolved: string[] = [];
    for (const intent of this.repository.getPendingOrderIntents("live")) {
      try {
        let order = await this.exchange.getOrder(intent.clientOrderId);
        if (!order || order.status === "UNKNOWN") {
          const openOrders = await this.exchange.listOpenOrders(intent.order.symbol);
          const listedOrder = openOrders.find((candidate) => candidate.clientOrderId === intent.clientOrderId) ?? null;
          if (listedOrder) order = listedOrder;
        }
        if (!order) { unresolved.push(intent.clientOrderId); continue; }
        const state = orderIntentState(order);
        this.repository.updateOrderIntent(intent.clientOrderId, state, order);
        this.repository.saveFills(order);
        if (state === "resolved") resolved++;
        else unresolved.push(intent.clientOrderId);
      } catch { unresolved.push(intent.clientOrderId); }
    }
    return { resolved, unresolved };
  }

  async execute(decision: TradeDecision, quote: MarketQuote): Promise<ExchangeOrder> {
    if (!decision.risk.approved || !decision.proposal.order) throw new Error("Live execution requires a risk-approved proposal.");
    const clientOrderId = decision.orderClientId ?? newWallexClientOrderId();
    const order = { ...decision.risk.normalizedOrder! };
    if (order.type === "LIMIT") order.price ??= quote.price;
    else delete order.price;
    const intent: OrderIntent = {
      clientOrderId, runId: decision.runId, decisionId: decision.id, order,
      state: "pending", createdAt: Date.now(),
    };
    // This durable intent must commit before the first order-write request.
    if (!this.repository.createOrderIntent(intent)) {
      throw new Error(`Order intent ${clientOrderId} already exists; reconcile the existing Wallex order instead of submitting again.`);
    }
    this.repository.updateOrderIntent(clientOrderId, "submitted");
    try {
      const result = await this.exchange.submitOrder(order, clientOrderId);
      this.repository.updateOrderIntent(clientOrderId, orderIntentState(result), result);
      this.repository.saveFills(result);
      return result;
    } catch (error) {
      const status = (error as { status?: number })?.status;
      if (status !== undefined && [400, 401, 403, 422].includes(status)) {
        this.repository.updateOrderIntent(clientOrderId, "rejected");
        throw new WallexSubmissionRejectedError(clientOrderId,
          `Wallex rejected order ${clientOrderId} with HTTP ${status}; intent is recorded as rejected. ${error instanceof Error ? error.message : String(error)}`);
      }
      this.repository.updateOrderIntent(clientOrderId, "reconciling");
      try {
        let reconciled = await this.exchange.getOrder(clientOrderId);
        if (!reconciled || reconciled.status === "UNKNOWN") {
          const openOrders = await this.exchange.listOpenOrders(order.symbol);
          const listedOrder = openOrders.find((candidate) => candidate.clientOrderId === clientOrderId) ?? null;
          if (listedOrder) reconciled = listedOrder;
        }
        if (reconciled) {
          this.repository.updateOrderIntent(clientOrderId, orderIntentState(reconciled), reconciled);
          this.repository.saveFills(reconciled);
          return reconciled;
        }
      } catch { /* Keep the durable intent unresolved for a later restart reconciliation. */ }
      throw new AmbiguousWallexSubmissionError(clientOrderId,
        `Wallex order submission outcome is ambiguous; intent ${clientOrderId} is persisted. It will not be resubmitted automatically. Original error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export interface BookLike { bids: [string, string][]; asks: [string, string][] }

/** Simulate a marketable shadow fill by walking the visible book. It cannot submit exchange orders. */
export function simulateShadowFill(input: {
  decision: TradeDecision;
  book: BookLike;
  fallbackPrice: string;
  slippageBps: string;
  feeBps: string;
  quoteCurrency?: string;
  now: number;
}): { fills: Fill[]; order: ExchangeOrder; fee: string; slippage: string } {
  const proposal = input.decision.proposal.order;
  if (!proposal) throw new Error("No order to simulate.");
  const target = new Decimal(proposal.quantity);
  const levels = [...(proposal.side === "BUY" ? input.book.asks : input.book.bids)]
    .sort((a, b) => proposal.side === "BUY" ? new Decimal(a[0]).cmp(b[0]) : new Decimal(b[0]).cmp(a[0]));
  let remaining = target;
  let notional = new Decimal(0);
  let filled = new Decimal(0);
  for (const [rawPrice, rawQuantity] of levels) {
    if (remaining.lte(0)) break;
    const px = new Decimal(rawPrice);
    if (proposal.type === "LIMIT" && proposal.price) {
      const limit = new Decimal(proposal.price);
      if (proposal.side === "BUY" && px.gt(limit)) break;
      if (proposal.side === "SELL" && px.lt(limit)) break;
    }
    const quantity = Decimal.min(remaining, new Decimal(rawQuantity));
    if (quantity.lte(0)) continue;
    remaining = remaining.minus(quantity); filled = filled.plus(quantity); notional = notional.plus(quantity.mul(px));
  }
  const slippage = new Decimal(input.slippageBps).div(10_000);
  let average = filled.gt(0) ? notional.div(filled) : new Decimal(input.fallbackPrice);
  if (filled.gt(0)) {
    average = proposal.side === "BUY" ? average.mul(new Decimal(1).plus(slippage)) : average.mul(new Decimal(1).minus(slippage));
    if (proposal.type === "LIMIT" && proposal.price) {
      const limit = new Decimal(proposal.price);
      average = proposal.side === "BUY" ? Decimal.min(average, limit) : Decimal.max(average, limit);
    }
  }
  const fee = filled.mul(average).mul(input.feeBps).div(10_000);
  const slippageAmount = filled.mul(average.minus(new Decimal(input.fallbackPrice)).abs());
  const clientOrderId = input.decision.orderClientId ?? newWallexClientOrderId();
  const fills: Fill[] = filled.gt(0) ? [{
    id: `${clientOrderId}:shadow:${input.now}`, orderClientId: clientOrderId, symbol: proposal.symbol,
    side: proposal.side, quantity: filled.toFixed(), price: average.toFixed(), fee: fee.toFixed(),
    feeAsset: input.quoteCurrency ?? "QUOTE", timestamp: input.now,
  }] : [];
  return {
    fills, fee: fee.toFixed(), slippage: slippageAmount.toFixed(),
    order: {
      clientOrderId, symbol: proposal.symbol, side: proposal.side,
      status: filled.eq(0) ? "CANCELED" : remaining.gt(0) ? "PARTIALLY_FILLED" : "FILLED",
      quantity: target.toFixed(), executedQuantity: filled.toFixed(), averagePrice: average.toFixed(), fills, updatedAt: input.now,
    },
  };
}

export function applyVirtualFills(portfolio: VirtualPortfolio, order: ExchangeOrder, markPrice: string) {
  let current = portfolio.current();
  for (const fill of order.fills) current = portfolio.applyFill(fill, markPrice);
  return current;
}
