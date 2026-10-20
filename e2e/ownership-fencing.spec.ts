import { test, expect, type Page, type TestInfo } from "@playwright/test";

type Evidence = {
  mode: "expiry" | "cancel" | "tab-close";
  oldEnvelope: Record<string, unknown>;
  newEnvelope: Record<string, unknown>;
  rejectionNames: string[];
  persistedSnapshots: Record<string, unknown>[];
  publicationCounts: { old: number; new: number };
  boundary?: string;
};

const runExpiryOrCancel = async (
  page: Page,
  second: Page,
  mode: "expiry" | "cancel",
): Promise<Evidence> => {
  const result = await page.evaluate(
    async ({ mode }) => {
      const ownership = await import("/src/analysis/ownership.ts");
      const storage = await import("/src/storage/analysis-runs.ts");
      const id = `r24-fence-${mode}-${crypto.randomUUID()}`;
      const runId = `r24-run-${crypto.randomUUID()}`;
      const fingerprint = "a".repeat(64);
      const oldOwner = `old-${mode}-${crypto.randomUUID()}`;
      const newOwner = `new-${mode}-${crypto.randomUUID()}`;
      const lockName = `r24-fence-lock-${crypto.randomUUID()}`;
      const total = 1;
      await storage.claimLocalRun(id, oldOwner, total, { runId, fingerprint });
      const initial = await storage.readLocalRun(id);
      if (!initial) throw new Error("old claim did not persist");
      const caller = new AbortController();
      const state = {
        prepared: null as Record<string, unknown> | null,
        committed: false,
        oldPublish: 0,
        newPublish: 0,
        cleanup: (() => {}) as () => void,
        settled: false,
        rejectionNames: [] as string[],
      };
      let finishOldCommit!: () => void;
      const oldCommitSettled = new Promise<void>((resolve) => {
        finishOldCommit = resolve;
      });
      (window as unknown as { __fence?: typeof state }).__fence = state;
      const workerSource = `
      let envelope;
      self.onmessage = ({ data }) => {
        if (data.type === "start") {
          envelope = data.envelope;
          self.postMessage({ type: "prepared", envelope });
        } else if (data.type === "resume") {
          self.postMessage({ type: "commit", envelope });
        }
      };
    `;
      const url = URL.createObjectURL(
        new Blob([workerSource], { type: "text/javascript" }),
      );
      const worker = new Worker(url);
      const envelope = {
        id,
        owner: oldOwner,
        generationId: oldOwner,
        runId,
        fingerprint,
        state: "running",
        error: `old-${mode}-must-not-publish`,
        total,
      };
      const prepared = new Promise<void>((resolve, reject) => {
        worker.onmessage = async ({ data }) => {
          if (data.type === "prepared") {
            state.prepared = data.envelope;
            resolve();
            return;
          }
          if (data.type === "commit") {
            state.committed = true;
            try {
              await storage.writeLocalRun(
                id,
                oldOwner,
                (current) => ({ ...current, error: data.envelope.error }),
                leaseSignal,
              );
              state.oldPublish++;
            } catch (error) {
              state.rejectionNames.push(
                error instanceof DOMException ? error.name : String(error),
              );
            } finally {
              finishOldCommit();
            }
          }
        };
        worker.onerror = reject;
      });
      let leaseSignal!: AbortSignal;
      const oldRun = ownership
        .withAnalysisOwnership(
          async (lease) => {
            leaseSignal = lease.signal;
            worker.postMessage({ type: "start", envelope });
            await prepared;
            await new Promise<void>((resolve) => {
              state.cleanup = resolve;
            });
          },
          {
            lockName,
            ownerId: oldOwner,
            leaseMs: mode === "expiry" ? 100 : 10_000,
            signal: caller.signal,
          },
        )
        .then(
          () => (state.settled = true),
          (error) => {
            state.rejectionNames.push(
              error instanceof DOMException ? error.name : String(error),
            );
            state.settled = true;
          },
        );
      await prepared;
      if (mode === "cancel") caller.abort();
      else await new Promise((resolve) => setTimeout(resolve, 180));
      if (!leaseSignal.aborted) throw new Error("lease did not abort");
      worker.postMessage({ type: "resume" });
      await oldCommitSettled;
      const afterLateWrite = await storage.readLocalRun(id);
      (window as any).__fenceCleanup = () => {
        worker.terminate();
        URL.revokeObjectURL(url);
        state.cleanup();
        return oldRun;
      };
      return {
        id,
        state,
        initial,
        afterLateWrite,
        newOwner,
        runId,
        fingerprint,
        total,
        lockName,
      };
    },
    { mode },
  );
  expect(result.afterLateWrite).toEqual(result.initial);
  expect(result.state.committed).toBe(true);
  expect(result.state.oldPublish).toBe(0);
  expect(result.state.rejectionNames).toEqual(["AbortError"]);
  const pending = await second.evaluate(
    async (name) => {
      const ownership = await import("/src/analysis/ownership.ts");
      const storage = await import("/src/storage/analysis-runs.ts");
      const state = { acquired: false, published: 0, settled: false };
      (window as any).__fenceSecond = state;
      void ownership
        .withAnalysisOwnership(
          async () => {
            state.acquired = true;
            await storage.claimLocalRun(name.id, name.owner, name.total, {
              runId: name.runId,
              fingerprint: name.fingerprint,
              expected: name.expected,
            });
            await storage.writeLocalRun(name.id, name.owner, (current) => ({
              ...current,
              error: `new-${name.mode}-published`,
            }));
            state.published++;
          },
          { lockName: name.lockName, ownerId: name.owner, leaseMs: 10_000 },
        )
        .then(
          () => (state.settled = true),
          () => (state.settled = true),
        );
      const locks = await navigator.locks.query();
      return (
        locks.pending?.some((lock) => lock.name === name.lockName) ?? false
      );
    },
    {
      id: result.id,
      owner: result.newOwner,
      runId: result.runId,
      fingerprint: result.fingerprint,
      total: result.total,
      expected: result.afterLateWrite,
      lockName: result.lockName,
      mode,
    },
  );
  if (!pending)
    throw new Error("second tab was not queued behind held native lock");
  await page.evaluate(() => (window as any).__fenceCleanup());
  await expect
    .poll(async () =>
      second.evaluate(() => (window as any).__fenceSecond?.acquired),
    )
    .toBe(true);
  await expect
    .poll(() => second.evaluate(() => (window as any).__fenceSecond?.settled))
    .toBe(true);
  await expect
    .poll(() => second.evaluate(() => (window as any).__fenceSecond?.published))
    .toBe(1);

  // Resolve the second tab's persisted record and replay the exact old envelope without its signal.
  const evidence = await second.evaluate(
    async ({ id, mode, oldEnvelope, oldSnapshot }) => {
      const storage = await import("/src/storage/analysis-runs.ts");
      const current = await storage.readLocalRun(id);
      const rejectionNames: string[] = [];
      try {
        await storage.writeLocalRun(
          id,
          oldEnvelope.owner as string,
          (record) => ({
            ...record,
            error: oldEnvelope.error as string,
          }),
        );
      } catch (error) {
        rejectionNames.push(
          error instanceof DOMException ? error.name : String(error),
        );
      }
      return { current, oldSnapshot, rejectionNames, mode };
    },
    {
      id: result.id,
      mode,
      oldEnvelope: result.state.prepared,
      oldSnapshot: result.afterLateWrite,
    },
  );
  const secondState = await second.evaluate(
    () => (window as any).__fenceSecond,
  );
  const persisted = await second.evaluate(async (id) => {
    const storage = await import("/src/storage/analysis-runs.ts");
    return storage.readLocalRun(id);
  }, result.id);
  const oldEnvelope = result.state.prepared!;
  const newEnvelope = persisted!;
  expect(oldEnvelope).toMatchObject({
    owner: oldEnvelope.generationId,
    runId: oldEnvelope.runId,
    fingerprint: "a".repeat(64),
  });
  expect(newEnvelope).toMatchObject({
    owner: newEnvelope.generationId,
    runId: oldEnvelope.runId,
    fingerprint: oldEnvelope.fingerprint,
  });
  expect(newEnvelope.owner).not.toBe(oldEnvelope.owner);
  expect(persisted).toEqual(evidence.current);
  expect(await page.evaluate(() => (window as any).__fence.oldPublish)).toBe(0);
  expect(secondState.published).toBe(1);
  expect(evidence.rejectionNames).toEqual(["Error: 旧runの保存を拒否しました"]);
  return {
    mode,
    oldEnvelope,
    newEnvelope,
    rejectionNames: [
      ...result.state.rejectionNames,
      ...evidence.rejectionNames,
    ],
    persistedSnapshots: [
      result.initial,
      result.afterLateWrite,
      evidence.current,
      persisted,
    ],
    publicationCounts: {
      old: result.state.oldPublish,
      new: secondState.published,
    },
  };
};

