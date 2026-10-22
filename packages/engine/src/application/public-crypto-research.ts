import type { ResearchCategory, ResearchItem } from "../domain/types.ts";
import type { ResearchProvider } from "./ports.ts";
import { readJsonLimited, readTextLimited } from "../adapters/providers/bounded-json.ts";

const REQUEST_TIMEOUT_MS = 8_000;
const COINPAPRIKA_ROOT = "https://api.coinpaprika.com/v1";
const DEXPAPRIKA_ROOT = "https://api.dexpaprika.com";
const RSS_ROOT = "https://www.coindesk.com/arc/outboundfeeds/rss/";

export function cryptoBaseAsset(symbol: string, quoteCurrency = "USDT"): string | undefined {
  const normalized = symbol.toUpperCase().replaceAll("/", "").trim();
  const quotes = [...new Set([quoteCurrency.toUpperCase(), "USDT", "USDC", "TMN", "IRT", "USD", "BTC", "ETH"])].sort((a, b) => b.length - a.length);
  const quote = quotes.find((candidate) => normalized.endsWith(candidate) && normalized.length > candidate.length);
  const base = quote ? normalized.slice(0, -quote.length) : "";
  if (base && /^[A-Z0-9]{2,15}$/.test(base)) return base;
  return /^[A-Z0-9]{2,15}$/.test(normalized) ? normalized : undefined;
}

async function requestJson(
  fetcher: typeof fetch, url: URL, provider: string, signal?: AbortSignal, extraHeaders: Record<string, string> = {},
): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(new Error("request timeout")), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetcher(url, {
        headers: { accept: "application/json, application/rss+xml, application/xml, text/xml", "user-agent": "Trex/0.1 (crypto research)", ...extraHeaders },
        signal: controller.signal,
      });
      if ((response.status === 429 || response.status >= 500) && attempt === 0 && !signal?.aborted) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await response.body?.cancel();
        await new Promise((resolve) => setTimeout(resolve, Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 2) * 1000 : 350));
        continue;
      }
      if (!response.ok) throw new Error(provider + " returned HTTP " + response.status + ".");
      return await readJsonLimited(response, 1_000_000);
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw new Error(provider + " request was cancelled.");
      if (attempt === 0 && error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError" || error instanceof TypeError)) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      if (error instanceof Error && error.message.startsWith(provider + " returned HTTP ")) throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    }
  }
  if (lastError instanceof Error && lastError.name === "AbortError") throw new Error(provider + " request timed out.");
  throw new Error(provider + " request or response failed (" + (lastError instanceof Error ? lastError.name : "unknown error") + ").");
}

