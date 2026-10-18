import { expect, test, type Page, type TestInfo } from "@playwright/test";

type GateSnapshot = { heldPuts: number; timers: number; putAttempts: number };

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
    const controlledTimers = new Map<number, () => void>();
    const controlledTimerIds = new WeakMap<() => void, number>();
    let nextControlledTimerId = -1;
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
        const id = controlledTimerIds.get(run);
        if (id !== undefined) controlledTimers.delete(id);
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
    const nativeClearTimeout = window.clearTimeout.bind(window);
    window.setTimeout = ((
      handler: TimerHandler,
      timeout?: number,
      ...args: any[]
    ) => {
      if (gate.armed && timeout === 650 && typeof handler === "function") {
        const id = nextControlledTimerId--;
        const run = () => handler(...args);
        controlledTimers.set(id, run);
        controlledTimerIds.set(run, id);
        gate.timers.push(run);
        return id;
      }
      return nativeSetTimeout(handler, timeout, ...args);
    }) as typeof window.setTimeout;
    window.clearTimeout = ((id?: number) => {
      const run = id === undefined ? undefined : controlledTimers.get(id);
      if (run && id !== undefined) {
        controlledTimers.delete(id);
        gate.timers = gate.timers.filter((candidate) => candidate !== run);
        return;
      }
      nativeClearTimeout(id);
    }) as typeof window.clearTimeout;
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

async function releaseHeldPut(page: Page, index = 0) {
  await page.evaluate((putIndex) => {
    const g = (window as any).__staleSuccessGate;
    const [deliver] = g.heldPuts.splice(putIndex, 1);
    if (!deliver) throw new Error(`held put ${putIndex} is missing`);
    deliver();
  }, index);
}

async function releaseNextAutosave(page: Page) {
  await expect.poll(async () => (await gate(page)).timers).toBe(1);
  await page.evaluate(() => (window as any).__staleSuccessGate.releaseTimer());
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

test("autosave B success recovers after A success and B conflict", async ({
  page,
}, info) => {
  await installStaleSuccessGate(page);
  await setup(page);
  const before = (await rows(page))[0];
  await arm(page);
  await edit(page, "Aさん：自動復旧の先行保存A。");
  await releaseNextAutosave(page);
  await expect
    .poll(async () => (await rows(page))[0].storageRevision)
    .toBe((before.storageRevision ?? 0) + 1);
  await expect.poll(async () => (await gate(page)).heldPuts).toBe(1);
  const durableA = (await rows(page))[0];

  await edit(page, "Bさん：自動復旧の後続編集B。");
  await releaseNextAutosave(page);
  await expect(page.getByRole("alert")).toContainText(
    /保存(?:失敗|できません)/,
  );
  await expect(
    page.getByRole("region", { name: "保存と復旧", exact: true }),
  ).toBeVisible();
  const failed = (await gate(page)) as GateSnapshot;

  // The native A commit is durable; only its success callback may carry that
  // generation into B. Frozen timers are never replayed as a false success.
  await releaseHeldPut(page);
  await expect(
    page.getByRole("region", { name: "保存と復旧", exact: true }),
  ).toBeVisible();
  // Release exactly the newly scheduled recovery retry, then its native
  // success callback. No unrelated timer is replayed to manufacture success.
  await expect.poll(async () => (await gate(page)).timers).toBe(1);
  await releaseNextAutosave(page);
  await expect.poll(async () => (await gate(page)).heldPuts).toBe(1);
  await releaseHeldPut(page);
  await expect(
    page.getByRole("region", { name: "保存と復旧", exact: true }),
  ).toHaveCount(0);
  const durableB = (await rows(page))[0];
  expect(durableB.storageRevision).toBe((durableA.storageRevision ?? 0) + 1);
  expect(
    durableB.utterances.find((utterance) => utterance.id === "U01")?.quote,
  ).toContain("自動復旧の後続編集B");
  await page.getByRole("button", { name: "原文範囲台帳", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "意味解析なしで台帳を開始", exact: true }),
  ).toBeEnabled();
  await info.attach("save-success-generation-autosave-recovery.json", {
    body: JSON.stringify({ before, durableA, failed, durableB }, null, 2),
    contentType: "application/json",
  });
});