test.describe("ownership fencing: prepared Blob Worker envelopes", () => {
  for (const mode of ["expiry", "cancel"] as const) {
    test(`${mode}: late worker write is fenced before publish, then handoff succeeds`, async ({
      page,
      context,
    }, testInfo) => {
      await page.goto("/");
      const second = await context.newPage();
      await second.goto("/");
      const evidence = await runExpiryOrCancel(page, second, mode);
      await testInfo.attach(`r24-fence-${mode}.json`, {
        body: JSON.stringify(evidence, null, 2),
        contentType: "application/json",
      });
      expect(evidence.persistedSnapshots.at(-1)).toMatchObject({
        owner: evidence.newEnvelope.owner,
        generationId: evidence.newEnvelope.generationId,
        runId: evidence.newEnvelope.runId,
        fingerprint: evidence.newEnvelope.fingerprint,
        error: `new-${mode}-published`,
      });
    });
  }

  test("tab close: captured dead-worker envelope cannot contaminate the new owner", async ({
    page,
    context,
  }, testInfo) => {
    await page.goto("/");
    const second = await context.newPage();
    await second.goto("/");
    const evidence = await page.evaluate(async () => {
      const ownership = await import("/src/analysis/ownership.ts");
      const storage = await import("/src/storage/analysis-runs.ts");
      const id = `r24-fence-close-${crypto.randomUUID()}`;
      const runId = `r24-run-${crypto.randomUUID()}`;
      const fingerprint = "a".repeat(64);
      const owner = `closed-${crypto.randomUUID()}`;
      const lockName = "r24-fence-close-lock";
      await storage.claimLocalRun(id, owner, 1, { runId, fingerprint });
      const initial = await storage.readLocalRun(id);
      const envelope = {
        id,
        owner,
        generationId: owner,
        runId,
        fingerprint,
        state: "running",
        error: "closed-old-must-not-publish",
        total: 1,
      };
      const worker = new Worker(
        URL.createObjectURL(
          new Blob(
            [
              "self.onmessage=e=>e.data.type==='prepare'&&postMessage(e.data.envelope)",
            ],
            { type: "text/javascript" },
          ),
        ),
      );
      const prepared = new Promise<Record<string, unknown>>(
        (resolve) => (worker.onmessage = (event) => resolve(event.data)),
      );
      let resolvePrepared!: () => void;
      const ready = new Promise<void>((resolve) => (resolvePrepared = resolve));
      void ownership.withAnalysisOwnership(
        async () => {
          worker.postMessage({ type: "prepare", envelope });
          const oldEnvelope = await prepared;
          (window as any).__closedOldEnvelope = oldEnvelope;
          resolvePrepared();
          await new Promise<void>(() => {});
        },
        { lockName, ownerId: owner, leaseMs: 10_000 },
      );
      await ready;
      return {
        id,
        runId,
        fingerprint,
        lockName,
        initial,
        oldEnvelope: (window as any).__closedOldEnvelope,
      };
    });
    await page.close();
    const result = await second.evaluate(async (input) => {
      const ownership = await import("/src/analysis/ownership.ts");
      const storage = await import("/src/storage/analysis-runs.ts");
      const owner = `survivor-${crypto.randomUUID()}`;
      const state = { published: 0, observedOld: undefined as unknown };
      await ownership.withAnalysisOwnership(
        async () => {
          const expected = await storage.readLocalRun(input.id);
          state.observedOld = expected;
          await storage.claimLocalRun(input.id, owner, 1, {
            runId: input.runId,
            fingerprint: input.fingerprint,
            expected,
          });
          await storage.writeLocalRun(input.id, owner, (record) => ({
            ...record,
            error: "new-tab-close-published",
          }));
          state.published++;
        },
        { lockName: "r24-fence-close-lock", ownerId: owner, leaseMs: 10_000 },
      );
      const beforeReplay = await storage.readLocalRun(input.id);
      const rejectionNames: string[] = [];
      try {
        await storage.writeLocalRun(
          input.id,
          input.oldEnvelope.owner as string,
          (record) => ({ ...record, error: input.oldEnvelope.error as string }),
        );
      } catch (error) {
        rejectionNames.push(
          error instanceof DOMException ? error.name : String(error),
        );
      }
      return {
        owner,
        initial: input.initial,
        observedOld: state.observedOld,
        beforeReplay,
        afterReplay: await storage.readLocalRun(input.id),
        rejectionNames,
        published: state.published,
      };
    }, evidence);
    const finalEvidence: Evidence = {
      mode: "tab-close",
      oldEnvelope: evidence.oldEnvelope,
      newEnvelope: { ...result.beforeReplay },
      rejectionNames: result.rejectionNames,
      persistedSnapshots: [
        result.initial,
        result.observedOld as Record<string, unknown>,
        result.beforeReplay,
        result.afterReplay,
      ],
      publicationCounts: { old: 0, new: result.published },
      boundary:
        "The former tab was closed after capturing the prepared envelope; its dead Worker could not resume. The surviving tab replayed that exact envelope without the old signal after native Lock auto-release.",
    };
    await testInfo.attach("r24-fence-tab-close.json", {
      body: JSON.stringify(finalEvidence, null, 2),
      contentType: "application/json",
    });
    expect(result.published).toBe(1);
    expect(result.observedOld).toEqual(result.initial);
    expect(result.initial).toMatchObject({
      owner: evidence.oldEnvelope.owner,
      generationId: evidence.oldEnvelope.generationId,
      runId: evidence.runId,
      fingerprint: evidence.fingerprint,
    });
    expect(result.owner).not.toBe(evidence.oldEnvelope.owner);
    expect(result.afterReplay).toEqual(result.beforeReplay);
    expect(result.afterReplay).toMatchObject({
      owner: result.owner,
      generationId: result.owner,
      runId: evidence.runId,
      fingerprint: evidence.fingerprint,
      error: "new-tab-close-published",
    });
    expect(result.rejectionNames).toEqual(["Error: 旧runの保存を拒否しました"]);
  });
});