async function requestText(fetcher: typeof fetch, url: URL, provider: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      headers: { accept: "application/rss+xml, application/xml, text/xml", "user-agent": "Trex/0.1 (crypto research)" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(provider + " returned HTTP " + response.status + ".");
    return await readTextLimited(response, 1_000_000);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(provider + " returned HTTP ")) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new Error(provider + " request timed out.");
    throw new Error(provider + " request or response failed (" + (error instanceof Error ? error.name : "unknown error") + ").");
  } finally { clearTimeout(timeout); }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numeric(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function displayNumber(value: unknown): string {
  const number = numeric(value);
  return number === undefined ? "not reported" : new Intl.NumberFormat("en-US", { maximumSignificantDigits: 10 }).format(number);
}

function positiveNumber(value: unknown): number | undefined {
  const number = numeric(value);
  return number !== undefined && number > 0 ? number : undefined;
}

function displayPositiveSupply(value: unknown): string {
  const number = positiveNumber(value);
  return number === undefined ? "not reported" : displayNumber(number);
}

interface CoinIdentity { id: string; name: string; symbol: string; type: string; rank?: number }
interface CacheEntry<T> { value: T; expiresAt: number }

export class CoinPaprikaResearchClient {
  private readonly identities = new Map<string, CacheEntry<CoinIdentity | null>>();
  private readonly tickers = new Map<string, CacheEntry<Record<string, unknown>>>();
  private readonly profiles = new Map<string, CacheEntry<Record<string, unknown>>>();

  constructor(private readonly fetcher: typeof fetch = fetch, private readonly now: () => number = Date.now) {}

  async resolve(symbol: string, quoteCurrency = "USDT"): Promise<CoinIdentity | null> {
    const base = cryptoBaseAsset(symbol, quoteCurrency);
    if (!base) return null;
    const cached = this.identities.get(base);
    if (cached && cached.expiresAt > this.now()) return cached.value;
    const url = new URL(COINPAPRIKA_ROOT + "/search/");
    url.searchParams.set("q", base);
    url.searchParams.set("c", "currencies");
    url.searchParams.set("limit", "25");
    const payload = asRecord(await requestJson(this.fetcher, url, "CoinPaprika"));
    const candidates = Array.isArray(payload.currencies) ? payload.currencies.map(asRecord) : [];
    const exact = candidates.filter((candidate) =>
      typeof candidate.symbol === "string" && candidate.symbol.toUpperCase() === base && candidate.is_active !== false && typeof candidate.id === "string" && /^[a-z0-9-]{2,100}$/.test(candidate.id),
    );
    const nativeCoins = exact.filter((candidate) => candidate.type === "coin");
    const selected = nativeCoins.length === 1 ? nativeCoins[0] : exact.length === 1 ? exact[0] : undefined;
    if (!selected && exact.length > 1) {
      throw new Error("CoinPaprika found multiple active exact-symbol assets for " + base + "; no token identity was selected automatically.");
    }
    const selectedRank = selected ? numeric(selected.rank) : undefined;
    const identity = selected ? {
      id: String(selected.id), name: String(selected.name ?? base), symbol: String(selected.symbol), type: String(selected.type ?? "unknown"),
      ...(selectedRank === undefined ? {} : { rank: selectedRank }),
    } : null;
    this.identities.set(base, { value: identity, expiresAt: this.now() + 24 * 60 * 60 * 1000 });
    return identity;
  }

  async ticker(identity: CoinIdentity): Promise<Record<string, unknown>> {
    const cached = this.tickers.get(identity.id);
    if (cached && cached.expiresAt > this.now()) return cached.value;
    const url = new URL(COINPAPRIKA_ROOT + "/tickers/" + encodeURIComponent(identity.id));
    url.searchParams.set("quotes", "USD");
    const value = asRecord(await requestJson(this.fetcher, url, "CoinPaprika"));
    this.tickers.set(identity.id, { value, expiresAt: this.now() + 30 * 60 * 1000 });
    return value;
  }

  async profile(identity: CoinIdentity): Promise<Record<string, unknown>> {
    const cached = this.profiles.get(identity.id);
    if (cached && cached.expiresAt > this.now()) return cached.value;
    const value = asRecord(await requestJson(this.fetcher, new URL(COINPAPRIKA_ROOT + "/coins/" + encodeURIComponent(identity.id)), "CoinPaprika"));
    this.profiles.set(identity.id, { value, expiresAt: this.now() + 24 * 60 * 60 * 1000 });
    return value;
  }
}

const tokenomicsCategories: readonly ResearchCategory[] = ["tokenomics"];

export class CoinPaprikaSupplyResearchProvider implements ResearchProvider {
  readonly id = "coinpaprika-supply";
  readonly categories = tokenomicsCategories;
  readonly maxAgeSeconds = 6 * 60 * 60;
  constructor(private readonly client: CoinPaprikaResearchClient, private readonly quoteCurrency = "USDT") {}

  async fetch(symbol: string, categories: readonly ResearchCategory[], now: number): Promise<ResearchItem[]> {
    if (!categories.includes("tokenomics")) return [];
    const identity = await this.client.resolve(symbol, this.quoteCurrency);
    if (!identity) return [];
    const ticker = await this.client.ticker(identity);
    const reportedSymbol = typeof ticker.symbol === "string" ? ticker.symbol.toUpperCase() : "";
    if (ticker.id !== identity.id || reportedSymbol !== identity.symbol.toUpperCase()) {
      throw new Error("CoinPaprika ticker identity did not match the resolved exact-symbol asset.");
    }
    const updatedAt = typeof ticker.last_updated === "string" ? Date.parse(ticker.last_updated) : Number.NaN;
    if (!Number.isFinite(updatedAt)) throw new Error("CoinPaprika ticker did not include a valid source update time.");
    const quote = asRecord(asRecord(ticker.quotes).USD);
    const supplyFields = ["circulating_supply", "total_supply", "max_supply"] as const;
    const supplyReported = supplyFields.some((field) => positiveNumber(ticker[field]) !== undefined);
    const lines = [
      "Asset identity: " + identity.name + " (" + identity.symbol + "; CoinPaprika ID " + identity.id + "). Exact ticker match was resolved using the provider search response.",
      "Circulating supply: " + displayPositiveSupply(ticker.circulating_supply) + " " + identity.symbol,
      "Total supply: " + displayPositiveSupply(ticker.total_supply) + " " + identity.symbol,
      "Maximum supply: " + displayPositiveSupply(ticker.max_supply) + " " + identity.symbol + (numeric(ticker.max_supply) === 0 ? " (API returned 0; its meaning is not established here, so it is treated as unreported)" : ""),
      "Market capitalization: " + displayNumber(quote.market_cap) + " USD; 24-hour aggregated volume: " + displayNumber(quote.volume_24h) + " USD.",
      "Provider last updated: " + new Date(updatedAt).toISOString() + ". This is an aggregated third-party estimate, not a direct chain proof.",
      "Missing values mean this provider did not report the field; they do not mean zero, unlimited supply, or no events. This source does not provide a verified unlock calendar, emissions/burn schedule, staking/governance participation, utility capture, or complete chain activity.",
    ];
    return [{
      id: "coinpaprika:supply:" + identity.id + ":" + updatedAt,
      category: "tokenomics", title: "Token supply and aggregated USD market metrics",
      content: lines.join("\n"), source: "CoinPaprika · Powered by CoinPaprika",
      sourceUrl: "https://api.coinpaprika.com/v1/tickers/" + encodeURIComponent(identity.id) + "?quotes=USD",
      observedAt: Math.trunc(updatedAt), confidence: supplyReported ? 0.72 : 0.55,
      dedupKey: "coinpaprika:supply:" + identity.id,
      metadata: { provider: "CoinPaprika", coinId: identity.id, assetSymbol: identity.symbol, quoteCurrency: "USD", identityMatch: "exact active symbol; unique native coin preferred", sourceUpdatedAt: updatedAt, supplyReported },
    }];
  }
}

export class CoinPaprikaProfileResearchProvider implements ResearchProvider {
  readonly id = "coinpaprika-profile";
  readonly categories = tokenomicsCategories;
  readonly maxAgeSeconds = 24 * 60 * 60;
  constructor(private readonly client: CoinPaprikaResearchClient, private readonly quoteCurrency = "USDT") {}

  async fetch(symbol: string, categories: readonly ResearchCategory[], now: number): Promise<ResearchItem[]> {
    if (!categories.includes("tokenomics")) return [];
    const identity = await this.client.resolve(symbol, this.quoteCurrency);
    if (!identity) return [];
    const profile = await this.client.profile(identity);
    if (profile.id !== identity.id || typeof profile.symbol !== "string" || profile.symbol.toUpperCase() !== identity.symbol.toUpperCase()) {
      throw new Error("CoinPaprika profile identity did not match the resolved exact-symbol asset.");
    }
    const tags = Array.isArray(profile.tags) ? profile.tags.map((tag) => asRecord(tag)).map((tag) => tag.name).filter((name): name is string => typeof name === "string").slice(0, 12) : [];
    const links = asRecord(profile.links);
    const websites = Array.isArray(links.website) ? links.website.filter((value): value is string => typeof value === "string" && value.startsWith("https://")).slice(0, 3) : [];
    const description = typeof profile.description === "string" ? profile.description.replace(/\s+/g, " ").trim().slice(0, 1_000) : "";
    const lastDataAt = typeof profile.last_data_at === "string" ? profile.last_data_at : undefined;
    const values = [
      "Third-party catalogue profile for " + identity.name + " (" + identity.symbol + "; " + identity.id + "). This is a provider-authored description, not an independently verified protocol document.",
      description ? "Description: " + description : "Description: not provided.",
      typeof profile.proof_type === "string" ? "Listed proof/consensus type: " + profile.proof_type : "Listed proof/consensus type: not provided.",
      typeof profile.development_status === "string" ? "Listed development status: " + profile.development_status : "Listed development status: not provided.",
      typeof profile.org_structure === "string" ? "Listed organization structure: " + profile.org_structure : "Listed organization structure: not provided.",
      tags.length ? "Provider tags: " + tags.join(", ") : "Provider tags: none listed.",
      websites.length ? "Project links listed by provider: " + websites.join(", ") : "Project links: none listed.",
      "Provider profile last data at: " + (lastDataAt ?? "not supplied") + ". The retrieval time is not the same as the provider's last update time.",
      "This profile cannot verify current token utility, supply control, staking rewards, governance participation, unlocks, or burn/emission mechanics.",
    ];
    return [{
      id: "coinpaprika:profile:" + identity.id + ":" + (lastDataAt ?? "retrieved-" + now),
      category: "tokenomics", title: "Project catalogue profile (secondary source)", content: values.join("\n"),
      source: "CoinPaprika · Powered by CoinPaprika",
      sourceUrl: "https://api.coinpaprika.com/v1/coins/" + encodeURIComponent(identity.id),
      observedAt: now, confidence: 0.55, dedupKey: "coinpaprika:profile:" + identity.id,
      metadata: { provider: "CoinPaprika", coinId: identity.id, assetSymbol: identity.symbol, sourceLastDataAt: lastDataAt ?? null, retrievedAt: now, profileIsSecondarySource: true },
    }];
  }
}

const TRONSCAN_ROOT = "https://apilist.tronscanapi.com";
const TRONSCAN_FUNDS_DOC = "https://docs.tronscan.org/en/api/statistics/funds";
const TRONSCAN_STAKING_DOC = "https://docs.tronscan.org/en/api/statistics/freezeresource";
const TRONSCAN_GOVERNANCE_DOC = "https://docs.tronscan.org/en/api/witness/proposal";
const TRONSCAN_CHAIN_PARAMETERS_DOC = "https://docs.tronscan.org/en/api/witness/chainparameters";
const TRONSCAN_ACTIVITY_DOC = "https://docs.tronscan.org/en/api/statistics/stats-overview";
const TRONSCAN_REVENUE_DOC = "https://docs.tronscan.org/en/api/protocol-revenue-service-api/turnover-new";
const TRONSCAN_MAX_AGE_SECONDS = 10 * 60;
const TRONSCAN_DAILY_MAX_AGE_SECONDS = 4 * 24 * 60 * 60;

export class TronScanResearchClient {
  private readonly cache = new Map<string, CacheEntry<Promise<Record<string, unknown>>>>();
  private queue: Promise<void> = Promise.resolve();
  private lastRequestAt = 0;
  readonly configured: boolean;

  constructor(private readonly fetcher: typeof fetch, private readonly apiKey?: string, private readonly now: () => number = Date.now) {
    this.configured = Boolean(apiKey?.trim());
  }

  get(path: string, query: Record<string, string> = {}): Promise<Record<string, unknown>> {
    if (!this.configured || !this.apiKey) throw new Error("TronScan API key is not configured.");
    const url = new URL(TRONSCAN_ROOT + path);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const cacheKey = url.toString();
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > this.now()) return cached.value;
    const scheduled = this.queue.then(async () => {
      const delayMs = 500 - (Date.now() - this.lastRequestAt);
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      this.lastRequestAt = Date.now();
    });
    this.queue = scheduled.then(() => undefined, () => undefined);
    const promise = scheduled.then(() => requestJson(this.fetcher, url, "TronScan", undefined, { "TRON-PRO-API-KEY": this.apiKey! }).then(asRecord));
    this.cache.set(cacheKey, { value: promise, expiresAt: this.now() + 5 * 60 * 1000 });
    promise.catch(() => {
      if (this.cache.get(cacheKey)?.value === promise) this.cache.delete(cacheKey);
    });
    return promise;
  }
}

