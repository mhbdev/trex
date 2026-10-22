import { z } from "zod";
import type { ResearchCategory, ResearchItem } from "../domain/types.ts";
import type { ResearchProvider } from "./ports.ts";
import { readJsonLimited } from "../adapters/providers/bounded-json.ts";

const sentimentCategories: readonly ResearchCategory[] = ["sentiment"];
const MAX_FEED_ITEMS = 25;
const REQUEST_TIMEOUT_MS = 7_000;

function cryptoBase(symbol: string, quoteCurrency: string): string | undefined {
  const normalized = symbol.toUpperCase().replaceAll("/", "").trim();
  const quotes = [...new Set([quoteCurrency.toUpperCase(), "USDT", "USDC", "TMN", "IRT", "USD", "BTC", "ETH"])].sort((a, b) => b.length - a.length);
  const quote = quotes.find((candidate) => normalized.endsWith(candidate) && normalized.length > candidate.length);
  const base = quote ? normalized.slice(0, -quote.length) : "";
  return /^[A-Z0-9]{2,15}$/.test(base) ? base : undefined;
}

async function withTimeout<T>(fetcher: typeof fetch, url: URL, consume: (response: Response) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      headers: { "user-agent": "Trex/0.1 (public market research)", accept: "application/atom+xml, application/xml, text/xml, application/json" },
      signal: controller.signal,
    });
    return await consume(response);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("Public research request timed out.");
    throw error;
  } finally { clearTimeout(timeout); }
}

async function readTextLimited(response: Response, maxBytes: number): Promise<string> {
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) throw new Error("Public research response exceeded the size limit.");
  if (!response.body) return (await response.text()).slice(0, maxBytes);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new Error("Public research response exceeded the size limit."); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

function decodeXml(value: string): string {
  return value.replace(/&#(x[\da-f]+|\d+);|&(amp|lt|gt|quot|apos);/gi, (entity, numeric: string | undefined, named: string | undefined) => {
    if (numeric) {
      const codepoint = numeric.toLowerCase().startsWith("x") ? Number.parseInt(numeric.slice(1), 16) : Number.parseInt(numeric, 10);
      try { return String.fromCodePoint(codepoint); } catch { return ""; }
    }
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[String(named).toLowerCase()] ?? entity;
  });
}

function cleanText(value: string, limit: number): string {
  const plain = decodeXml(decodeXml(value))
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > limit ? `${plain.slice(0, limit - 1)}…` : plain;
}

function xmlTag(entry: string, tag: string): string {
  const match = entry.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1] ?? "";
}

function redditCommunities(base: string): string[] {
  const specific: Record<string, string> = { BTC: "Bitcoin", ETH: "ethereum", SOL: "solana" };
  return [...new Set([specific[base], "CryptoCurrency", "CryptoMarkets"].filter((value): value is string => Boolean(value)))];
}

export class RedditRssResearchProvider implements ResearchProvider {
  readonly id = "reddit-public-search";
  readonly categories = sentimentCategories;
  readonly maxAgeSeconds = 7 * 24 * 60 * 60;

  constructor(private readonly fetcher: typeof fetch = fetch, private readonly quoteCurrency = "USDT") {}

