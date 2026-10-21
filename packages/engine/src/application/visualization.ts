import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import Decimal from "decimal.js";
import type { RunReport } from "../domain/types.ts";
import type { RunAuditDetails } from "./ports.ts";
import { compareRuns } from "./reporting.ts";

export interface DashboardAuditData {
  runs: readonly RunAuditDetails[];
  /** Number of matching runs considered when selecting the displayed audit window. */
  totalRuns?: number;
}

const colorFor = (index: number): string => `hsl(${Math.round(index * 137.508) % 360} 70% 65%)`;
const escapeHtml = (value: string): string => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const cell = (value: unknown): string => escapeHtml(value === null || value === undefined || value === "" ? "—" : String(value));
const dateTime = (value: number | null | undefined): string => Number.isFinite(value) ? new Date(value!).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC") : "—";

function jsonText(value: unknown): string {
  try { return JSON.stringify(value, null, 2) ?? String(value); }
  catch { return "[unserializable value]"; }
}

function series(report: RunReport, drawdown = false): number[] {
  const input = report.equityCurve?.map((point) => Number(point.equity)) ?? [Number(report.initialEquity), Number(report.finalEquity)];
  const base = Number(report.initialEquity);
  if (!drawdown) return input.map((value) => Number.isFinite(value) && base > 0 ? value / base * 100 : 100);
  let peak = base;
  return input.map((value) => {
    if (Number.isFinite(value)) peak = Math.max(peak, value);
    return peak > 0 && Number.isFinite(value) ? -((peak - value) / peak * 100) : 0;
  });
}

function renderChart(reports: readonly RunReport[], drawdown = false): string {
  const width = 1040, height = 380, left = 78, right = 24, top = 28, bottom = 48;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  if (reports.length === 0) return `<svg viewBox="0 0 ${width} ${height}" role="img"><text x="${width / 2}" y="${height / 2}" text-anchor="middle">No completed run reports to visualize</text></svg>`;
  const values = reports.flatMap((report) => series(report, drawdown));
  let min = Math.min(drawdown ? 0 : 100, ...values), max = Math.max(drawdown ? 0 : 100, ...values);
  const span = Math.max(max - min, 0.25); min -= span * 0.08; max += span * 0.08;
  const y = (value: number) => top + (max - value) / (max - min) * plotHeight;
  const grid = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const value = max - ratio * (max - min), py = top + ratio * plotHeight;
    return `<line x1="${left}" y1="${py}" x2="${width - right}" y2="${py}" class="grid"/><text x="${left - 10}" y="${py + 4}" text-anchor="end" class="axis">${value.toFixed(2)}%</text>`;
  }).join("");
  const paths = reports.map((report, index) => {
    const points = series(report, drawdown);
    const coordinates = points.map((value, point) => {
      const x = left + (points.length <= 1 ? 0 : point / (points.length - 1) * plotWidth);
      return `${x.toFixed(2)},${y(value).toFixed(2)}`;
    }).join(" ");
    const name = `${report.symbol ?? "unknown"} · ${report.strategyId ?? "unspecified"}`;
    return `<polyline points="${coordinates}" fill="none" stroke="${colorFor(index)}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"><title>${escapeHtml(name)}</title></polyline>`;
  }).join("");
  const baseline = `<line x1="${left}" y1="${y(drawdown ? 0 : 100)}" x2="${width - right}" y2="${y(drawdown ? 0 : 100)}" stroke="#758398" stroke-dasharray="5 5"/>`;
  const label = drawdown ? "Drawdown from equity high (%)" : "Equity index (starting equity = 100)";
  return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${label}"><text x="${left}" y="16" class="axis">${label}</text>${grid}${baseline}${paths}<text x="${left}" y="${height - 12}" class="axis">Start of tested period</text><text x="${width - right}" y="${height - 12}" text-anchor="end" class="axis">End of tested period</text></svg>`;
}

function renderLegend(reports: readonly RunReport[]): string {
  return reports.map((report, index) => `<span><i style="background:${colorFor(index)}"></i>${escapeHtml(report.symbol ?? "unknown")} · ${escapeHtml(report.strategyId ?? "unspecified")}</span>`).join("");
}

function renderScorecards(reports: readonly RunReport[], audit?: DashboardAuditData): string {
  const runs = audit?.runs ?? [];
  const decisions = runs.flatMap((run) => run.decisions);
  const aiCalls = runs.flatMap((run) => run.aiModelCalls);
  const fills = runs.flatMap((run) => run.orders.flatMap((order) => order.fills));
  const recordedRunCount = audit?.totalRuns ?? runs.length;
  const metrics: Array<[string, string]> = [
    ["Portfolios", String(reports.length)],
    ["Run records", String(recordedRunCount)],
    ["Decisions in audit window", String(decisions.length)],
    ["Fills in audit window", String(fills.length)],
    ["Recorded model steps", String(aiCalls.length)],
  ];
  return `<section class="overview" id="overview" tabindex="-1" data-component="summary" aria-label="Run summary"><dl>${metrics.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl></section>`;
}

