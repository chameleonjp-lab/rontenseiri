import { test, expect } from "@playwright/test";

test("production explicit preparation supports offline shell and keeps cache scoped", async ({
  page,
  context,
}, testInfo) => {
  test.skip(
    !testInfo.config.configFile?.endsWith("playwright.offline.config.ts"),
    "offline.spec.ts requires the dedicated production preview config",
  );
  const external: string[] = [];
  const failures: string[] = [];
  const configuredOrigin = new URL(testInfo.project.use.baseURL ?? page.url())
    .origin;
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("requestfailed", (request) =>
    failures.push(`${request.url()}: ${request.failure()?.errorText}`),
  );
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin !== configuredOrigin && url.protocol !== "data:")
      external.push(request.url());
  });

  const title = `オフライン受入-${Date.now()}`;
  await page.goto("/");
  await page.getByRole("button", { name: "新しく始める", exact: true }).click();
  await page.getByLabel("作業名").fill(title);
  await page
    .getByLabel("文字起こし済みのテキスト")
    .fill("Aさん：オフライン保存の原文です。\nBさん：復元確認の問いです。");
  await page.getByRole("button", { name: "読み込みと抽出結果を確認" }).click();
  await page
    .getByRole("button", { name: "原文を確認して整理を始める" })
    .click();
  await expect(page.locator('[data-id="U01"]')).toBeVisible();
  await page
    .getByRole("button", { name: "この端末に保存", exact: true })
    .click();
  await page.locator('[data-id="U01"] .speech-hit').click();
  await page.getByRole("button", { name: "発言・原文" }).click();
  await page
    .getByLabel("訂正後の原文")
    .fill("オフライン保存後に訂正した原文です。");
  await page
    .getByRole("textbox", { name: "変更理由", exact: true })
    .fill("オフライン受入の原文訂正");
  await page.getByRole("button", { name: "訂正を保存" }).click();
  await page
    .getByRole("button", { name: "この端末に保存", exact: true })
    .click();
  await page.getByRole("button", { name: "訂正履歴", exact: true }).click();
  await expect(page.getByText("オフライン受入の原文訂正")).toBeVisible();
  await page.getByRole("button", { name: "直前の訂正を元に戻す" }).click();
  await page
    .getByRole("button", { name: "この端末に保存", exact: true })
    .click();
  await page.getByRole("button", { name: "端末・保存", exact: true }).click();
  await page
    .getByRole("button", { name: "オフライン準備を確認", exact: true })
    .click();
  await expect(page.getByText(/準備完了：/)).toBeVisible();

  const before = await page.evaluate(async () => ({
    registrations: (await navigator.serviceWorker.getRegistrations()).map(
      (registration) => registration.scope,
    ),
    caches: await caches.keys(),
  }));
  expect(
    before.registrations.every((scope) => new URL(scope).pathname === "/"),
  ).toBeTruthy();
  expect(
    before.caches.every(
      (name) =>
        name.startsWith("rontenseiri-shell-") || !name.includes("rontenseiri"),
    ),
  ).toBeTruthy();

  const cached = await page.evaluate(async () => {
    const out: string[] = [];
    for (const name of await caches.keys()) {
      if (!name.startsWith("rontenseiri-shell-")) continue;
      const c = await caches.open(name);
      out.push(...(await c.keys()).map((r) => r.url));
    }
    return out;
  });
  expect(
    cached.some((url) => url.includes("/assets/") && url.endsWith(".js")),
  ).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await testInfo.attach("offline-page.html", {
    body: await page.content(),
    contentType: "text/html",
  });
  await testInfo.attach("offline-errors.json", {
    body: JSON.stringify(failures),
    contentType: "application/json",
  });
  await expect(
    page.getByRole("heading", { name: "会話の流れを、 見えるかたちに。" }),
  ).toBeVisible();
  await page.locator("button.recent-open", { hasText: title }).click();
  await expect(page.getByText("オフライン保存の原文です。")).toBeVisible();
  await page.getByRole("button", { name: "訂正履歴", exact: true }).click();
  await expect(page.getByText("undo", { exact: true })).toBeVisible();
  expect(external).toEqual([]);
  await page.screenshot({
    path: "artifacts/offline-restored.png",
    fullPage: true,
  });

  const after = await page.evaluate(async () => ({
    caches: await caches.keys(),
    registrations: (await navigator.serviceWorker.getRegistrations()).map(
      (registration) => registration.scope,
    ),
  }));
  expect(
    after.registrations.every((scope) => new URL(scope).pathname === "/"),
  ).toBeTruthy();
  expect(
    after.caches.filter((name) => name.startsWith("rontenseiri-shell-")).length,
  ).toBeGreaterThan(0);
  expect(
    after.caches.some((name) => !name.startsWith("rontenseiri-shell-")),
  ).toBeFalsy();
});