  async fetch(symbol: string, categories: readonly ResearchCategory[], now: number): Promise<ResearchItem[]> {
    if (!categories.includes("sentiment")) return [];
    const base = cryptoBase(symbol, this.quoteCurrency);
    if (!base) return [];
    const communities = redditCommunities(base);
    const url = new URL(`https://www.reddit.com/r/${communities.map(encodeURIComponent).join("+")}/search.rss`);
    url.searchParams.set("q", base);
    url.searchParams.set("restrict_sr", "on");
    url.searchParams.set("sort", "new");
    url.searchParams.set("t", "week");
    url.searchParams.set("limit", String(MAX_FEED_ITEMS));
    const feed = await withTimeout(this.fetcher, url, async (response) => {
      if (!response.ok) throw new Error(`Reddit returned HTTP ${response.status}.`);
      const xml = await readTextLimited(response, 1_000_000);
      if (!xml.includes("<feed")) throw new Error("Reddit returned an invalid RSS feed.");
      return xml;
    });

    const items: ResearchItem[] = [];
    for (const entry of feed.match(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi) ?? []) {
      const title = cleanText(xmlTag(entry, "title"), 300);
      const content = cleanText(xmlTag(entry, "content") || xmlTag(entry, "summary"), 1_400);
      const published = cleanText(xmlTag(entry, "published") || xmlTag(entry, "updated"), 80);
      const observedAt = Date.parse(published);
      const link = entry.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?\s*>/i)?.[1];
      const id = cleanText(xmlTag(entry, "id"), 300) || link || `${communities.join("+")}:${observedAt}:${title}`;
      if (!title || !Number.isFinite(observedAt) || observedAt > now + 60_000) continue;
      const community = link?.match(/\/r\/([^/]+)/i)?.[1] ?? "crypto communities";
      items.push({
        id: `reddit:${id}`.slice(0, 500), category: "sentiment", title,
        content: content || "Public community discussion; the post body was empty.",
        source: `Reddit · r/${community}`,
        ...(link?.startsWith("https://") ? { sourceUrl: link } : {}),
        observedAt: Math.trunc(observedAt), confidence: 0.5,
        dedupKey: link || id, metadata: { pair: symbol.toUpperCase(), communities, evidenceType: "user-generated opinion" },
      });
    }
    return items.slice(0, MAX_FEED_ITEMS);
  }
}

const StockTwitsPayload = z.object({ messages: z.array(z.unknown()).max(200) });

export class StockTwitsResearchProvider implements ResearchProvider {
  readonly id = "stocktwits-public-stream";
  readonly categories = sentimentCategories;
  readonly maxAgeSeconds = 24 * 60 * 60;

  constructor(private readonly fetcher: typeof fetch = fetch, private readonly quoteCurrency = "USDT") {}

  async fetch(symbol: string, categories: readonly ResearchCategory[], now: number): Promise<ResearchItem[]> {
    if (!categories.includes("sentiment")) return [];
    const base = cryptoBase(symbol, this.quoteCurrency);
    if (!base) return [];
    const url = new URL(`https://api.stocktwits.com/api/2/streams/symbol/${encodeURIComponent(base)}.X.json`);
    const payload = await withTimeout(this.fetcher, url, async (response) => {
      if (!response.ok) throw new Error(`StockTwits returned HTTP ${response.status}.`);
      return StockTwitsPayload.parse(await readJsonLimited(response, 1_000_000));
    });
    const items: ResearchItem[] = [];
    for (const candidate of payload.messages) {
      if (!candidate || typeof candidate !== "object") continue;
      const message = candidate as Record<string, unknown>;
      const body = typeof message.body === "string" ? cleanText(message.body, 1_400) : "";
      const observedAt = typeof message.created_at === "string" ? Date.parse(message.created_at) : Number.NaN;
      if (!body || !Number.isFinite(observedAt) || observedAt > now + 60_000) continue;
      const entities = message.entities && typeof message.entities === "object" ? message.entities as Record<string, unknown> : {};
      const sentiment = entities.sentiment && typeof entities.sentiment === "object" ? entities.sentiment as Record<string, unknown> : {};
      const label = typeof sentiment.basic === "string" ? sentiment.basic.toLowerCase() : "unlabeled";
      const user = message.user && typeof message.user === "object" ? message.user as Record<string, unknown> : {};
      const messageId = String(message.id ?? `${observedAt}:${body.slice(0, 60)}`);
      const sourceUrl = typeof message.url === "string" && message.url.startsWith("https://") ? message.url : undefined;
      items.push({
        id: `stocktwits:${messageId}`.slice(0, 500), category: "sentiment",
        title: `StockTwits ${label} community message`,
        content: `User-generated ${label} opinion${typeof user.username === "string" ? ` from @${user.username}` : ""}: ${body}`,
        source: "StockTwits", ...(sourceUrl ? { sourceUrl } : {}), observedAt: Math.trunc(observedAt),
        confidence: label === "bullish" || label === "bearish" ? 0.65 : 0.45,
        dedupKey: `stocktwits:${messageId}`, metadata: { pair: symbol.toUpperCase(), sentiment: label, evidenceType: "user-generated opinion" },
      });
      if (items.length >= MAX_FEED_ITEMS) break;
    }
    return items;
  }
}
