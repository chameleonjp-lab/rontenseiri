import { expect, test, type Page } from "@playwright/test";

async function namedLocks(page: Page, name: string) {
  return page.evaluate(async (name) => {
    const state = await navigator.locks.query();
    return {
      held: state.held?.filter((lock) => lock.name === name).length ?? 0,
      pending: state.pending?.filter((lock) => lock.name === name).length ?? 0,
    };
  }, name);
}

for (const mode of ["cancel", "timeout"] as const) {
  test(`待機中の${mode}はnative queueを除去し次タブだけを開始する`, async ({
    page,
    context,
  }, info) => {
    await page.goto("/");
    const lockName = `r24-pending-${mode}-${Date.now()}`;
    await page.evaluate(async (lockName) => {
      const { acquireAnalysisOwnership } =
        await import("/src/analysis/ownership.ts");
      (window as any).__pendingOwner = await acquireAnalysisOwnership({
        lockName,
        leaseMs: 10_000,
      });
    }, lockName);

    const second = await context.newPage();
    await second.goto("/");
    const queued = await second.evaluate(
      async ({ mode, lockName }) => {
        const { withAnalysisOwnership } =
          await import("/src/analysis/ownership.ts");
        const caller = new AbortController();
        const listeners = new Set<EventListenerOrEventListenerObject>();
        const add = caller.signal.addEventListener.bind(caller.signal);
        const remove = caller.signal.removeEventListener.bind(caller.signal);
        caller.signal.addEventListener = ((
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: AddEventListenerOptions | boolean,
        ) => {
          if (type === "abort") listeners.add(listener);
          add(type, listener, options);
        }) as typeof caller.signal.addEventListener;
        caller.signal.removeEventListener = ((
          type: string,
          listener: EventListenerOrEventListenerObject,
          options?: EventListenerOptions | boolean,
        ) => {
          if (type === "abort") listeners.delete(listener);
          remove(type, listener, options);
        }) as typeof caller.signal.removeEventListener;
        const state = {
          started: 0,
          settled: false,
          error: "",
          caller,
          listeners,
        };
        (window as any).__pendingLoser = state;
        void withAnalysisOwnership(
          async () => {
            state.started++;
          },
          {
            lockName,
            signal: caller.signal,
            timeoutMs: mode === "timeout" ? 100 : 0,
            leaseMs: 10_000,
          },
        ).then(
          () => {
            state.settled = true;
          },
          (error) => {
            state.error = error.name;
            state.settled = true;
          },
        );
        const locks = await navigator.locks.query();
        return (
          locks.pending?.filter((lock) => lock.name === lockName).length ?? 0
        );
      },
      { mode, lockName },
    );
    expect(queued).toBe(1);
    if (mode === "cancel")
      await second.evaluate(() =>
        (window as any).__pendingLoser.caller.abort(),
      );
    await expect
      .poll(() => second.evaluate(() => (window as any).__pendingLoser.settled))
      .toBe(true);
    const afterCancel = await second.evaluate(() => {
      const state = (window as any).__pendingLoser;
      return {
        started: state.started,
        error: state.error,
        retainedListeners: state.listeners.size,
      };
    });
    expect(afterCancel).toEqual({
      started: 0,
      error: mode === "cancel" ? "AbortError" : "OwnershipTimeoutError",
      retainedListeners: 0,
    });
    // This assertion distinguishes actual native queue removal from merely rejecting the caller's promise.
    await expect
      .poll(() => namedLocks(page, lockName))
      .toEqual({ held: 1, pending: 0 });

    const third = await context.newPage();
    await third.goto("/");
    await third.evaluate(async (lockName) => {
      const { withAnalysisOwnership } =
        await import("/src/analysis/ownership.ts");
      const state = { started: 0, settled: false, error: "" };
      (window as any).__pendingSuccessor = state;
      void withAnalysisOwnership(
        async () => {
          state.started++;
        },
        { lockName, leaseMs: 10_000 },
      ).then(
        () => {
          state.settled = true;
        },
        (error) => {
          state.error = error.name;
          state.settled = true;
        },
      );
    }, lockName);
    await expect
      .poll(() => namedLocks(page, lockName))
      .toEqual({ held: 1, pending: 1 });
    expect(
      await third.evaluate(() => (window as any).__pendingSuccessor.started),
    ).toBe(0);
    await page.evaluate(() => (window as any).__pendingOwner.release());
    await expect
      .poll(() =>
        third.evaluate(() => (window as any).__pendingSuccessor.settled),
      )
      .toBe(true);
    expect(
      await third.evaluate(() => (window as any).__pendingSuccessor),
    ).toEqual({ started: 1, settled: true, error: "" });
    expect(
      await second.evaluate(() => (window as any).__pendingLoser.started),
    ).toBe(0);
    await expect
      .poll(() => namedLocks(page, lockName))
      .toEqual({ held: 0, pending: 0 });
    await info.attach(`pending-${mode}-native-queue.json`, {
      body: JSON.stringify({
        mode,
        lockName,
        initialPending: queued,
        afterCancel,
        successorStarted: 1,
        final: await namedLocks(page, lockName),
      }),
      contentType: "application/json",
    });
  });
}

test("既に取消された要求はnative queueへ入らずworkを開始しない", async ({
  page,
}, info) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { withAnalysisOwnership } =
      await import("/src/analysis/ownership.ts");
    const lockName = `r24-pre-abort-${crypto.randomUUID()}`;
    const caller = new AbortController();
    caller.abort();
    let started = 0;
    let error = "";
    try {
      await withAnalysisOwnership(
        async () => {
          started++;
        },
        { lockName, signal: caller.signal },
      );
    } catch (e) {
      error = (e as Error).name;
    }
    const state = await navigator.locks.query();
    return {
      started,
      error,
      held: state.held?.filter((lock) => lock.name === lockName).length ?? 0,
      pending:
        state.pending?.filter((lock) => lock.name === lockName).length ?? 0,
    };
  });
  expect(result).toEqual({
    started: 0,
    error: "AbortError",
    held: 0,
    pending: 0,
  });
  await info.attach("pre-abort-no-native-queue.json", {
    body: JSON.stringify(result),
    contentType: "application/json",
  });
});
