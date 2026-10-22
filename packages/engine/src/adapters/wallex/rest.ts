import Decimal from "decimal.js";
import { Centrifuge } from "centrifuge";
import { CandleSchema, MarketSpecSchema, type Candle, type ExchangeOrder, type Fill, type MarketQuote, type MarketSpec, type OrderProposal, type PortfolioState, type Side } from "../../domain/types.ts";
import type { MarketDataPort, OrderExecutionPort } from "../../application/ports.ts";
import { readTextLimited } from "../providers/bounded-json.ts";

export interface WallexOptions {
  baseUrl: string;
  wsUrl: string;
  apiKey?: string;
  subAccountClientId?: string;
  packageId?: string;
  allowedMarkets: string[];
  fetcher?: typeof fetch;
  now?: () => number;
  requestTimeoutMs?: number;
}

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject => value !== null && typeof value === "object" ? value as JsonObject : {};
const unwrapResult = (body: unknown): unknown => object(body).result ?? body;
const asString = (value: unknown, fallback = ""): string => value === null || value === undefined ? fallback : String(value);
const asBoolean = (value: unknown): boolean => value === true || value === 1 || value === "true";
const wallexIconUrl = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    if (typeof value !== "string" || !value.startsWith("https://")) continue;
    try { return new URL(value).toString(); } catch { /* Ignore absent or malformed optional icon metadata. */ }
  }
  return undefined;
};
const timeMs = (value: unknown, fallback: number): number => {
  if (typeof value === "number") return value < 10_000_000_000 ? value * 1000 : value;
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
};

class WallexHttp {
  private readonly fetcher: typeof fetch;
  readonly now: () => number;
  constructor(private readonly options: WallexOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
  }
  async request<T>(path: string, init: RequestInit = {}, authenticated = false): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.body !== undefined) headers.set("content-type", "application/json");
    if (authenticated) {
      if (!this.options.apiKey) throw new Error("WALLEX_API_KEY is required for this endpoint.");
      headers.set("x-api-key", this.options.apiKey);
      if (this.options.subAccountClientId) headers.set("sub-account-client-id", this.options.subAccountClientId);
    }
    const method = (init.method ?? "GET").toUpperCase();
    // Only idempotent reads are retried. A POST or DELETE may have reached Wallex
    // even when its response is malformed, so retrying it could duplicate an order.
    const retryableRead = method === "GET";
    const maxAttempts = retryableRead ? 3 : 1;
    const url = this.options.baseUrl.replace(/\/+$/, "") + path;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let response: Response;
      try {
        const requestSignal = AbortSignal.timeout(this.options.requestTimeoutMs ?? 10_000);
        const signal = init.signal ? AbortSignal.any([init.signal, requestSignal]) : requestSignal;
        response = await this.fetcher(url, {
          ...init, headers,
          signal,
        });
      } catch (error) {
        if (!retryableRead || init.signal?.aborted || attempt === maxAttempts - 1) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
        continue;
      }

      let body: unknown;
      let responseText = "";
      try {
        responseText = await readTextLimited(response, 2_000_000);
        body = JSON.parse(responseText.replace(/^\uFEFF/, "")) as unknown;
      } catch (error) {
        if (error instanceof Error && error.message.includes("exceeded the 2000000-byte limit")) throw error;
        const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || "missing";
        const trimmedBody = responseText.trimStart();
        const bodyKind = !trimmedBody ? "empty or incomplete body" :
          contentType.includes("html") || /^(?:<!doctype\s+html|<html\b|<head\b|<body\b)/i.test(trimmedBody) ? "HTML page" : "unrecognized body";
        const detail = new Error(`Wallex returned non-JSON HTTP ${response.status} for ${path} (content-type: ${contentType}; ${bodyKind}).`);
        const transientStatus = response.status === 429 || response.status >= 500;
        if (retryableRead && !init.signal?.aborted && attempt < maxAttempts - 1 && (response.ok || transientStatus)) {
          await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
          continue;
        }
        throw detail;
      }
      if (!response.ok) {
        const transientStatus = response.status === 429 || response.status >= 500;
        if (retryableRead && !init.signal?.aborted && attempt < maxAttempts - 1 && transientStatus) {
          await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
          continue;
        }
        const message = asString(object(body).message, `HTTP ${response.status}`);
        const error = new Error(`Wallex ${method} ${path} failed: ${message}`) as Error & { status?: number };
        error.status = response.status;
        throw error;
      }
      if (object(body).success === false) throw new Error(`Wallex rejected ${path}: ${asString(object(body).message, "unknown error")}`);
      return body as T;
    }
    throw new Error(`Wallex ${method} ${path} request did not complete.`);
  }
  get optionsPublic(): Pick<WallexOptions, "packageId" | "allowedMarkets"> { return this.options; }
}

