import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startAdminServer } from "../apps/cli/src/admin-server.ts";
import { dashboardIsBuilt, probeDashboard } from "../apps/cli/src/launcher.ts";

describe("start launcher", () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

  test("recognizes a running Trex service, a free port, and a port used by something else", async () => {
    const instance = await startAdminServer({ port: 0, databaseUrl: ":memory:", environment: {} });
    cleanups.push(() => instance.close());
    expect(await probeDashboard(instance.address)).toBe("running");

    const other = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("hello") });
    cleanups.push(() => { other.stop(true); });
    expect(await probeDashboard(`http://127.0.0.1:${other.port}`)).toBe("occupied");

    const free = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
    const freePort = free.port;
    free.stop(true);
    expect(await probeDashboard(`http://127.0.0.1:${freePort}`)).toBe("stopped");
  });

  test("detects whether the dashboard bundle exists", async () => {
    const directory = await mkdtemp(join(tmpdir(), "trex-launcher-"));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    expect(dashboardIsBuilt(directory)).toBe(false);
    await mkdir(join(directory, "dist"), { recursive: true });
    await writeFile(join(directory, "dist", "index.html"), "<html></html>");
    expect(dashboardIsBuilt(directory)).toBe(true);
  });
});