function tronBaseAsset(symbol: string, quoteCurrency: string): boolean {
  return cryptoBaseAsset(symbol, quoteCurrency) === "TRX";
}

function tronSkipReason(symbol: string, quoteCurrency: string, client: TronScanResearchClient): string | undefined {
  if (!tronBaseAsset(symbol, quoteCurrency)) return "Skipped: this provider covers TRX on the TRON mainnet; it does not establish facts about other assets.";
  if (!client.configured) return "Skipped: no TronScan API key is configured in this profile, so authenticated TRON mainnet evidence was not queried.";
  return undefined;
}

function tronNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function tronDisplay(value: unknown, unit = ""): string {
  const number = tronNumber(value);
  if (number === undefined) return "not reported";
  return new Intl.NumberFormat("en-US", { maximumSignificantDigits: 12 }).format(number) + (unit ? " " + unit : "");
}

function tronRatioPercent(value: unknown): string {
  const ratio = tronNumber(value);
  return ratio === undefined ? "not reported" : (ratio * 100).toFixed(2) + "%";
}

function tronDate(value: unknown): string {
  const timestamp = tronNumber(value);
  if (timestamp === undefined || timestamp <= 0) return "not reported";
  return new Date(timestamp).toISOString();
}

function tronItem(input: {
  id: string; category: "tokenomics" | "on_chain"; title: string; content: string; sourceUrl: string;
  observedAt: number; metadata: Record<string, unknown>; confidence?: number;
}): ResearchItem {
  return {
    id: input.id, category: input.category, title: input.title, content: input.content.slice(0, 1_950),
    source: "TronScan · TRON mainnet indexer", sourceUrl: input.sourceUrl,
    observedAt: input.observedAt, confidence: input.confidence ?? 0.82,
    dedupKey: input.id.split(":").slice(0, 3).join(":"),
    metadata: { provider: "TronScan", network: "TRON mainnet", retrievedAt: input.observedAt, ...input.metadata },
  };
}