export class WallexMarketDataAdapter implements MarketDataPort {
  private readonly http: WallexHttp;
  private readonly quoteCache = new Map<string, MarketQuote>();
  private readonly depthCache = new Map<string, { bids: [string, string][]; asks: [string, string][]; observedAt: number }>();
  private marketRowsCache: JsonObject[] | undefined;
  private marketRowsObservedAt = 0;
  private readonly quoteCurrency: string;
  constructor(options: WallexOptions & { quoteCurrency?: string }) {
    this.http = new WallexHttp(options);
    this.quoteCurrency = options.quoteCurrency ?? "USDT";
  }
  async close(): Promise<void> {}

  ingestStreamQuote(quote: MarketQuote): void { this.quoteCache.set(quote.symbol.toUpperCase(), quote); }
  ingestDepthSnapshot(symbol: string, depth: { bids: [string, string][]; asks: [string, string][]; observedAt: number }): void {
    this.depthCache.set(symbol.toUpperCase(), structuredClone(depth));
  }

  private async marketRows(signal?: AbortSignal): Promise<JsonObject[]> {
    signal?.throwIfAborted();
    if (this.marketRowsCache && this.http.now() - this.marketRowsObservedAt <= 1_000) return this.marketRowsCache;
    const body = await this.http.request<unknown>("/hector/web/v1/markets", signal ? { signal } : {});
    const raw = object(unwrapResult(body)).markets;
    if (!Array.isArray(raw)) throw new Error("Wallex market response did not include result.markets.");
    this.marketRowsCache = raw.map(object);
    this.marketRowsObservedAt = this.http.now();
    return this.marketRowsCache;
  }

  async listSpotMarkets(signal?: AbortSignal): Promise<MarketSpec[]> {
    return (await this.marketRows(signal)).map((value) => {
      const symbol = asString(value.symbol).toUpperCase();
      const baseAssetIconUrl = wallexIconUrl(value.base_asset_icon, value.base_asset_png_icon, value.base_asset_svg_icon, value.base_icon);
      const quoteAssetIconUrl = wallexIconUrl(value.quote_asset_icon, value.quote_asset_png_icon, value.quote_asset_svg_icon, value.quote_icon);
      return MarketSpecSchema.parse({
        symbol,
        baseAsset: asString(value.base_asset),
        quoteAsset: asString(value.quote_asset),
        ...(baseAssetIconUrl ? { baseAssetIconUrl } : {}),
        ...(quoteAssetIconUrl ? { quoteAssetIconUrl } : {}),
        pricePrecision: Number(value.price_precision ?? 8),
        quantityPrecision: Number(value.amount_precision ?? 8),
        minQuantity: asString(value.min_qty, "0"),
        minNotional: asString(value.min_notional, "0"),
        spotEnabled: asBoolean(value.is_spot),
      });
    }).filter((market) => market.spotEnabled);
  }

  async getQuote(symbol: string, signal?: AbortSignal): Promise<MarketQuote> {
    signal?.throwIfAborted();
    const normalized = symbol.toUpperCase();
    const cached = this.quoteCache.get(normalized);
    if (cached && this.http.now() - cached.observedAt <= 5_000) return cached;
    const rows = await this.marketRows(signal);
    const raw = rows.find((item) => asString(item.symbol).toUpperCase() === normalized);
    const market = raw && MarketSpecSchema.parse({
      symbol: normalized, baseAsset: asString(raw.base_asset), quoteAsset: asString(raw.quote_asset),
      pricePrecision: Number(raw.price_precision ?? 8), quantityPrecision: Number(raw.amount_precision ?? 8),
      spotEnabled: asBoolean(raw.is_spot),
    });
    if (!market?.spotEnabled) throw new Error(`Wallex spot market ${symbol} is unavailable.`);
    if (!raw || !asString(raw.price)) throw new Error(`Wallex has no current price for ${symbol}.`);
    return { symbol: market.symbol, price: asString(raw.price), observedAt: this.marketRowsObservedAt, source: "wallex-rest" };
  }

