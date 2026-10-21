import { describe, expect, test } from "bun:test";
import { LiveExecutionCoordinator } from "../packages/engine/src/application/live-execution.ts";
import type { OrderExecutionPort, RunRepository } from "../packages/engine/src/application/ports.ts";
import type { ExchangeOrder, OrderIntent, TradeDecision } from "../packages/engine/src/domain/types.ts";

describe("restart-safe Wallex submission", () => {
  test("reconciles an ambiguous submission without resubmitting its client id", async () => {
    const intents = new Map<string, OrderIntent>();
    const states: string[] = [];
    const repository = {
      saveOrderIntent: (intent: OrderIntent) => intents.set(intent.clientOrderId, intent),
      createOrderIntent: (intent: OrderIntent) => { if (intents.has(intent.clientOrderId)) return false; intents.set(intent.clientOrderId, intent); return true; },
      getPendingOrderIntents: () => [...intents.values()].filter((intent) => intent.state !== "resolved"),
      updateOrderIntent: (id: string, state: OrderIntent["state"]) => {
        const intent = intents.get(id)!; intent.state = state; states.push(state);
      },
      saveFills: () => undefined,
    } as unknown as RunRepository;
    let submitCalls = 0;
    let knownOrder: ExchangeOrder | null = null;
    const exchange: OrderExecutionPort = {
      submitOrder: async () => { submitCalls++; throw new Error("connection reset after request write"); },
      getOrder: async () => knownOrder,
      cancelOrder: async () => null,
      listOpenOrders: async () => [],
    };
    const order = { symbol: "BTCUSDT", side: "BUY" as const, type: "LIMIT" as const, quantity: "1", price: "100" };
    const decision = {
      id: "decision-1", runId: "run-1", symbol: "BTCUSDT", decidedAt: 1, quote: { symbol: "BTCUSDT", price: "100", observedAt: 1, source: "wallex-rest" },
      evidence: [], findings: [], proposal: { action: "BUY", symbol: "BTCUSDT", confidence: 0.8, rationale: "signal", evidenceIds: [], order },
      risk: { approved: true, reasons: [], checkedAt: 1, normalizedOrder: order }, orderClientId: "WA_UNIQUE_1",
    } as TradeDecision;
    const coordinator = new LiveExecutionCoordinator(exchange, repository);
    await expect(coordinator.execute(decision, decision.quote)).rejects.toThrow("will not be resubmitted automatically");
    expect(submitCalls).toBe(1);
    expect(intents.get("WA_UNIQUE_1")?.state).toBe("reconciling");
    await expect(coordinator.execute(decision, decision.quote)).rejects.toThrow("already exists");
    expect(submitCalls).toBe(1);

    knownOrder = { clientOrderId: "WA_UNIQUE_1", symbol: "BTCUSDT", side: "BUY", status: "FILLED", quantity: "1", executedQuantity: "1", averagePrice: "100", fills: [], updatedAt: 2 };
    const recovered = await new LiveExecutionCoordinator(exchange, repository).reconcilePending();
    expect(recovered.resolved).toBe(0);
    expect(recovered.unresolved).toEqual(["WA_UNIQUE_1"]);
    expect(submitCalls).toBe(1);
    expect(intents.get("WA_UNIQUE_1")?.state).toBe("reconciling");
    knownOrder = { ...knownOrder, fills: [{
      id: "fill-1", orderClientId: "WA_UNIQUE_1", symbol: "BTCUSDT", side: "BUY",
      quantity: "1", price: "100", fee: "0.1", feeAsset: "USDT", timestamp: 2,
    }] };
    const completed = await new LiveExecutionCoordinator(exchange, repository).reconcilePending();
    expect(completed.resolved).toBe(1);
    expect(completed.unresolved).toEqual([]);
    expect(intents.get("WA_UNIQUE_1")?.state).toBe("resolved");
    expect(states).toContain("reconciling");
  });

  test("keeps an unrecognized successful response unresolved instead of treating it as terminal", async () => {
    const intent = { clientOrderId: "WA_UNKNOWN_1", runId: "run-1", decisionId: "decision-1", order: { symbol: "BTCUSDT", side: "BUY" as const, type: "LIMIT" as const, quantity: "1", price: "100" }, state: "pending" as const, createdAt: 1 };
    const states: string[] = [];
    const repository = {
      saveOrderIntent: () => undefined,
      createOrderIntent: () => true,
      getPendingOrderIntents: () => [intent],
      updateOrderIntent: (_id: string, state: OrderIntent["state"]) => { states.push(state); },
      saveFills: () => undefined,
    } as unknown as RunRepository;
    const unknownOrder: ExchangeOrder = { clientOrderId: intent.clientOrderId, symbol: "BTCUSDT", side: "BUY", status: "UNKNOWN", quantity: "1", executedQuantity: "0", averagePrice: "0", fills: [], updatedAt: 2 };
    const exchange: OrderExecutionPort = {
      submitOrder: async () => unknownOrder,
      getOrder: async () => unknownOrder,
      cancelOrder: async () => null,
      listOpenOrders: async () => [],
    };
    const decision = {
      id: "decision-1", runId: "run-1", symbol: "BTCUSDT", decidedAt: 1, quote: { symbol: "BTCUSDT", price: "100", observedAt: 1, source: "wallex-rest" },
      evidence: [], findings: [], proposal: { action: "BUY", symbol: "BTCUSDT", confidence: 0.8, rationale: "signal", evidenceIds: [], order: intent.order },
      risk: { approved: true, reasons: [], checkedAt: 1, normalizedOrder: intent.order }, orderClientId: intent.clientOrderId,
    } as TradeDecision;
    const coordinator = new LiveExecutionCoordinator(exchange, repository);
    await coordinator.execute(decision, decision.quote);
    expect(states.at(-1)).toBe("reconciling");
    const recovery = await coordinator.reconcilePending();
    expect(recovery.unresolved).toEqual([intent.clientOrderId]);
    expect(states.at(-1)).toBe("reconciling");
  });
});

