import { expect, test, type Page, type TestInfo } from "@playwright/test";

type Row = {
  id: string;
  storageRevision?: number;
  utterances: Array<{ id: string; quote: string }>;
};

async function installStaleSuccessGate(page: Page) {
  await page.addInitScript(() => {
    type Gate = {
      armed: boolean;
      heldPuts: Array<() => void>;
      timers: Array<() => void>;
      putAttempts: number;
      releasePut: () => void;
      releaseTimer: () => void;
    };
    const gate: Gate = {
      armed: false,
      heldPuts: [],
      timers: [],
      putAttempts: 0,
      releasePut() {
        const deliver = gate.heldPuts.shift();
        if (!deliver)
          throw new Error("stale-success put callback queue is empty");
        deliver();
      },
      releaseTimer() {
        const run = gate.timers.shift();
        if (!run) throw new Error("stale-success 650ms timer queue is empty");
        run();
      },
    };
    Object.assign(window, { __staleSuccessGate: gate });

    const nativePut = IDBObjectStore.prototype.put;
    const nativeAddEventListener = IDBRequest.prototype.addEventListener;
    const requestKinds = new WeakMap<IDBRequest, "put">();
    IDBObjectStore.prototype.put = function (...args: any[]) {
      const request = nativePut.apply(this, args as any);
      if (this.name === "projects" && gate.armed) {
        gate.putAttempts++;
        requestKinds.set(request, "put");
      }
      return request;
    };
    const holdSuccess = (request: IDBRequest, listener: EventListener) => {
      if (requestKinds.get(request) !== "put" || !gate.armed) return listener;
      return function (this: IDBRequest, event: Event) {
        gate.heldPuts.push(() => listener.call(request, event));
      };
    };
    IDBRequest.prototype.addEventListener = function (
      type: string,
      listener: any,
      options?: any,
    ) {
      if (type === "success" && listener) {
        return nativeAddEventListener.call(
          this,
          type,
          holdSuccess(this, listener),
          options,
        );
      }
      return nativeAddEventListener.call(this, type, listener, options);
    };

    const nativeSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = ((
      handler: TimerHandler,
      timeout?: number,
      ...args: any[]
    ) => {
      if (gate.armed && timeout === 650 && typeof handler === "function") {
        gate.timers.push(() => handler(...args));
        return 0 as unknown as number;
      }
      return nativeSetTimeout(handler, timeout, ...args);
    }) as typeof window.setTimeout;
  });
}

