import { describe, expect, test } from "bun:test";
import { AiSdkModelAdapter } from "../packages/engine/src/adapters/ai/model.ts";
import { loadConfig } from "../packages/engine/src/domain/config.ts";
import type { AgentContext } from "../packages/engine/src/application/ports.ts";
import { SqliteRunRepository } from "../packages/engine/src/adapters/persistence/store.ts";
import { resolve } from "node:path";

const context: AgentContext = {
  symbol: "BTCUSDT",
  quote: { symbol: "BTCUSDT", price: "60000", observedAt: 1_000, source: "wallex-rest" },
  candles: [], research: [], priorFindings: [], recentReflections: [],
  portfolio: { quoteCurrency: "USDT", cash: "1000", positions: [], equity: "1000", highWatermark: "1000", realizedPnlToday: "0", observedAt: 1_000 },
};

describe("AI SDK gateway adapters", () => {
  test.each([
    {
      name: "BoxAPI", provider: "boxapi", modelId: "gpt-6-astra", key: "box-test-key",
      expectedUrl: "https://ai.boxapi.ir/ai/v1/chat/completions", expectedModel: "gpt-6-astra",
      env: { AI_PROVIDER: "boxapi", AI_MODEL: "gpt-6-astra", BOXAPI_API_KEY: "box-test-key" },
    },
    {
      name: "Liara", provider: "liara", modelId: "openai/gpt-5", key: "liara-test-key",
      expectedUrl: "https://ai.liara.ir/api/workspace-123/v1/chat/completions", expectedModel: "openai/gpt-5",
      env: { AI_PROVIDER: "liara", AI_MODEL: "openai/gpt-5", LIARA_API_KEY: "liara-test-key", LIARA_WORKSPACE_ID: "workspace-123" },
    },
  ])("routes $name requests through its configured OpenAI-compatible endpoint", async ({ env, expectedUrl, expectedModel, key }) => {
    const requests: Array<{ url: string; authorization: string | null; body: Record<string, unknown> }> = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      const requestBody = typeof init?.body === "string" ? init.body : input instanceof Request ? await input.clone().text() : "{}";
      requests.push({ url, authorization: headers.get("authorization"), body: JSON.parse(requestBody) as Record<string, unknown> });
      return Response.json({ error: { message: "test gateway reached", type: "authentication_error" } }, { status: 401 });
    }) as typeof fetch;

    const model = new AiSdkModelAdapter(loadConfig(env), fetcher);
    await expect(model.propose("portfolio_manager", "Return a safe hold for this adapter test.", context)).rejects.toThrow();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe(expectedUrl);
    expect(requests[0]!.authorization).toBe(`Bearer ${key}`);
    expect(requests[0]!.body.model).toBe(expectedModel);
    expect(requests[0]!.body).not.toHaveProperty("temperature");
    const responseFormat = requests[0]!.body.response_format as {
      json_schema?: { schema?: { properties?: { order?: { anyOf?: Array<{ type?: string; required?: string[] }> } } } };
    };
    const orderObjectSchema = responseFormat.json_schema?.schema?.properties?.order?.anyOf?.find((item) => item.type === "object");
    expect(orderObjectSchema?.required).toContain("price");
  });

  test("normalizes the required nullable wire price back to an omitted market-order price", async () => {
    const fetcher = (async () => Response.json({
      id: "chatcmpl-test",
      object: "chat.completion",
      created: 1,
      model: "gpt-5.6-luna",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: JSON.stringify({
            action: "BUY", symbol: "BTCUSDT", confidence: 0.8, rationale: "Test proposal.", evidenceIds: [],
            order: { symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: "0.01", price: null },
          }),
        },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    })) as unknown as typeof fetch;
    const model = new AiSdkModelAdapter(loadConfig({ AI_PROVIDER: "boxapi", AI_MODEL: "gpt-5.6-luna", BOXAPI_API_KEY: "box-test-key" }), fetcher);
    const proposal = await model.propose("portfolio_manager", "Propose a market order for adapter testing.", context);
    expect(proposal.order?.type).toBe("MARKET");
    expect(proposal.order).not.toHaveProperty("price");
  });

  test("uses BoxAPI's supported tool-call reasoning setting and audits model usage", async () => {
    const repository = new SqliteRunRepository("file::memory:");
    repository.migrate(resolve("packages/engine/drizzle"));
    repository.createRun({ id: "ai-audit-run", mode: "shadow", config: { symbol: "BTCUSDT" }, startedAt: 1_000 });
    const requests: Array<Record<string, unknown>> = [];
    const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({
        id: "chatcmpl-ai-audit",
        object: "chat.completion",
        created: 1,
        model: "gpt-6-luna",
        choices: [{
          index: 0,
          message: { role: "assistant", content: JSON.stringify({ summary: "No directional edge in the supplied evidence.", confidence: 0.72, evidenceIds: [] }) },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 321, completion_tokens: 19, total_tokens: 340 },
      });
    }) as typeof fetch;
    const model = new AiSdkModelAdapter(
      loadConfig({ AI_PROVIDER: "boxapi", AI_MODEL: "gpt-6-luna", BOXAPI_API_KEY: "box-test-key" }),
      fetcher as unknown as typeof fetch, repository,
    );
    try {
      const finding = await model.analyze("market_technical_analyst", { ...context, runId: "ai-audit-run" });
      expect(finding.summary).toContain("No directional edge");
      expect(requests).toHaveLength(1);
      expect(requests[0]?.reasoning_effort).toBe("none");
      const calls = repository.getRunDetails("ai-audit-run")?.aiModelCalls;
      expect(calls).toHaveLength(1);
      expect(calls?.[0]).toMatchObject({
        role: "market_technical_analyst", operation: "analyze", provider: "boxapi.chat", modelId: "gpt-6-luna",
        status: "completed", inputTokens: 321, outputTokens: 19, totalTokens: 340, responseId: "chatcmpl-ai-audit",
      });
    } finally { repository.close(); }
  });

  test("stores failed BoxAPI tool calls in the run audit trail", async () => {
    const repository = new SqliteRunRepository("file::memory:");
    repository.migrate(resolve("packages/engine/drizzle"));
    repository.createRun({ id: "ai-failed-run", mode: "shadow", config: { symbol: "BTCUSDT" }, startedAt: 1_000 });
    const fetcher = (async () => Response.json({ error: { message: "gateway rejected tool call" } }, { status: 400 })) as unknown as typeof fetch;
    const model = new AiSdkModelAdapter(
      loadConfig({ AI_PROVIDER: "boxapi", AI_MODEL: "gpt-6-luna", BOXAPI_API_KEY: "box-test-key" }), fetcher, repository,
    );
    try {
      await expect(model.analyze("news_analyst", { ...context, runId: "ai-failed-run" })).rejects.toThrow();
      const calls = repository.getRunDetails("ai-failed-run")?.aiModelCalls;
      expect(calls).toHaveLength(1);
      expect(calls?.[0]).toMatchObject({ role: "news_analyst", status: "failed", errorMessage: expect.stringContaining("gateway rejected tool call") });
    } finally { repository.close(); }
  });
});

