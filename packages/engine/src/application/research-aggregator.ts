import { z } from "zod";
import type { ResearchAggregatorPort, ResearchProvider, ResearchBundle } from "./ports.ts";
import { ResearchItemSchema } from "../domain/types.ts";
import { readJsonLimited } from "../adapters/providers/bounded-json.ts";

const MAX_RESEARCH_ITEMS_PER_CATEGORY = 10;

export class HybridResearchAggregator implements ResearchAggregatorPort {
  constructor(private readonly providers: readonly ResearchProvider[]) {}

  async collect(symbol: string, now: number): Promise<ResearchBundle> {
    const results = await Promise.allSettled(this.providers.map(async (provider) => {
      const skipReason = provider.skipReason?.(symbol);
      const items = skipReason ? [] : (await provider.fetch(symbol, provider.categories, now)).map((item) => ResearchItemSchema.parse(item));
      return { provider: provider.id, skipReason, items };
    }));
    const warnings: ResearchBundle["warnings"] = [];
    const coverage: NonNullable<ResearchBundle["coverage"]> = [];
    const all = [];
    const providerByItem = new Map<object, string>();
    for (let i = 0; i < results.length; i++) {
      const result = results[i]!;
      if (result.status === "fulfilled") {
        const provider = this.providers[i]!;
        if (result.value.skipReason) {
          coverage.push({ provider: provider.id, categories: [...provider.categories], status: "skipped", returnedItemCount: 0, acceptedItemCount: 0, includedItemCount: 0, excludedStaleCount: 0, excludedFutureCount: 0, message: result.value.skipReason });
          continue;
        }
        const maxAgeMs = (provider.maxAgeSeconds ?? 86_400) * 1000;
        let stale = 0;
        let future = 0;
        let accepted = 0;
        for (const rawItem of result.value.items) {
          const item = rawItem;
          if (item.observedAt > now + 60_000) { future++; continue; }
          if (now - item.observedAt > maxAgeMs) { stale++; continue; }
          all.push(item);
          providerByItem.set(item, provider.id);
          accepted++;
        }
        coverage.push({
          provider: provider.id, categories: [...provider.categories],
          status: accepted > 0 ? "available" : result.value.items.length > 0 ? "filtered" : "no_matches",
          returnedItemCount: result.value.items.length, acceptedItemCount: accepted, includedItemCount: 0,
          excludedStaleCount: stale, excludedFutureCount: future,
          ...(accepted === 0 ? { message: result.value.items.length > 0
            ? "The provider returned items, but all were excluded as stale or future-dated. This does not establish that no event or activity exists."
            : "The provider returned no matching evidence for this query. This does not establish that no event or activity exists." } : {}),
        });
        if (stale > 0) warnings.push({ provider: provider.id, message: `${stale} stale research item(s) were excluded.` });
        if (future > 0) warnings.push({ provider: provider.id, message: `${future} future-dated research item(s) were excluded.` });
      } else {
        const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
        const provider = this.providers[i]!;
        coverage.push({ provider: provider.id, categories: [...provider.categories], status: "failed", returnedItemCount: 0, acceptedItemCount: 0, includedItemCount: 0, excludedStaleCount: 0, excludedFutureCount: 0, message });
        warnings.push({ provider: provider.id, message });
      }
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
      if (count >= MAX_RESEARCH_ITEMS_PER_CATEGORY) { capped++; continue; }
      categoryCounts.set(item.category, count + 1);
      items.push(item);
      const owner = providerByItem.get(item);
      const sourceCoverage = owner ? coverage.find((entry) => entry.provider === owner) : undefined;
      if (sourceCoverage) sourceCoverage.includedItemCount++;
    }
    if (capped > 0) warnings.push({ provider: "aggregator", message: `${capped} additional evidence item(s) were excluded by the per-category context limit.` });
    return { items, warnings, coverage };
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