test("B success delivered before delayed lower-revision A success retains B", async ({
  context,
}, info) => {
  const pageA = await context.newPage();
  const pageB = await context.newPage();
  await installStaleSuccessGate(pageA);
  await installStaleSuccessGate(pageB);
  await setup(pageA);
  await arm(pageA);
  await edit(pageA, "Aさん：遅延callbackの先行保存A。");
  await pageA
    .getByRole("button", { name: "この端末に保存", exact: true })
    .click();
  await expect.poll(async () => (await rows(pageA))[0].storageRevision).toBe(2);
  await expect.poll(async () => (await gate(pageA)).heldPuts).toBe(1);
  const durableA = (await rows(pageA))[0];

  await pageB.goto("/");
  await expect(
    pageB.getByRole("heading", { name: "最近の作業" }),
  ).toBeVisible();
  await expect(pageB.locator(".recent-open").first()).toBeVisible();
  await pageB.locator(".recent-open").first().click();
  await edit(pageB, "Bさん：先着callbackの後続保存B。");
  await arm(pageB);
  await pageB
    .getByRole("button", { name: "この端末に保存", exact: true })
    .click();
  await expect
    .poll(async () => (await rows(pageB))[0].storageRevision)
    .toBe((durableA.storageRevision ?? 0) + 1);
  await expect.poll(async () => (await gate(pageB)).heldPuts).toBe(1);
  const durableB = (await rows(pageB))[0];
  await releaseHeldPut(pageB);
  await expect(pageB.getByRole("status")).toContainText(
    "このブラウザに保存しました",
  );
  await expect(
    pageB.getByRole("region", { name: "保存と復旧", exact: true }),
  ).toHaveCount(0);
  await releaseHeldPut(pageA);
  await pageB.reload();
  const finalRows = await rows(pageB);
  expect(finalRows[0].storageRevision).toBe(durableB.storageRevision);
  expect(
    finalRows[0].utterances.find((utterance) => utterance.id === "U01")?.quote,
  ).toContain("先着callbackの後続保存B");
  await expect(pageB.locator(".recent-open").first()).toBeVisible();
  await info.attach("save-success-generation-reverse-delivery.json", {
    body: JSON.stringify({ durableA, durableB, finalRows }, null, 2),
    contentType: "application/json",
  });
  await pageA.close();
  await pageB.close();
});

