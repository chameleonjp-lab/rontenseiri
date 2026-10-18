import { expect, test, type Page } from "@playwright/test";
import type { LocalRunRecord } from "../src/storage/analysis-runs";
import type { ReconciliationResult } from "../src/analysis/bounded-reconcile";
import { inventoryManifest } from "../src/analysis/span-inventory";
import type { Project } from "../src/domain/types";
import {
  installProjectReadGate,
  armProjectReadGate,
  projectReadGateState,
  releaseProjectReadGate,
} from "./helpers/project-read-gate";

const widths = [650, 651, 900, 901] as const;

async function record(page: Page): Promise<LocalRunRecord> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("rontenseiri-analysis-runs-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<LocalRunRecord>((resolve, reject) => {
        const request = db.transaction("runs").objectStore("runs").getAll();
        request.onsuccess = () => {
          const value = request.result.find((run: LocalRunRecord) =>
            run.id.startsWith("span-inventory:"),
          );
          if (!value) reject(new Error("span inventory run was not persisted"));
          else resolve(value);
        };
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  });
}

async function savedProjects(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("rontenseiri-projects-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<Project[]>((resolve, reject) => {
        const request = db
          .transaction("projects")
          .objectStore("projects")
          .getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  });
}

async function openInventory(page: Page) {
  const menu = page.getByRole("button", { name: "メニュー", exact: true });
  const entry = page.getByRole("button", {
    name: "原文範囲台帳",
    exact: true,
  });
  await expect(entry.or(menu).filter({ visible: true }).first()).toBeVisible();
  if (!(await entry.isVisible())) await menu.click();
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(
    page.getByRole("dialog", {
      name: "原文範囲台帳（意味解析なし）",
      exact: true,
    }),
  ).toBeVisible();
}

async function setup(page: Page, width: number) {
  await page.setViewportSize({ width, height: 980 });
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
  await openInventory(page);
}

async function reopenSavedProject(page: Page) {
  await page.reload();
  await armProjectReadGate(page);
  await page.locator("button.recent-open").first().click();
  await expect
    .poll(() => projectReadGateState(page))
    .toMatchObject({ blocked: true, reads: 1 });
  let finished = false;
  const opening = openInventory(page).then(() => {
    finished = true;
  });
  const duringRead = await projectReadGateState(page);
  expect(duringRead.blocked).toBe(true);
  expect(finished).toBe(false);
  await releaseProjectReadGate(page);
  await opening;
  return {
    duringRead,
    openingFinishedBeforeRead: false,
    afterRead: await projectReadGateState(page),
  };
}