function renderComparison(reports: readonly RunReport[]): string {
  const ranked = compareRuns(reports);
  const rows = ranked.map((row) => {
    const pnlClass = Number(row.netPnl) > 0 ? "positive" : Number(row.netPnl) < 0 ? "negative" : "neutral";
    const reliability = row.executionReliabilityPct === null ? "Not exercised" : `${cell(row.executionReliabilityPct)}%`;
    return `<tr>
      <td><strong>${cell(row.symbol)}</strong><span class="secondary">${cell(row.strategyId)} · ${cell(row.mode)}</span></td>
      <td><strong>${cell(row.finalEquity)} ${cell(row.quoteCurrency)}</strong><span class="secondary">from ${cell(row.initialEquity)}</span></td>
      <td class="${pnlClass}"><strong>${cell(row.netPnl)} ${cell(row.quoteCurrency)}</strong><span class="secondary">${cell(row.netReturnPct)}%</span></td>
      <td>${cell(row.maxDrawdownPct)}%</td><td>${cell(row.tradeCount)}</td><td>${reliability}</td>
      <td><details data-state-key="metrics:${cell(row.runId)}"><summary>More metrics</summary><dl class="compact-metrics">
        <div><dt>Buy &amp; hold</dt><dd>${row.buyAndHoldReturnPct === null ? "—" : `${cell(row.buyAndHoldReturnPct)}%`}</dd></div>
        <div><dt>Excess return</dt><dd>${row.excessReturnPct === null ? "—" : `${cell(row.excessReturnPct)}%`}</dd></div>
        <div><dt>Volume</dt><dd>${cell(row.volume)} ${cell(row.quoteCurrency)}</dd></div>
        <div><dt>Average fill size</dt><dd>${cell(row.averageTradeSize)} ${cell(row.quoteCurrency)}</dd></div>
        <div><dt>Fees</dt><dd>${cell(row.fees)}</dd></div>
        <div><dt>Estimated slippage impact</dt><dd>${cell(row.slippage)} ${cell(row.quoteCurrency)}</dd></div>
      </dl></details></td>
    </tr>`;
  }).join("");
  return `<section class="panel" tabindex="-1"><h2>Performance comparison</h2>${rows ? `<div class="table-wrap" data-focus-key="performance-comparison" tabindex="0" role="region" aria-label="Performance comparison table; scroll horizontally for more columns"><table><thead><tr><th>Portfolio</th><th>Current equity</th><th>Net P&amp;L</th><th>Max drawdown</th><th>Fills</th><th>Execution reliability</th><th>Details</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty">No completed reports are available.</div>`}<p class="muted">Execution reliability is shown only when an order proposal reached the execution path. “Not exercised” means this run did not test order execution.</p></section>`;
}

function renderAiCalls(calls: RunAuditDetails["aiModelCalls"], runId: string): string {
  if (calls.length === 0) return `<p class="empty">No model-call telemetry was recorded for this run.</p>`;
  const rows = calls.map((call) => `<tr>
    <td>${cell(call.stepNumber)}</td><td>${cell(call.role)}<br><span class="muted">${cell(call.operation)}</span></td>
    <td>${cell(call.provider)} / ${cell(call.modelId)}</td><td><span class="badge ${call.status === "completed" ? "ok" : "bad"}">${cell(call.status)}</span></td>
    <td>${cell(call.inputTokens)} / ${cell(call.outputTokens)} / ${cell(call.reasoningTokens)} / ${cell(call.totalTokens)}</td>
    <td>${Math.max(0, call.endedAt - call.startedAt)} ms</td><td>${cell(call.finishReason)}</td><td>${cell(call.toolNames.join(", ") || "none")}</td>
    <td>${call.errorMessage || call.warnings.length ? `<details data-state-key="ai-call:${cell(call.id)}:error"><summary>View</summary><pre>${escapeHtml(jsonText({ error: call.errorMessage, errorName: call.errorName, warnings: call.warnings }))}</pre></details>` : "—"}</td>
  </tr>`).join("");
  return `<div class="table-wrap" data-focus-key="ai-activity:${cell(runId)}" tabindex="0" role="region" aria-label="AI model activity table; scroll horizontally for more columns"><table><thead><tr><th>Step</th><th>Agent role</th><th>Provider / model</th><th>Status</th><th>Input / output / reasoning / total tokens</th><th>Duration</th><th>Finish</th><th>Read-only tools</th><th>Warnings / error</th></tr></thead><tbody>${rows}</tbody></table></div><p class="muted">Token counts are provider-reported. Dollar cost is not estimated because provider price schedules are not configured; check the provider account for billed usage.</p>`;
}

function renderDecision(decision: RunAuditDetails["decisions"][number], open = false): string {
  const riskReasons = decision.risk.reasons.length ? decision.risk.reasons.map((reason) => `<li>${cell(reason)}</li>`).join("") : `<li>No rejection reasons recorded.</li>`;
  const findings = decision.findings.map((finding) => `<article class="finding"><strong>${cell(finding.role)}</strong><span>${(finding.confidence * 100).toFixed(1)}% confidence · evidence ${cell(finding.evidenceIds.join(", ") || "none")}</span><p>${cell(finding.summary)}</p></article>`).join("");
  const evidence = decision.evidence.map((item) => `<tr><td>${cell(item.id)}</td><td>${cell(item.source)}</td><td>${cell(item.confidence)}</td><td>${dateTime(item.observedAt)}</td><td>${cell(item.summary)}</td></tr>`).join("");
  const order = decision.proposal.order;
  return `<details class="decision" data-state-key="decision:${cell(decision.id)}"${open ? " open" : ""}><summary><time>${dateTime(decision.decidedAt)}</time> · ${cell(decision.symbol)} · <b>${cell(decision.proposal.action)}</b> · ${(decision.proposal.confidence * 100).toFixed(1)}% confidence · risk ${decision.risk.approved ? "approved" : "not approved"}</summary>
    <div class="decision-grid"><div><h4>Proposal and rationale</h4><p><b>${cell(decision.proposal.action)}</b> · ${cell(order ? `${order.side} ${order.quantity} ${decision.symbol} ${order.type}${order.price ? ` @ ${order.price}` : ""}` : "No order")}</p><p>${cell(decision.proposal.rationale)}</p><p class="muted">Cited proposal evidence: ${cell(decision.proposal.evidenceIds.join(", ") || "none")}</p></div>
    <div><h4>Market quote</h4><p>${cell(decision.quote.price)} ${cell(decision.symbol)} · ${cell(decision.quote.source)}</p><p class="muted">Observed ${dateTime(decision.quote.observedAt)}</p><h4>Risk gate</h4><span class="badge ${decision.risk.approved ? "ok" : "bad"}">${decision.risk.approved ? "approved" : "rejected / no order"}</span><ul>${riskReasons}</ul></div></div>
    <details class="findings-detail" data-state-key="decision:${cell(decision.id)}:debate"><summary>Agent debate and reviews (${decision.findings.length})</summary><div class="findings">${findings || `<p class="empty">No agent findings stored.</p>`}</div></details>
    <details data-state-key="decision:${cell(decision.id)}:evidence"><summary>Evidence cited and available (${decision.evidence.length})</summary><div class="table-wrap" data-focus-key="evidence:${cell(decision.id)}" tabindex="0" role="region" aria-label="Cited evidence table; scroll horizontally for more columns"><table><thead><tr><th>ID</th><th>Source</th><th>Confidence</th><th>Observed</th><th>Summary</th></tr></thead><tbody>${evidence || `<tr><td colspan="5">No evidence stored.</td></tr>`}</tbody></table></div></details>
  </details>`;
}

