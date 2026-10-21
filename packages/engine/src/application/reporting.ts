import Decimal from "decimal.js";
import type { EngineMode, ExchangeOrder, Fill, RunReport } from "../domain/types.ts";

export function formatFeesByAsset(fills: readonly Fill[]): string {
  const totals = new Map<string, Decimal>();
  for (const fill of fills) {
    const asset = fill.feeAsset.toUpperCase() || "UNKNOWN";
    totals.set(asset, (totals.get(asset) ?? new Decimal(0)).plus(fill.fee));
  }
  return totals.size === 0 ? "0" : [...totals].map(([asset, amount]) => `${amount.toFixed()} ${asset}`).join(", ");
}

export interface RunMetrics {
  runId: string;
  mode: EngineMode;
  startedAt: number;
  initialEquity: string;
  finalEquity: string;
  equityPath: string[];
  acceptedProposals: number;
  orders: ExchangeOrder[];
  fees: string;
  slippage: string;
  assumptions: string[];
  symbol?: string;
  strategyId?: string;
  quoteCurrency?: string;
  equityCurve?: { timestamp: number; equity: string }[];
  buyAndHoldFinalEquity?: string;
}

export function buildRunReport(metrics: RunMetrics, endedAt = Date.now()): RunReport {
  const initial = new Decimal(metrics.initialEquity);
  const final = new Decimal(metrics.finalEquity);
  const netReturnPct = initial.eq(0) ? new Decimal(0) : final.minus(initial).div(initial).mul(100);
  let peak = initial;
  let maxDrawdown = new Decimal(0);
  for (const value of metrics.equityPath) {
    const equity = new Decimal(value);
    peak = Decimal.max(peak, equity);
    if (peak.gt(0)) maxDrawdown = Decimal.max(maxDrawdown, peak.minus(equity).div(peak).mul(100));
  }
  const fills = metrics.orders.flatMap((order) => order.fills);
  const volume = fills.reduce((sum, fill) => sum.plus(new Decimal(fill.quantity).mul(fill.price)), new Decimal(0));
  const reliability = metrics.acceptedProposals === 0 ? null :
    new Decimal(metrics.orders.filter((order) => order.fills.length > 0 || order.status === "NEW" || order.status === "PARTIALLY_FILLED").length)
      .div(metrics.acceptedProposals).mul(100);
  const buyAndHoldReturnPct = metrics.buyAndHoldFinalEquity === undefined || initial.eq(0)
    ? undefined : new Decimal(metrics.buyAndHoldFinalEquity).minus(initial).div(initial).mul(100);
  const excessReturnPct = buyAndHoldReturnPct === undefined ? undefined : netReturnPct.minus(buyAndHoldReturnPct);
  return {
    runId: metrics.runId, mode: metrics.mode, startedAt: metrics.startedAt, endedAt,
    initialEquity: initial.toFixed(), finalEquity: final.toFixed(), netReturnPct: netReturnPct.toFixed(4),
    maxDrawdownPct: maxDrawdown.toFixed(4), tradeCount: fills.length, volume: volume.toFixed(),
    acceptedProposals: metrics.acceptedProposals,
    averageTradeSize: fills.length === 0 ? "0" : volume.div(fills.length).toFixed(),
    executionReliabilityPct: reliability?.toFixed(2) ?? null, fees: metrics.fees, slippage: metrics.slippage,
    assumptions: metrics.assumptions,
    ...(metrics.symbol ? { symbol: metrics.symbol } : {}),
    ...(metrics.strategyId ? { strategyId: metrics.strategyId } : {}),
    ...(metrics.quoteCurrency ? { quoteCurrency: metrics.quoteCurrency } : {}),
    ...(metrics.equityCurve ? { equityCurve: metrics.equityCurve } : {}),
    ...(buyAndHoldReturnPct ? { buyAndHoldReturnPct: buyAndHoldReturnPct.toFixed(4) } : {}),
    ...(excessReturnPct ? { excessReturnPct: excessReturnPct.toFixed(4) } : {}),
  };
}

export function compareRuns(reports: readonly RunReport[]) {
  return [...reports].sort((a, b) => Number(b.netReturnPct) - Number(a.netReturnPct)).map((report, rank) => ({
    rank: rank + 1, runId: report.runId, mode: report.mode, symbol: report.symbol ?? "unknown",
    strategyId: report.strategyId ?? "unspecified", quoteCurrency: report.quoteCurrency ?? "unknown", initialEquity: report.initialEquity,
    finalEquity: report.finalEquity, netPnl: new Decimal(report.finalEquity).minus(report.initialEquity).toFixed(),
    netReturnPct: report.netReturnPct, buyAndHoldReturnPct: report.buyAndHoldReturnPct ?? null,
    excessReturnPct: report.excessReturnPct ?? null, maxDrawdownPct: report.maxDrawdownPct,
    tradeCount: report.tradeCount, volume: report.volume, averageTradeSize: report.averageTradeSize,
    executionReliabilityPct: (report.acceptedProposals ?? report.tradeCount) === 0 ? null : report.executionReliabilityPct,
    fees: report.fees, slippage: report.slippage,
  }));
}

