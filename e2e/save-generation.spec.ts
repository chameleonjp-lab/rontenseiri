import { expect, test, type Page } from "@playwright/test";

type RaceLog = {
  attempts: Array<{ kind: string; revision?: number; key?: string }>;
  queued: string[];
  delivered: string[];
};

async function installSaveRaceGate(page: Page) {
  await page.addInitScript(() => {
    type Gate = {
      armed: boolean;
      baseline: number;
      failPuts: number;
      forcedFailures: number;
      attempts: Array<{ kind: string; revision?: number; key?: string }>;
      queued: Array<{ label: string; deliver: () => void }>;
      delivered: string[];
      releaseOne: () => void;
    };
    const gate: Gate = {
      armed: false,
      baseline: 0,
      failPuts: 0,
      forcedFailures: 0,
      attempts: [],
      queued: [],
      delivered: [],
      releaseOne() {
        const item = gate.queued.shift();
        if (!item) throw new Error("save race callback queue is empty");
        gate.delivered.push(item.label);
        item.deliver();
      },
    };
    Object.assign(window, { __saveRaceGate: gate });
    const nativePut = IDBObjectStore.prototype.put;
    const nativeGet = IDBObjectStore.prototype.get;
    const nativeAddEventListener = IDBRequest.prototype.addEventListener;
    const requestKinds = new WeakMap<IDBRequest, "put" | "get">();
    const contentKey = (value: any) => {
      if (!value || typeof value !== "object") return undefined;
      const { saved, updatedAt, storageRevision, ...content } = value;
      return JSON.stringify(content);
    };
    IDBObjectStore.prototype.put = function (...args: any[]) {
      if (this.name === "projects" && gate.armed) {
        const value = args[0] as any;
        gate.attempts.push({
          kind: "put-attempt",
          revision: value?.storageRevision,
          key: contentKey(value),
        });
        if (gate.failPuts > 0) {
          gate.failPuts -= 1;
          gate.forcedFailures += 1;
          throw new DOMException(
            "forced durable failure",
            "QuotaExceededError",
          );
        }
      }
      const request = nativePut.apply(this, args as any);
      if (this.name === "projects" && gate.armed) {
        requestKinds.set(request, "put");
      }
      return request;
    };
    IDBObjectStore.prototype.get = function (...args: any[]) {
      const request = nativeGet.apply(this, args as any);
      if (this.name !== "projects" || !gate.armed) return request;
      requestKinds.set(request, "get");
      return request;
    };
    const deliverSuccess = (request: IDBRequest, listener: EventListener) => {
      const kind = requestKinds.get(request);
      if (!kind || !gate.armed) return listener;
      return function (this: IDBRequest, event: Event) {
        const value = request.result as any;
        if (kind === "get" && value) {
          const revision = value.storageRevision ?? 0;
          gate.attempts.push({
            kind: "get-attempt",
            revision,
            key: contentKey(value),
          });
          if (revision > gate.baseline) {
            gate.queued.push({
              label: "loser-conflict",
              deliver: () => listener.call(request, event),
            });
            return;
          }
        }
        if (kind === "put") {
          gate.queued.push({
            label: "winner-success",
            deliver: () => listener.call(request, event),
          });
          return;
        }
        return listener.call(request, event);
      };
    };
    const requestDescriptor = Object.getOwnPropertyDescriptor(
      IDBRequest.prototype,
      "onsuccess",
    )!;
    Object.defineProperty(IDBRequest.prototype, "onsuccess", {
      configurable: requestDescriptor.configurable,
      enumerable: requestDescriptor.enumerable,
      get: requestDescriptor.get,
      set(listener: EventListener | null) {
        requestDescriptor.set!.call(
          this,
          listener && deliverSuccess(this, listener),
        );
      },
    });
    // Keep addEventListener covered for implementations that use it instead.
    IDBRequest.prototype.addEventListener = function (
      type: string,
      listener: any,
      options?: any,
    ) {
      if (type === "success" && listener) {
        return nativeAddEventListener.call(
          this,
          type,
          deliverSuccess(this, listener),
          options,
        );
      }
      return nativeAddEventListener.call(this, type, listener, options);
    };
  });
}

