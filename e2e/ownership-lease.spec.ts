import { test, expect } from "@playwright/test";

for (const mode of ["expiry", "cancel"] as const) {
  test(`所有権${mode}は旧Workerを停止し、後処理完了まで別タブへ資源を渡さない`, async ({
    page,
    context,
  }) => {
    await page.goto("/");
    const second = await context.newPage();
    await second.goto("/");
    const lockName = "r24-native-lease-handoff";
    await page.evaluate(
      async ({ name, mode }) => {
        const path = "/src/analysis/ownership.ts";
        const { withAnalysisOwnership } = await import(path);
        const controller = new AbortController();
        const state = {
          started: false,
          messages: 0,
          aborted: false,
          settled: false,
          rejected: false,
          finishCleanup: () => {},
          cancel: () => controller.abort(),
        };
        Object.assign(window, { __leaseFirst: state });
        void withAnalysisOwnership(
          async (lease: { signal: AbortSignal }) => {
            const blob = new Blob(
              ['setInterval(() => postMessage("alive"), 5)'],
              {
                type: "text/javascript",
              },
            );
            const url = URL.createObjectURL(blob);
            const worker = new Worker(url);
            worker.onmessage = () => state.messages++;
            state.started = true;
            try {
              await new Promise<void>((resolve) => {
                lease.signal.addEventListener(
                  "abort",
                  () => {
                    worker.terminate();
                    state.aborted = true;
                    // Model/Worker cleanup can be asynchronous. Keep the callback
                    // alive until this test explicitly confirms it is finished.
                    state.finishCleanup = resolve;
                  },
                  { once: true },
                );
              });
            } finally {
              worker.terminate();
              URL.revokeObjectURL(url);
            }
          },
          {
            lockName: name,
            ownerId: "first-tab",
            leaseMs: mode === "expiry" ? 500 : 10_000,
            signal: controller.signal,
          },
        ).then(
          () => (state.settled = true),
          () => {
            state.rejected = true;
            state.settled = true;
          },
        );
      },
      { name: lockName, mode },
    );
    await expect
      .poll(() => page.evaluate(() => (window as any).__leaseFirst.messages))
      .toBeGreaterThan(0);
    if (mode === "cancel")
      await page.evaluate(() => (window as any).__leaseFirst.cancel());
    await expect
      .poll(() => page.evaluate(() => (window as any).__leaseFirst.aborted))
      .toBe(true);
    await second.evaluate(async (name) => {
      const path = "/src/analysis/ownership.ts";
      const { withAnalysisOwnership } = await import(path);
      const state = { acquired: false, settled: false, finish: () => {} };
      Object.assign(window, { __leaseSecond: state });
      void withAnalysisOwnership(
        async () => {
          state.acquired = true;
          await new Promise<void>((resolve) => {
            state.finish = resolve;
          });
        },
        { lockName: name, ownerId: "second-tab", leaseMs: 10_000 },
      ).then(
        () => (state.settled = true),
        () => (state.settled = true),
      );
    }, lockName);
    await expect
      .poll(async () =>
        second.evaluate(async (name) => {
          const state = await navigator.locks.query();
          return state.pending?.some((lock) => lock.name === name) ?? false;
        }, lockName),
      )
      .toBe(true);
    expect(
      await second.evaluate(() => (window as any).__leaseSecond.acquired),
    ).toBe(false);
    expect(
      await page.evaluate(() => (window as any).__leaseFirst.settled),
    ).toBe(false);
    const afterAbort = await page.evaluate(
      () => (window as any).__leaseFirst.messages,
    );
    // Event-loop turns in the second tab cannot grant the still-held lock.
    await second.evaluate(() => new Promise(requestAnimationFrame));
    expect(
      await page.evaluate(() => (window as any).__leaseFirst.messages),
    ).toBe(afterAbort);
    await page.evaluate(() => (window as any).__leaseFirst.finishCleanup());
    await expect
      .poll(() => second.evaluate(() => (window as any).__leaseSecond.acquired))
      .toBe(true);
    await expect
      .poll(() => page.evaluate(() => (window as any).__leaseFirst.settled))
      .toBe(true);
    expect(
      await page.evaluate(() => (window as any).__leaseFirst.rejected),
    ).toBe(true);
    await second.evaluate(() => (window as any).__leaseSecond.finish());
    await expect
      .poll(() => second.evaluate(() => (window as any).__leaseSecond.settled))
      .toBe(true);
  });
}

test("所有タブ終了後は別タブが同じ解析ロックを取得できる", async ({
  page,
  context,
}) => {
  await page.goto("/");
  const second = await context.newPage();
  await second.goto("/");
  const lockName = "r24-native-tab-close-handoff";
  await page.evaluate(async (name) => {
    const path = "/src/analysis/ownership.ts";
    const { withAnalysisOwnership } = await import(path);
    Object.assign(window, { __leaseCloseOwner: false });
    void withAnalysisOwnership(
      async () => {
        (window as any).__leaseCloseOwner = true;
        await new Promise(() => {});
      },
      { lockName: name, ownerId: "closing-tab", leaseMs: 10_000 },
    );
  }, lockName);
  await expect
    .poll(() => page.evaluate(() => (window as any).__leaseCloseOwner))
    .toBe(true);
  await second.evaluate(async (name) => {
    const path = "/src/analysis/ownership.ts";
    const { withAnalysisOwnership } = await import(path);
    Object.assign(window, { __leaseAfterClose: false });
    void withAnalysisOwnership(
      async () => {
        (window as any).__leaseAfterClose = true;
      },
      { lockName: name, ownerId: "waiting-tab", leaseMs: 10_000 },
    );
  }, lockName);
  await expect
    .poll(() =>
      second.evaluate(async (name) => {
        const state = await navigator.locks.query();
        return state.pending?.some((lock) => lock.name === name) ?? false;
      }, lockName),
    )
    .toBe(true);
  expect(await second.evaluate(() => (window as any).__leaseAfterClose)).toBe(
    false,
  );
  await page.close();
  await expect
    .poll(() => second.evaluate(() => (window as any).__leaseAfterClose))
    .toBe(true);
});
