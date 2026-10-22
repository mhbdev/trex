import { z } from "zod";
import type { MarketDataPort } from "../../application/ports.ts";
import type { MarketQuote } from "../../domain/types.ts";
import { readJsonLimited } from "./bounded-json.ts";

function isSafeProviderUrl(value: string): boolean {
  const url = new URL(value);
  return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname));
}

const fallbackSchema = z.object({
  id: z.string().min(1).max(100),
  url: z.url().refine(isSafeProviderUrl, "must use HTTPS (or localhost HTTP for development)"),
  timeoutMs: z.number().int().positive().max(30_000).default(4000),
  headers: z.record(z.string(), z.string()).optional(),
});
type FallbackConfig = z.infer<typeof fallbackSchema>;

export function parseQuoteFallbacks(raw: string): FallbackConfig[] { return z.array(fallbackSchema).max(5).parse(JSON.parse(raw)); }

/** Wallex remains the first and only executable quote source; configured feeds are failover for research and shadow. */
export class QuoteFailoverMarketData implements MarketDataPort {
  private readonly fallbacks: FallbackConfig[];
  constructor(private readonly primary: MarketDataPort, rawFallbacks = "[]", private readonly fetcher: typeof fetch = fetch) {
    this.fallbacks = parseQuoteFallbacks(rawFallbacks);
  }

  listSpotMarkets(signal?: AbortSignal) { return this.primary.listSpotMarkets(signal); }
  getDepth(symbol: string, signal?: AbortSignal) { return this.primary.getDepth(symbol, signal); }
  getCandles(symbol: string, fromSeconds: number, toSeconds: number, resolutionMinutes?: 1, signal?: AbortSignal) {
    return this.primary.getCandles(symbol, fromSeconds, toSeconds, resolutionMinutes, signal);
  }
  getPackageUnavailableMarkets(packageId: string) {
    if (!this.primary.getPackageUnavailableMarkets) return Promise.reject(new Error("Primary market data adapter does not support package restrictions."));
    return this.primary.getPackageUnavailableMarkets(packageId);
  }
  getAccountPortfolio() {
    if (!this.primary.getAccountPortfolio) return Promise.reject(new Error("Primary market data adapter does not support account balances."));
    return this.primary.getAccountPortfolio();
  }

  async getQuote(symbol: string, signal?: AbortSignal): Promise<MarketQuote> {
    try { return await this.primary.getQuote(symbol, signal); }
    catch (primaryError) {
      if (signal?.aborted) throw signal.reason ?? primaryError;
      const errors = [`wallex: ${primaryError instanceof Error ? primaryError.message : String(primaryError)}`];
      for (const fallback of this.fallbacks) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), fallback.timeoutMs);
        try {
          const url = new URL(fallback.url);
          url.searchParams.set("symbol", symbol.toUpperCase());
          const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
          const response = await this.fetcher(url, { ...(fallback.headers ? { headers: fallback.headers } : {}), signal: requestSignal });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const raw = z.object({ symbol: z.string(), price: z.string().or(z.number().finite()), observedAt: z.number().int().optional() }).parse(await readJsonLimited(response, 256_000));
          if (raw.symbol.toUpperCase() !== symbol.toUpperCase()) throw new Error("response symbol did not match request");
          const observedAt = raw.observedAt ?? Date.now();
          return { symbol: raw.symbol.toUpperCase(), price: String(raw.price), observedAt, source: `fallback:${fallback.id}` };
        } catch (error) {
          if (signal?.aborted) throw signal.reason ?? error;
          errors.push(`${fallback.id}: request failed (${error instanceof Error ? error.name : "unknown error"})`);
        } finally { clearTimeout(timeout); }
      }
      throw new AggregateError([primaryError], `All quote providers failed: ${errors.join("; ")}`);
    }
  }
  async close(): Promise<void> { await this.primary.close?.(); }
}