/** Combine persisted shadow cycles into the lifetime performance of one virtual portfolio. */
export function aggregateRunReports(reports: readonly RunReport[]): RunReport | null {
  if (reports.length === 0) return null;
  const ordered = [...reports].sort((a, b) => a.startedAt - b.startedAt || a.endedAt - b.endedAt || a.runId.localeCompare(b.runId));
  const first = ordered[0]!;
  const latest = ordered.at(-1)!;
  if (ordered.some((report) => report.mode !== first.mode || report.symbol !== first.symbol || report.strategyId !== first.strategyId)) {
    throw new Error("Cannot aggregate reports from different modes, symbols, or strategies.");
  }
  const initial = new Decimal(first.initialEquity);
  const final = new Decimal(latest.finalEquity);
  const netReturnPct = initial.eq(0) ? new Decimal(0) : final.minus(initial).div(initial).mul(100);
  const points = ordered.flatMap((report) => report.equityCurve?.length
    ? report.equityCurve
    : [{ timestamp: report.startedAt, equity: report.initialEquity }, { timestamp: report.endedAt, equity: report.finalEquity }]);
  const curve = downsampleEquityCurve(points);
  let peak = initial;
  let maxDrawdown = new Decimal(0);
  for (const point of points) {
    const equity = new Decimal(point.equity);
    peak = Decimal.max(peak, equity);
    if (peak.gt(0)) maxDrawdown = Decimal.max(maxDrawdown, peak.minus(equity).div(peak).mul(100));
  }

  const sum = (values: readonly string[]) => values.reduce((total, value) => total.plus(new Decimal(value)), new Decimal(0));
  const tradeCount = ordered.reduce((total, report) => total + report.tradeCount, 0);
  const volume = sum(ordered.map((report) => report.volume));
  const acceptedProposals = ordered.reduce((total, report) => total + (report.acceptedProposals ?? report.tradeCount), 0);
  const reliabilityNumerator = ordered.reduce((total, report) => {
    const weight = report.acceptedProposals ?? report.tradeCount;
    return report.executionReliabilityPct === null || weight === 0
      ? total
      : total.plus(new Decimal(report.executionReliabilityPct).mul(weight));
  }, new Decimal(0));
  const reliabilityDenominator = ordered.reduce((total, report) => total + (
    report.executionReliabilityPct === null ? 0 : (report.acceptedProposals ?? report.tradeCount)
  ), 0);

  const feesByAsset = new Map<string, Decimal>();
  const unparsedFees = new Set<string>();
  for (const report of ordered) {
    if (report.fees.trim() === "0") continue;
    for (const part of report.fees.split(",")) {
      const match = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s+([A-Z0-9_-]+)\s*$/.exec(part);
      if (!match) { unparsedFees.add(part.trim()); continue; }
      const asset = match[2]!;
      feesByAsset.set(asset, (feesByAsset.get(asset) ?? new Decimal(0)).plus(match[1]!));
    }
  }
  const formattedFees = [
    ...[...feesByAsset].map(([asset, amount]) => `${amount.toFixed()} ${asset}`),
    ...unparsedFees,
  ].join(", ") || "0";
  const slippageUnavailable = ordered.some((report) => !Number.isFinite(Number(report.slippage)));
  const slippage = slippageUnavailable ? "unavailable" : sum(ordered.map((report) => report.slippage)).toFixed();

  return {
    runId: latest.runId,
    mode: latest.mode,
    startedAt: first.startedAt,
    endedAt: latest.endedAt,
    initialEquity: initial.toFixed(),
    finalEquity: final.toFixed(),
    netReturnPct: netReturnPct.toFixed(4),
    maxDrawdownPct: maxDrawdown.toFixed(4),
    tradeCount,
    acceptedProposals,
    volume: volume.toFixed(),
    averageTradeSize: tradeCount === 0 ? "0" : volume.div(tradeCount).toFixed(),
    executionReliabilityPct: reliabilityDenominator === 0 ? null : reliabilityNumerator.div(reliabilityDenominator).toFixed(2),
    fees: formattedFees,
    slippage,
    assumptions: [...new Set(ordered.flatMap((report) => report.assumptions))],
    ...(latest.symbol ? { symbol: latest.symbol } : {}),
    ...(latest.strategyId ? { strategyId: latest.strategyId } : {}),
    ...(latest.quoteCurrency ? { quoteCurrency: latest.quoteCurrency } : {}),
    equityCurve: curve,
  };
}

/** Retain local peaks and troughs while bounding serialized chart data for long replays. */
export function downsampleEquityCurve(points: readonly { timestamp: number; equity: string }[], maxPoints = 1_000): { timestamp: number; equity: string }[] {
  const byTimestamp = new Map<number, { timestamp: number; equity: string }>();
  for (const point of points) byTimestamp.set(point.timestamp, point);
  const ordered = [...byTimestamp.values()].sort((a, b) => a.timestamp - b.timestamp);
  if (ordered.length <= maxPoints || maxPoints < 4) return ordered;
  const bucketCount = Math.floor((maxPoints - 2) / 2);
  const interiorCount = ordered.length - 2;
  const selected = new Set<number>([0, ordered.length - 1]);
  for (let bucket = 0; bucket < bucketCount; bucket++) {
    const start = 1 + Math.floor(bucket * interiorCount / bucketCount);
    const end = 1 + Math.floor((bucket + 1) * interiorCount / bucketCount);
    let min = start, max = start;
    for (let index = start + 1; index < end; index++) {
      if (new Decimal(ordered[index]!.equity).lt(ordered[min]!.equity)) min = index;
      if (new Decimal(ordered[index]!.equity).gt(ordered[max]!.equity)) max = index;
    }
    selected.add(min); selected.add(max);
  }
  return [...selected].sort((a, b) => a - b).map((index) => ordered[index]!);
}