async function rows(page: Page): Promise<Row[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("rontenseiri-projects-v1", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<Row[]>((resolve, reject) => {
        const request = db
          .transaction("projects")
          .objectStore("projects")
          .getAll();
        request.onsuccess = () => resolve(request.result as Row[]);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  });
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

async function edit(page: Page, text: string) {
  await page.locator('[data-id="U01"] .speech-hit').click();
  const panel = page.getByRole("complementary", { name: "選択した発言の詳細" });
  await panel.getByRole("button", { name: "発言・原文" }).click();
  await panel.getByLabel("訂正後の原文").fill(text);
  await panel
    .getByRole("textbox", { name: "変更理由", exact: true })
    .fill(text);
  await panel.getByRole("button", { name: "訂正を保存" }).click();
}

async function arm(page: Page) {
  await page.evaluate(() => {
    (window as any).__staleSuccessGate.armed = true;
  });
}

async function gate(page: Page) {
  return page.evaluate(() => {
    const g = (window as any).__staleSuccessGate;
    return {
      heldPuts: g.heldPuts.length,
      timers: g.timers.length,
      putAttempts: g.putAttempts,
    };
  });
}

async function reproduce(
  page: Page,
  mode: "manual" | "autosave",
  info: Pick<TestInfo, "attach">,
) {
  await installStaleSuccessGate(page);
  await setup(page);
  const before = (await rows(page))[0];
  await arm(page);
  await edit(page, `Aさん：先行保存A（${mode}）。`);

  if (mode === "manual") {
    await page
      .getByRole("button", { name: "この端末に保存", exact: true })
      .click();
  } else {
    // Release exactly the one scheduled A autosave; all later 650ms retries stay frozen.
    await expect.poll(async () => (await gate(page)).timers).toBe(1);
    await page.evaluate(() =>
      (window as any).__staleSuccessGate.releaseTimer(),
    );
  }
  // The native transaction has committed A, but its success callback is still held.
  await expect
    .poll(async () => (await rows(page))[0].storageRevision)
    .toBe((before.storageRevision ?? 0) + 1);
  await expect.poll(async () => (await gate(page)).heldPuts).toBe(1);
  const durableA = (await rows(page))[0];

  await edit(page, `Bさん：後続編集B（${mode}）。`);
  const bBeforeRelease = await page.locator('[data-id="U01"]').innerText();
  expect(bBeforeRelease).toContain(`後続編集B（${mode}）`);

  if (mode === "manual") {
    await page
      .getByRole("button", { name: "この端末に保存", exact: true })
      .click();
  } else {
    await expect.poll(async () => (await gate(page)).timers).toBe(1);
    await page.evaluate(() =>
      (window as any).__staleSuccessGate.releaseTimer(),
    );
  }
  await expect(page.getByRole("alert")).toContainText(
    /保存(?:失敗|できません)/,
  );
  await expect(
    page.getByRole("region", { name: "保存と復旧", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("現在版は未保存です", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "意味解析なしで台帳を開始", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('[data-id="U01"]')).toContainText(
    `後続編集B（${mode}）`,
  );

  const failure = await page.evaluate(() => {
    const g = (window as any).__staleSuccessGate;
    return {
      heldPuts: g.heldPuts.length,
      timers: g.timers.length,
      putAttempts: g.putAttempts,
    };
  });
  // Capture the actual first React commit and native durable snapshots before releasing A.
  const beforeRelease = {
    dom: await page.locator('[data-id="U01"]').innerText(),
    durable: await rows(page),
    failure,
  };
  await page.evaluate(() => (window as any).__staleSuccessGate.releasePut());
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );

  // The late A success must not clear B's recovery UI or B's in-memory edit.
  await expect(
    page.getByRole("region", { name: "保存と復旧", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    /保存(?:失敗|できません)/,
  );
  await expect(page.locator('[data-id="U01"]')).toContainText(
    `後続編集B（${mode}）`,
  );
  await page.getByRole("button", { name: "原文範囲台帳", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "意味解析なしで台帳を開始", exact: true }),
  ).toBeDisabled();
  const afterRelease = {
    dom: await page.locator('[data-id="U01"]').innerText(),
    durable: await rows(page),
    gate: await gate(page),
  };
  expect(beforeRelease.durable).toEqual([durableA]);
  expect(afterRelease.durable).toEqual([durableA]);

  // Positive control in the very same interleaving: the latest B really saves
  // after A's committed storage generation is carried forward, so it may clear
  // B's failure. Frozen stale timers are never replayed to manufacture success.
  await page
    .getByRole("dialog", { name: "原文範囲台帳（意味解析なし）", exact: true })
    .getByRole("button", { name: "ダイアログを閉じる", exact: true })
    .click();
  await page.evaluate(() => {
    (window as any).__staleSuccessGate.armed = false;
  });
  await page
    .getByRole("button", { name: "この端末に保存", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "このブラウザに保存しました",
  );
  await expect(
    page.getByRole("region", { name: "保存と復旧", exact: true }),
  ).toHaveCount(0);
  const durableB = (await rows(page))[0];
  expect(durableB.storageRevision).toBe((durableA.storageRevision ?? 0) + 1);
  expect(
    durableB.utterances.find((utterance) => utterance.id === "U01")?.quote,
  ).toContain(`後続編集B（${mode}）`);
  await page.getByRole("button", { name: "原文範囲台帳", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "意味解析なしで台帳を開始", exact: true }),
  ).toBeEnabled();
  await info.attach(`save-success-generation-${mode}.json`, {
    body: JSON.stringify(
      {
        mode,
        before,
        durableA,
        beforeRelease,
        afterRelease,
        durableB,
        latestSuccessClearsFailure: true,
      },
      null,
      2,
    ),
    contentType: "application/json",
  });
}

test("manual A success callback cannot clear later B failure recovery", async ({
  page,
}, info) => {
  await reproduce(page, "manual", info);
});

test("autosave A success callback cannot clear later B failure recovery", async ({
  page,
}, info) => {
  await reproduce(page, "autosave", info);
});
