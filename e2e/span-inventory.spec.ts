import { test, expect, type Page } from "@playwright/test";
import type { LocalRunRecord } from "../src/storage/analysis-runs";
import type { ReconciliationResult } from "../src/analysis/bounded-reconcile";
import { inventoryManifest } from "../src/analysis/span-inventory";
import { sampleProject } from "../src/analysis/sample";

async function openPanel(page: Page) {
  await page.getByRole("button", { name: "原文範囲台帳", exact: true }).click();
  await expect(
    page.getByRole("region", {
      name: "原文範囲台帳（意味解析なし）",
      exact: true,
    }),
  ).toBeVisible();
}
async function setup(page: Page) {
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
  await openPanel(page);
}
async function record(page: Page): Promise<LocalRunRecord> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("rontenseiri-analysis-runs-v1");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise<LocalRunRecord>((resolve, reject) => {
        const r = db.transaction("runs").objectStore("runs").getAll();
        r.onsuccess = () =>
          resolve(
            r.result.find((v: LocalRunRecord) =>
              v.id.startsWith("span-inventory:"),
            ),
          );
        r.onerror = () => reject(r.error);
      });
    } finally {
      db.close();
    }
  });
}
async function savedProjects(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open("rontenseiri-projects-v1");
      r.onsuccess = () => resolve(r.result);
    });
    try {
      return await new Promise((resolve) => {
        const r = db.transaction("projects").objectStore("projects").getAll();
        r.onsuccess = () => resolve(r.result);
      });
    } finally {
      db.close();
    }
  });
}
async function reload(page: Page) {
  await page.reload();
  await page.locator(".recent-open").first().click();
  await openPanel(page);
}
async function start(page: Page) {
  await page
    .getByRole("button", { name: "意味解析なしで台帳を開始", exact: true })
    .click();
  await expect(page.getByTestId("inventory-state")).toContainText(
    "部分結果（保存済み）",
  );
}
async function mutate(page: Page, fault: string) {
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
        const v = r.result.find((v: LocalRunRecord) =>
          v.id.startsWith("span-inventory:"),
        );
        if (change === "duplicate")
          v.checkpoint.reconciled.results.push(
            v.checkpoint.reconciled.results[0],
          );
        if (change === "version")
          v.checkpoint.candidates[0].value.evidence[0].sourceVersionId = "old";
        if (change === "status") v.state = "completed";
        if (change === "config") v.checkpoint.configId += "old";
        store.put(v, v.id);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, fault);
}