export class TronScanSupplyResearchProvider implements ResearchProvider {
  readonly id = "tronscan-trx-supply-burn";
  readonly categories: readonly ResearchCategory[] = ["tokenomics"];
  readonly maxAgeSeconds = TRONSCAN_MAX_AGE_SECONDS;
  constructor(private readonly client: TronScanResearchClient, private readonly quoteCurrency = "USDT", private readonly now: () => number = Date.now) {}
  skipReason(symbol: string) { return tronSkipReason(symbol, this.quoteCurrency, this.client); }

  async fetch(symbol: string, categories: readonly ResearchCategory[], now: number): Promise<ResearchItem[]> {
    if (!categories.includes("tokenomics")) return [];
    const data = await this.client.get("/api/funds");
    const fields = ["circulationSupply", "genesisBlockIssue", "totalBlockReward", "totalVoteReward", "totalBurnedForResourcesAndFees"];
    if (!fields.some((field) => tronNumber(data[field]) !== undefined)) throw new Error("TronScan funds response did not contain recognized supply or burn fields.");
    const content = [
      "Asset/network: native TRX on TRON mainnet. Current aggregate indexer snapshot; it is not a locally verified block proof.",
      "Circulating supply: " + tronDisplay(data.circulationSupply, "TRX") + ".",
      "Total turnover: " + tronDisplay(data.totalTurnOver, "TRX") + "; genesis issuance: " + tronDisplay(data.genesisBlockIssue, "TRX") + ".",
      "Cumulative block rewards: " + tronDisplay(data.totalBlockReward, "TRX") + "; cumulative vote rewards: " + tronDisplay(data.totalVoteReward, "TRX") + ".",
      "Cumulative TRX burned for resources and fees: " + tronDisplay(data.totalBurnedForResourcesAndFees, "TRX") + "; Independence Day burn: " + tronDisplay(data.burnedOnIndependenceDay, "TRX") + ".",
      "This is historical cumulative issuance/burn data, not a future unlock calendar or a forecast of net emissions. Missing values are unreported, not zero.",
      "Retrieved at: " + new Date(now).toISOString() + ".",
    ].join("\n");
    return [tronItem({
      id: "tronscan:trx-supply-burn:" + Math.floor(now / 300_000), category: "tokenomics",
      title: "TRX supply, reward and cumulative burn snapshot", content, sourceUrl: TRONSCAN_FUNDS_DOC, observedAt: now,
      metadata: { endpoint: "/api/funds", dataKind: "current aggregate snapshot", token: "TRX", mainnet: true },
    })];
  }
}