function renderOrders(run: RunAuditDetails): string {
  const rows = run.orders.flatMap((order) => order.fills.map((fill) => `<tr><td>${dateTime(fill.timestamp)}</td><td>${cell(order.state)}</td><td>${cell(fill.symbol)}</td><td>${cell(fill.side)}</td><td>${cell(fill.quantity)}</td><td>${cell(fill.price)}</td><td>${cell(fill.fee)} ${cell(fill.feeAsset)}</td><td>${cell(order.clientOrderId)}</td></tr>`)).join("");
  const intents = run.orders.map((order) => `<details data-state-key="order:${cell(order.clientOrderId)}"><summary>${cell(order.state)} · ${cell(order.order.side)} ${cell(order.order.quantity)} ${cell(order.order.symbol)} · intent ${cell(order.clientOrderId)}</summary><pre>${escapeHtml(jsonText({ requested: order.order, exchangeOrder: order.exchangeOrder, fills: order.fills }))}</pre></details>`).join("");
  const emptyMessage = run.orders.length > 0 ? "Order intents were recorded, but none produced a fill." : "No order intent or simulated/recorded fill was created for this run.";
  return `${rows ? `<div class="table-wrap" data-focus-key="order-fills:${cell(String(run.run.id))}" tabindex="0" role="region" aria-label="Order fills table; scroll horizontally for more columns"><table><thead><tr><th>Fill time</th><th>Order state</th><th>Pair</th><th>Side</th><th>Quantity</th><th>Price</th><th>Fee</th><th>Client order ID</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="empty">${emptyMessage}</p>`}${intents}`;
}

function renderSources(run: RunAuditDetails): string {
  const rows = run.sourceSnapshots.map((snapshot) => {
    let summary = snapshot.payload;
    if (Array.isArray(snapshot.payload) && snapshot.category === "candles") {
      const candles = snapshot.payload as Array<{ timestamp?: number; close?: string; complete?: boolean }>;
      summary = { barCount: candles.length, completedBars: candles.filter((candle) => candle.complete).length,
        firstTimestamp: candles[0]?.timestamp, latestTimestamp: candles.at(-1)?.timestamp, latestClose: candles.at(-1)?.close };
    }
    return `<tr><td>${cell(snapshot.category)}</td><td>${cell(snapshot.source)}</td><td>${cell(snapshot.symbol)}</td><td>${dateTime(snapshot.observedAt)}</td><td><details data-state-key="source:${cell(snapshot.id)}"><summary>Inspect snapshot</summary><pre>${escapeHtml(jsonText(summary))}</pre></details></td></tr>`;
  }).join("");
  return rows ? `<div class="table-wrap" data-focus-key="source-snapshots:${cell(String(run.run.id))}" tabindex="0" role="region" aria-label="Source snapshots table; scroll horizontally for more columns"><table><thead><tr><th>Category</th><th>Source</th><th>Pair</th><th>Observed</th><th>Recorded evidence</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="empty">No source snapshots recorded.</p>`;
}

function renderMemory(run: RunAuditDetails): string {
  const rows = run.decisionMemories.map((memory) => `<tr><td>${cell(memory.symbol)}</td><td>${cell(memory.action)}</td><td>${cell(memory.status)}</td><td>${dateTime(memory.decidedAt)}</td><td>${dateTime(memory.dueAt)}</td><td>${cell(memory.rawReturn === null ? "pending" : `${(Number(memory.rawReturn) * 100).toFixed(2)}%`)}</td><td>${cell(memory.benchmarkReturn === null ? "pending" : `${(Number(memory.benchmarkReturn) * 100).toFixed(2)}%`)}</td><td>${cell(memory.alphaReturn === null ? "pending" : `${(Number(memory.alphaReturn) * 100).toFixed(2)}%`)}</td><td>${cell(memory.reflection)}</td></tr>`).join("");
  return rows ? `<div class="table-wrap" data-focus-key="decision-memory:${cell(String(run.run.id))}" tabindex="0" role="region" aria-label="Decision memory table; scroll horizontally for more columns"><table><thead><tr><th>Pair</th><th>Action</th><th>Status</th><th>Decision</th><th>Evaluation due</th><th>Raw return</th><th>Benchmark</th><th>Alpha</th><th>Reflection / lesson</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p class="empty">No decision-memory evaluations are attached to this run.</p>`;
}

