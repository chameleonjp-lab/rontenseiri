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
  get pendingCount(): number {
    return this.queue.length;
  }
  async request(
    _name: string,
    options: { signal?: AbortSignal },
    callback: LockCallback,
  ): Promise<void> {
    await new Promise<void>((resolve) => {
      let canceled = false;
      const enter = () => {
        if (canceled) {
          resolve();
          return;
        }
        this.busy = true;
        Promise.resolve(
          callback({ name: "rontenseiri-analysis" } as Lock),
        ).then(() => {
          this.busy = false;
          resolve();
          this.queue.shift()?.();
        });
      };
      const cancel = () => {
        canceled = true;
        const index = this.queue.indexOf(enter);
        if (index >= 0) this.queue.splice(index, 1);
        resolve();
      };
      options.signal?.addEventListener("abort", cancel, { once: true });
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

  it("abort signals the held lease but only explicit release hands off the lock", async () => {
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
    expect(first.signal.aborted).toBe(true);
    expect(locks.pendingCount).toBe(1);
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
    const request = vi.spyOn(locks, "request");
    await expect(
      acquireAnalysisOwnership({ locks, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(request).not.toHaveBeenCalled();
  });

  it("removes a canceled acquisition from the native-like pending queue", async () => {
    const locks = new FixtureLocks();
    const first = await acquireAnalysisOwnership({
      locks,
      lockName: "pending-fixture",
    });
    const controller = new AbortController();
    const waiting = acquireAnalysisOwnership({
      locks,
      lockName: "pending-fixture",
      signal: controller.signal,
    });
    expect(locks.pendingCount).toBe(1);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    expect(locks.pendingCount).toBe(0);
    await first.release();
  });

  it("clears the acquisition timeout once a lease is granted", async () => {
    vi.useFakeTimers();
    try {
      const locks = new FixtureLocks();
      const lease = await acquireAnalysisOwnership({
        locks,
        lockName: "granted-timeout-fixture",
        timeoutMs: 10,
        leaseMs: 100,
      });
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(10);
      expect(lease.signal.aborted).toBe(false);
      await lease.release();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["sync", "async"] as const)(
    "cleans timers and caller listener after a %s request failure",
    async (mode) => {
      vi.useFakeTimers();
      try {
        const caller = new AbortController();
        const remove = vi.spyOn(caller.signal, "removeEventListener");
        const failure = new Error(`request-${mode}-failed`);
        const locks = {
          request: () => {
            if (mode === "sync") throw failure;
            return Promise.reject(failure);
          },
        };
        await expect(
          acquireAnalysisOwnership({
            locks,
            signal: caller.signal,
            timeoutMs: 10,
            lockName: `failed-${mode}`,
          }),
        ).rejects.toBe(failure);
        expect(vi.getTimerCount()).toBe(0);
        expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
      } finally {
        vi.useRealTimers();
      }
    },
  );

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