export class TronScanStakingResearchProvider implements ResearchProvider {
  readonly id = "tronscan-trx-staking";
  readonly categories: readonly ResearchCategory[] = ["tokenomics"];
  readonly maxAgeSeconds = TRONSCAN_DAILY_MAX_AGE_SECONDS;
  constructor(private readonly client: TronScanResearchClient, private readonly quoteCurrency = "USDT", private readonly now: () => number = Date.now) {}
  skipReason(symbol: string) { return tronSkipReason(symbol, this.quoteCurrency, this.client); }

  async fetch(symbol: string, categories: readonly ResearchCategory[], now: number): Promise<ResearchItem[]> {
    if (!categories.includes("tokenomics")) return [];
    const today = new Date(now).toISOString().slice(0, 10);
    const start = new Date(now - 6 * 86_400_000).toISOString().slice(0, 10);
    const data = await this.client.get("/api/freezeresource", { start_day: start, end_day: today });
    const rows = Array.isArray(data.data) ? data.data.map(asRecord) : [];
    const latest = rows.filter((row) => typeof row.day === "string").sort((a, b) => String(b.day).localeCompare(String(a.day)))[0];
    if (!latest && tronNumber(data.freezing_rate) === undefined) return [];
    const ratio = tronNumber(latest?.freezing_rate ?? data.freezing_rate);
    const percentage = tronRatioPercent(ratio);
    const latestDay = typeof latest?.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(latest.day) ? latest.day : undefined;
    const observedAt = latestDay ? Date.parse(latestDay + "T23:59:59.999Z") : now;
    const content = [
      "Asset/network: native TRX on TRON mainnet. TronScan reports a network staking ratio; this does not mean every holder can access a particular yield.",
      "Latest reported staking ratio: " + percentage + (latestDay ? " for " + latestDay : "") + ".",
      "24-hour change in staking ratio: " + tronDisplay(latest?.freezing_rate_change_24h ?? data.freeze_rate_diff) + " (raw provider value; unit is the provider's ratio change).",
      "Bandwidth share of staking: " + tronRatioPercent(latest?.freeze1Percent ?? data.freeze1Percent) + "; energy share: " + tronRatioPercent(latest?.freeze2Percent ?? data.freeze2Percent) + " (provider ratio converted to percent).",
      "Total freeze weight: " + tronDisplay(latest?.total_freeze_weight ?? data.total_freeze_weight) + " (weight as reported; not interpreted as a token amount).",
      "The source is an indexer's daily aggregate. It does not provide individual account lockups, holder-level staking participation, future unlocks, or a guaranteed staking return.",
      "Retrieved at: " + new Date(now).toISOString() + ". The source observation time follows the latest dated daily row, so old rows can expire as stale.",
    ].join("\n");
    return [tronItem({
      id: "tronscan:trx-staking:" + (latestDay ?? Math.floor(now / 300_000)), category: "tokenomics",
      title: "TRX network staking-rate data", content, sourceUrl: TRONSCAN_STAKING_DOC, observedAt,
      metadata: { endpoint: "/api/freezeresource", fromDay: start, toDay: today, latestDay: latestDay ?? null, retrievedAt: now, dataKind: "daily network aggregate" },
    })];
  }
}

export class TronScanGovernanceResearchProvider implements ResearchProvider {
  readonly id = "tronscan-trx-governance";
  readonly categories: readonly ResearchCategory[] = ["tokenomics"];
  readonly maxAgeSeconds = TRONSCAN_MAX_AGE_SECONDS;
  constructor(private readonly client: TronScanResearchClient, private readonly quoteCurrency = "USDT") {}
  skipReason(symbol: string) { return tronSkipReason(symbol, this.quoteCurrency, this.client); }

  async fetch(symbol: string, categories: readonly ResearchCategory[], now: number): Promise<ResearchItem[]> {
    if (!categories.includes("tokenomics")) return [];
    const response = await this.client.get("/api/proposal", { start: "0", limit: "20" });
    const rows = Array.isArray(response.data) ? response.data.map(asRecord) : [];
    const total = tronNumber(response.total);
    const recent = rows.slice(0, 8).map((row) => {
      const changes = Array.isArray(row.paramters) ? row.paramters.map(asRecord).slice(0, 8)
        .map((entry) => "parameter " + tronDisplay(entry.key) + " → " + tronDisplay(entry.value)).join(", ") : "parameter values not reported";
      return "Proposal " + tronDisplay(row.proposalId) + " · state " + String(row.state ?? "not reported")
        + " · created " + tronDate(row.createTime) + " · expires " + tronDate(row.expirationTime)
        + " · votes " + tronDisplay(row.totalVotes) + " (valid " + tronDisplay(row.validVotes) + ") · " + changes;
    });
    if (!recent.length) return [];
    const content = [
      "TRON mainnet governance proposals indexed by TronScan. This is a first-page snapshot and does not establish proposal impact on TRX value.",
      "Provider total: " + tronDisplay(total) + " proposal records; returned page: " + rows.length + " (20 requested). Details shown: " + recent.length + ".",
      ...recent,
      "Proposal changes describe governance activity; they do not establish utility capture, holder participation, or a future token unlock schedule.",
    ].join("\n");
    return [tronItem({
      id: "tronscan:trx-governance:" + Math.floor(now / 300_000), category: "tokenomics",
      title: "TRON mainnet governance proposal snapshot", content, sourceUrl: TRONSCAN_GOVERNANCE_DOC, observedAt: now,
      metadata: { endpoint: "/api/proposal", stateFilter: null, pageStart: 0, pageLimit: 20, providerTotal: total ?? null, returnedCount: rows.length, displayedCount: recent.length },
    })];
  }
}

