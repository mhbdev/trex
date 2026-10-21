import type { RunRepository } from "./ports.ts";

/** Renews a runner lease and permanently fails closed if ownership expires or changes. */
export class ExecutionLeaseGuard {
  private lost = false;
  private deadline: number;
  private readonly timer: ReturnType<typeof setInterval>;

  constructor(private readonly repository: RunRepository, private readonly name: string, private readonly owner: string,
    private readonly now: () => number, private readonly leaseMs: number) {
    this.deadline = now() + leaseMs;
    this.timer = setInterval(() => this.renew(), Math.max(250, Math.floor(leaseMs / 3)));
    this.timer.unref?.();
  }

  assertHeld(): void {
    const now = this.now();
    if (this.lost || now >= this.deadline || !this.repository.acquireExecutionLease(this.name, this.owner, now, this.leaseMs)) {
      this.lost = true;
      throw new Error(`Execution lease ${this.name} was lost; no further trading or portfolio writes are allowed.`);
    }
    this.deadline = now + this.leaseMs;
  }

  close(): void { clearInterval(this.timer); }

  private renew(): void {
    const now = this.now();
    if (this.lost || now >= this.deadline || !this.repository.acquireExecutionLease(this.name, this.owner, now, this.leaseMs)) {
      this.lost = true;
      return;
    }
    this.deadline = now + this.leaseMs;
  }
}