function renderPortfolioHistory(run: RunAuditDetails): string {
  const rows = run.portfolioHistory.map((snapshot) => {
    const marketValue = snapshot.positions.reduce((sum, position) => sum.plus(new Decimal(position.quantity).mul(position.markPrice ?? position.averageEntryPrice)), new Decimal(0));
    const unrealized = snapshot.positions.reduce((sum, position) => sum.plus(new Decimal(position.quantity).mul(new Decimal(position.markPrice ?? position.averageEntryPrice).minus(position.averageEntryPrice))), new Decimal(0));
    const positions = snapshot.positions.map((position) => `${position.symbol} ${position.quantity} @ ${position.averageEntryPrice} (mark ${position.markPrice ?? position.averageEntryPrice})`).join("; ") || "flat";
    return `<tr><td>${dateTime(snapshot.timestamp)}</td><td>${cell(snapshot.equity)} ${cell(snapshot.quoteCurrency)}</td><td>${cell(snapshot.cash)} ${cell(snapshot.quoteCurrency)}</td><td>${marketValue.toString()} ${cell(snapshot.quoteCurrency)}</td><td>${unrealized.toString()} ${cell(snapshot.quoteCurrency)}</td><td>${cell(snapshot.realizedPnlToday)} ${cell(snapshot.quoteCurrency)}</td><td>${cell(snapshot.highWatermark)} ${cell(snapshot.quoteCurrency)}</td><td>${cell(positions)}</td></tr>`;
  }).join("");
  return rows ? `<div class="table-wrap" data-focus-key="portfolio-history:${cell(String(run.run.id))}" tabindex="0" role="region" aria-label="Portfolio history table; scroll horizontally for more columns"><table><thead><tr><th>Observed</th><th>Equity</th><th>Cash</th><th>Position value</th><th>Unrealized P&amp;L</th><th>Realized today</th><th>High watermark</th><th>Positions</th></tr></thead><tbody>${rows}</tbody></table></div><p class="muted">Unrealized P&amp;L uses the last mark versus average cost including quote-denominated entry fees; it excludes future exit fees. Equity includes recorded cash and marked positions.</p>` : `<p class="empty">No portfolio snapshots recorded.</p>`;
}

function renderAuditRun(run: RunAuditDetails, index: number): string {
  const metadata = run.run;
  const report = metadata.report as RunReport | null;
  const config = metadata.config;
  const decisions = run.decisions.map((decision, decisionIndex) =>
    renderDecision(decision, index === 0 && decisionIndex === run.decisions.length - 1)).join("");
  const riskRows = run.riskOutcomes.map((outcome) => `<tr><td>${dateTime(outcome.checkedAt)}</td><td>${cell(outcome.decisionId)}</td><td><span class="badge ${outcome.approved ? "ok" : "bad"}">${outcome.approved ? "approved" : "rejected"}</span></td><td>${cell(outcome.reasons.join("; ") || "none")}</td></tr>`).join("");
  const runId = String(metadata.id ?? "unknown");
  const status = String(metadata.status ?? "unknown");
  const mode = String(metadata.mode ?? "unknown");
  const failureName = typeof metadata.failureName === "string" ? metadata.failureName : null;
  const failureMessage = typeof metadata.failureMessage === "string" ? metadata.failureMessage : null;
  const lastDecision = run.decisions.at(-1);
  const fillCount = run.orders.reduce((sum, order) => sum + order.fills.length, 0);
  const outcome = status === "failed" ? `${failureName ?? "failed"}${failureMessage ? `: ${failureMessage.slice(0, 100)}` : " · cause not recorded"}`
    : status !== "completed" ? status
    : fillCount > 0 ? `${fillCount} fill${fillCount === 1 ? "" : "s"}`
      : lastDecision?.proposal.order ? (lastDecision.risk.approved ? "order proposed · no fill" : "order blocked")
        : lastDecision ? `${lastDecision.proposal.action} · no order proposed` : "no decision recorded";
  const identity = report ? `${report.symbol ?? "unknown"} · ${report.strategyId ?? "unspecified"}` : String(lastDecision?.symbol ?? "unknown pair");
  const sourceCategories = new Set(run.sourceSnapshots.map((snapshot) => snapshot.category.toLowerCase()));
  const contextualEvidence = [...sourceCategories].some((category) => !["candles", "indicators", "market_quote", "ticker", "depth", "orderbook", "wallex_market_policy"].includes(category));
  const coverage = run.sourceSnapshots.length === 0 ? "no source snapshots"
    : contextualEvidence ? `${run.sourceSnapshots.length} source snapshots` : "market-only evidence";
  const summary = `${dateTime(Number(metadata.startedAt))} · ${identity} · ${outcome} · ${coverage}`;
  const failureBlock = status === "failed"
    ? `<details class="subpanel" open><summary>Failure details</summary><p>${failureMessage ? cell(failureMessage) : "This older failure has no persisted cause. The original process output may contain the reason."}</p></details>`
    : "";
  return `<details class="run-audit" data-state-key="run:${cell(runId)}"${index === 0 ? " open" : ""}><summary>${escapeHtml(summary)} <span class="muted">run ${escapeHtml(runId)}</span></summary>
    ${failureBlock}
    <details class="subpanel" data-state-key="run:${cell(runId)}:configuration"><summary>Configuration and assumptions</summary><pre>${escapeHtml(jsonText({ config, report: report ? {
      startedAt: report.startedAt, endedAt: report.endedAt, initialEquity: report.initialEquity, finalEquity: report.finalEquity,
      netReturnPct: report.netReturnPct, maxDrawdownPct: report.maxDrawdownPct, tradeCount: report.tradeCount,
      acceptedProposals: report.acceptedProposals, volume: report.volume, averageTradeSize: report.averageTradeSize,
      fees: report.fees, slippage: report.slippage, assumptions: report.assumptions,
    } : null }))}</pre></details>
    <details class="subpanel" data-state-key="run:${cell(runId)}:ai"><summary>AI model activity (${run.aiModelCalls.length} recorded steps)</summary>${run.aiModelCalls.length === 0 && run.decisions.length > 0 ? `<p class="muted">No model-call telemetry is stored for this decision. The decision and agent findings remain available below.</p>` : ""}${renderAiCalls(run.aiModelCalls, runId)}</details>
    <section class="subpanel"><h3>Decisions and multi-agent debate (${run.decisions.length})</h3>${decisions || `<p class="empty">No decision was recorded for this run.</p>`}</section>
    <details class="subpanel" data-state-key="run:${cell(runId)}:risk"><summary>Risk checks (${run.riskOutcomes.length})</summary>${riskRows ? `<div class="table-wrap" data-focus-key="risk-checks:${cell(runId)}" tabindex="0" role="region" aria-label="Risk checks table; scroll horizontally for more columns"><table><thead><tr><th>Checked</th><th>Decision ID</th><th>Result</th><th>Reasons</th></tr></thead><tbody>${riskRows}</tbody></table></div>` : `<p class="empty">No risk checks recorded.</p>`}</details>
    <details class="subpanel" data-state-key="run:${cell(runId)}:orders"><summary>Orders and fills (${fillCount})</summary>${renderOrders(run)}</details>
    <details class="subpanel" data-state-key="run:${cell(runId)}:portfolio"><summary>Portfolio state (${run.portfolioHistory.length} snapshots)</summary>${renderPortfolioHistory(run)}</details>
    <details class="subpanel" data-state-key="run:${cell(runId)}:sources"><summary>Research and source snapshots (${run.sourceSnapshots.length})</summary>${renderSources(run)}</details>
    <details class="subpanel" data-state-key="run:${cell(runId)}:memory"><summary>Memory and outcome evaluations (${run.decisionMemories.length})</summary>${renderMemory(run)}</details>
  </details>`;
}

