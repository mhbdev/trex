import { describe, expect, test } from "bun:test";
import { LocalDashboardServer } from "../packages/engine/src/adapters/http/local-dashboard-server.ts";

describe("local live dashboard server", () => {
  test("serves a read-only loopback report and versioned dashboard state", async () => {
    const server = new LocalDashboardServer(0,
      '<!doctype html><html><body><main id="report-content" data-dashboard-revision="0">before</main><script nonce="__DASHBOARD_NONCE__">connect()</script></body></html>');
    const url = server.start();
    try {
      const page = await fetch(url);
      const html = await page.text();
      expect(page.status).toBe(200);
      expect(page.headers.get("content-security-policy")).toContain("script-src 'nonce-");
      expect(html).toContain("nonce=");
      expect(html).not.toContain("__DASHBOARD_NONCE__");
      expect(page.headers.get("cache-control")).toContain("no-store");

      server.publishHtml('<!doctype html><html><body><main id="report-content" data-dashboard-revision="0">after</main></body></html>');
      server.publishStatus("waiting", "Cycle complete.");
      const response = await fetch(new URL("/api/dashboard", url));
      const state = await response.json() as { instanceId: string; revision: number; status: { state: string }; html: string };
      expect(response.status).toBe(200);
      expect(state.instanceId.length).toBeGreaterThan(0);
      expect(state.revision).toBe(1);
      expect(state.status.state).toBe("waiting");
      expect(state.html).toContain("after");

      const method = await fetch(url, { method: "POST" });
      expect(method.status).toBe(405);
      const crossOrigin = await fetch(url, { headers: { Origin: "null" } });
      expect(crossOrigin.status).toBe(403);
    } finally {
      await server.stop();
    }
  });

  test("opens an event stream with current engine status and report revision", async () => {
    const server = new LocalDashboardServer(0, "<!doctype html><html><body></body></html>");
    const url = server.start();
    const response = await fetch(new URL("/events", url));
    try {
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      const reader = response.body!.getReader();
      const first = await reader.read();
      const events = new TextDecoder().decode(first.value);
      expect(events).toContain("event: status");
      expect(events).toContain('"state":"starting"');
      expect(events).toContain("event: snapshot");
      const updatePromise = reader.read();
      server.publishHtml("updated report");
      server.publishStatus("evaluating", "Evaluating BTCTMN.");
      const update = new TextDecoder().decode((await updatePromise).value);
      expect(update).toContain('"revision":1');
      expect(update).toContain('"state":"evaluating"');
      await reader.cancel();
    } finally {
      await server.stop();
    }
  });
});