async function armGate(page: Page) {
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("rontenseiri-projects-v1");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const baseline = await new Promise<number>((resolve, reject) => {
      const request = db
        .transaction("projects")
        .objectStore("projects")
        .getAll();
      request.onsuccess = () =>
        resolve(
          (request.result[0]?.storageRevision as number | undefined) ?? 0,
        );
      request.onerror = () => reject(request.error);
    });
    db.close();
    const gate = (window as any).__saveRaceGate;
    gate.baseline = baseline;
    gate.armed = true;
  });
}

async function raceLog(page: Page): Promise<RaceLog> {
  return page.evaluate(() => {
    const gate = (window as any).__saveRaceGate;
    return {
      attempts: gate.attempts,
      queued: gate.queued.map((item: { label: string }) => item.label),
      delivered: gate.delivered,
    };
  });
}

async function editFirstSpeech(page: Page, text: string) {
  await page.locator('[data-id="U01"] .speech-hit').click();
  const panel = page.getByRole("complementary", {
    name: "選択した発言の詳細",
  });
  await panel.getByRole("button", { name: "発言・原文" }).click();
  await panel.getByLabel("訂正後の原文").fill(text);
  await panel
    .getByRole("textbox", { name: "変更理由", exact: true })
    .fill(text);
  await panel.getByRole("button", { name: "訂正を保存" }).click();
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
}

async function openInventory(page: Page) {
  await page.getByRole("button", { name: "原文範囲台帳", exact: true }).click();
  await expect(
    page.getByRole("region", {
      name: "原文範囲台帳（意味解析なし）",
      exact: true,
    }),
  ).toBeVisible();
}

test("同一内容・同一版の手動保存と自動保存は、勝者を先に届けて永続ゲートを閉じない", async ({
  page,
}, info) => {
  await installSaveRaceGate(page);
  await setup(page);
  await armGate(page);
  await editFirstSpeech(page, "Aさん：同一版の手動保存。");
  // Manual save is deliberately started before the 650ms autosave timer.
  await page
    .getByRole("button", { name: "この端末に保存", exact: true })
    .click();
  await expect
    .poll(async () => (await raceLog(page)).queued.length, {
      message:
        "manual winner and autosave conflict callbacks were not both queued",
    })
    .toBe(2);
  const queued = await raceLog(page);
  expect(
    queued.attempts.filter((a) => a.kind.endsWith("attempt")).length,
  ).toBeGreaterThanOrEqual(3);
  const matchingKeys = await page.evaluate(() => {
    const gate = (window as any).__saveRaceGate;
    const put = gate.attempts.find((a: any) => a.kind === "put-attempt");
    const conflict = gate.attempts.find(
      (a: any) => a.kind === "get-attempt" && a.revision > gate.baseline,
    );
    return { put: put?.key, conflict: conflict?.key };
  });
  expect(matchingKeys.put).toBe(matchingKeys.conflict);
  expect(queued.attempts.filter((a) => a.kind === "put-attempt")).toHaveLength(
    1,
  );
  expect(
    queued.attempts.filter((a) => a.kind === "get-attempt").length,
  ).toBeGreaterThanOrEqual(2);

  await page.evaluate(() => (window as any).__saveRaceGate.releaseOne());
  await expect
    .poll(async () => (await raceLog(page)).delivered)
    .toEqual(["winner-success"]);
  await page.evaluate(() => (window as any).__saveRaceGate.releaseOne());
  await expect
    .poll(async () => (await raceLog(page)).delivered)
    .toEqual(["winner-success", "loser-conflict"]);
  await openInventory(page);
  await expect(
    page.getByRole("button", { name: "意味解析なしで台帳を開始", exact: true }),
  ).toBeEnabled();
  await expect(page.locator(".save-recovery")).toHaveCount(0);
  const durable = await page.evaluate(async () => {
    const path = "/src/storage/projects.ts";
    const { listProjects } = await import(path);
    return listProjects();
  });
  await info.attach("same-content-save-race-order.json", {
    body: JSON.stringify({
      queued,
      matchingKeys,
      final: await raceLog(page),
      durable,
    }),
    contentType: "application/json",
  });
});

