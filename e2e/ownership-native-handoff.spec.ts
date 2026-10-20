import { expect, test } from "@playwright/test";

async function namedLocks(page: import("@playwright/test").Page, name: string) {
  return page.evaluate(async (lockName) => {
    const state = await navigator.locks.query();
    return {
      held: state.held?.filter((lock) => lock.name === lockName).length ?? 0,
      pending:
        state.pending?.filter((lock) => lock.name === lockName).length ?? 0,
    };
  }, name);
}

test("real three-page native handoff cancels held work without stale publication", async ({
  page,
  context,
}, info) => {
  await page.goto("/");
  const lockName = `r24-native-handoff-${crypto.randomUUID()}`;
  const stageOrder: string[] = [];

  await page.evaluate(async (name) => {
    const { acquireAnalysisOwnership } =
      await import("/src/analysis/ownership.ts");
    (window as any).__handoffA = await acquireAnalysisOwnership({
      lockName: name,
    });
  }, lockName);
  stageOrder.push("A-held");

  const second = await context.newPage();
  await second.goto("/");
  const bInitial = await second.evaluate(async (name) => {
    const { withAnalysisOwnership } =
      await import("/src/analysis/ownership.ts");
    const caller = new AbortController();
    let releaseWork!: () => void;
    const workGate = new Promise<string>((resolve) => {
      releaseWork = () => resolve("late-B-payload");
    });
    const state = {
      caller,
      releaseWork,
      workStarts: 0,
      workReturned: 0,
      thenPublications: 0,
      settled: false,
      error: "",
      returnedPayload: "",
      leaseAborted: false,
    };
    (window as any).__handoffB = state;
    void withAnalysisOwnership(
      async (lease) => {
        state.workStarts++;
        state.leaseAborted = lease.signal.aborted;
        lease.signal.addEventListener(
          "abort",
          () => {
            state.leaseAborted = true;
          },
          { once: true },
        );
        const payload = await workGate;
        state.workReturned++;
        state.returnedPayload = payload;
        return payload;
      },
      { lockName: name, signal: caller.signal },
    ).then(
      () => {
        state.thenPublications++;
        state.settled = true;
      },
      (error: unknown) => {
        state.error = (error as Error).name;
        state.settled = true;
      },
    );
    const locks = await navigator.locks.query();
    return {
      held: locks.held?.filter((lock) => lock.name === name).length ?? 0,
      pending: locks.pending?.filter((lock) => lock.name === name).length ?? 0,
    };
  }, lockName);
  expect(bInitial).toEqual({ held: 1, pending: 1 });
  stageOrder.push("B-queued");

  await page.evaluate(() => (window as any).__handoffA.release());
  await expect
    .poll(() => second.evaluate(() => (window as any).__handoffB.workStarts))
    .toBe(1);
  stageOrder.push("A-released-B-granted-work-started");

  const third = await context.newPage();
  await third.goto("/");
  const cInitial = await third.evaluate(async (name) => {
    const { withAnalysisOwnership } =
      await import("/src/analysis/ownership.ts");
    const state = {
      workStarts: 0,
      thenPublications: 0,
      settled: false,
      error: "",
    };
    (window as any).__handoffC = state;
    void withAnalysisOwnership(
      async () => {
        state.workStarts++;
        return "C-payload";
      },
      { lockName: name },
    ).then(
      () => {
        state.thenPublications++;
        state.settled = true;
      },
      (error: unknown) => {
        state.error = (error as Error).name;
        state.settled = true;
      },
    );
    const locks = await navigator.locks.query();
    return {
      held: locks.held?.filter((lock) => lock.name === name).length ?? 0,
      pending: locks.pending?.filter((lock) => lock.name === name).length ?? 0,
    };
  }, lockName);
  expect(cInitial).toEqual({ held: 1, pending: 1 });
  expect(
    await third.evaluate(() => (window as any).__handoffC.workStarts),
  ).toBe(0);
  stageOrder.push("C-queued-work-0");

  await second.evaluate(() => (window as any).__handoffB.caller.abort());
  await expect
    .poll(() => second.evaluate(() => (window as any).__handoffB.leaseAborted))
    .toBe(true);
  const afterCancel = await namedLocks(page, lockName);
  expect(afterCancel).toEqual({ held: 1, pending: 1 });
  const cWorkBeforeBRelease = await third.evaluate(
    () => (window as any).__handoffC.workStarts,
  );
  expect(cWorkBeforeBRelease).toBe(0);
  stageOrder.push("B-cancelled-lease-aborted-C-still-pending-work-0");

  await second.evaluate(() => (window as any).__handoffB.releaseWork());
  await expect
    .poll(() => second.evaluate(() => (window as any).__handoffB.settled))
    .toBe(true);
  await expect
    .poll(() => third.evaluate(() => (window as any).__handoffC.settled))
    .toBe(true);
  const bFinal = await second.evaluate(() => {
    const state = (window as any).__handoffB;
    return {
      workStarts: state.workStarts,
      workReturned: state.workReturned,
      returnedPayload: state.returnedPayload,
      thenPublications: state.thenPublications,
      error: state.error,
      leaseAborted: state.leaseAborted,
    };
  });
  expect(bFinal).toEqual({
    workStarts: 1,
    workReturned: 1,
    returnedPayload: "late-B-payload",
    thenPublications: 0,
    error: "AbortError",
    leaseAborted: true,
  });
  stageOrder.push("B-work-returned-published-0");

  const cFinal = await third.evaluate(() => (window as any).__handoffC);
  expect(cFinal).toEqual({
    workStarts: 1,
    thenPublications: 1,
    settled: true,
    error: "",
  });
  const final = await namedLocks(page, lockName);
  expect(final).toEqual({ held: 0, pending: 0 });
  stageOrder.push("C-acquired-work-1-published-1-final-queue-empty");

  const evidence = {
    lockName,
    stageOrder,
    bInitial,
    cInitial,
    afterCancel,
    leaseAborted: bFinal.leaseAborted,
    cPendingWhileBBlocked: afterCancel.pending,
    cWorkBeforeBRelease,
    bWorkReturned: bFinal.workReturned,
    bReturnedPayload: bFinal.returnedPayload,
    bPublished: bFinal.thenPublications,
    bRejection: bFinal.error,
    cWork: cFinal.workStarts,
    cPublished: cFinal.thenPublications,
    final,
  };
  await info.attach("r24-native-handoff-pre.json", {
    body: JSON.stringify(evidence),
    contentType: "application/json",
  });
});
