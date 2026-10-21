import { z } from "zod";
import type { ResearchAggregatorPort, ResearchProvider, ResearchBundle } from "./ports.ts";
import { ResearchItemSchema } from "../domain/types.ts";
import { readJsonLimited } from "../adapters/providers/bounded-json.ts";

export class HybridResearchAggregator implements ResearchAggregatorPort {
  constructor(private readonly providers: readonly ResearchProvider[]) {}

  async collect(symbol: string, now: number): Promise<ResearchBundle> {
    const results = await Promise.allSettled(this.providers.map(async (provider) => ({
      provider: provider.id,
      items: await provider.fetch(symbol, provider.categories, now),
    })));
    const warnings: ResearchBundle["warnings"] = [];
    const all = [];
    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      if (result.status === "fulfilled") {
        const provider = this.providers[i]!;
        const maxAgeMs = (provider.maxAgeSeconds ?? 86_400) * 1000;
        let stale = 0;
        let future = 0;
        for (const rawItem of result.value.items) {
          const item = ResearchItemSchema.parse(rawItem);
          if (item.observedAt > now + 60_000) { future++; continue; }
          if (now - item.observedAt > maxAgeMs) { stale++; continue; }
          all.push(item);
        }
        if (stale > 0) warnings.push({ provider: provider.id, message: `${stale} stale research item(s) were excluded.` });
        if (future > 0) warnings.push({ provider: provider.id, message: `${future} future-dated research item(s) were excluded.` });
      } else warnings.push({ provider: this.providers[i]!.id, message: result.reason instanceof Error ? result.reason.message : String(result.reason) });
    }
    const newestByKey = new Map<string, (typeof all)[number]>();
    for (const item of all) {
      const key = item.dedupKey ?? `${item.category}:${item.source}:${item.title.trim().toLowerCase()}`;
      const existing = newestByKey.get(key);
      if (!existing || item.observedAt > existing.observedAt ||
        (item.observedAt === existing.observedAt && item.confidence > existing.confidence)) newestByKey.set(key, item);
    }
    const categoryCounts = new Map<string, number>();
    const items = [];
    let capped = 0;
    for (const item of [...newestByKey.values()].sort((a, b) => b.observedAt - a.observedAt)) {
      const count = categoryCounts.get(item.category) ?? 0;
      if (count >= 5) { capped++; continue; }
      categoryCounts.set(item.category, count + 1);
      items.push(item);
    }
    if (capped > 0) warnings.push({ provider: "aggregator", message: `${capped} additional evidence item(s) were excluded by the per-category context limit.` });
    return { items, warnings };
  }
}

function isSafeProviderUrl(value: string): boolean {
  const url = new URL(value);
  return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
}

const EndpointSchema = z.object({
  id: z.string().min(1).max(100),
  url: z.url().refine(isSafeProviderUrl, "must use HTTPS (or localhost HTTP for development)"),
  categories: z.array(z.enum(["market", "technical", "news", "sentiment", "tokenomics", "on_chain", "macro", "prediction_market"])).min(1),
  timeoutMs: z.number().int().positive().max(30_000).default(5000),
  maxAgeSeconds: z.number().int().positive().max(2_592_000).default(86_400),
  headers: z.record(z.string(), z.string()).optional(),
});

/** Generic JSON source adapter. The endpoint responds with { items: ResearchItem[] }. */
export class ConfiguredJsonResearchProvider implements ResearchProvider {
  readonly id: string;
  readonly categories: readonly ResearchProvider["categories"][number][];
  readonly maxAgeSeconds: number;
  constructor(private readonly config: z.infer<typeof EndpointSchema>, private readonly fetcher: typeof fetch = fetch) {
    this.id = config.id;
    this.categories = config.categories;
    this.maxAgeSeconds = config.maxAgeSeconds;
  }

  static parseMany(raw: string): ConfiguredJsonResearchProvider[] {
    const inputs = z.array(EndpointSchema).max(10).parse(JSON.parse(raw));
    return inputs.map((input) => new ConfiguredJsonResearchProvider(input));
  }

  async fetch(symbol: string, categories: readonly ResearchProvider["categories"][number][], now: number) {
    const include = this.categories.filter((category) => categories.includes(category));
    if (include.length === 0) return [];
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const url = new URL(this.config.url);
      url.searchParams.set("symbol", symbol);
      url.searchParams.set("categories", include.join(","));
      url.searchParams.set("asOf", new Date(now).toISOString());
      const response = await this.fetcher(url, { ...(this.config.headers ? { headers: this.config.headers } : {}), signal: controller.signal });
      if (!response.ok) throw new Error(`${this.id} returned HTTP ${response.status}`);
      const body = await readJsonLimited(response, 1_000_000);
      return z.object({ items: z.array(ResearchItemSchema).max(200) }).parse(body).items.filter((item) => include.includes(item.category));
    } catch (error) {
      if (error instanceof Error && error.message.startsWith(`${this.id} returned HTTP`)) throw error;
      if (error instanceof Error && error.name === "AbortError") throw new Error(`${this.id} request timed out.`);
      throw new Error(`${this.id} request or response failed (${error instanceof Error ? error.name : "unknown error"}).`);
    } finally { clearTimeout(timeout); }
  }
}