test("実Workerの原文範囲台帳: 部分保存→再読込→次ページで重複・欠落なし、議題不変、外部通信なし", async ({
  page,
  context,
}, info) => {
  await page.addInitScript(() => {
    const observed: Array<{
      phase: string;
      chunkId?: string;
      cursor?: number;
    }> = [];
    Object.assign(window, { __inventoryRequests: observed });
    const native = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (
      message: unknown,
      ...rest: unknown[]
    ) {
      const d = message as {
        phase?: string;
        chunk?: { id: string };
        cursor?: { nextPairIndex: number };
        type?: string;
      };
      if (d.phase && !d.type)
        observed.push({
          phase: d.phase,
          chunkId: d.chunk?.id,
          cursor: d.cursor?.nextPairIndex,
        });
      return Reflect.apply(native, this, [message, ...rest]);
    };
  });
  const requests: Array<{ url: string; method: string; body: string | null }> =
    [];
  const workers: string[] = [];
  const sockets: string[] = [];
  context.on("request", (r) =>
    requests.push({ url: r.url(), method: r.method(), body: r.postData() }),
  );
  page.on("worker", (w) => workers.push(w.url()));
  page.on("websocket", (s) => sockets.push(s.url()));
  await setup(page);
  const projectsBefore = await savedProjects(page);
  await start(page);
  const first = await record(page);
  const prefix = first.checkpoint!.reconciled as ReconciliationResult;
  expect(first.state).toBe("partial");
  expect(prefix.results).toHaveLength(8);
  const manifest = inventoryManifest(sampleProject());
  const total =
    (manifest.candidates.length * (manifest.candidates.length - 1)) / 2;
  expect(prefix.unexaminedRanges).toEqual([{ start: 8, end: total }]);
  await expect(page.getByTestId("inventory-result")).toContainText(
    `[8, ${total})`,
  );
  await page
    .getByRole("region", { name: "原文範囲台帳（意味解析なし）", exact: true })
    .screenshot({ path: "artifacts/r22-partial.png" });
  await reload(page);
  await expect(page.getByTestId("inventory-state")).toContainText(
    "部分結果（保存済み）",
  );
  expect(await record(page)).toEqual(first); // Read-only display cannot rewrite the durable record.
  let previous = prefix;
  for (let i = 0; i < Math.ceil(total / 8); i++) {
    if (previous.status === "complete") break;
    await page
      .getByRole("button", { name: "保存済みペアの次ページへ", exact: true })
      .click();
    await expect(page.getByTestId("inventory-state")).not.toContainText(
      "処理中",
    );
    await expect
      .poll(
        async () =>
          ((await record(page)).checkpoint!.reconciled as ReconciliationResult)
            .cursor.nextPairIndex,
      )
      .toBeGreaterThan(previous.cursor.nextPairIndex);
    const next = (await record(page)).checkpoint!
      .reconciled as ReconciliationResult;
    expect(next.results.slice(0, previous.results.length)).toEqual(
      previous.results,
    );
    expect(next.cursor.nextPairIndex).toBe(next.results.length);
    previous = next;
  }
  expect(previous.status).toBe("complete");
  expect(previous.unexaminedRanges).toEqual([]);
  const expected = manifest.candidates.flatMap((left, i) =>
    manifest.candidates.slice(i + 1).map((right) => ({
      leftId: left.id,
      rightId: right.id,
      disposition: "hold",
    })),
  );
  expect(previous.results).toEqual(expected);
  expect(
    new Set(previous.results.map((r) => `${r.leftId}|${r.rightId}`)).size,
  ).toBe(total);
  const resumed = await page.evaluate(
    () =>
      (
        window as unknown as {
          __inventoryRequests: Array<{ phase: string; cursor?: number }>;
        }
      ).__inventoryRequests,
  );
  expect(resumed.filter((r) => r.phase === "candidate")).toEqual([]);
  expect(
    resumed.filter((r) => r.phase === "reconcile").map((r) => r.cursor),
  ).toEqual(
    Array.from({ length: Math.ceil(total / 8) - 1 }, (_, i) => (i + 1) * 8),
  );
  const completed = await record(page);
  expect(completed.state).toBe("completed");
  await expect(page.getByTestId("inventory-state")).toContainText(
    "列挙完了（意味未判定）",
  );
  await reload(page);
  await expect(page.getByTestId("inventory-state")).toContainText(
    "列挙完了（意味未判定）",
  );
  expect(await record(page)).toEqual(completed);
  expect(await savedProjects(page)).toEqual(projectsBefore);
  const origin = new URL(page.url()).origin;
  expect(requests.filter((r) => new URL(r.url).origin !== origin)).toEqual([]);
  expect(requests.filter((r) => r.method !== "GET")).toEqual([]);
  expect(
    sockets.filter((u) => new URL(u).host !== new URL(origin).host),
  ).toEqual([]);
  expect(workers.length).toBeGreaterThan(1);
  expect(workers.every((u) => u.includes("inventory.worker"))).toBe(true);
  await info.attach("r22-worker-network-and-prefix", {
    body: JSON.stringify(
      {
        requests,
        workers,
        sockets,
        resumed,
        first,
        completed,
        scope:
          "dev-server actual Worker/IDB; no model. Not production SW or device/AI/performance acceptance",
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
  await page
    .getByRole("region", { name: "原文範囲台帳（意味解析なし）", exact: true })
    .screenshot({ path: "artifacts/r22-complete.png" });
});

for (const fault of ["duplicate", "version", "status", "config"]) {
  test(`破損・古い保存結果 ${fault} は表示・再開前に拒否し保存内容を変えない`, async ({
    page,
  }) => {
    await setup(page);
    await start(page);
    await mutate(page, fault);
    const before = await record(page);
    await reload(page);
    await expect(page.getByTestId("inventory-state")).toContainText("失敗");
    await expect(page.getByTestId("inventory-result")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /保存済みchunkから台帳を再開/ }),
    ).toBeDisabled();
    expect(await record(page)).toEqual(before);
  });
}

test("次ページ保存障害は既存ペアを失わず、再読込後も同じ次位置から再開する", async ({
  page,
}) => {
  await setup(page);
  await start(page);
  const first = await record(page);
  const prefix = first.checkpoint!.reconciled as ReconciliationResult;
  await page.evaluate(() => {
    const native = IDBObjectStore.prototype.put;
    let failed = false;
    IDBObjectStore.prototype.put = function (
      value: unknown,
      key?: IDBValidKey,
    ) {
      const v = value as LocalRunRecord;
      const result = v?.checkpoint?.reconciled as
        ReconciliationResult | undefined;
      if (
        !failed &&
        v?.id?.startsWith("span-inventory:") &&
        result &&
        result.cursor.nextPairIndex > 8
      ) {
        failed = true;
        throw new DOMException(
          "injected page quota failure",
          "QuotaExceededError",
        );
      }
      return key === undefined
        ? native.call(this, value)
        : native.call(this, value, key);
    };
  });
  await page
    .getByRole("button", { name: "保存済みペアの次ページへ", exact: true })
    .click();
  await expect.poll(async () => (await record(page)).state).toBe("failed");
  const failed = await record(page);
  expect(failed.checkpoint!.reconciled).toEqual(prefix);
  expect(failed.checkpoint!.candidates).toEqual(first.checkpoint!.candidates);
  await expect(page.getByRole("alert")).toContainText("quota failure");
  await reload(page);
  await expect(page.getByTestId("inventory-result")).toContainText(
    "次のペア位置: 8",
  );
  await page
    .getByRole("button", { name: "保存済みペアの次ページへ", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        ((await record(page)).checkpoint!.reconciled as ReconciliationResult)
          .cursor.nextPairIndex,
    )
    .toBe(16);
  const next = (await record(page)).checkpoint!
    .reconciled as ReconciliationResult;
  expect(next.results.slice(0, 8)).toEqual(prefix.results);
  expect(
    new Set(next.results.map((r) => `${r.leftId}|${r.rightId}`)).size,
  ).toBe(16);
});

test("部分結果はcompletedに昇格不可で、完了後の再実行は保存レコードを変更しない", async ({
  page,
}) => {
  await setup(page);
  await start(page);
  const first = await record(page);
  const rejected = await page.evaluate(async (r) => {
    const path = "/src/storage/analysis-runs.ts";
    const storage = await import(path);
    try {
      await storage.writeLocalRun(r.id, r.owner, (v: LocalRunRecord) => ({
        ...v,
        state: "completed",
      }));
      return false;
    } catch {
      return true;
    }
  }, first);
  expect(rejected).toBe(true);
  expect(await record(page)).toEqual(first);
  const manifest = inventoryManifest(sampleProject());
  const total =
    (manifest.candidates.length * (manifest.candidates.length - 1)) / 2;
  for (let i = 0; i < Math.ceil(total / 8); i++) {
    if ((await record(page)).state === "completed") break;
    await page
      .getByRole("button", { name: "保存済みペアの次ページへ", exact: true })
      .click();
    await expect(page.getByTestId("inventory-state")).not.toContainText(
      "処理中",
    );
  }
  const completed = await record(page);
  expect(completed.state).toBe("completed");
  const projectRecords = await savedProjects(page);
  await page.evaluate(async (projects) => {
    const path = "/src/analysis/inventory-run.ts";
    const run = await import(path);
    await run.runSpanInventory(
      (projects as any[])[0],
      new AbortController().signal,
      () => {},
    );
  }, projectRecords);
  expect(await record(page)).toEqual(completed);
});

test("次ページ応答前の取消は確定prefixを保持し、再読込後は同じ位置から続行する", async ({
  page,
}) => {
  await setup(page);
  await start(page);
  const first = await record(page);
  await page.evaluate(() => {
    const native = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (
      message: unknown,
      ...rest: unknown[]
    ) {
      const value = message as {
        phase?: string;
        cursor?: { nextPairIndex: number };
      };
      const returned = Reflect.apply(native, this, [message, ...rest]);
      if (value.phase === "reconcile" && value.cursor?.nextPairIndex === 8) {
        const cancel = [...document.querySelectorAll("button")].find(
          (b) => b.textContent === "台帳処理を取り消す",
        );
        if (!cancel) throw new Error("cancel button missing");
        cancel.click(); // Same main-thread turn: the real Worker reply has not been delivered.
      }
      return returned;
    };
  });
  await page
    .getByRole("button", { name: "保存済みペアの次ページへ", exact: true })
    .click();
  await expect.poll(async () => (await record(page)).state).toBe("cancelled");
  expect((await record(page)).checkpoint!.reconciled).toEqual(
    first.checkpoint!.reconciled,
  );
  await reload(page);
  await expect(page.getByTestId("inventory-result")).toContainText(
    "次のペア位置: 8",
  );
  await page
    .getByRole("button", { name: "保存済みペアの次ページへ", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        ((await record(page)).checkpoint!.reconciled as ReconciliationResult)
          .cursor.nextPairIndex,
    )
    .toBe(16);
  expect(
    (
      (await record(page)).checkpoint!.reconciled as ReconciliationResult
    ).results.slice(0, 8),
  ).toEqual((first.checkpoint!.reconciled as ReconciliationResult).results);
});