  async getDepth(symbol: string, signal?: AbortSignal): Promise<{ bids: [string, string][]; asks: [string, string][]; observedAt: number }> {
    signal?.throwIfAborted();
    const normalized = symbol.toUpperCase();
    const cached = this.depthCache.get(normalized);
    if (cached && this.http.now() - cached.observedAt <= 1000) return structuredClone(cached);
    const query = new URLSearchParams({ symbol: symbol.toUpperCase() });
    const body = await this.http.request<unknown>(`/v1/depth?${query}`, signal ? { signal } : {});
    const result = object(unwrapResult(body));
    const levels = (value: unknown): [string, string][] => Array.isArray(value) ? value.map((entry): [string, string] => {
      const row = object(entry);
      return [asString(row.price), asString(row.quantity)];
    }).filter(([price, quantity]) => price !== "" && quantity !== "") : [];
    const depth = { bids: levels(result.bid), asks: levels(result.ask), observedAt: this.http.now() };
    this.depthCache.set(normalized, depth);
    return structuredClone(depth);
  }

  async getCandles(symbol: string, fromSeconds: number, toSeconds: number, resolutionMinutes: 1 = 1, signal?: AbortSignal): Promise<Candle[]> {
    signal?.throwIfAborted();
    const query = new URLSearchParams({ symbol: symbol.toUpperCase(), resolution: String(resolutionMinutes), from: String(fromSeconds), to: String(toSeconds) });
    const response = object(await this.http.request<unknown>(`/v1/udf/history?${query}`, signal ? { signal } : {}));
    if (response.s !== "ok") {
      if (response.s === "no_data") return [];
      throw new Error(`Wallex candle endpoint status: ${asString(response.s, "missing")}`);
    }
    const times = response.t as unknown[];
    const opens = response.o as unknown[];
    const highs = response.h as unknown[];
    const lows = response.l as unknown[];
    const closes = response.c as unknown[];
    const volumes = response.v as unknown[];
    if (![times, opens, highs, lows, closes, volumes].every(Array.isArray)) throw new Error("Wallex candle payload has invalid OHLCV arrays.");
    const now = this.http.now();
    const candles = times.map((timestamp, index) => CandleSchema.parse({
      symbol: symbol.toUpperCase(), timestamp: Number(timestamp) * 1000,
      open: asString(opens[index]), high: asString(highs[index]), low: asString(lows[index]), close: asString(closes[index]),
      volume: asString(volumes[index]), complete: (Number(timestamp) + resolutionMinutes * 60) * 1000 <= now,
    }));
    return candles.sort((a, b) => a.timestamp - b.timestamp);
  }

  async getPackageUnavailableMarkets(packageId: string): Promise<string[]> {
    const body = await this.http.request<unknown>(`/v1/prop/packages/${encodeURIComponent(packageId)}`, {}, true);
    const unavailable = object(unwrapResult(body)).unavailableMarkets;
    if (!Array.isArray(unavailable)) throw new Error("Wallex package response omitted unavailableMarkets; refusing to infer an empty restriction list.");
    return unavailable.map((symbol) => asString(symbol).toUpperCase());
  }

