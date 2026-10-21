import Decimal from "decimal.js";
import { randomUUID } from "node:crypto";
import type { EngineConfig } from "../domain/config.ts";
import type { Candle, PendingDecisionMemory, SettledDecisionMemory } from "../domain/types.ts";
import type { MarketDataPort, ModelPort, RunRepository } from "./ports.ts";

const BAR_MS = 60_000;
const FETCH_CHUNK_SECONDS = 900 * 60;
const BENCHMARK_MAX_AGE_MS = 5 * BAR_MS;

interface CandlePair { subject: Candle[]; benchmark: Candle[] }
export interface MemorySettlementResult { settled: number; warnings: string[] }

function closeAt(candle: Candle): number { return candle.timestamp + BAR_MS; }

function completedThrough(candles: readonly Candle[], asOf: number): Candle[] {
  return candles.filter((candle) => candle.complete && closeAt(candle) <= asOf && Number(candle.close) > 0)
    .sort((a, b) => a.timestamp - b.timestamp);
}

function atOrBefore(candles: readonly Candle[], timestamp: number): Candle | undefined {
  let low = 0, high = candles.length - 1, found = -1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    if (closeAt(candles[middle]!) <= timestamp) { found = middle; low = middle + 1; }
    else high = middle - 1;
  }
  return found < 0 ? undefined : candles[found];
}

function forwardClose(candles: readonly Candle[], timestamp: number): Candle | undefined {
  let low = 0, high = candles.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (closeAt(candles[middle]!) < timestamp) low = middle + 1;
    else high = middle;
  }
  return candles[low];
}

function returnFraction(entry: string, exit: string): string {
  const initial = new Decimal(entry);
  const final = new Decimal(exit);
  if (!initial.isFinite() || !final.isFinite() || !initial.gt(0) || !final.gt(0)) throw new Error("Memory settlement encountered a non-positive or invalid price.");
  return final.minus(initial).div(initial).toFixed(12);
}

export function resolveMemoryBenchmark(symbol: string, quoteAsset: string, configured?: string): string {
  if (configured) return configured;
  const normalized = symbol.toUpperCase().replaceAll("/", "");
  const quote = quoteAsset.toUpperCase();
  if (normalized.endsWith(quote) && normalized.length > quote.length) return `BTC${quote}`;
  throw new Error(`Cannot infer a Wallex benchmark for ${symbol}; configure MEMORY_BENCHMARK_SYMBOL.`);
}

export class DecisionMemoryService {
  constructor(
    private readonly config: EngineConfig,
    private readonly marketData: MarketDataPort,
    private readonly model: ModelPort,
    private readonly repository: RunRepository,
  ) {}

  createPending(decision: {
    id: string; runId: string; symbol: string; decidedAt: number; action: PendingDecisionMemory["action"];
    rationale: string; confidence: number; risk: { approved: boolean; reasons: string[] }; quotePrice: string;
  }, contextKey: string, benchmarkSymbol: string): PendingDecisionMemory {
    const holdingPeriodBars = this.config.memory.holdingPeriodBars;
    const memory: PendingDecisionMemory = {
      decisionId: decision.id, runId: decision.runId, symbol: decision.symbol, contextKey,
      action: decision.action,
      decisionText: `${decision.action} (${(decision.confidence * 100).toFixed(1)}% confidence); risk ${decision.risk.approved ? "approved" : "rejected"}${decision.risk.reasons.length ? `: ${decision.risk.reasons.join("; ")}` : ""}. ${decision.rationale}`.slice(0, 2_000),
      entryReferencePrice: decision.quotePrice, benchmarkSymbol, decidedAt: decision.decidedAt,
      holdingPeriodBars, dueAt: decision.decidedAt + (holdingPeriodBars + 1) * BAR_MS,
    };
    return memory;
  }

