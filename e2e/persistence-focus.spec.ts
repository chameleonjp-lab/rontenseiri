import { test, expect } from "@playwright/test";

type StoredProject = {
  id: string;
  title: string;
  storageRevision?: number;
  saved: boolean;
  sources: Array<{ text: string }>;
  utterances: Array<{ id: string; quote: string }>;
  revisions: Array<{ kind: string }>;
};

async function storedByTitle(
  page: import("@playwright/test").Page,
  title: string,
) {
  return page.evaluate(async (wanted) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("rontenseiri-projects-v1", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("projects"))
          request.result.createObjectStore("projects");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise<StoredProject[]>((resolve, reject) => {
      const request = db
        .transaction("projects", "readonly")
        .objectStore("projects")
        .getAll();
      request.onsuccess = () => resolve(request.result as StoredProject[]);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return rows.find((row) => row.title === wanted) ?? null;
  }, title);
}

async function waitForStored(
  page: import("@playwright/test").Page,
  title: string,
) {
  await expect
    .poll(() => storedByTitle(page, title), { timeout: 10_000 })
    .not.toBeNull();
  return storedByTitle(page, title);
}

test("real input survives same-tab recent reopen, correction history, and Undo", async ({
  page,
}) => {
  const title = `受入確認-${Date.now()}`;
  await page.goto("/");
  await page.getByRole("button", { name: "新しく始める", exact: true }).click();
  await page.getByLabel("作業名").fill(title);
  await page
    .getByLabel("文字起こし済みのテキスト")
    .fill("Aさん：これは一つ目の原文です。\nBさん：これは二つ目の問いです。");
  await page.getByRole("button", { name: "読み込みと抽出結果を確認" }).click();
  await page
    .getByRole("button", { name: "原文を確認して整理を始める" })
    .click();
  await expect(page.locator('[data-id="U01"]')).toBeVisible();

  await page
    .getByRole("button", { name: "この端末に保存", exact: true })
    .click();
  await waitForStored(page, title);
  const firstRecord = await storedByTitle(page, title);
  expect(firstRecord?.id).toBeTruthy();
  expect(firstRecord?.storageRevision).toBeGreaterThanOrEqual(1);
  const revBefore = firstRecord?.storageRevision;

  await page.locator('[data-id="U01"] .speech-hit').click();
  await page.getByRole("button", { name: "発言・原文" }).click();
  await page
    .getByLabel("訂正後の原文")
    .fill("これは訂正後に保存した原文です。");
  await page
    .getByRole("textbox", { name: "変更理由", exact: true })
    .fill("受入試験の原文訂正");
  await page.getByRole("button", { name: "訂正を保存" }).click();
  await page
    .getByRole("button", { name: "この端末に保存", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await storedByTitle(page, title))?.sources.some((source) =>
          source.text.includes("訂正後"),
        ) ?? false,
      { timeout: 10_000 },
    )
    .toBe(true);

  await page.getByRole("button", { name: "論点整理.", exact: false }).click();
  await expect(
    page.getByRole("heading", { name: "会話の流れを、 見えるかたちに。" }),
  ).toBeVisible();
  await page.locator("button.recent-open", { hasText: title }).click();
  await expect(page.locator("text=訂正後に保存した原文です")).toBeVisible();
  await page.getByRole("button", { name: "訂正履歴", exact: true }).click();
  await expect(page.getByText("受入試験の原文訂正")).toBeVisible();
  await page.getByRole("button", { name: "直前の訂正を元に戻す" }).click();
  await page
    .getByRole("button", { name: "この端末に保存", exact: true })
    .click();

  await page.getByRole("button", { name: "論点整理.", exact: false }).click();
  await page.locator("button.recent-open", { hasText: title }).click();
  await expect(
    page.getByRole("button", { name: "訂正履歴", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "訂正履歴", exact: true }).click();
  await expect(page.getByText("undo", { exact: true })).toBeVisible();
  const finalRecord = await storedByTitle(page, title);
  expect(finalRecord?.id).toBe(firstRecord?.id);
  expect(finalRecord?.storageRevision).toBeGreaterThan(revBefore ?? 0);
  expect(
    finalRecord?.revisions.some((revision) => revision.kind === "undo"),
  ).toBe(true);
});