function renderAudit(audit?: DashboardAuditData): string {
  if (!audit || audit.runs.length === 0) return `<section class="panel" id="audit" tabindex="-1" data-component="audit"><h2>Decision and AI audit trail</h2><p class="empty">No per-run audit data was supplied for this report.</p></section>`;
  const omitted = Math.max(0, (audit.totalRuns ?? audit.runs.length) - audit.runs.length);
  const runs = [...audit.runs].sort((a, b) => Number(a.run.startedAt) - Number(b.run.startedAt));
  const completed = runs.filter((run) => run.run.status === "completed").length;
  const failed = runs.filter((run) => run.run.status === "failed").length;
  const running = runs.filter((run) => run.run.status === "running").length;
  const omittedText = omitted === 1 ? "1 matching record is outside this HTML audit window" : `${omitted} matching records are outside this HTML audit window`;
  return `<section class="panel" id="audit" tabindex="-1" data-component="audit"><h2>Run audit</h2><p class="muted">${completed} completed · ${failed} failed · ${running} still running in this window. Showing ${runs.length} detailed records${omitted ? `; ${omittedText}` : ""}. Full audit data remains in SQLite; use <code>report &lt;run-id&gt; --html</code> for a single run.</p>${runs.map((run, index) => renderAuditRun(run, index === runs.length - 1 ? 0 : index + 1)).join("")}</section>`;
}

