import Decimal from "decimal.js";
import type { Fill, PortfolioState, Position } from "../domain/types.ts";
import type { PortfolioServicePort } from "./ports.ts";

export class VirtualPortfolio implements PortfolioServicePort {
  private state: PortfolioState;
  constructor(initialCash: string, private readonly quoteCurrency: string, now = Date.now()) {
    this.state = {
      quoteCurrency,
      cash: new Decimal(initialCash).toFixed(),
      positions: [],
      equity: new Decimal(initialCash).toFixed(),
      highWatermark: new Decimal(initialCash).toFixed(),
      realizedPnlToday: "0",
      dayStartEquity: new Decimal(initialCash).toFixed(),
      observedAt: now,
    };
  }

  current(): PortfolioState { return structuredClone(this.state); }

  restore(state: PortfolioState): void { this.state = structuredClone(state); }

  applyFill(fill: Fill, markPrice: string): PortfolioState {
    const positions = this.state.positions.map((position) => ({ ...position }));
    const index = positions.findIndex((position) => position.symbol === fill.symbol);
    const prior: Position = index >= 0 ? positions[index]! : { symbol: fill.symbol, quantity: "0", averageEntryPrice: "0" };
    const oldQty = new Decimal(prior.quantity);
    const qty = new Decimal(fill.quantity);
    const price = new Decimal(fill.price);
    const fee = new Decimal(fill.fee || "0");
    const feeInQuote = fill.feeAsset.trim().toUpperCase() === this.quoteCurrency.toUpperCase() ? fee : new Decimal(0);
    let cash = new Decimal(this.state.cash);
    const newUtcDay = new Date(fill.timestamp).toISOString().slice(0, 10) !== new Date(this.state.observedAt).toISOString().slice(0, 10);
    let realized = newUtcDay ? new Decimal(0) : new Decimal(this.state.realizedPnlToday);
    const dayStartEquity = newUtcDay ? this.state.equity : (this.state.dayStartEquity ?? this.state.equity);
    let nextQty: Decimal;
    let avg = new Decimal(prior.averageEntryPrice);
    if (fill.side === "BUY") {
      nextQty = oldQty.plus(qty);
      const quoteCost = qty.mul(price).plus(feeInQuote);
      avg = oldQty.mul(avg).plus(quoteCost).div(nextQty);
      cash = cash.minus(quoteCost);
    } else {
      nextQty = oldQty.minus(qty);
      if (nextQty.lt(0)) throw new Error(`Virtual portfolio cannot sell more ${fill.symbol} than it owns.`);
      realized = realized.plus(price.minus(avg).mul(qty));
      cash = cash.plus(qty.mul(price));
      if (feeInQuote.gt(0)) { cash = cash.minus(feeInQuote); realized = realized.minus(feeInQuote); }
      if (nextQty.eq(0)) avg = new Decimal(0);
    }
    if (nextQty.eq(0)) {
      if (index >= 0) positions.splice(index, 1);
    } else {
      const replacement: Position = { symbol: fill.symbol, quantity: nextQty.toFixed(), averageEntryPrice: avg.toFixed(), markPrice };
      if (index >= 0) positions[index] = replacement;
      else positions.push(replacement);
    }
    const positionValue = positions.reduce((sum, item) => sum.plus(new Decimal(item.quantity).mul(item.symbol === fill.symbol ? markPrice : item.markPrice ?? item.averageEntryPrice)), new Decimal(0));
    const equity = cash.plus(positionValue);
    const highWatermark = Decimal.max(this.state.highWatermark, equity).toFixed();
    this.state = { ...this.state, cash: cash.toFixed(), positions, equity: equity.toFixed(), highWatermark, realizedPnlToday: realized.toFixed(), dayStartEquity, observedAt: fill.timestamp };
    return this.current();
  }

  mark(symbolPrices: ReadonlyMap<string, string>, now = Date.now()): PortfolioState {
    const newUtcDay = new Date(now).toISOString().slice(0, 10) !== new Date(this.state.observedAt).toISOString().slice(0, 10);
    const positions = this.state.positions.map((position) => ({
      ...position,
      markPrice: symbolPrices.get(position.symbol) ?? position.markPrice ?? position.averageEntryPrice,
    }));
    const value = positions.reduce((sum, position) => sum.plus(new Decimal(position.quantity).mul(position.markPrice!)), new Decimal(0));
    const equity = new Decimal(this.state.cash).plus(value);
    this.state = {
      ...this.state, positions, equity: equity.toFixed(), highWatermark: Decimal.max(this.state.highWatermark, equity).toFixed(),
      ...(newUtcDay ? { realizedPnlToday: "0", dayStartEquity: this.state.equity } : {}), observedAt: now,
    };
    return this.current();
  }
}