  async getAccountPortfolio(): Promise<PortfolioState> {
    // This is Wallex's dedicated sub-account balance detail route, not the main-account wallet endpoint.
    const body = await this.http.request<unknown>("/v1/account/balances-detail", {}, true);
    const raw = object(unwrapResult(body));
    const balanceRows = raw.balances ?? raw;
    const rows: { key?: string; value: unknown }[] = Array.isArray(balanceRows) ? balanceRows.map((value) => ({ value })) :
      Object.entries(object(balanceRows)).map(([key, value]) => ({ key, value }));
    if (!rows.length) throw new Error("Wallex account balance response was empty or has an unsupported shape.");
    const balances = new Map<string, { available: Decimal; total: Decimal }>();
    for (const { key, value } of rows) {
      const row = object(value);
      const asset = asString(row.asset ?? row.currency ?? row.symbol ?? key).toUpperCase();
      if (!asset) throw new Error("Wallex account balance response contains a row without an asset symbol.");
      const primitive = typeof value === "string" || typeof value === "number" ? value : undefined;
      const availableRaw = row.available ?? row.available_balance ?? row.availableBalance ?? row.free;
      const locked = new Decimal(asString(row.freeze ?? row.locked ?? row.frozen, "0"));
      const totalRaw = row.total ?? row.value ?? row.balance ?? row.amount ?? primitive;
      const total = totalRaw === undefined ? new Decimal(asString(availableRaw, "0")).plus(locked) : new Decimal(asString(totalRaw));
      const available = availableRaw === undefined ? total.minus(locked) : new Decimal(asString(availableRaw));
      if (!available.isFinite() || !total.isFinite() || available.lt(0) || total.lt(0) || available.gt(total)) {
        throw new Error(`Wallex returned invalid available/total balances for ${asset}.`);
      }
      const prior = balances.get(asset);
      balances.set(asset, prior
        ? { available: prior.available.plus(available), total: prior.total.plus(total) }
        : { available, total });
    }
    let cash = new Decimal(0);
    let cashEquity = new Decimal(0);
    const positions: PortfolioState["positions"] = [];
    for (const [asset, balance] of balances) {
      const { available } = balance;
      const quantity = balance.total;
      if (asset === this.quoteCurrency) {
        cash = cash.plus(available);
        cashEquity = cashEquity.plus(quantity);
      }
      else if (quantity.gt(0)) {
        const symbol = `${asset}${this.quoteCurrency}`;
        try {
          const quote = await this.getQuote(symbol);
          positions.push({ symbol, quantity: quantity.toFixed(), availableQuantity: available.toFixed(), averageEntryPrice: quote.price, markPrice: quote.price });
        } catch { throw new Error(`Cannot safely value non-zero Wallex asset ${asset} in ${this.quoteCurrency}; live trading is paused.`); }
      }
    }
    const equity = positions.reduce((sum, item) => sum.plus(new Decimal(item.quantity).mul(item.averageEntryPrice)), cashEquity).toFixed();
    return { quoteCurrency: this.quoteCurrency, cash: cash.toFixed(), positions, equity, highWatermark: equity, realizedPnlToday: "0", dayStartEquity: equity, observedAt: this.http.now() };
  }
}

