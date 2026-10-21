import { describe, expect, test } from "bun:test";
import type { RunReport } from "../packages/engine/src/domain/types.ts";
import { aggregateRunReports, buildRunReport, compareRuns, downsampleEquityCurve } from "../packages/engine/src/application/reporting.ts";
import { renderBenchmarkHtml } from "../packages/engine/src/application/visualization.ts";
import { auditFailure } from "../packages/engine/src/application/failure-audit.ts";
import type { RunAuditDetails } from "../packages/engine/src/application/ports.ts";

const report = (runId: string, netReturnPct: string, strategyId: string): RunReport => ({
  runId, mode: "backtest", startedAt: 0, endedAt: 10_000,
  symbol: "BTCUSDT", strategyId, initialEquity: "1000", finalEquity: (1000 + Number(netReturnPct) * 10).toFixed(),
  netReturnPct, maxDrawdownPct: "3.0000", tradeCount: 4, volume: "500", averageTradeSize: "125",
  executionReliabilityPct: "100.00", fees: "0.5 USDT", slippage: "1.25",
  buyAndHoldReturnPct: "2.0000", excessReturnPct: (Number(netReturnPct) - 2).toFixed(4),
  assumptions: ["Completed one-minute candles."],
  equityCurve: [{ timestamp: 0, equity: "1000" }, { timestamp: 5000, equity: "1080" }],
});