  async settleMatured(contextKey: string, asOf: number, suppliedHistory?: ReadonlyMap<string, readonly Candle[]>, auditRunId?: string): Promise<MemorySettlementResult> {
    const result: MemorySettlementResult = { settled: 0, warnings: [] };
    const pending = this.repository.getMaturedDecisionMemories(contextKey, asOf);
    if (pending.length === 0) return result;

    const history = new Map<string, Candle[]>();
    for (const [symbol, candles] of suppliedHistory ?? []) history.set(symbol.toUpperCase(), completedThrough(candles, asOf));
    const required = new Map<string, number>();
    for (const memory of pending) {
      required.set(memory.symbol, Math.min(required.get(memory.symbol) ?? Infinity, memory.decidedAt - BAR_MS));
      required.set(memory.benchmarkSymbol, Math.min(required.get(memory.benchmarkSymbol) ?? Infinity, memory.decidedAt - BAR_MS));
    }
    const missing = [...required].filter(([symbol]) => !history.has(symbol));
    await Promise.all(missing.map(async ([symbol, startAt]) => {
      try { history.set(symbol, completedThrough(await this.fetchRange(symbol, startAt, asOf), asOf)); }
      catch (error) { result.warnings.push(`${symbol}: historical memory prices unavailable (${error instanceof Error ? error.message : String(error)}).`); }
    }));

    for (const memory of pending) {
      const owner = randomUUID();
      const leaseName = `memory-settlement:${memory.decisionId}`;
      const leaseMs = Math.max(120_000, this.config.ai.timeoutMs * 2 + 30_000);
      if (!this.repository.acquireExecutionLease(leaseName, owner, Date.now(), leaseMs)) continue;
      try {
        const prices = history.get(memory.symbol);
        const benchmarks = history.get(memory.benchmarkSymbol);
        if (!prices || !benchmarks) continue;
        const entry = forwardClose(prices, memory.decidedAt + 1);
        if (!entry) continue;
        const exit = forwardClose(prices, closeAt(entry) + memory.holdingPeriodBars * BAR_MS);
        if (!exit || closeAt(exit) > asOf) continue;
        const benchmarkEntry = atOrBefore(benchmarks, closeAt(entry));
        const benchmarkExit = atOrBefore(benchmarks, closeAt(exit));
        if (!benchmarkEntry || !benchmarkExit || closeAt(entry) - closeAt(benchmarkEntry) > BENCHMARK_MAX_AGE_MS ||
          closeAt(exit) - closeAt(benchmarkExit) > BENCHMARK_MAX_AGE_MS) continue;

        const rawReturn = returnFraction(entry.close, exit.close);
        const benchmarkReturn = returnFraction(benchmarkEntry.close, benchmarkExit.close);
        const alphaReturn = new Decimal(rawReturn).minus(benchmarkReturn).toFixed(12);
        const reflectorInput = {
          action: memory.action, decisionText: memory.decisionText, rawReturn, benchmarkReturn,
          alphaReturn, benchmarkSymbol: memory.benchmarkSymbol, holdingPeriodBars: memory.holdingPeriodBars,
          ...(auditRunId ? { auditRunId } : {}), auditDecisionId: memory.decisionId, auditSymbol: memory.symbol,
        };
        let reflection: string;
        if (this.config.ai.disabledRoles.includes("reflector")) {
          reflection = `AI reflection is disabled for this profile. Recorded ${memory.action} outcome: market ${(Number(rawReturn) * 100).toFixed(2)}%, benchmark ${(Number(benchmarkReturn) * 100).toFixed(2)}%, alpha ${(Number(alphaReturn) * 100).toFixed(2)}% over ${memory.holdingPeriodBars} one-minute bars.`;
        } else {
          try { reflection = await this.model.reflect(reflectorInput); }
          catch (error) {
            result.warnings.push(`${memory.symbol} decision ${memory.decisionId}: reflection failed; outcome remains pending (${error instanceof Error ? error.message : String(error)}).`);
            continue;
          }
        }
        const outcome = {
          entryPrice: entry.close, exitPrice: exit.close,
          benchmarkEntryPrice: benchmarkEntry.close, benchmarkExitPrice: benchmarkExit.close,
          rawReturn, benchmarkReturn, alphaReturn, resolvedAt: closeAt(exit), reflection,
        } satisfies Parameters<RunRepository["settleDecisionMemory"]>[1];
        if (this.repository.settleDecisionMemory(memory.decisionId, outcome)) result.settled++;
      } catch (error) {
        result.warnings.push(`${memory.symbol} decision ${memory.decisionId}: settlement failed and will be retried (${error instanceof Error ? error.message : String(error)}).`);
      } finally {
        this.repository.releaseExecutionLease(leaseName, owner);
      }
    }
    return result;
  }

  private async fetchRange(symbol: string, fromMs: number, toMs: number): Promise<Candle[]> {
    const startSeconds = Math.max(0, Math.floor(fromMs / 1_000));
    const endSeconds = Math.floor(toMs / 1_000) + 1;
    const chunks: Candle[][] = [];
    for (let from = startSeconds; from < endSeconds;) {
      const to = Math.min(endSeconds, from + FETCH_CHUNK_SECONDS);
      chunks.push(await this.marketData.getCandles(symbol, from, to, 1));
      from = to;
    }
    const unique = new Map<number, Candle>();
    for (const candle of chunks.flat()) unique.set(candle.timestamp, candle);
    return [...unique.values()].sort((a, b) => a.timestamp - b.timestamp);
  }
}