for (const [oldSource, newSource] of [
  ["manual", "manual"],
  ["manual", "autosave"],
  ["autosave", "manual"],
  ["autosave", "autosave"],
] as const) {
  test(`same-App B callback wins before delayed lower-revision A callback (${oldSource}/${newSource})`, async ({
    page,
  }, info) => {
    await installStaleSuccessGate(page);
    await setup(page);
    const initial = (await rows(page))[0];

    // A is a real native commit. Only its success callback remains queued.
    await arm(page);
    await edit(page, "Aさん：同一Appの先行保存A。");
    if (oldSource === "manual")
      await page
        .getByRole("button", { name: "この端末に保存", exact: true })
        .click();
    else await releaseNextAutosave(page);
    await expect
      .poll(async () => (await rows(page))[0].storageRevision)
      .toBe((initial.storageRevision ?? 0) + 1);
    await expect.poll(async () => (await gate(page)).heldPuts).toBe(1);
    const durableA = (await rows(page))[0];

    // Leave through the actual App header. The confirmation is the product's
    // explicit discard guard; no reload or second Page is involved.
    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("confirm");
      expect(dialog.message()).toContain("破棄して別の作業へ");
      await dialog.accept();
    });
    await page.getByRole("button", { name: "論点整理.", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "最近の作業" }),
    ).toBeVisible();
    await page.locator(".recent-open").first().click();
    await expect(page.locator('[data-id="U01"]')).toContainText(
      "Aさん：同一Appの先行保存A。",
    );

    // Reopened durable A is edited and committed as B in the same React/App
    // instance. The gate now contains A's old callback followed by B's callback.
    await edit(page, "Bさん：同一Appの後続保存B。");
    if (newSource === "manual")
      await page
        .getByRole("button", { name: "この端末に保存", exact: true })
        .click();
    else await releaseNextAutosave(page);
    await expect
      .poll(async () => (await rows(page))[0].storageRevision)
      .toBe((durableA.storageRevision ?? 0) + 1);
    await expect.poll(async () => (await gate(page)).heldPuts).toBe(2);
    const durableB = (await rows(page))[0];

    // Deliver B first, then the already-committed lower-revision A callback.
    await releaseHeldPut(page, 1);
    if (newSource === "manual")
      await expect(page.getByRole("status")).toContainText(
        "このブラウザに保存しました",
      );
    await expect(
      page.getByRole("region", { name: "保存と復旧", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "原文範囲台帳", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "意味解析なしで台帳を開始",
        exact: true,
      }),
    ).toBeEnabled();
    await page
      .getByRole("dialog", {
        name: "原文範囲台帳（意味解析なし）",
        exact: true,
      })
      .getByRole("button", { name: "ダイアログを閉じる", exact: true })
      .click();
    await expect(page.locator('[data-id="U01"]')).toContainText(
      "Bさん：同一Appの後続保存B。",
    );

    await releaseHeldPut(page, 0);
    await expect(page.locator('[data-id="U01"]')).toContainText(
      "Bさん：同一Appの後続保存B。",
    );
    await expect(
      page.getByRole("region", { name: "保存と復旧", exact: true }),
    ).toHaveCount(0);
    const afterStaleA = (await rows(page))[0];
    expect(afterStaleA.storageRevision).toBe(durableB.storageRevision);
    expect(
      afterStaleA.utterances.find((utterance) => utterance.id === "U01")?.quote,
    ).toContain("同一Appの後続保存B");
    await page
      .getByRole("button", { name: "原文範囲台帳", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "意味解析なしで台帳を開始",
        exact: true,
      }),
    ).toBeEnabled();
    await page
      .getByRole("dialog", {
        name: "原文範囲台帳（意味解析なし）",
        exact: true,
      })
      .getByRole("button", { name: "ダイアログを閉じる", exact: true })
      .click();

    // Re-save the unchanged B before reloading: a regressed in-memory revision
    // cannot pass this native CAS. The payload must remain B, not a new edit C.
    await page.evaluate(() => {
      (window as any).__staleSuccessGate.armed = false;
    });
    await page
      .getByRole("button", { name: "この端末に保存", exact: true })
      .click();
    await expect
      .poll(async () => (await rows(page))[0].storageRevision)
      .toBe((durableB.storageRevision ?? 0) + 1);
    await expect(page.getByRole("status")).toContainText(
      "このブラウザに保存しました",
    );
    await expect(
      page.getByRole("button", { name: "この端末に保存", exact: true }),
    ).toBeEnabled();
    const resavedB = (await rows(page))[0];
    expect(resavedB.storageRevision).toBe((durableB.storageRevision ?? 0) + 1);
    expect(
      resavedB.utterances.find((utterance) => utterance.id === "U01")?.quote,
    ).toContain("同一Appの後続保存B");
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "最近の作業" }),
    ).toBeVisible();
    await page.locator(".recent-open").first().click();
    await expect(page.locator('[data-id="U01"]')).toContainText(
      "同一Appの後続保存B",
    );
    const reloadedB = (await rows(page))[0];
    expect(reloadedB).toEqual(resavedB);
    await page
      .getByRole("button", { name: "原文範囲台帳", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "意味解析なしで台帳を開始",
        exact: true,
      }),
    ).toBeEnabled();
    await info.attach("save-success-generation-same-app.json", {
      body: JSON.stringify(
        {
          initial,
          durableA,
          durableB,
          afterStaleA,
          resavedB,
          reloadedB,
          samePage: true,
          oldSource,
          newSource,
          primaryRequirement: "P5/G5",
          savedReferenceIdentityDirectlyObserved: false,
          appInstanceReloadedBeforeLateA: false,
          normalUIReopenBeforeB: true,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
  });
}
