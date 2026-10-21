import { describe, expect, test } from "bun:test";
import { WallexMarketDataAdapter, WallexMarketStream, WallexOrderExecutionAdapter } from "../packages/engine/src/adapters/wallex/rest.ts";
import type { MarketDataPort } from "../packages/engine/src/application/ports.ts";
import type { Centrifuge } from "centrifuge";

describe("Wallex adapters", () => {
  test("maps market metadata and excludes the still-forming one-minute candle", async () => {
    const now = 119_999;
    const fetcher = (async (input: URL | RequestInfo) => {
      const url = String(input);
      if (url.includes("/hector/web/v1/markets")) return Response.json({ success: true, result: { markets: [{ symbol: "BTCUSDT", base_asset: "BTC", quote_asset: "USDT", price: "100", price_precision: 2, amount_precision: 4, is_spot: true }] } });
      if (url.includes("/v1/udf/history")) return Response.json({ s: "ok", t: [0, 60], o: ["1", "2"], h: ["2", "3"], l: ["0.5", "1"], c: ["1.5", "2.5"], v: ["10", "20"] });
      throw new Error(`Unexpected URL ${url}`);
    }) as typeof fetch;
    const adapter = new WallexMarketDataAdapter({ baseUrl: "https://api.wallex.ir", wsUrl: "wss://api.wallex.ir/connection/websocket", allowedMarkets: ["BTCUSDT"], fetcher, now: () => now });
    const markets = await adapter.listSpotMarkets();
    const candles = await adapter.getCandles("BTCUSDT", 0, 120, 1);
    expect(markets[0]?.quantityPrecision).toBe(4);
    expect(candles.map((candle) => candle.complete)).toEqual([true, false]);
  });

  test("sends credit-account headers and client id to the documented order endpoint", async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
      captured = { url: String(input), init: init ?? {} };
      return Response.json({ success: true, result: { active: true, clientOrderId: "WA_TEST", status: "NEW", symbol: "BTCUSDT", side: "BUY", origQty: "1", executedQty: "0", price: "100", fills: [] } }, { status: 201 });
    }) as typeof fetch;
    const adapter = new WallexOrderExecutionAdapter({ baseUrl: "https://api.wallex.ir", wsUrl: "wss://api.wallex.ir/connection/websocket", apiKey: "credit-key", subAccountClientId: "sub-account", allowedMarkets: ["BTCUSDT"], fetcher });
    const result = await adapter.submitOrder({ symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: "1", price: "100" }, "WA_TEST");
    const headers = new Headers(captured?.init.headers);
    expect(captured?.url).toContain("/v1/account/orders");
    expect(headers.get("x-api-key")).toBe("credit-key");
    expect(headers.get("sub-account-client-id")).toBe("sub-account");
    expect(JSON.parse(String(captured?.init.body)).client_id).toBe("WA_TEST");
    expect(JSON.parse(String(captured?.init.body)).price).toBeUndefined();
    expect(result.status).toBe("NEW");
  });

  test("cancels by the documented clientOrderId query parameter", async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
      captured = { url: String(input), init: init ?? {} };
      return Response.json({ success: true, result: { clientOrderId: "WA_CANCEL", active: false, status: "CANCELED", symbol: "BTCUSDT", side: "BUY", origQty: "1", executedQty: "0", fills: [] } });
    }) as typeof fetch;
    const adapter = new WallexOrderExecutionAdapter({ baseUrl: "https://api.wallex.ir", wsUrl: "wss://api.wallex.ir/connection/websocket", apiKey: "credit-key", subAccountClientId: "sub-account", allowedMarkets: ["BTCUSDT"], fetcher });
    const result = await adapter.cancelOrder("WA_CANCEL");
    expect(captured?.url).toContain("/v1/account/orders?clientOrderId=WA_CANCEL");
    expect(captured?.init.method).toBe("DELETE");
    expect(result?.status).toBe("CANCELED");
  });

  test("resynchronizes and caches REST depth after initial connect and reconnect", async () => {
    let connected: (() => void) | undefined;
    let connectCalls = 0;
    let disconnectCalls = 0;
    let unsubscribeCalls = 0;
    const channels: string[] = [];
    const client = {
      on: (event: string, callback: () => void) => { if (event === "connected") connected = callback; },
      newSubscription: (channel: string) => {
        channels.push(channel);
        return {
          on: () => undefined,
          subscribe: () => undefined,
          unsubscribe: () => { unsubscribeCalls++; },
          removeAllListeners: () => undefined,
        };
      },
      connect: () => { connectCalls++; },
      disconnect: () => { disconnectCalls++; },
    } as unknown as Centrifuge;
    let restDepthCalls = 0;
    const marketData: MarketDataPort = {
      listSpotMarkets: async () => [], getQuote: async () => ({ symbol: "BTCUSDT", price: "100", observedAt: Date.now(), source: "wallex-rest" }),
      getDepth: async () => { restDepthCalls++; return { bids: [["99", "1"]], asks: [["101", "1"]], observedAt: Date.now() }; },
      getCandles: async () => [],
    };
    const adapter = new WallexMarketDataAdapter({ baseUrl: "https://api.wallex.ir", wsUrl: "wss://api.wallex.ir/connection/websocket", allowedMarkets: [] });
    let resyncs = 0;
    let reconnects = 0;
    const stream = new WallexMarketStream("wss://api.wallex.ir/connection/websocket", marketData, {
      onPrice: () => undefined,
      onDepthSnapshot: (symbol, depth) => { adapter.ingestDepthSnapshot(symbol, depth); resyncs++; },
      onReconnect: () => { reconnects++; },
    }, () => client);
    stream.start(["BTCUSDT"]);
    expect(connectCalls).toBe(1);
    expect(channels).toEqual(["public:all@price", "orderbook:BTCUSDT@buyDepth", "orderbook:BTCUSDT@sellDepth"]);
    connected?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(resyncs).toBe(1);
    connected?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reconnects).toBe(1);
    expect(resyncs).toBe(2);
    expect((await adapter.getDepth("BTCUSDT")).asks[0]?.[0]).toBe("101");
    expect(restDepthCalls).toBe(2);
    stream.close();
    expect(disconnectCalls).toBe(1);
    expect(unsubscribeCalls).toBe(3);
  });

  test("uses available credit-account cash for sizing and total balances for equity", async () => {
    let balanceRequestHeaders = new Headers();
    const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("balances-detail")) {
        balanceRequestHeaders = new Headers(init?.headers);
        return Response.json({ success: true, result: { balances: [
          { symbol: "USDT", available: "90", freeze: "10", total: "100" },
          { symbol: "BTC", available: "0.5", freeze: "0.5", total: "1" },
        ] } });
      }
      if (url.includes("/hector/web/v1/markets")) {
        return Response.json({ success: true, result: { markets: [{ symbol: "BTCUSDT", base_asset: "BTC", quote_asset: "USDT", price: "20", price_precision: 2, amount_precision: 4, is_spot: true }] } });
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as typeof fetch;
    const adapter = new WallexMarketDataAdapter({
      baseUrl: "https://api.wallex.ir", wsUrl: "wss://api.wallex.ir/connection/websocket",
      apiKey: "credit-key", subAccountClientId: "credit-account", allowedMarkets: ["BTCUSDT"], fetcher,
    });
    const portfolio = await adapter.getAccountPortfolio();
    expect(balanceRequestHeaders.get("x-api-key")).toBe("credit-key");
    expect(balanceRequestHeaders.get("sub-account-client-id")).toBe("credit-account");
    expect(portfolio.cash).toBe("90");
    expect(portfolio.equity).toBe("120");
    expect(portfolio.positions[0]?.availableQuantity).toBe("0.5");
  });

  test("parses mapped balance rows with value and locked fields", async () => {
    const fetcher = (async (input: URL | RequestInfo) => {
      if (String(input).includes("balances-detail")) return Response.json({ success: true, result: { balances: {
        USDT: { asset: "USDT", value: "100", locked: "5" },
      } } });
      throw new Error(`Unexpected URL ${String(input)}`);
    }) as typeof fetch;
    const adapter = new WallexMarketDataAdapter({
      baseUrl: "https://api.wallex.ir", wsUrl: "wss://api.wallex.ir/connection/websocket",
      apiKey: "credit-key", subAccountClientId: "credit-account", allowedMarkets: [], fetcher,
    });
    const portfolio = await adapter.getAccountPortfolio();
    expect(portfolio.cash).toBe("95");
    expect(portfolio.equity).toBe("100");
  });
});

