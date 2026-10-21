import { randomUUID } from "node:crypto";

export type DashboardEngineState = "starting" | "connecting" | "evaluating" | "waiting" | "stopping" | "stopped" | "failed";

export interface DashboardEngineStatus {
  state: DashboardEngineState;
  message: string;
  changedAt: number;
}

interface DashboardSubscriber {
  controller: ReadableStreamDefaultController<Uint8Array>;
  heartbeat: ReturnType<typeof setInterval>;
  close: () => void;
}

const encoder = new TextEncoder();

/** Serves a read-only dashboard on loopback while a shadow watcher is running. */
export class LocalDashboardServer {
  private server: ReturnType<typeof Bun.serve> | undefined;
  private html: string;
  private revision = 0;
  private readonly instanceId = randomUUID();
  private status: DashboardEngineStatus = {
    state: "starting",
    message: "Preparing the first shadow cycle.",
    changedAt: Date.now(),
  };
  private readonly subscribers = new Set<DashboardSubscriber>();

  constructor(private readonly requestedPort: number, initialHtml: string) {
    if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65_535) {
      throw new Error("Dashboard port must be an integer from 0 to 65535.");
    }
    this.html = initialHtml;
  }

  start(): string {
    if (this.server) throw new Error("The local dashboard server is already running.");
    try {
      this.server = Bun.serve({
        hostname: "127.0.0.1",
        port: this.requestedPort,
        fetch: (request) => this.handleRequest(request),
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not start the local dashboard on 127.0.0.1:${this.requestedPort}: ${detail}. Choose another --dashboard-port, or use --dashboard-port 0 to select an available port.`);
    }
    return `http://127.0.0.1:${this.server.port}/`;
  }

  publishHtml(html: string): void {
    this.html = html;
    this.revision += 1;
    this.broadcast("snapshot", { revision: this.revision });
  }

  publishStatus(state: DashboardEngineState, message: string): void {
    this.status = { state, message, changedAt: Date.now() };
    this.broadcast("status", this.status);
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    if (this.status.state !== "failed") this.publishStatus("stopped", "The shadow watcher stopped. This page is the last saved view.");
    await new Promise((resolve) => setTimeout(resolve, 150));
    for (const subscriber of [...this.subscribers]) subscriber.close();
    await this.server.stop(true);
    this.server = undefined;
  }

  private decorateHtml(nonce: string): string {
    return this.html
      .replaceAll("__DASHBOARD_NONCE__", nonce)
      .replaceAll("__DASHBOARD_INSTANCE__", this.instanceId)
      .replace('data-dashboard-revision="0"', `data-dashboard-revision="${this.revision}"`);
  }

  private baseHeaders(contentType: string, nonce?: string): Headers {
    const headers = new Headers({
      "Content-Type": contentType,
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Resource-Policy": "same-origin",
    });
    if (nonce) {
      headers.set("Content-Security-Policy", `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'`);
    }
    return headers;
  }

  private handleRequest(request: Request): Response {
    const url = new URL(request.url);
    const expectedHost = `127.0.0.1:${this.server?.port}`;
    if (request.headers.get("host") !== expectedHost) return new Response("Invalid host.", { status: 421 });
    const origin = request.headers.get("origin");
    if (origin) {
      try {
        const parsedOrigin = new URL(origin);
        if (parsedOrigin.protocol !== "http:" || parsedOrigin.host !== expectedHost) return new Response("Cross-origin access is disabled.", { status: 403 });
      } catch {
        return new Response("Cross-origin access is disabled.", { status: 403 });
      }
    }
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed.", { status: 405, headers: { Allow: "GET, HEAD" } });

    if (url.pathname === "/") {
      const nonce = randomUUID().replaceAll("-", "");
      return new Response(request.method === "HEAD" ? null : this.decorateHtml(nonce), {
        headers: this.baseHeaders("text/html; charset=utf-8", nonce),
      });
    }
    if (url.pathname === "/api/dashboard") {
      return Response.json({ instanceId: this.instanceId, revision: this.revision, status: this.status, html: this.html }, {
        headers: this.baseHeaders("application/json; charset=utf-8"),
      });
    }
    if (url.pathname === "/events") return this.eventStream(request);
    return new Response("Not found.", { status: 404, headers: this.baseHeaders("text/plain; charset=utf-8") });
  }

  private eventStream(request: Request): Response {
    let subscriber: DashboardSubscriber | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        let closed = false;
        const close = () => {
          if (closed) return;
          closed = true;
          if (subscriber) {
            clearInterval(subscriber.heartbeat);
            this.subscribers.delete(subscriber);
          }
          try { controller.close(); } catch { /* The browser may already have disconnected. */ }
        };
        subscriber = {
          controller,
          heartbeat: setInterval(() => {
            try { controller.enqueue(encoder.encode(": keepalive\n\n")); }
            catch { close(); }
          }, 15_000),
          close,
        };
        this.subscribers.add(subscriber);
        controller.enqueue(encoder.encode(`event: status\ndata: ${JSON.stringify(this.status)}\n\n`));
        controller.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify({ instanceId: this.instanceId, revision: this.revision })}\n\n`));
      },
      cancel: () => subscriber?.close(),
    });
    request.signal.addEventListener("abort", () => subscriber?.close(), { once: true });
    return new Response(stream, {
      headers: new Headers({
        ...Object.fromEntries(this.baseHeaders("text/event-stream; charset=utf-8")),
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      }),
    });
  }

  private broadcast(event: "status" | "snapshot", payload: unknown): void {
    const encoded = encoder.encode(`event: ${event}\ndata: ${JSON.stringify(event === "snapshot" ? { instanceId: this.instanceId, ...payload as object } : payload)}\n\n`);
    for (const subscriber of [...this.subscribers]) {
      try { subscriber.controller.enqueue(encoded); }
      catch { subscriber.close(); }
    }
  }
}