describe("benchmark reporting and visualization", () => {
  test("ranks pair/strategy cases by net return and preserves comparison metrics", () => {
    const comparison = compareRuns([report("r1", "-4", "momentum"), report("r2", "8", "mean-reversion")]);
    expect(comparison.map((row) => row.runId)).toEqual(["r2", "r1"]);
    expect(comparison[0]?.netPnl).toBe("80");
    expect(comparison[0]?.buyAndHoldReturnPct).toBe("2.0000");
    expect(comparison[0]?.excessReturnPct).toBe("6.0000");
  });

  test("does not claim execution reliability when no order proposal exercised execution", () => {
    const noTrade = buildRunReport({
      runId: "no-trade", mode: "shadow", startedAt: 0, initialEquity: "1000", finalEquity: "1000",
      equityPath: ["1000", "1000"], acceptedProposals: 0, orders: [], fees: "0", slippage: "0", assumptions: [],
      symbol: "BTCUSDT", strategyId: "momentum", quoteCurrency: "USDT",
    }, 10);
    expect(noTrade.executionReliabilityPct).toBeNull();
    expect(compareRuns([noTrade])[0]?.executionReliabilityPct).toBeNull();
    const legacyHold = { ...noTrade, executionReliabilityPct: "100.00" };
    expect(compareRuns([legacyHold])[0]?.executionReliabilityPct).toBeNull();
    expect(renderBenchmarkHtml([noTrade])).toContain("Not exercised");
  });

  test("redacts credential-like values from persisted failure messages", () => {
    const failure = auditFailure(new Error("request failed: API key=topsecret Authorization: Bearer token-secret"));
    expect(failure.name).toBe("Error");
    expect(failure.message).not.toContain("topsecret");
    expect(failure.message).not.toContain("token-secret");
    expect(failure.message).toContain("[REDACTED]");
  });

  test("aggregates shadow cycles into cumulative portfolio performance", () => {
    const first = {
      ...report("r1", "10", "momentum"), mode: "shadow" as const, startedAt: 0, endedAt: 10,
      initialEquity: "100", finalEquity: "110", acceptedProposals: 1,
      tradeCount: 2, volume: "20", fees: "0.2 USDT", slippage: "1",
      equityCurve: [{ timestamp: 0, equity: "100" }, { timestamp: 10, equity: "110" }],
    };
    const second = {
      ...report("r2", "-10", "momentum"), mode: "shadow" as const, startedAt: 20, endedAt: 30,
      initialEquity: "110", finalEquity: "99", acceptedProposals: 1,
      executionReliabilityPct: "50.00", tradeCount: 1, volume: "10", fees: "0.3 USDT", slippage: "0.5",
      equityCurve: [{ timestamp: 20, equity: "110" }, { timestamp: 30, equity: "99" }],
    };
    const total = aggregateRunReports([second, first]);
    expect(total?.initialEquity).toBe("100");
    expect(total?.finalEquity).toBe("99");
    expect(total?.netReturnPct).toBe("-1.0000");
    expect(total?.maxDrawdownPct).toBe("10.0000");
    expect(total?.tradeCount).toBe(3);
    expect(total?.acceptedProposals).toBe(2);
    expect(total?.volume).toBe("30");
    expect(total?.averageTradeSize).toBe("10");
    expect(total?.fees).toBe("0.5 USDT");
    expect(total?.slippage).toBe("1.5");
    expect(total?.executionReliabilityPct).toBe("75.00");
    expect(total?.equityCurve).toEqual([
      { timestamp: 0, equity: "100" }, { timestamp: 10, equity: "110" },
      { timestamp: 20, equity: "110" }, { timestamp: 30, equity: "99" },
    ]);
  });

  test("does not aggregate unlike pair or strategy reports", () => {
    expect(() => aggregateRunReports([report("r1", "1", "momentum"), report("r2", "2", "mean-reversion")])).toThrow("different modes, symbols, or strategies");
  });

  test("renders an offline equity chart, scorecard, assumptions, and escaped text", () => {
    const html = renderBenchmarkHtml([report("r1", "8", "momentum")], "<script>alert(1)</script>");
    expect(html).toContain("Equity index (starting equity = 100)");
    expect(html).toContain("Performance comparison");
    expect(html).toContain("Buy &amp; hold");
    expect(html).toContain("Completed one-minute candles.");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(renderBenchmarkHtml([report("r1", "8", "momentum")], "refreshing", 60)).toContain('<meta http-equiv="refresh" content="60">');
  });

  test("adds accessible section navigation and state-preserving live dashboard updates only in watch mode", () => {
    const offline = renderBenchmarkHtml([report("r1", "8", "momentum")]);
    const live = renderBenchmarkHtml([report("r1", "8", "momentum")], "Live shadow", undefined, undefined, true);
    expect(live).toContain('<a class="skip-link" href="#overview">Skip to report content</a>');
    expect(live).toContain('<nav aria-label="Report sections">');
    expect(live).toContain('id="engine-connection" role="status" aria-live="polite"');
    expect(live).toContain('<button id="retry-dashboard" type="button" hidden>Reconnect dashboard</button>');
    expect(offline).not.toContain('id="retry-dashboard"');
    expect(live).toContain('id="performance" tabindex="-1" data-component="performance"');
    expect(live).toContain('id="audit" tabindex="-1" data-component="audit"');
    expect(live).toContain('new EventSource("/events")');
    expect(live).toContain("restoreInteractiveState");
    expect(live).toContain("data-dashboard-revision=\"0\"");
    const script = live.match(/<script nonce="__DASHBOARD_NONCE__">([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeDefined();
    expect(() => new Function(script!)).not.toThrow();
    expect(offline).toContain("hashchange");
    expect(offline).not.toContain('new EventSource("/events")');
  });

  test("renders per-run AI usage, decision rationale, risk, portfolio, and source audit details safely", () => {
    const audit: RunAuditDetails = {
      run: { id: "r1", mode: "shadow", status: "completed", startedAt: 0, endedAt: 10_000, config: { symbol: "BTCUSDT" }, report: report("r1", "8", "momentum") },
      decisions: [{
        id: "d1", runId: "r1", symbol: "BTCUSDT", decidedAt: 5_000,
        quote: { symbol: "BTCUSDT", price: "60000", observedAt: 4_999, source: "wallex-rest" },
        evidence: [{ id: "ev1", source: "wallex", summary: "Observed quote", observedAt: 4_999, confidence: 1 }],
        findings: [{ role: "market_technical_analyst", summary: "No edge", confidence: 0.7, evidenceIds: ["ev1"], createdAt: 5_000 }],
        proposal: { action: "HOLD", symbol: "BTCUSDT", confidence: 0.7, rationale: "Wait for confirmation.", evidenceIds: ["ev1"], order: null },
        risk: { approved: false, reasons: ["Portfolio manager returned HOLD; no order is eligible."], checkedAt: 5_001 },
      }],
      riskOutcomes: [], orders: [], decisionMemories: [], portfolioHistory: [{
        timestamp: 9_999, portfolioKey: "shadow:BTCUSDT:momentum", cash: "900", equity: "1010",
        positions: [{ symbol: "BTCUSDT", quantity: "1", averageEntryPrice: "100", markPrice: "110" }],
        quoteCurrency: "USDT", highWatermark: "1010", realizedPnlToday: "0", dayStartEquity: "1000",
      }],
      sourceSnapshots: [{ id: "s1", category: "news", source: "fixture", symbol: "BTCUSDT", observedAt: 4_900, payload: { title: "Test evidence" } }],
      aiModelCalls: [{
        id: "ai1", operationId: "op1", runId: "r1", symbol: "BTCUSDT", role: "market_technical_analyst",
        operation: "analyze", provider: "boxapi.chat", modelId: "gpt-6-luna", stepNumber: 1, status: "completed",
        startedAt: 4_000, endedAt: 4_500, inputTokens: 123, outputTokens: 12, totalTokens: 135,
        finishReason: "stop", toolNames: [], warnings: [],
      }, {
        id: "ai2", operationId: "op2", runId: "r1", symbol: "BTCUSDT", role: "news_analyst",
        operation: "analyze", provider: "boxapi.chat", modelId: "gpt-6-luna", stepNumber: 1, status: "failed",
        startedAt: 4_600, endedAt: 4_700, toolNames: [], warnings: [], errorName: "APICallError", errorMessage: "<script>steal()</script>",
      }],
    };
    const html = renderBenchmarkHtml([report("r1", "8", "momentum")], "Audit dashboard", undefined, { runs: [audit], totalRuns: 2 });
    expect(html).toContain("AI model activity (2 recorded steps)");
    expect(html).toContain("123 / 12 / — / 135");
    expect(html).toContain("Wait for confirmation.");
    expect(html).toContain("No edge");
    expect(html).toContain("10 USDT");
    expect(html).toContain("Unrealized P&amp;L");
    expect(html).toContain("1 matching record is outside this HTML audit window");
    expect(html).toContain("source snapshots (1)");
    expect(html).toContain("1 completed · 0 failed · 0 still running");
    expect(html).toContain("&lt;script&gt;steal()&lt;/script&gt;");
    expect(html).not.toContain("<script>steal()</script>");
  });

  test("renders recorded failure causes and identifies older failures without captured causes", () => {
    const base: RunAuditDetails = {
      run: { id: "failed-1", mode: "shadow", status: "failed", startedAt: 0, endedAt: 1, failureName: "TimeoutError", failureMessage: "Wallex candles request timed out.", config: {}, report: null },
      decisions: [], riskOutcomes: [], orders: [], decisionMemories: [], portfolioHistory: [], sourceSnapshots: [], aiModelCalls: [],
    };
    expect(renderBenchmarkHtml([], "Failures", undefined, { runs: [base] })).toContain("TimeoutError: Wallex candles request timed out.");
    expect(renderBenchmarkHtml([], "Legacy failure", undefined, { runs: [{ ...base, run: { ...base.run, failureName: null, failureMessage: null } }] })).toContain("This older failure has no persisted cause.");
  });

  test("bounds long chart payloads without dropping bucket highs and lows", () => {
    const points = Array.from({ length: 10_000 }, (_, index) => ({ timestamp: index, equity: String(index === 5_000 ? 20_000 : index === 5_001 ? 1 : 10_000 + index) }));
    const compact = downsampleEquityCurve(points, 100);
    expect(compact.length).toBeLessThanOrEqual(100);
    expect(compact[0]?.timestamp).toBe(0);
    expect(compact.at(-1)?.timestamp).toBe(9_999);
    expect(compact.some((point) => point.timestamp === 5_000)).toBe(true);
    expect(compact.some((point) => point.timestamp === 5_001)).toBe(true);
  });
});