for (const width of widths) {
  test(`実Worker台帳の保存・再開は${width}pxで厳密なprefixを維持する`, async ({
    page,
  }, info) => {
    const requests: Array<{ url: string; method: string }> = [];
    const workers: string[] = [];
    const sockets: string[] = [];
    const writes: Array<{ database: string; store?: string; method: string }> =
      [];
    await installProjectReadGate(page);
    await page.exposeFunction(
      "__r22ObserveWrite",
      (write: (typeof writes)[number]) => writes.push(write),
    );
    await page.addInitScript(() => {
      const pending: Promise<unknown>[] = [];
      (window as any).__r22WriteNotices = pending;
      const trace = (database: string, method: string, store?: string) => {
        if (
          !["rontenseiri-projects-v1", "rontenseiri-analysis-runs-v1"].includes(
            database,
          )
        )
          return;
        pending.push(
          (window as any).__r22ObserveWrite({ database, store, method }),
        );
      };
      const transaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (...args: any[]) {
        if (args[1] === "readwrite") trace(this.name, "readwrite-transaction");
        return Reflect.apply(transaction, this, args);
      } as typeof transaction;
      for (const method of ["put", "add", "delete", "clear"] as const) {
        const native = IDBObjectStore.prototype[method];
        IDBObjectStore.prototype[method] = function (...args: any[]) {
          trace(this.transaction.db.name, method, this.name);
          return Reflect.apply(native, this, args);
        } as any;
      }
    });
    page.on("request", (request) =>
      requests.push({ url: request.url(), method: request.method() }),
    );
    page.on("worker", (worker) => workers.push(worker.url()));
    page.on("websocket", (socket) => sockets.push(socket.url()));

    await setup(page, width);
    const projectsBefore = await savedProjects(page);
    expect(projectsBefore).toHaveLength(1);
    await page
      .getByRole("button", { name: "意味解析なしで台帳を開始", exact: true })
      .click();
    await expect(page.getByTestId("inventory-state")).toContainText(
      "部分結果（保存済み）",
    );

    const first = await record(page);
    const firstReconciled = first.checkpoint!
      .reconciled as ReconciliationResult;
    expect(first.state).toBe("partial");
    expect(firstReconciled.results).toHaveLength(8);
    expect(firstReconciled.cursor.nextPairIndex).toBe(8);
    const manifest = inventoryManifest(projectsBefore[0]);
    // Independent row-major manifest oracle: do not call the reconciler to
    // manufacture the expected page from the implementation under test.
    const expectedPairs = manifest.candidates.flatMap((left, index) =>
      manifest.candidates.slice(index + 1).map((right) => ({
        leftId: left.id,
        rightId: right.id,
        disposition: "hold",
      })),
    );
    const total = expectedPairs.length;
    expect(firstReconciled.results).toEqual(expectedPairs.slice(0, 8));
    expect(firstReconciled.unexaminedRanges).toEqual([
      { start: 8, end: total },
    ]);

    await page.evaluate(() => Promise.all((window as any).__r22WriteNotices));
    const writesBeforeReload = writes.length;
    const navigationReadiness = await reopenSavedProject(page);
    await expect(page.getByTestId("inventory-state")).toContainText(
      "部分結果（保存済み）",
    );
    expect(await record(page)).toEqual(first);
    await page.evaluate(() => Promise.all((window as any).__r22WriteNotices));
    const reloadWrites = writes.slice(writesBeforeReload);
    expect(reloadWrites).toEqual([]);

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
      .toBe(16);
    const resumed = await record(page);
    const resumedReconciled = resumed.checkpoint!
      .reconciled as ReconciliationResult;
    expect(resumed.state).toBe("partial");
    expect(resumedReconciled.results).toHaveLength(16);
    expect(resumedReconciled.results.slice(0, 8)).toEqual(
      firstReconciled.results,
    );
    expect(resumedReconciled.results.slice(8, 16)).toEqual(
      expectedPairs.slice(8, 16),
    );
    expect(resumedReconciled.results).toEqual(expectedPairs.slice(0, 16));
    expect(resumedReconciled.cursor.nextPairIndex).toBe(16);
    expect(resumedReconciled.unexaminedRanges).toEqual([
      { start: 16, end: total },
    ]);
    expect(
      new Set(
        resumedReconciled.results.map(
          (result) => `${result.leftId}|${result.rightId}`,
        ),
      ).size,
    ).toBe(16);
    expect(await savedProjects(page)).toEqual(projectsBefore);

    const origin = new URL(page.url()).origin;
    expect(
      sockets.filter((url) => new URL(url).host !== new URL(origin).host),
    ).toEqual([]);
    expect(
      requests.filter(({ url }) => {
        const parsed = new URL(url);
        return (
          !["data:", "blob:"].includes(parsed.protocol) &&
          parsed.origin !== origin
        );
      }),
    ).toEqual([]);
    expect(requests.filter((request) => request.method !== "GET")).toEqual([]);
    expect(workers.length).toBeGreaterThanOrEqual(2);
    expect(workers.every((url) => new URL(url).origin === origin)).toBe(true);
    expect(workers.every((url) => url.includes("inventory.worker"))).toBe(true);

    await info.attach(`r22-responsive-next-${width}.json`, {
      body: JSON.stringify(
        {
          width,
          workers,
          requests,
          sockets,
          first,
          resumed,
          expectedPairs: expectedPairs.slice(0, 16),
          reloadWrites,
          navigationReadiness,
          projectUnchanged: true,
          scope: "real inventory Worker + IndexedDB; no external AI/model",
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
  });
}