const liveDashboardScript = `
(() => {
  const root = document.querySelector("#report-content");
  const statusLabel = document.querySelector("#engine-connection");
  const connectionLabel = document.querySelector("#connection-status");
  const updatedLabel = document.querySelector("#last-updated");
  const retryButton = document.querySelector("#retry-dashboard");
  let disconnectTimer;
  let events;
  const state = { instanceId: root?.dataset.dashboardInstance ?? "", revision: Number(root?.dataset.dashboardRevision ?? 0), engine: "starting", connection: "connecting", refreshPending: 0, refreshing: false };
  const navLinks = [...document.querySelectorAll(".sidebar nav a")];

  const setNavigation = () => {
    const activeHash = location.hash || "#overview";
    for (const link of navLinks) {
      if (link.hash === activeHash) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    }
  };
  const setConnection = (connection) => {
    state.connection = connection;
    const labels = { connecting: "Connecting", connected: "Connected", reconnecting: "Reconnecting", stopped: "Stopped", error: "Update error" };
    connectionLabel.textContent = labels[connection] ?? connection;
    statusLabel.dataset.connection = connection;
    if (retryButton) retryButton.hidden = connection !== "error";
    updateAnnouncement();
  };
  const setEngineStatus = (status) => {
    state.engine = status.state;
    const labels = { starting: "Starting", connecting: "Connecting to Wallex", evaluating: "Evaluating", waiting: "Waiting for next cycle", stopping: "Stopping", stopped: "Stopped", failed: "Failed" };
    statusLabel.querySelector("#engine-state-label").textContent = labels[status.state] ?? status.state;
    statusLabel.querySelector("#engine-message").textContent = status.message;
    if (status.state === "stopped" || status.state === "failed") setConnection("stopped");
    updateAnnouncement();
  };
  const updateAnnouncement = () => {
    statusLabel.setAttribute("aria-label", "Engine " + statusLabel.querySelector("#engine-state-label").textContent + ". " + connectionLabel.textContent + ". " + statusLabel.querySelector("#engine-message").textContent);
  };
  const keyForDetails = (detail) => {
    if (detail.dataset.stateKey) return detail.dataset.stateKey;
    const summary = detail.querySelector(":scope > summary")?.textContent.trim().replace(/\\s+/g, " ").replace(/\\s+\\(\\d+[^)]*\\)$/, "") ?? "section";
    const parent = detail.parentElement?.closest("details");
    const parentKey = parent ? keyForDetails(parent) : "report";
    const siblings = [...detail.parentElement.children].filter((child) => child.tagName === "DETAILS");
    return parentKey + "/" + summary + "#" + siblings.indexOf(detail);
  };
  const restoreInteractiveState = (oldRoot, newRoot) => {
    const expanded = new Map([...oldRoot.querySelectorAll("details")].map((detail) => [keyForDetails(detail), detail.open]));
    for (const detail of newRoot.querySelectorAll("details")) {
      const key = keyForDetails(detail);
      if (expanded.has(key)) detail.open = expanded.get(key);
    }
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !oldRoot.contains(active)) return null;
    if (active.dataset.focusKey) return { type: "element", value: active.dataset.focusKey };
    return active.matches("summary") ? { type: "summary", value: keyForDetails(active.closest("details")) } : null;
  };
  const refreshSnapshot = async () => {
    if (state.refreshing || state.refreshPending <= state.revision) return;
    state.refreshing = true;
    let applied = false;
    try {
      const response = await fetch("/api/dashboard", { cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("Dashboard refresh returned " + response.status + ".");
      const payload = await response.json();
      const parsed = new DOMParser().parseFromString(payload.html, "text/html");
      const nextRoot = parsed.querySelector("#report-content");
      if (!nextRoot || !root) throw new Error("The refreshed report content was not found.");
      root.setAttribute("aria-busy", "true");
      const focusedKey = restoreInteractiveState(root, nextRoot);
      const currentComponents = new Map([...root.querySelectorAll(":scope > [data-component]")].map((element) => [element.dataset.component, element]));
      for (const incoming of nextRoot.querySelectorAll(":scope > [data-component]")) {
        const current = currentComponents.get(incoming.dataset.component);
        if (current) current.replaceWith(document.importNode(incoming, true));
      }
      if (focusedKey) {
        const target = focusedKey.type === "element"
          ? [...root.querySelectorAll("[data-focus-key]")].find((element) => element.dataset.focusKey === focusedKey.value)
          : [...root.querySelectorAll("details")].find((detail) => keyForDetails(detail) === focusedKey.value)?.querySelector(":scope > summary");
        target?.focus({ preventScroll: true });
      }
      root.dataset.dashboardRevision = String(payload.revision);
      root.dataset.dashboardInstance = payload.instanceId;
      state.instanceId = payload.instanceId;
      state.revision = payload.revision;
      state.refreshPending = payload.revision;
      applied = true;
      updatedLabel.textContent = "Last report update: " + new Date().toLocaleTimeString();
      setEngineStatus(payload.status);
      if (state.connection === "error") setConnection("connected");
      root.setAttribute("aria-busy", "false");
      setNavigation();
    } catch (error) {
      setConnection("error");
      statusLabel.querySelector("#engine-message").textContent = error instanceof Error ? error.message : "Could not refresh the report.";
      root?.setAttribute("aria-busy", "false");
      window.setTimeout(() => void refreshSnapshot(), 3_000);
    } finally {
      state.refreshing = false;
      if (applied && state.refreshPending > state.revision) void refreshSnapshot();
    }
  };

  window.addEventListener("hashchange", setNavigation);
  setNavigation();
  const connect = () => {
    window.clearTimeout(disconnectTimer);
    events?.close();
    setConnection("connecting");
    const source = new EventSource("/events");
    events = source;
    source.onopen = () => {
      if (events !== source) return;
      window.clearTimeout(disconnectTimer);
      setConnection("connected");
    };
    source.onerror = () => {
      if (events !== source) return;
      if (state.engine !== "stopped" && state.engine !== "failed") {
        setConnection("reconnecting");
        window.clearTimeout(disconnectTimer);
        disconnectTimer = window.setTimeout(() => {
          if (state.connection === "reconnecting") {
            setConnection("error");
            statusLabel.querySelector("#engine-message").textContent = "The engine connection is unavailable; showing the last saved report.";
            updateAnnouncement();
          }
        }, 12_000);
      }
    };
    source.addEventListener("status", (event) => {
      if (events !== source) return;
      const status = JSON.parse(event.data);
      setEngineStatus(status);
      if (status.state === "stopped" || status.state === "failed") {
        source.close();
        setConnection("stopped");
      }
    });
    source.addEventListener("snapshot", (event) => {
      if (events !== source) return;
      const message = JSON.parse(event.data);
      if (message.instanceId !== state.instanceId) {
        state.instanceId = message.instanceId;
        state.revision = -1;
      }
      state.refreshPending = Math.max(state.refreshPending, message.revision);
      void refreshSnapshot();
    });
  };
  retryButton?.addEventListener("click", connect);
  connect();
})();`;

const offlineNavigationScript = `<script>(() => {
  const links = [...document.querySelectorAll(".sidebar nav a")];
  const updateCurrentLink = () => {
    const activeHash = location.hash || "#overview";
    for (const link of links) {
      if (link.hash === activeHash) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    }
  };
  window.addEventListener("hashchange", updateCurrentLink);
  updateCurrentLink();
})();</script>`;