export class TronScanChainParametersResearchProvider implements ResearchProvider {
  readonly id = "tronscan-trx-chain-parameters";
  readonly categories: readonly ResearchCategory[] = ["tokenomics"];
  readonly maxAgeSeconds = TRONSCAN_MAX_AGE_SECONDS;
  constructor(private readonly client: TronScanResearchClient, private readonly quoteCurrency = "USDT") {}
  skipReason(symbol: string) { return tronSkipReason(symbol, this.quoteCurrency, this.client); }

  async fetch(symbol: string, categories: readonly ResearchCategory[], now: number): Promise<ResearchItem[]> {
    if (!categories.includes("tokenomics")) return [];
    const response = await this.client.get("/api/chainparameters");
    if (!Array.isArray(response.tronParameters)) throw new Error("TronScan chain-parameter response did not contain the documented parameter list.");
    const parameters = response.tronParameters.map(asRecord);
    const relevant = parameters.filter((parameter) =>
      typeof parameter.key === "string" && /reward|burn|fee|energy|vote|stake|freeze|issuance/i.test(parameter.key),
    ).slice(0, 16);
    if (!relevant.length) return [];
    const content = [
      "Current TRON mainnet chain parameters returned by TronScan, with initial values and linked governance-proposal records when supplied.",
      "Values below are copied as raw protocol parameter values; the endpoint does not define units or economic effects for every key. Do not treat them as a forecast or future unlock schedule.",
      ...relevant.map((parameter) => {
        const relations = Array.isArray(parameter.relations) ? parameter.relations.map(asRecord).slice(0, 3).map((relation) =>
          "proposal " + tronDisplay(relation.id) + " " + String(relation.state ?? "state not reported")
          + " value " + tronDisplay(relation.value) + " expires " + tronDate(relation.expiration_time),
        ) : [];
        return String(parameter.key) + ": current=" + tronDisplay(parameter.value)
          + "; initial=" + tronDisplay(parameter.initValue)
          + (relations.length ? "; linked changes: " + relations.join("; ") : "; no linked proposal records returned");
      }),
      "TronScan is an indexer for these API results. Interpret parameter definitions against TRON protocol documentation; current settings and governance history do not establish holder-level returns or future emissions.",
    ].join("\n");
    return [tronItem({
      id: "tronscan:trx-chain-parameters:" + Math.floor(now / 300_000), category: "tokenomics",
      title: "Current TRON chain reward, fee and resource parameters", content,
      sourceUrl: TRONSCAN_CHAIN_PARAMETERS_DOC, observedAt: now,
      metadata: { endpoint: "/api/chainparameters", retrievedAt: now, relevantParameterCount: relevant.length, totalParameterCount: parameters.length, dataKind: "current indexed chain parameters and linked proposal history" },
      confidence: 0.76,
    })];
  }
}

export class TronScanRevenueResearchProvider implements ResearchProvider {
  readonly id = "tronscan-trx-protocol-revenue";
  readonly categories: readonly ResearchCategory[] = ["tokenomics"];
  readonly maxAgeSeconds = 36 * 60 * 60;
  constructor(private readonly client: TronScanResearchClient, private readonly quoteCurrency = "USDT") {}
  skipReason(symbol: string) { return tronSkipReason(symbol, this.quoteCurrency, this.client); }

  async fetch(symbol: string, categories: readonly ResearchCategory[], now: number): Promise<ResearchItem[]> {
    if (!categories.includes("tokenomics")) return [];
    const end = now;
    const start = now - 7 * 86_400_000;
    const response = await this.client.get("/api/turnover/new", {
      size: "8", start: String(start), end: String(end), timeType: "0",
    });
    if (tronNumber(response.code) !== 200 || String(response.status ?? "") !== "1") {
      throw new Error("TronScan protocol revenue response did not report a successful status.");
    }
    const rows = Array.isArray(response.data) ? response.data.map(asRecord)
      .filter((row) => typeof row.day === "string")
      .sort((left, right) => String(left.day).localeCompare(String(right.day))).slice(-7) : [];
    if (!rows.length) return [];
    const daily = rows.map((row) => [
      String(row.day),
      "protocol-reported revenue " + tronDisplay(row.totalIncome, "TRX"),
      "burn component " + tronDisplay(row.burnIncome, "TRX") + " (" + tronRatioPercent(row.burnIncomePercent) + ")",
      "staking component " + tronDisplay(row.stakeIncome, "TRX") + " (" + tronRatioPercent(row.stakeIncomePercent) + ")",
      "reported close " + tronDisplay(row.trxClosePrice, "USD"),
    ].join(" · "));
    const updatedSeconds = tronNumber(response.lastUpdateSeconds);
    const observedAt = updatedSeconds && updatedSeconds > 0 ? Math.trunc(updatedSeconds * 1000) : now;
    const content = [
      "TRON protocol-revenue service values as reported by TronScan for daily periods. These are indexed protocol metrics, not a holder's realized income or proof of token-holder value capture.",
      ...daily,
      "Historical burn and staking components are not a forecast of future emissions, a holder-level yield, or a future unlock schedule.",
    ].join("\n");
    return [tronItem({
      id: "tronscan:trx-protocol-revenue:" + Math.floor(observedAt / 300_000), category: "tokenomics",
      title: "TRON protocol-reported revenue, burn and staking breakdown", content,
      sourceUrl: TRONSCAN_REVENUE_DOC, observedAt,
      metadata: { endpoint: "/api/turnover/new", timeType: "daily", daysRequested: 7, daysReturned: rows.length, lastUpdateSeconds: updatedSeconds ?? null, dataKind: "indexed protocol revenue report" },
      confidence: 0.78,
    })];
  }
}

