import { describe, expect, test } from "bun:test";
import { HybridResearchAggregator } from "../packages/engine/src/application/research-aggregator.ts";
import type { ResearchProvider } from "../packages/engine/src/application/ports.ts";

const item = (source: string, observedAt: number, confidence: number) => ({
  id: `${source}-${observedAt}`, category: "news" as const, title: "Wallex market update", content: "BTC liquidity increased.",
  source, observedAt, confidence, dedupKey: "news:btc:liquidity", metadata: {},
});

describe("hybrid research aggregation", () => {
  test("deduplicates contextual items while keeping the freshest confident source and tolerating optional failures", async () => {
    const providers: ResearchProvider[] = [
      { id: "old", categories: ["news"], fetch: async () => [item("wire-a", 100, 0.9)] },
      { id: "new", categories: ["news"], fetch: async () => [item("wire-b", 200, 0.8)] },
      { id: "optional", categories: ["sentiment"], fetch: async () => { throw new Error("feed offline"); } },
    ];
    const result = await new HybridResearchAggregator(providers).collect("BTCUSDT", 300);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.source).toBe("wire-b");
    expect(result.warnings).toHaveLength(1);
  });

  test("excludes stale and future-dated contextual evidence", async () => {
    const provider: ResearchProvider = {
      id: "timestamped", categories: ["news"], maxAgeSeconds: 1,
      fetch: async () => [item("fresh", 999_999, 0.8), item("stale", 1, 0.9), item("future", 1_100_001, 1)],
    };
    const result = await new HybridResearchAggregator([provider]).collect("BTCUSDT", 1_000_000);
    expect(result.items.map((entry) => entry.source)).toEqual(["fresh"]);
    expect(result.warnings).toHaveLength(2);
  });
});