export function renderBenchmarkHtml(
  reports: readonly RunReport[],
  title = "Trading strategy benchmark",
  refreshSeconds?: number,
  audit?: DashboardAuditData,
  liveDashboard = false,
): string {
  const assumptions = reports.map((report) => `<details data-state-key="assumption:${cell(report.runId)}"><summary>${escapeHtml(report.symbol ?? "unknown")} / ${escapeHtml(report.strategyId ?? "unspecified")} — net ${cell(report.netReturnPct)}%</summary><ul>${report.assumptions.map((assumption) => `<li>${escapeHtml(assumption)}</li>`).join("")}</ul></details>`).join("");
  const refresh = refreshSeconds !== undefined && Number.isInteger(refreshSeconds) && refreshSeconds > 0
    ? `<meta http-equiv="refresh" content="${refreshSeconds}">` : "";
  const lastUpdated = reports.length > 0 ? dateTime(Math.max(...reports.map((report) => report.endedAt))) : "—";
  const refreshNote = refreshSeconds !== undefined && Number.isInteger(refreshSeconds) && refreshSeconds > 0
    ? ` · refreshes every ${refreshSeconds} seconds while the shadow watcher runs` : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${refresh}<title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:dark;--bg:#0b1118;--surface:#111a24;--surface-raised:#151f2a;--line:#2b3948;--text:#edf2f7;--muted:#b0bdca;--accent:#79ddb5;--positive:#91e2bb;--negative:#ff9a9a;--warning:#f2ca7b;--focus:#f2ca7b}*{box-sizing:border-box}html{scrollbar-color:#526170 var(--bg);scrollbar-width:thin}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.55 system-ui,"Segoe UI",sans-serif}::selection{background:#79ddb555;color:var(--text)}main{max-width:1320px;margin:0 auto;padding:28px 34px 56px}h1{font-size:27px;line-height:1.2;margin:0 0 7px;font-weight:650;letter-spacing:-.02em}h2{font-size:18px;line-height:1.3;margin:0 0 12px;font-weight:620}h3{font-size:15px;margin:0 0 8px;font-weight:600}h4{font-size:14px;margin:10px 0 4px}p{max-width:75ch}.muted,.secondary{color:var(--muted)}.muted{font-size:12px}.panel{padding:22px 0;margin-top:24px;border-top:1px solid var(--line)}.subpanel{padding:13px 0;margin-top:8px;border-top:1px solid var(--line)}.overview{margin-top:20px;padding:14px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}.overview dl{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:16px;margin:0}.overview dt,.compact-metrics dt{font-size:12px;color:var(--muted)}.overview dd{margin:3px 0 0;font-size:21px;font-variant-numeric:tabular-nums;font-weight:600}.charts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px}svg{display:block;width:100%;height:auto;background:var(--surface);border-radius:8px}.grid{stroke:#304050;stroke-width:1}.axis{fill:#b0bdca;font:12px system-ui}.legend{display:flex;flex-wrap:wrap;gap:8px 18px;margin-top:9px;color:var(--muted);font-size:12px}.legend span{display:flex;align-items:center;gap:7px}.legend i{width:9px;height:9px;border-radius:50%}table{border-collapse:collapse;width:100%;min-width:780px;font-variant-numeric:tabular-nums}th,td{padding:10px 11px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{color:var(--muted);font-size:12px;font-weight:550;white-space:nowrap}.table-wrap{overflow:auto}td strong{display:block;font-weight:600}td .secondary{display:block;font-size:12px;margin-top:2px}details{padding:9px 0;border-top:1px solid var(--line)}summary{cursor:pointer;color:var(--accent);text-underline-offset:3px}summary:hover{text-decoration:underline}summary:focus-visible{outline:2px solid var(--focus);outline-offset:3px;border-radius:3px}.overview summary{border:0}.run-audit{margin-top:12px}.run-audit>summary{padding:12px 0;color:var(--text);font-size:14px;font-weight:600}.decision{margin:8px 0}.decision>summary{padding:8px 0;color:var(--text)}.decision-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.findings{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 24px}.finding{padding:11px 0;border-top:1px solid var(--line)}.finding strong{font-weight:600}.finding span{display:block;color:var(--muted);font-size:12px}.finding p{margin:6px 0 0}.badge{display:inline-block;border-radius:4px;padding:2px 7px;font-size:12px}.ok{color:#061910;background:#9be7c1}.bad{color:#310909;background:#ffb2ae}.positive{color:var(--positive)}.negative{color:var(--negative)}.neutral{color:var(--text)}.compact-metrics{display:grid;grid-template-columns:repeat(2,minmax(180px,1fr));gap:9px 20px;margin:12px 0 4px}.compact-metrics dd{margin:2px 0 0;font-variant-numeric:tabular-nums}.empty{color:var(--muted);padding:12px 0}pre{max-height:440px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;background:#0a1119;border:1px solid var(--line);border-radius:6px;padding:12px;color:#d5dfe8;font-size:12px}li{margin:3px 0}code{font:12px ui-monospace,Consolas,monospace;color:#d5dfe8}@media(max-width:760px){main{padding:20px 16px 40px}.overview dl{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.overview dd{font-size:18px}.charts,.decision-grid,.findings{grid-template-columns:1fr}.panel{margin-top:20px}.compact-metrics{grid-template-columns:1fr 1fr}}@media(max-width:420px){.compact-metrics{grid-template-columns:1fr}h1{font-size:24px}}
.skip-link{position:fixed;z-index:5;left:12px;top:12px;padding:9px 13px;background:var(--text);color:var(--bg);transform:translateY(-160%);border-radius:4px}.skip-link:focus{transform:translateY(0)}
.app-shell{display:grid;grid-template-columns:224px minmax(0,1fr);min-height:100vh}.sidebar{position:sticky;top:0;align-self:start;height:100vh;overflow-y:auto;display:flex;flex-direction:column;gap:22px;padding:22px 16px;border-right:1px solid var(--line);background:var(--bg)}.brand{color:var(--text);text-decoration:none;font-size:15px;font-weight:650;letter-spacing:-.02em;padding:5px 8px}.sidebar nav{display:grid;gap:4px}.sidebar nav a{display:flex;align-items:center;min-height:44px;padding:8px 10px;border-radius:4px;color:var(--muted);text-decoration:none}.sidebar nav a:hover,.sidebar nav a[aria-current="location"]{color:var(--text);background:var(--surface)}.sidebar nav a[aria-current="location"]{box-shadow:inset 2px 0 var(--accent)}.sidebar a:focus-visible,.skip-link:focus-visible,.table-wrap:focus-visible,.connection button:focus-visible{outline:2px solid var(--focus);outline-offset:3px}.connection{margin-top:auto;padding:12px 8px;border-top:1px solid var(--line);font-size:12px}.connection strong,.connection span{display:block}.connection strong{font-size:13px}.connection .muted{margin-top:3px}.connection button{min-height:44px;margin-top:8px;padding:6px 10px;border:1px solid var(--line);border-radius:4px;background:var(--surface);color:var(--text);font:inherit;cursor:pointer}.connection button:hover{border-color:var(--accent)}.connection button[hidden]{display:none}.main-column{min-width:0}.main-column main#report-content{max-width:1320px;margin:0 auto;padding:28px 34px 56px}#report-content[aria-busy="true"]{cursor:progress}#report-content [tabindex="-1"]:focus{outline:2px solid var(--focus);outline-offset:4px}#report-content [id]{scroll-margin-top:16px}.table-wrap:focus-visible{border-radius:3px}summary{display:flex;align-items:center;min-height:44px}.updated-line{margin:0 0 16px;color:var(--muted);font-size:12px}.offline-label{font-size:12px;color:var(--muted)}
@media(max-width:760px){.app-shell{display:block}.sidebar{height:auto;gap:9px;padding:10px 14px;border-right:0;border-bottom:1px solid var(--line)}.sidebar nav{display:flex;gap:3px;overflow-x:auto;scrollbar-width:thin}.sidebar nav a{flex:0 0 auto;min-height:44px;padding:8px 12px;white-space:nowrap}.sidebar nav a[aria-current="location"]{box-shadow:inset 0 -2px var(--accent)}.connection{display:flex;align-items:baseline;gap:8px;margin:0;padding:5px 8px 0;border-top:0}.connection>div{flex:1 1 100%;min-width:0}.connection strong,.connection span{display:inline}.connection .muted{margin:0}.connection button{margin:0 0 0 auto}.main-column main#report-content{padding:20px 16px 40px}#report-content [id]{scroll-margin-top:148px}}
@media(max-width:420px){.brand{font-size:14px}.connection{font-size:11px;flex-wrap:wrap}.main-column main#report-content{padding-inline:13px}}
</style></head><body><a class="skip-link" href="#overview">Skip to report content</a><div class="app-shell">
<aside class="sidebar" aria-label="Report navigation"><a class="brand" href="#overview">Trex · Reports</a><nav aria-label="Report sections">
<a href="#overview" aria-current="location">Overview</a><a href="#performance">Performance</a><a href="#comparison">Scenarios</a><a href="#assumptions">Assumptions</a><a href="#audit">Run audit</a>
</nav><section class="connection" aria-label="Dashboard status"><div id="engine-connection" role="status" aria-live="polite" aria-atomic="true" aria-label="Dashboard status"><strong id="engine-state-label">${liveDashboard ? "Starting" : "Saved report"}</strong><span id="connection-status">${liveDashboard ? "Connecting" : "Offline snapshot"}</span><span id="engine-message" class="muted">${liveDashboard ? "Connecting to the local shadow engine." : "This standalone report is not connected to a running engine."}</span><span id="last-updated" class="muted">Updated ${escapeHtml(lastUpdated)}</span></div>${liveDashboard ? `<button id="retry-dashboard" type="button" hidden>Reconnect dashboard</button>` : ""}</section></aside>
<div class="main-column"><main id="report-content" data-dashboard-revision="0" data-dashboard-instance="__DASHBOARD_INSTANCE__" aria-busy="false"><header data-component="header"><h1>${escapeHtml(title)}</h1><p class="updated-line">${reports.length} portfolio scenario(s) · updated ${escapeHtml(lastUpdated)}${escapeHtml(refreshNote)}. Equity and P&amp;L come from the recorded portfolio; shadow orders are simulated and never reach Wallex.</p></header>
${renderScorecards(reports, audit)}
<section class="panel" id="performance" tabindex="-1" data-component="performance"><h2>Portfolio performance</h2><div class="charts"><div>${renderChart(reports)}<div class="legend">${renderLegend(reports)}</div></div><div>${renderChart(reports, true)}<div class="legend">${renderLegend(reports)}</div></div></div></section>
${renderComparison(reports).replace('<section class="panel" tabindex="-1">', '<section class="panel" id="comparison" tabindex="-1" data-component="comparison">')}
<section class="panel" id="assumptions" tabindex="-1" data-component="assumptions"><h2>Performance assumptions</h2>${assumptions || `<p class="empty">No run assumptions are available.</p>`}</section>
${renderAudit(audit)}
</main><footer class="offline-label">${liveDashboard ? "Read-only local dashboard · orders cannot be submitted from this page." : "Saved HTML snapshot · open a live dashboard with shadow --watch --html."}</footer></div></div>
${liveDashboard ? `<script nonce="__DASHBOARD_NONCE__">${liveDashboardScript}</script>` : offlineNavigationScript}</body></html>`;
}

export async function writeBenchmarkHtml(path: string, reports: readonly RunReport[], title?: string, refreshSeconds?: number, audit?: DashboardAuditData): Promise<string> {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, renderBenchmarkHtml(reports, title, refreshSeconds, audit), "utf8");
  return target;
}