function parseWallexOrder(value: unknown, fallbackClientId: string, now: number): ExchangeOrder {
  const raw = object(unwrapResult(value));
  const clientOrderId = asString(raw.clientOrderId ?? raw.client_id, fallbackClientId);
  if (!clientOrderId) throw new Error("Wallex order response omitted clientOrderId.");
  const executedQuantity = asString(raw.executedQty ?? raw.executedQuantity, "0");
  const origQuantity = asString(raw.origQty ?? raw.quantity, "0");
  const sideValue = asString(raw.side).toUpperCase();
  if (sideValue !== "BUY" && sideValue !== "SELL") throw new Error("Wallex order response has an invalid side.");
  const symbol = asString(raw.symbol).toUpperCase();
  if (!/^[A-Z0-9_-]+$/.test(symbol)) throw new Error("Wallex order response has an invalid symbol.");
  const rawStatus = asString(raw.status, raw.active === false ? "CANCELED" : "NEW").toUpperCase();
  const executed = new Decimal(executedQuantity);
  const original = new Decimal(origQuantity);
  if (!executed.isFinite() || executed.lt(0) || !original.isFinite() || original.lte(0) || executed.gt(original)) {
    throw new Error("Wallex order response has invalid executed or original quantity values.");
  }
  const status: ExchangeOrder["status"] = rawStatus.includes("REJECT") ? "REJECTED" : rawStatus.includes("CANCEL") ? "CANCELED" :
    executed.gt(0) && executed.gte(original) ? "FILLED" : executed.gt(0) ? "PARTIALLY_FILLED" :
      rawStatus === "NEW" || raw.active === true ? "NEW" : "UNKNOWN";
  const side = sideValue as Side;
  const rawFills = Array.isArray(raw.fills) ? raw.fills : [];
  const fills: Fill[] = rawFills.map((entry, index) => {
    const fill = object(entry);
    const timestamp = timeMs(fill.timestamp, now);
    const quantity = asString(fill.quantity);
    const price = asString(fill.price);
    if (!new Decimal(quantity).isFinite() || new Decimal(quantity).lte(0) || !new Decimal(price).isFinite() || new Decimal(price).lte(0)) {
      throw new Error("Wallex order response contains an invalid fill quantity or price.");
    }
    const fee = asString(fill.fee, "0");
    if (!new Decimal(fee).isFinite() || new Decimal(fee).lt(0)) throw new Error("Wallex order response contains an invalid fill fee.");
    const feeAssetValue = fill.feeAsset;
    const feeAsset = (typeof feeAssetValue === "string" ? feeAssetValue :
      asString(object(feeAssetValue).asset ?? object(feeAssetValue).symbol ?? object(feeAssetValue).currency ?? object(feeAssetValue).key)).trim().toUpperCase();
    const fillSymbol = asString(fill.symbol, symbol).toUpperCase();
    if (fillSymbol !== symbol) throw new Error("Wallex order response contains a fill for a different symbol.");
    return {
      id: `${clientOrderId}:${index}`,
      orderClientId: clientOrderId, symbol: fillSymbol, side,
      quantity, price, fee, feeAsset, timestamp,
    };
  });
  return {
    clientOrderId, symbol, side, status, quantity: origQuantity, executedQuantity,
    averagePrice: asString(raw.executedPrice ?? raw.price, "0"), fills, updatedAt: timeMs(raw.updated_at ?? raw.updatedAt, now),
  };
}

export class WallexOrderExecutionAdapter implements OrderExecutionPort {
  private readonly http: WallexHttp;
  private readonly allowedMarkets: ReadonlySet<string>;
  constructor(options: WallexOptions) {
    this.http = new WallexHttp(options);
    this.allowedMarkets = new Set(options.allowedMarkets.map((symbol) => symbol.toUpperCase()));
  }

  async submitOrder(order: OrderProposal, clientOrderId: string): Promise<ExchangeOrder> {
    if (!/^[A-Z0-9_]+$/.test(clientOrderId)) throw new Error("Wallex client_id must contain only A-Z, digits, and underscore.");
    if (!this.allowedMarkets.has(order.symbol.toUpperCase())) throw new Error(`Refusing to submit an order outside WALLEX_ALLOWED_MARKETS: ${order.symbol}.`);
    const body = await this.http.request<unknown>("/v1/account/orders", {
      method: "POST",
      body: JSON.stringify({
        symbol: order.symbol, side: order.side, type: order.type,
        quantity: order.quantity, ...(order.type === "LIMIT" && order.price ? { price: order.price } : {}),
        client_id: clientOrderId,
      }),
    }, true);
    const orderResult = parseWallexOrder(body, clientOrderId, this.http.now());
    if (orderResult.clientOrderId !== clientOrderId) throw new Error("Wallex order response returned a different client_id; submission must be reconciled by the requested id.");
    return orderResult;
  }

  async getOrder(clientOrderId: string): Promise<ExchangeOrder | null> {
    try {
      const body = await this.http.request<unknown>(`/v1/account/orders/${encodeURIComponent(clientOrderId)}`, {}, true);
      const order = parseWallexOrder(body, clientOrderId, this.http.now());
      if (order.clientOrderId !== clientOrderId) throw new Error("Wallex order detail returned a different clientOrderId.");
      return order;
    } catch (error) {
      if ((error as { status?: number }).status === 404) return null;
      throw error;
    }
  }

