import { expect, test, type Page } from "@playwright/test";

type DeadlineControl = {
  stopCapturing(): void;
  count(): number;
  deliver(): void;
  restore(): void;
};

async function controlAcquisitionDeadline(page: Page, delay: number) {
  await page.evaluate((targetDelay) => {
    const originalSetTimeout = window.setTimeout;
    const originalClearTimeout = window.clearTimeout;
    const captured = new Map<number, () => void>();
    let armed = true;
    window.setTimeout = ((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => {
      if (armed && timeout === targetDelay && typeof handler === "function") {
        const id = originalSetTimeout.call(window, () => {}, timeout);
        // Disable the real deadline immediately. Only explicit delivery below
        // can invoke this acquisition callback, regardless of rAF scheduling.
        originalClearTimeout.call(window, id);
        captured.set(id, () => handler(...args));
        return id;
      }
      return originalSetTimeout.call(window, handler, timeout, ...args);
    }) as typeof window.setTimeout;
    window.clearTimeout = ((id?: number) => {
      if (id !== undefined) captured.delete(id);
      return originalClearTimeout.call(window, id);
    }) as typeof window.clearTimeout;
    (
      window as Window & { __r24AcquisitionDeadline?: DeadlineControl }
    ).__r24AcquisitionDeadline = {
      stopCapturing() {
        armed = false;
      },
      count() {
        return captured.size;
      },
      deliver() {
        if (captured.size !== 1)
          throw new Error("exactly one acquisition deadline required");
        captured.values().next().value!();
      },
      restore() {
        window.setTimeout = originalSetTimeout;
        window.clearTimeout = originalClearTimeout;
      },
    };
  }, delay);
}

for (const mode of ["caller cancel", "timeout"] as const) {
  test(`native grant then ${mode} rejects controlled delivery and clears the captured deadline`, async ({
    page,
  }, info) => {
    await page.goto("/");
    const timeoutMs = mode === "timeout" ? 20 : 2_000;
    await controlAcquisitionDeadline(page, timeoutMs);
    const result = await page.evaluate(
      async ({ mode, timeoutMs }) => {
        const { acquireAnalysisOwnership } =
          await import("/src/analysis/ownership.ts");
        const deadline = (
          window as Window & { __r24AcquisitionDeadline: DeadlineControl }
        ).__r24AcquisitionDeadline;
        const lockName = `r24-controlled-${mode}-${crypto.randomUUID()}`;
        const caller = new AbortController();
        let openGate!: () => void;
        const deliveryGate = new Promise<void>((resolve) => {
          openGate = resolve;
        });
        const state = { nativeCallbackEntered: false };
        const nativeRequest = navigator.locks.request.bind(navigator.locks);
        const controlledLocks: LockManager = {
          request: (name, options, callback) =>
            nativeRequest(name, options, async (lock) => {
              state.nativeCallbackEntered = true;
              await deliveryGate;
              return callback(lock);
            }),
        } as LockManager;
        try {
          const pending = acquireAnalysisOwnership({
            locks: controlledLocks,
            lockName,
            signal: caller.signal,
            timeoutMs,
            leaseMs: 2_000,
          });
          deadline.stopCapturing();
          while (!state.nativeCallbackEntered)
            await new Promise(requestAnimationFrame);
          const capturedTimersBefore = deadline.count();
          if (mode === "timeout") deadline.deliver();
          else caller.abort();
          const rejection = await pending.then(
            () => "fulfilled",
            (error: unknown) => (error as Error).name,
          );
          const capturedTimersAfter = deadline.count();
          openGate();
          await new Promise(requestAnimationFrame);
          const native = await navigator.locks.query();
          return {
            lockName,
            controlledDelivery: true,
            controlledAcquisitionDeadline: true,
            timeoutDelivery: mode === "timeout" ? "explicit" : "not delivered",
            nativeCallbackEntered: state.nativeCallbackEntered,
            capturedTimersBefore,
            capturedTimersAfter,
            rejection,
            held:
              native.held?.filter((lock) => lock.name === lockName).length ?? 0,
            pending:
              native.pending?.filter((lock) => lock.name === lockName).length ??
              0,
          };
        } finally {
          openGate();
          deadline.restore();
        }
      },
      { mode, timeoutMs },
    );
    expect(result).toEqual({
      lockName: result.lockName,
      controlledDelivery: true,
      controlledAcquisitionDeadline: true,
      timeoutDelivery: mode === "timeout" ? "explicit" : "not delivered",
      nativeCallbackEntered: true,
      capturedTimersBefore: 1,
      capturedTimersAfter: 0,
      rejection: mode === "timeout" ? "OwnershipTimeoutError" : "AbortError",
      held: 0,
      pending: 0,
    });
    await info.attach(
      `grant-vs-${mode === "timeout" ? "timeout" : "caller-cancel"}.json`,
      { body: JSON.stringify(result), contentType: "application/json" },
    );
  });
}

test("post-grant caller abort aborts the lease but release remains the native handoff boundary", async ({
  page,
}, info) => {
  await page.goto("/");
  const lockName = `r24-post-grant-abort-${Date.now()}`;
  const result = await page.evaluate(async (name) => {
    const { acquireAnalysisOwnership } =
      await import("/src/analysis/ownership.ts");
    const caller = new AbortController();
    const lease = await acquireAnalysisOwnership({
      lockName: name,
      signal: caller.signal,
      leaseMs: 2_000,
    });
    caller.abort();
    const afterAbort = await navigator.locks.query();
    const successor = acquireAnalysisOwnership({
      lockName: name,
      ownerId: "successor",
      timeoutMs: 100,
      leaseMs: 2_000,
    });
    await new Promise(requestAnimationFrame);
    const whileHeld = await navigator.locks.query();
    await lease.release();
    const next = await successor;
    await next.release();
    return {
      leaseAborted: lease.signal.aborted,
      afterAbort:
        afterAbort.held?.filter((lock) => lock.name === name).length ?? 0,
      successorPending:
        whileHeld.pending?.filter((lock) => lock.name === name).length ?? 0,
      handoffCompleted: true,
    };
  }, lockName);
  expect(result).toEqual({
    leaseAborted: true,
    afterAbort: 1,
    successorPending: 1,
    handoffCompleted: true,
  });
  await info.attach("post-grant-caller-abort.json", {
    body: JSON.stringify({ lockName, ...result }),
    contentType: "application/json",
  });
});

test("null-lock cleanup uses explicit ifAvailable delivery, not the normal blocking call", async ({
  page,
}, info) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { acquireAnalysisOwnership } =
      await import("/src/analysis/ownership.ts");
    const lockName = `r24-null-lock-${crypto.randomUUID()}`;
    const holder = await new Promise<LockManagerSnapshot>((resolve, reject) => {
      void navigator.locks.request(lockName, {}, async (lock) => {
        if (!lock)
          return reject(new Error("holder unexpectedly received null"));
        resolve(await navigator.locks.query());
        await new Promise(() => {});
      });
    });
    const caller = new AbortController();
    const listeners = new Set<EventListenerOrEventListenerObject>();
    const add = caller.signal.addEventListener.bind(caller.signal);
    const remove = caller.signal.removeEventListener.bind(caller.signal);
    caller.signal.addEventListener = ((type, listener, options) => {
      if (type === "abort") listeners.add(listener);
      add(type, listener, options);
    }) as typeof caller.signal.addEventListener;
    caller.signal.removeEventListener = ((type, listener, options) => {
      if (type === "abort") listeners.delete(listener);
      remove(type, listener, options);
    }) as typeof caller.signal.removeEventListener;
    const nullLocks: LockManager = {
      request: (name, _options, callback) =>
        navigator.locks.request(name, { ifAvailable: true }, callback),
    } as LockManager;
    let errorName = "";
    try {
      await acquireAnalysisOwnership({
        locks: nullLocks,
        lockName,
        signal: caller.signal,
        timeoutMs: 100,
      });
    } catch (error) {
      errorName = (error as Error).name;
    }
    const after = await navigator.locks.query();
    caller.abort();
    return {
      lockName,
      explicitIfAvailable: true,
      holderHeld:
        holder.held?.filter((lock) => lock.name === lockName).length ?? 0,
      errorName,
      listeners: listeners.size,
      held: after.held?.filter((lock) => lock.name === lockName).length ?? 0,
      pending:
        after.pending?.filter((lock) => lock.name === lockName).length ?? 0,
    };
  });
  expect(result).toMatchObject({
    explicitIfAvailable: true,
    holderHeld: 1,
    errorName: "OwnershipTimeoutError",
    listeners: 0,
    held: 1,
    pending: 0,
  });
  await info.attach("null-lock-cleanup.json", {
    body: JSON.stringify(result),
    contentType: "application/json",
  });
});

