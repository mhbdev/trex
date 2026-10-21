import { afterEach, describe, expect, test } from "bun:test";
import { startAdminServer } from "../apps/cli/src/admin-server.ts";

describe("loopback admin API", () => {
  const servers: Array<Awaited<ReturnType<typeof startAdminServer>>> = [];
  afterEach(async () => {
    for (const instance of servers.splice(0)) await instance.close();
  });

  test("serves profiles behind the per-session token and validates live confirmation", async () => {
    const instance = await startAdminServer({ port: 0, databaseUrl: ":memory:", environment: { AI_API_KEY: "private-admin-test-key" } });
    servers.push(instance);
    const origin = instance.address;
    const sessionResponse = await fetch(`${origin}/api/session`);
    expect(sessionResponse.status).toBe(200);
    const session = await sessionResponse.json() as { token: string };
    const headers = { "x-trex-session": session.token };
    const writeHeaders = { ...headers, origin, "content-type": "application/json" };

    const bootstrap = await fetch(`${origin}/api/bootstrap`, { headers });
    expect(bootstrap.status).toBe(200);
    const bootstrapBody = await bootstrap.json() as { profiles: Array<{ name: string; secrets: Record<string, unknown> }>; activeProfileId: string; config: Record<string, unknown> };
    expect(bootstrapBody.profiles[0]?.name).toBe("Default");
    expect(JSON.stringify(bootstrapBody)).not.toContain("private-admin-test-key");

    const noToken = await fetch(`${origin}/api/profiles`, {
      method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ name: "Blocked" }),
    });
    expect(noToken.status).toBe(401);
    const badOrigin = await fetch(`${origin}/api/profiles`, {
      method: "POST", headers: { ...writeHeaders, origin: "https://example.invalid" }, body: JSON.stringify({ name: "Blocked" }),
    });
    expect(badOrigin.status).toBe(403);

    const created = await fetch(`${origin}/api/profiles`, {
      method: "POST", headers: writeHeaders, body: JSON.stringify({ name: "Review" }),
    });
    expect(created.status).toBe(201);

    const secretAsSetting = await fetch(`${origin}/api/settings`, {
      method: "PUT", headers: writeHeaders,
      body: JSON.stringify({ profileId: "unused", settings: { AI_API_KEY: "do-not-echo-this" } }),
    });
    expect(secretAsSetting.status).toBe(400);
    expect(await secretAsSetting.text()).not.toContain("do-not-echo-this");

    const unconfirmedLive = await fetch(`${origin}/api/runs`, {
      method: "POST", headers: writeHeaders,
      body: JSON.stringify({ mode: "live", profileId: bootstrapBody.activeProfileId, symbol: "BTCTMN", strategyId: "agentic-balanced", confirmed: false }),
    });
    expect(unconfirmedLive.status).toBe(400);

    const eventResponse = await fetch(`${origin}/api/events?token=${encodeURIComponent(session.token)}`);
    expect(eventResponse.status).toBe(200);
    const reader = eventResponse.body!.getReader();
    const firstEvent = await reader.read();
    expect(new TextDecoder().decode(firstEvent.value)).toContain("event: state");
    await reader.cancel();
  });
});