export class TronScanActivityResearchProvider implements ResearchProvider {
  readonly id = "tronscan-trx-network-activity";
  readonly categories: readonly ResearchCategory[] = ["on_chain"];
  readonly maxAgeSeconds = 3 * 24 * 60 * 60;
  constructor(private readonly client: TronScanResearchClient, private readonly quoteCurrency = "USDT", private readonly now: () => number = Date.now) {}
  skipReason(symbol: string) { return tronSkipReason(symbol, this.quoteCurrency, this.client); }

  async fetch(symbol: string, categories: readonly ResearchCategory[], now: number): Promise<ResearchItem[]> {
    if (!categories.includes("on_chain")) return [];
    const data = await this.client.get("/api/stats/overview", { days: "7" });
    if (data.success !== true) throw new Error("TronScan network activity response did not report success.");
    const rows = Array.isArray(data.data) ? data.data.map(asRecord)
      .sort((left, right) => (tronNumber(left.date) ?? 0) - (tronNumber(right.date) ?? 0)).slice(-7) : [];
    if (!rows.length) return [];
    const daily = rows.map((row) => [
      String(row.dateDayStr ?? tronDate(row.date)).slice(0, 10),
      "active accounts " + tronDisplay(row.active_account_number),
      "transactions " + tronDisplay(row.newTransactionSeen),
      "TRX transfers " + tronDisplay(row.trx_transfer),
      "freeze/unfreeze/vote tx " + [row.freeze_transaction, row.unfreeze_transaction, row.vote_transaction].map((value) => tronDisplay(value)).join("/"),
    ].join(" · "));
    const content = [
      "TRON mainnet daily network-wide indexer statistics for up to the latest seven returned dates. Active accounts are addresses under the provider's metric, not unique people or TRX-only users.",
      ...daily,
      "Network-wide totals are not asset-specific utility measures or a complete independently verified transaction history.",
    ].join("\n");
    const lastRow = rows.at(-1);
    const lastDateText = typeof lastRow?.dateDayStr === "string" ? lastRow.dateDayStr : "";
    const dateFromDay = /^\d{4}-\d{2}-\d{2}$/.test(lastDateText)
      ? Date.parse(lastDateText + "T23:59:59.000Z")
      : Number.NaN;
    const observedAt = tronNumber(lastRow?.date) ?? (Number.isFinite(dateFromDay) ? dateFromDay : now);
    return [tronItem({
      id: "tronscan:trx-network-activity:" + Math.floor(observedAt / 86_400_000), category: "on_chain",
      title: "Recent TRON network activity", content, sourceUrl: TRONSCAN_ACTIVITY_DOC, observedAt,
      metadata: { endpoint: "/api/stats/overview", daysRequested: 7, daysReturned: rows.length, latestDataDay: rows.at(-1)?.dateDayStr ?? null, retrievedAt: now, dataKind: "network-wide daily indexed statistics" },
    })];
  }
}

function decodeXml(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&#(x[\da-f]+|\d+);|&(amp|lt|gt|quot|apos);/gi,
    (entity, numeric: string | undefined, named: string | undefined) => {
      if (numeric) {
        const codepoint = numeric.toLowerCase().startsWith("x") ? Number.parseInt(numeric.slice(1), 16) : Number.parseInt(numeric, 10);
        try { return String.fromCodePoint(codepoint); } catch { return ""; }
      }
      return ({ amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" } as Record<string, string>)[String(named).toLowerCase()] ?? entity;
    });
}

function cleanXmlText(value: string, limit: number): string {
  const text = decodeXml(decodeXml(value)).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return text.length > limit ? text.slice(0, limit - 1) + "…" : text;
}

function xmlTag(entry: string, tag: string): string {
  return entry.match(new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">", "i"))?.[1] ?? "";
}

const knownAliases: Record<string, string[]> = { BTC: ["bitcoin"], ETH: ["ethereum"], SOL: ["solana"], XRP: ["ripple"], TRX: ["tron"], BNB: ["binance coin"], ADA: ["cardano"], DOGE: ["dogecoin"], TON: ["toncoin"] };

