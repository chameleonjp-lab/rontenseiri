import { expect, test, type Page } from "@playwright/test";
import type { LocalRunRecord } from "../src/storage/analysis-runs";
import type { ReconciliationResult } from "../src/analysis/bounded-reconcile";
import { inventoryManifest } from "../src/analysis/span-inventory";
import { sampleProject } from "../src/analysis/sample";

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
      return await new Promise<unknown[]>((resolve, reject) => {
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
  if (await menu.isVisible()) await menu.click();
  const entry = page.getByRole("button", {
    name: "原文範囲台帳",
    exact: true,
  });
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
  await page.locator("button.recent-open").first().click();
  await openInventory(page);
}

for (const width of widths) {
  test(`実Worker台帳の保存・再開は${width}pxで厳密なprefixを維持する`, async ({
    page,
  }, info) => {
    const requests: Array<{ url: string; method: string }> = [];
    const workers: string[] = [];
    const sockets: string[] = [];
    page.on("request", (request) =>
      requests.push({ url: request.url(), method: request.method() }),
    );
    page.on("worker", (worker) => workers.push(worker.url()));
    page.on("websocket", (socket) => sockets.push(socket.url()));

    await setup(page, width);
    const projectsBefore = await savedProjects(page);
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
    const manifest = inventoryManifest(sampleProject());
    const total =
      (manifest.candidates.length * (manifest.candidates.length - 1)) / 2;
    expect(firstReconciled.unexaminedRanges).toEqual([
      { start: 8, end: total },
    ]);

    await reopenSavedProject(page);
    await expect(page.getByTestId("inventory-state")).toContainText(
      "部分結果（保存済み）",
    );
    expect(await record(page)).toEqual(first);

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
    expect(resumedReconciled.cursor.nextPairIndex).toBe(16);
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
