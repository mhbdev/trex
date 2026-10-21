import { describe, expect, test } from "bun:test";
import { ExecutionLeaseGuard } from "../packages/engine/src/application/execution-lease.ts";
import type { RunRepository } from "../packages/engine/src/application/ports.ts";

describe("execution lease guard", () => {
  test("never reacquires after lease ownership expires or changes", () => {
    let now = 0;
    let acquisitions = 0;
    let available = true;
    const repository = {
      acquireExecutionLease: () => { acquisitions++; return available; },
    } as unknown as RunRepository;
    const guard = new ExecutionLeaseGuard(repository, "wallex-live", "owner-1", () => now, 60_000);
    try {
      now = 100;
      guard.assertHeld();
      expect(acquisitions).toBe(1);
      available = false;
      expect(() => guard.assertHeld()).toThrow("was lost");
      available = true;
      expect(() => guard.assertHeld()).toThrow("was lost");
      expect(acquisitions).toBe(2);
      now = 60_101;
      expect(() => guard.assertHeld()).toThrow("was lost");
      expect(acquisitions).toBe(2);
    } finally { guard.close(); }
  });
});