export class CoinDeskRssResearchProvider implements ResearchProvider {
  readonly id = "coindesk-news-rss";
  readonly categories: readonly ResearchCategory[] = ["news"];
  readonly maxAgeSeconds = 7 * 24 * 60 * 60;
  private cachedFeed: { expiresAt: number; promise: Promise<string> } | undefined;

  constructor(private readonly fetcher: typeof fetch = fetch, private readonly quoteCurrency = "USDT", private readonly now: () => number = Date.now) {}

  private feed(): Promise<string> {
    if (this.cachedFeed && this.cachedFeed.expiresAt > this.now()) return this.cachedFeed.promise;
    const promise = requestText(this.fetcher, new URL(RSS_ROOT), "CoinDesk RSS");
    this.cachedFeed = { expiresAt: this.now() + 2 * 60 * 1000, promise };
    promise.catch(() => { if (this.cachedFeed?.promise === promise) this.cachedFeed = undefined; });
    return promise;
  }

  async fetch(symbol: string, categories: readonly ResearchCategory[], now: number): Promise<ResearchItem[]> {
    if (!categories.includes("news")) return [];
    const base = cryptoBaseAsset(symbol, this.quoteCurrency);
    if (!base) return [];
    const feed = await this.feed();
    if (!/<rss\b|<feed\b/i.test(feed)) throw new Error("CoinDesk returned an invalid RSS feed.");
    if (base.length < 3) return [];
    const terms = [base, ...(knownAliases[base] ?? [])];
    const pattern = new RegExp("(^|[^\\p{L}\\p{N}])(?:" + terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")([^\\p{L}\\p{N}]|$)", "iu");
    const items: ResearchItem[] = [];
    for (const entry of feed.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) ?? []) {
      const title = cleanXmlText(xmlTag(entry, "title"), 300);
      const content = cleanXmlText(xmlTag(entry, "description"), 1_300);
      const dateText = cleanXmlText(xmlTag(entry, "pubDate"), 100) || cleanXmlText(xmlTag(entry, "published"), 100);
      const observedAt = Date.parse(dateText);
      const matchedText = title + " " + content;
      if (!title || !Number.isFinite(observedAt) || observedAt > now + 60_000 || now - observedAt > this.maxAgeSeconds * 1000 || !pattern.test(matchedText)) continue;
      const linkText = cleanXmlText(xmlTag(entry, "link"), 1_000);
      const link = linkText.startsWith("https://") ? linkText : undefined;
      const id = link ?? (title + ":" + observedAt);
      items.push({
        id: "coindesk:" + id.slice(0, 470), category: "news", title,
        content: content || "Headline only; no article summary was supplied by the feed.",
        source: "CoinDesk RSS", ...(link ? { sourceUrl: link } : {}), observedAt: Math.trunc(observedAt), confidence: 0.68,
        dedupKey: "coindesk:" + id, metadata: { assetSymbol: base, evidenceType: "publisher headline and excerpt", feedUrl: RSS_ROOT },
      });
      if (items.length >= 10) break;
    }
    return items;
  }
}

export interface DexPaprikaTokenCandidate {
  chain: string; id: string; symbol: string; name: string;
  liquidityUsd?: number; volumeUsd24h?: number; priceUsd?: number; change24hPct?: number;
}

export class DexPaprikaResearchClient {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async searchTokenCandidates(symbol: string, chain?: string, signal?: AbortSignal): Promise<DexPaprikaTokenCandidate[]> {
    const base = cryptoBaseAsset(symbol);
    if (!base) throw new Error("Enter a crypto ticker or market symbol such as TRX or TRXTMN.");
    if (chain && !/^[a-z0-9_]{2,40}$/i.test(chain)) throw new Error("Enter a valid network identifier.");
    const url = new URL(DEXPAPRIKA_ROOT + "/search");
    url.searchParams.set("query", base);
    const payload = asRecord(await requestJson(this.fetcher, url, "DexPaprika", signal));
    const candidates = Array.isArray(payload.tokens) ? payload.tokens.map(asRecord) : [];
    return candidates.filter((candidate) =>
      typeof candidate.symbol === "string" && candidate.symbol.toUpperCase() === base &&
      typeof candidate.chain === "string" && (!chain || candidate.chain.toLowerCase() === chain.toLowerCase()) &&
      typeof candidate.id === "string" && candidate.id.length <= 200,
    ).slice(0, 10).map((candidate) => {
      const liquidityUsd = numeric(candidate.liquidity_usd);
      const volumeUsd24h = numeric(candidate.volume_usd);
      const priceUsd = numeric(candidate.price_usd);
      const change24hPct = numeric(candidate.price_usd_change);
      return {
        chain: String(candidate.chain), id: String(candidate.id), symbol: String(candidate.symbol), name: String(candidate.name ?? candidate.symbol),
        ...(liquidityUsd === undefined ? {} : { liquidityUsd }),
        ...(volumeUsd24h === undefined ? {} : { volumeUsd24h }),
        ...(priceUsd === undefined ? {} : { priceUsd }),
        ...(change24hPct === undefined ? {} : { change24hPct }),
      };
    });
  }
}
