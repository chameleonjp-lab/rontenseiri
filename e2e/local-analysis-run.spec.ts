import { sampleProject } from "../src/analysis/sample";
import { expect, test, type Page } from "@playwright/test";
import type { LocalRunRecord } from "../src/storage/analysis-runs";
async function openRunPanel(page: Page) {
  await page
    .getByRole("button", { name: "端末内AIの評価", exact: true })
    .click();
  await expect(
    page.getByRole("region", {
      name: "ローカル解析経路の動作確認",
      exact: true,
    }),
  ).toBeVisible();
}
async function openSavedSample(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "サンプルを見てみる", exact: true })
    .click();
  await page
    .getByRole("button", { name: "この端末に保存", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "このブラウザに保存しました",
  );
  await openRunPanel(page);
}
async function readRecord(page: Page): Promise<LocalRunRecord> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("rontenseiri-analysis-runs-v1");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise<LocalRunRecord>((resolve, reject) => {
        const r = db.transaction("runs").objectStore("runs").getAll();
        r.onsuccess = () => resolve(r.result[0]);
        r.onerror = () => reject(r.error);
      });
    } finally {
      db.close();
    }
  });
}
async function alterRecord(page: Page, kind: "config" | "incomplete") {
  await page.evaluate(async (change) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("rontenseiri-analysis-runs-v1");
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("runs", "readwrite");
      const store = tx.objectStore("runs");
      const r = store.getAll();
      r.onsuccess = () => {
        const record = r.result[0];
        if (change === "config")
          record.checkpoint.configId = "nonmatching-config";
        else record.state = "running";
        store.put(record, record.id);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, kind);
}
async function reloadSaved(page: Page) {
  page.once("dialog", (dialog) => dialog.accept());
  await page.reload();
  await page.locator(".recent-open").first().click();
  await openRunPanel(page);
}
test("実Workerで開始→取消→再読込→k+1再開、先行chunk厳密一致、通信観測は別assert", async ({
  page,
  context,
}, testInfo) => {
  await page.addInitScript(() => {
    const observed: string[] = [];
    Object.assign(window, { __p2ChunkRequests: observed });
    const nativePost = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (
      message: unknown,
      ...rest: unknown[]
    ) {
      const data = message as {
        type?: string;
        phase?: string;
        chunk?: { id: string };
      };
      if (
        data.type === "transport-fixture" &&
        data.phase === "candidate" &&
        data.chunk
      )
        observed.push(data.chunk.id);
      return Reflect.apply(nativePost, this, [message, ...rest]);
    };
  });
  const requests: { url: string; method: string; body: string | null }[] = [];
  context.on("request", (request) =>
    requests.push({
      url: request.url(),
      method: request.method(),
      body: request.postData(),
    }),
  );
  const finishedRequests: string[] = [];
  const failedRequests: Array<{ url: string; error: string | undefined }> = [];
  context.on("requestfinished", (request) =>
    finishedRequests.push(request.url()),
  );
  context.on("requestfailed", (request) =>
    failedRequests.push({
      url: request.url(),
      error: request.failure()?.errorText,
    }),
  );
  const sockets: string[] = [];
  page.on("websocket", (socket) => sockets.push(socket.url()));
  const workers: string[] = [];
  page.on("worker", (worker) => workers.push(worker.url()));
  await openSavedSample(page);
  await page
    .getByRole("button", { name: "モデルなしで動作確認を開始", exact: true })
    .click();
  await expect
    .poll(async () => (await readRecord(page))?.checkpoint?.nextChunk ?? 0)
    .toBeGreaterThanOrEqual(2);
  const began = performance.now();
  await page
    .getByRole("button", { name: "動作確認を取り消す", exact: true })
    .click();
  await expect(page.getByTestId("local-run-state")).toContainText("取消済み");
  const cancellationMs = performance.now() - began;
  expect(cancellationMs).toBeLessThan(3000);
  const cancelled = await readRecord(page);
  const prefix = cancelled.checkpoint!.candidates;
  const k = cancelled.checkpoint!.nextChunk;
  expect(k).toBeGreaterThanOrEqual(2);
  expect(k).toBeLessThan(cancelled.total);
  expect(prefix).toHaveLength(k);
  await reloadSaved(page);
  await expect(page.getByTestId("local-run-state")).toContainText("取消済み");
  await page
    .getByRole("button", {
      name: "保存済みchunkの次から動作確認を再開",
      exact: true,
    })
    .click();
  await expect(page.getByTestId("local-run-state")).toContainText(
    "完了（動作確認のみ・AI解析未実施）",
  );
  const completed = await readRecord(page);
  expect(completed.state).toBe("completed");
  const resumedRequests = await page.evaluate(
    () =>
      (window as unknown as { __p2ChunkRequests: string[] }).__p2ChunkRequests,
  );
  expect(completed.checkpoint!.candidates.slice(0, k)).toEqual(prefix);
  const ids = completed.checkpoint!.candidates.map((c) => c.chunkId);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.length).toBe(completed.total);
  expect(resumedRequests).toEqual(ids.slice(k));
  expect(
    resumedRequests.filter((id) => prefix.some((c) => c.chunkId === id)),
  ).toEqual([]);
  expect(completed.checkpoint!.nextChunk).toBe(completed.total);
  expect(completed.checkpoint!.reconciled).toEqual({
    mode: "transport-only",
    chunkIds: ids,
  });
  expect(workers.filter((url) => url.includes("analysis.worker"))).toHaveLength(
    2,
  );
  await reloadSaved(page);
  await expect(page.getByTestId("local-run-state")).toContainText(
    "完了（動作確認のみ・AI解析未実施）",
  );
  expect(await readRecord(page)).toEqual(completed);
  // Independent observation assertions; no routing/mocking of Worker or requests.
  const origin = new URL(page.url()).origin;
  const external = requests.filter((r) => new URL(r.url).origin !== origin);
  expect(external, "observed external HTTP requests").toEqual([]);
  expect(
    sockets.filter((url) => new URL(url).host !== new URL(origin).host),
  ).toEqual([]);
  expect(requests.filter((r) => r.method !== "GET")).toEqual([]);
  const transcriptProbe = sampleProject().sources[0].text.slice(0, 30);
  expect(
    requests.some(
      (r) =>
        decodeURIComponent(r.url).includes(transcriptProbe) ||
        (r.body ?? "").includes(transcriptProbe),
    ),
  ).toBe(false);
  await testInfo.attach("p2-network-observation", {
    body: JSON.stringify(
      {
        requests,
        sockets,
        workers,
        external,
        finishedRequests,
        failedRequests,
        resumedRequests,
        serviceWorkerScope:
          "dev-server: no active Service Worker; production SW requests unverified",
        cancellationMs,
        k,
        total: completed.total,
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
  await page
    .getByRole("region", { name: "ローカル解析経路の動作確認", exact: true })
    .screenshot({ path: "artifacts/p2-completed-run.png" });
});
test("失敗・未完了・不一致checkpoint拒否を区別し、失敗を完了と表示しない", async ({
  page,
}) => {
  await openSavedSample(page);
  await page
    .getByLabel("動作確認シナリオ", { exact: true })
    .selectOption("fail-second");
  await page
    .getByRole("button", { name: "モデルなしで動作確認を開始", exact: true })
    .click();
  await expect(page.getByTestId("local-run-state")).toContainText("失敗");
  const failed = await readRecord(page);
  expect(failed.checkpoint!.nextChunk).toBe(1);
  expect(failed.checkpoint!.reconciled).toBeUndefined();
  await expect(page.getByTestId("local-run-state")).not.toContainText("完了");
  await alterRecord(page, "incomplete");
  await reloadSaved(page);
  await expect(page.getByTestId("local-run-state")).toContainText(
    "未完了（この画面では実行していません）",
  );
  await alterRecord(page, "config");
  const before = await readRecord(page);
  await page
    .getByRole("button", {
      name: "保存済みchunkの次から動作確認を再開",
      exact: true,
    })
    .click();
  await expect(page.getByTestId("local-run-state")).toContainText("失敗");
  await expect(
    page
      .getByRole("region", { name: "ローカル解析経路の動作確認", exact: true })
      .getByRole("alert"),
  ).toContainText("input/configuration mismatch");
  expect(await readRecord(page)).toEqual(before);
  await page
    .getByRole("button", { name: "最初から（checkpointを破棄）", exact: true })
    .click();
  await page
    .getByRole("button", { name: "モデルなしで動作確認を開始", exact: true })
    .click();
  await expect(page.getByTestId("local-run-state")).toContainText(
    "完了（動作確認のみ・AI解析未実施）",
  );
  expect((await readRecord(page)).runId).not.toBe(failed.runId);
});
test("IndexedDB: A取消→B所有→A遅延保存拒否、active transaction取消、半端commit拒否", async ({
  page,
}) => {
  await openSavedSample(page);
  await page
    .getByRole("button", { name: "モデルなしで動作確認を開始", exact: true })
    .click();
  await expect
    .poll(async () => (await readRecord(page))?.checkpoint?.nextChunk ?? -1)
    .toBeGreaterThanOrEqual(0);
  await page
    .getByRole("button", { name: "動作確認を取り消す", exact: true })
    .click();
  await expect(page.getByTestId("local-run-state")).toContainText("取消済み");
  const before = await readRecord(page);
  const result = await page.evaluate(async (record) => {
    // @ts-expect-error Vite serves the same persistence module used by the UI.
    const storage = await import("/src/storage/analysis-runs.ts");
    await storage.claimLocalRun(record.id, "generation-B", record.total);
    const baseline = await storage.readLocalRun(record.id);
    let stale = "",
      cancelled = "",
      midCancelled = false;
    try {
      await storage.writeLocalRun(record.id, record.owner, () => ({
        ...record,
        state: "completed",
      }));
    } catch (e) {
      stale = String(e);
    }
    const pre = new AbortController();
    pre.abort();
    try {
      await storage.writeLocalRun(
        record.id,
        "generation-B",
        (current: LocalRunRecord) => ({ ...current, state: "completed" }),
        pre.signal,
      );
    } catch (e) {
      cancelled = String(e);
    }
    const mid = new AbortController();
    try {
      await storage.writeLocalRun(
        record.id,
        "generation-B",
        (current: LocalRunRecord) => {
          mid.abort();
          return { ...current, state: "completed" };
        },
        mid.signal,
      );
    } catch {
      midCancelled = true;
    }
    const atomicFaults: string[] = [];
    for (const kind of ["cursor-only", "result-only"]) {
      try {
        await storage.writeLocalRun(
          record.id,
          "generation-B",
          (current: LocalRunRecord) => {
            const checkpoint = structuredClone(current.checkpoint!);
            if (kind === "cursor-only") {
              checkpoint.nextChunk++;
              checkpoint.lastCommittedChunkIndex = checkpoint.nextChunk - 1;
            } else checkpoint.candidates.push({ chunkId: "orphan", value: {} });
            return { ...current, checkpoint };
          },
        );
      } catch (e) {
        atomicFaults.push(String(e));
      }
    }
    return {
      baseline,
      stale,
      cancelled,
      midCancelled,
      atomicFaults,
      current: await storage.readLocalRun(record.id),
    };
  }, before);
  expect(result.stale).toContain("旧runの保存を拒否");
  expect(result.cancelled).toContain("cancelled");
  expect(result.midCancelled).toBe(true);
  expect(result.atomicFaults).toHaveLength(2);
  expect(
    result.atomicFaults.every((error) => error.includes("atomicity violation")),
  ).toBe(true);
  expect(result.current).toEqual(result.baseline);
  expect(result.current.owner).toBe("generation-B");
  expect(result.current.state).toBe("running");
});

test("破損cursor/result/引用spanの再開拒否はDB全体を不変にする", async ({
  page,
}) => {
  await openSavedSample(page);
  await page
    .getByLabel("動作確認シナリオ", { exact: true })
    .selectOption("fail-second");
  await page
    .getByRole("button", { name: "モデルなしで動作確認を開始", exact: true })
    .click();
  await expect(page.getByTestId("local-run-state")).toContainText("失敗");
  const saved = await readRecord(page);
  for (const kind of ["cursor-only", "result-only", "outside-span"]) {
    const corrupted = structuredClone(saved);
    if (kind === "cursor-only") {
      corrupted.checkpoint!.nextChunk++;
      corrupted.checkpoint!.lastCommittedChunkIndex =
        corrupted.checkpoint!.nextChunk - 1;
    }
    if (kind === "result-only")
      corrupted.checkpoint!.candidates.push(
        structuredClone(corrupted.checkpoint!.candidates[0]),
      );
    if (kind === "outside-span")
      corrupted.checkpoint!.chunkManifest![0].spans[0].end =
        Number.MAX_SAFE_INTEGER;
    await page.evaluate(async (record) => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const r = indexedDB.open("rontenseiri-analysis-runs-v1");
        r.onsuccess = () => resolve(r.result);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("runs", "readwrite");
        tx.objectStore("runs").put(record, record.id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    }, corrupted);
    await page
      .getByRole("button", {
        name: "保存済みchunkの次から動作確認を再開",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", {
        name: "保存済みchunkの次から動作確認を再開",
        exact: true,
      }),
    ).toBeEnabled();
    await expect(page.getByTestId("local-run-state")).toContainText("失敗");
    expect(await readRecord(page)).toEqual(corrupted);
  }
});

test("動作確認の取消・再開でfocusを保持し、Tab往復とEscape/×で同じ取消方針を使う", async ({
  page,
}) => {
  await openSavedSample(page);
  const start = page.getByRole("button", {
    name: "モデルなしで動作確認を開始",
    exact: true,
  });
  await start.focus();
  await page.keyboard.press("Enter");
  const cancel = page.getByRole("button", {
    name: "動作確認を取り消す",
    exact: true,
  });
  await expect(cancel).toBeFocused();
  await expect
    .poll(async () => (await readRecord(page))?.checkpoint?.nextChunk ?? 0)
    .toBeGreaterThanOrEqual(1);
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Enter");
  const resume = page.getByRole("button", {
    name: "保存済みchunkの次から動作確認を再開",
    exact: true,
  });
  await expect(resume).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", {
      name: "最初から（checkpointを破棄）",
      exact: true,
    }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(resume).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(cancel).toBeFocused();
  expect(
    await page
      .locator(".app-header")
      .evaluate((el) => (el as HTMLElement).inert),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "端末内AIの評価", exact: true }),
  ).toBeFocused();
  await expect
    .poll(async () => (await readRecord(page)).state)
    .toBe("cancelled");
  await openRunPanel(page);
  await expect(page.getByTestId("local-run-state")).toContainText("取消済み");
  await resume.click();
  await expect(cancel).toBeVisible();
  await page
    .getByRole("button", { name: "ダイアログを閉じる", exact: true })
    .click();
  await expect
    .poll(async () => (await readRecord(page)).state)
    .toBe("cancelled");
  await expect(
    page.getByRole("button", { name: "端末内AIの評価", exact: true }),
  ).toBeFocused();
  expect(
    await page
      .locator(".app-header")
      .evaluate((el) => (el as HTMLElement).inert),
  ).toBe(false);
});