test("release removes the exact product caller listener and clears ownership timers", async ({
  page,
}, info) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { acquireAnalysisOwnership } =
      await import("/src/analysis/ownership.ts");
    const lockName = `r24-listener-cleanup-${crypto.randomUUID()}`;
    const caller = new AbortController();
    const listeners = new Set<EventListenerOrEventListenerObject>();
    const add = caller.signal.addEventListener.bind(caller.signal);
    const remove = caller.signal.removeEventListener.bind(caller.signal);
    caller.signal.addEventListener = ((type, listener, options) => {
      if (type === "abort") listeners.add(listener);
      add(type, listener, options);
    }) as typeof caller.signal.addEventListener;
    caller.signal.removeEventListener = ((type, listener, options) => {
      if (type === "abort") listeners.delete(listener);
      remove(type, listener, options);
    }) as typeof caller.signal.removeEventListener;
    const activeTimers = new Set<number>();
    const originalSetTimeout = window.setTimeout.bind(window);
    const originalClearTimeout = window.clearTimeout.bind(window);
    window.setTimeout = ((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => {
      const id = originalSetTimeout(handler, timeout, ...args);
      activeTimers.add(id);
      return id;
    }) as typeof window.setTimeout;
    window.clearTimeout = ((id?: number) => {
      if (id !== undefined) activeTimers.delete(id);
      return originalClearTimeout(id);
    }) as typeof window.clearTimeout;
    try {
      const lease = await acquireAnalysisOwnership({
        lockName,
        signal: caller.signal,
        timeoutMs: 2_000,
        leaseMs: 2_000,
      });
      const afterGrant = {
        listeners: listeners.size,
        timers: activeTimers.size,
      };
      caller.abort();
      const beforeRelease = {
        leaseAborted: lease.signal.aborted,
        nativeHeld:
          (await navigator.locks.query()).held?.filter(
            (lock) => lock.name === lockName,
          ).length ?? 0,
      };
      await lease.release();
      return {
        lockName,
        afterGrant,
        beforeRelease,
        afterRelease: { listeners: listeners.size, timers: activeTimers.size },
      };
    } finally {
      window.setTimeout = originalSetTimeout;
      window.clearTimeout = originalClearTimeout;
    }
  });
  expect(result.afterGrant.listeners).toBe(1);
  expect(result.afterGrant.timers).toBe(1);
  expect(result.beforeRelease).toEqual({ leaseAborted: true, nativeHeld: 1 });
  expect(result.afterRelease).toEqual({ listeners: 0, timers: 0 });
  await info.attach("caller-listener-timer-cleanup.json", {
    body: JSON.stringify(result),
    contentType: "application/json",
  });
});