test("新しい意味編集の保存失敗はゲートを開けず、保存復旧後だけ台帳を再開できる", async ({
  page,
}, info) => {
  await setup(page);
  const projects = () =>
    page.evaluate(async () => {
      const path = "/src/storage/projects.ts";
      const { listProjects } = await import(path);
      return listProjects();
    });
  const runs = () =>
    page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("rontenseiri-analysis-runs-v1");
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise<any[]>((resolve, reject) => {
          const request = db.transaction("runs").objectStore("runs").getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      } finally {
        db.close();
      }
    });
  const before = await projects();
  await page.evaluate(() => {
    const state = { fail: true, rejected: [] as any[] };
    Object.assign(window, { __newRevisionFault: state });
    const native = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value: any, key?: IDBValidKey) {
      if (this.name === "projects" && state.fail) {
        state.rejected.push(structuredClone(value));
        throw new DOMException(
          "new-revision-durable-failure",
          "QuotaExceededError",
        );
      }
      return key === undefined
        ? native.call(this, value)
        : native.call(this, value, key);
    };
  });
  await editFirstSpeech(page, "Aさん：新しい意味編集の失敗。");
  await expect(page.locator(".save-state")).toContainText(
    "未保存の変更があります",
  );
  await page
    .getByRole("button", { name: "この端末に保存", exact: true })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "ブラウザの保存容量が不足" }),
  ).toBeVisible();
  const rejected = await page.evaluate(
    () => (window as any).__newRevisionFault.rejected,
  );
  expect(rejected.length).toBeGreaterThan(0);
  expect(rejected[0].sources).not.toEqual(before[0].sources);
  expect(await projects()).toEqual(before);
  await openInventory(page);
  await expect(
    page.getByRole("button", { name: "意味解析なしで台帳を開始", exact: true }),
  ).toBeDisabled();
  expect(await runs()).toEqual([]);
  await page
    .getByRole("button", { name: "ダイアログを閉じる", exact: true })
    .click();
  await page.evaluate(() => {
    (window as any).__newRevisionFault.fail = false;
  });
  await page
    .getByRole("button", { name: "この端末に保存", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "このブラウザに保存しました",
  );
  await openInventory(page);
  await expect(
    page.getByRole("button", { name: "意味解析なしで台帳を開始", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "意味解析なしで台帳を開始", exact: true })
    .click();
  await expect(page.getByTestId("inventory-state")).toContainText(
    "部分結果（保存済み）",
  );
  const first = (await runs())[0];
  expect(first.checkpoint.reconciled.cursor.nextPairIndex).toBe(8);
  await page.reload();
  await page.locator(".recent-open").first().click();
  await openInventory(page);
  await expect(page.getByTestId("inventory-state")).toContainText(
    "部分結果（保存済み）",
  );
  expect((await runs())[0]).toEqual(first);
  await page
    .getByRole("button", { name: "保存済みペアの次ページへ", exact: true })
    .click();
  await expect
    .poll(
      async () => (await runs())[0].checkpoint.reconciled.cursor.nextPairIndex,
    )
    .toBe(16);
  const next = (await runs())[0];
  expect(next.checkpoint.reconciled.results.slice(0, 8)).toEqual(
    first.checkpoint.reconciled.results,
  );
  expect(next.checkpoint.reconciled.results).toHaveLength(16);
  await info.attach("new-revision-failure-recovery-prefix.json", {
    body: JSON.stringify({ before, rejected, first, next }),
    contentType: "application/json",
  });
});
