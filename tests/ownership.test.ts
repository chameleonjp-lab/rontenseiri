import { describe, expect, it, vi } from "vitest";
import {
  acquireAnalysisOwnership,
  OwnershipTimeoutError,
  OwnershipUnavailableError,
  withAnalysisOwnership,
} from "../src/analysis/ownership";

type LockCallback = (lock: Lock | null) => Promise<void> | void;
class FixtureLocks {
  async query(): Promise<LockManagerSnapshot> {
    return { held: [], pending: [] };
  }

  private busy = false;
  private queue: Array<() => void> = [];
  async request(_name: string, callback: LockCallback): Promise<void> {
    await new Promise<void>((resolve) => {
      const enter = () => {
        this.busy = true;
        Promise.resolve(
          callback({ name: "rontenseiri-analysis" } as Lock),
        ).then(() => {
          this.busy = false;
          resolve();
          this.queue.shift()?.();
        });
      };
      if (this.busy) this.queue.push(enter);
      else enter();
    });
  }
}

describe("analysis ownership", () => {
  it("explicitly rejects when Web Locks are unavailable", async () => {
    await expect(
      acquireAnalysisOwnership({ locks: {} as LockManager }),
    ).rejects.toBeInstanceOf(OwnershipUnavailableError);
  });

  it("serializes competing tabs and times out the second owner", async () => {
    const locks = new FixtureLocks();
    const first = await acquireAnalysisOwnership({
      locks,
      ownerId: "tab-a",
      lockName: "fixture",
    });
    await expect(
      acquireAnalysisOwnership({
        locks,
        ownerId: "tab-b",
        lockName: "fixture",
        timeoutMs: 5,
      }),
    ).rejects.toBeInstanceOf(OwnershipTimeoutError);
    await first.release();
    const second = await acquireAnalysisOwnership({
      locks,
      ownerId: "tab-b",
      lockName: "fixture",
    });
    await second.release();
  });

  it("abort releases a held lock and does not leave a queued tab blocked", async () => {
    const locks = new FixtureLocks();
    const controller = new AbortController();
    const first = await acquireAnalysisOwnership({
      locks,
      ownerId: "tab-a",
      lockName: "abort-fixture",
      signal: controller.signal,
    });
    const waiting = acquireAnalysisOwnership({
      locks,
      ownerId: "tab-b",
      lockName: "abort-fixture",
      timeoutMs: 100,
    });
    controller.abort();
    await first.release();
    const second = await waiting;
    await second.release();
  });

  it("withAnalysisOwnership always releases after failure and permits the next run", async () => {
    const locks = new FixtureLocks();
    await expect(
      withAnalysisOwnership(
        async () => {
          throw new Error("fixture failure");
        },
        { locks, lockName: "finally-fixture" },
      ),
    ).rejects.toThrow("fixture failure");
    await expect(
      withAnalysisOwnership(async () => "next", {
        locks,
        lockName: "finally-fixture",
      }),
    ).resolves.toBe("next");
  });

  it("rejects an already-aborted acquisition without invoking the lock callback", async () => {
    const locks = new FixtureLocks();
    const controller = new AbortController();
    controller.abort();
    await expect(
      acquireAnalysisOwnership({ locks, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("does not hand off an expired lock until the active work releases it", async () => {
    vi.useFakeTimers();
    try {
      const locks = new FixtureLocks();
      const first = await acquireAnalysisOwnership({
        locks,
        lockName: "expiry-fixture",
        leaseMs: 10,
      });
      await vi.advanceTimersByTimeAsync(10);
      expect(first.signal.aborted).toBe(true);
      const blocked = acquireAnalysisOwnership({
        locks,
        lockName: "expiry-fixture",
        timeoutMs: 1,
      });
      const blockedExpectation = expect(blocked).rejects.toBeInstanceOf(
        OwnershipTimeoutError,
      );
      await vi.advanceTimersByTimeAsync(1);
      await blockedExpectation;
      await first.release();
      const next = await acquireAnalysisOwnership({
        locks,
        lockName: "expiry-fixture",
      });
      await next.release();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a late successful value after lease expiry and cleanup", async () => {
    vi.useFakeTimers();
    try {
      const locks = new FixtureLocks();
      let finish!: () => void;
      const pending = withAnalysisOwnership(
        async () => {
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
          return "stale-success";
        },
        { locks, lockName: "late-expired-result", leaseMs: 10 },
      );
      const rejected = expect(pending).rejects.toMatchObject({
        name: "AbortError",
      });
      await vi.advanceTimersByTimeAsync(10);
      finish();
      await rejected;
      await expect(
        withAnalysisOwnership(async () => "next", {
          locks,
          lockName: "late-expired-result",
        }),
      ).resolves.toBe("next");
    } finally {
      vi.useRealTimers();
    }
  });
});