  async cancelOrder(clientOrderId: string): Promise<ExchangeOrder | null> {
    const query = new URLSearchParams({ clientOrderId });
    const body = await this.http.request<unknown>(`/v1/account/orders?${query}`, { method: "DELETE" }, true);
    const order = parseWallexOrder(body, clientOrderId, this.http.now());
    if (order.clientOrderId !== clientOrderId) throw new Error("Wallex cancellation response returned a different clientOrderId.");
    return order;
  }

  async listOpenOrders(symbol?: string): Promise<ExchangeOrder[]> {
    const query = new URLSearchParams({ per_page: "100", page: "1" });
    if (symbol) query.set("symbol", symbol.toUpperCase());
    const body = await this.http.request<unknown>(`/v1/account/openOrders?${query}`, {}, true);
    const result = object(unwrapResult(body));
    const rows = Array.isArray(result) ? result : Object.values(result).flatMap((value) => Array.isArray(value) ? value : []);
    return rows.map((row) => parseWallexOrder(row, "", this.http.now()));
  }
}

export interface MarketStreamCallbacks {
  onPrice(quote: MarketQuote): void;
  onDepthSnapshot(symbol: string, depth: { bids: [string, string][]; asks: [string, string][]; observedAt: number }): void;
  onReconnect?(at: number): void;
  onBookUpdate?(symbol: string): void;
}

/** Public Centrifugo v2 stream; REST snapshots are emitted after every connection and reconnect. */
export class WallexMarketStream {
  private client: Centrifuge | undefined;
  private readonly subscriptions: Array<{ unsubscribe(): void; removeAllListeners(): void }> = [];
  private readonly lastBookRefresh = new Map<string, number>();
  private readonly bookRefreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(
    private readonly url: string,
    private readonly marketData: MarketDataPort,
    private readonly callbacks: MarketStreamCallbacks,
    private readonly createClient: (url: string) => Centrifuge = (url) => new Centrifuge(url),
  ) {}

  start(symbols: readonly string[]): void {
    if (this.client) throw new Error("Wallex market stream has already been started.");
    this.client = this.createClient(this.url);
    let connectedOnce = false;
    this.client.on("connected", () => {
      if (connectedOnce) this.callbacks.onReconnect?.(Date.now());
      connectedOnce = true;
      void this.resync(symbols);
    });
    const prices = this.client.newSubscription("public:all@price");
    prices.on("publication", (ctx) => {
      const row = object(ctx.data);
      const symbol = asString(row.symbol).toUpperCase();
      if (!symbols.includes(symbol) || !row.price) return;
      this.callbacks.onPrice({ symbol, price: asString(row.price), observedAt: Date.now(), source: "wallex-centrifugo-v2" });
    });
    prices.subscribe();
    this.subscriptions.push(prices);
    for (const symbol of symbols) {
      for (const channel of [`orderbook:${symbol}@buyDepth`, `orderbook:${symbol}@sellDepth`]) {
        const sub = this.client.newSubscription(channel);
        sub.on("publication", () => {
          this.callbacks.onBookUpdate?.(symbol);
          const last = this.lastBookRefresh.get(symbol) ?? 0;
          if (Date.now() - last < 5_000 || this.bookRefreshTimers.has(symbol)) return;
          const timer = setTimeout(() => {
            this.bookRefreshTimers.delete(symbol);
            void this.resync([symbol]);
          }, 50);
          this.bookRefreshTimers.set(symbol, timer);
        });
        sub.subscribe();
        this.subscriptions.push(sub);
      }
    }
    this.client.connect();
  }

  private async resync(symbols: readonly string[]): Promise<void> {
    for (const symbol of symbols) {
      try {
        const depth = await this.marketData.getDepth(symbol);
        this.lastBookRefresh.set(symbol, Date.now());
        this.callbacks.onDepthSnapshot(symbol, depth);
      }
      catch (error) { console.warn(`Wallex REST book resync failed for ${symbol}: ${error instanceof Error ? error.message : String(error)}`); }
    }
  }

  close(): void {
    for (const timer of this.bookRefreshTimers.values()) clearTimeout(timer);
    this.bookRefreshTimers.clear();
    for (const subscription of this.subscriptions) { subscription.unsubscribe(); subscription.removeAllListeners(); }
    this.subscriptions.length = 0;
    this.client?.disconnect();
    this.client = undefined;
  }
}
