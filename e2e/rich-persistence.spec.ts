import { expect, test, type Page } from "@playwright/test";

type StoredProject = {
  id: string;
  title: string;
  storageRevision?: number;
  saved: boolean;
  sources: Array<{ id: string; versionId: string; text: string }>;
  utterances: Array<{
    id: string;
    quote: string;
    classification: string;
    sourceVersionId: string;
    important: boolean;
  }>;
  revisions: Array<{ kind: string; reason?: string }>;
  reasoning?: {
    questions: Array<{ versionIds: string[]; currentVersionId: string }>;
    questionVersions: Array<{
      id: string;
      text: string;
      status: string;
    }>;
    responses: Array<{ questionVersionId: string; utteranceIds: string[] }>;
  };
};

async function storedByTitle(page: Page, title: string) {
  return page.evaluate(async (wanted) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("rontenseiri-projects-v1", 1);
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

async function waitForStored(page: Page, title: string) {
  await expect
    .poll(() => storedByTitle(page, title), { timeout: 10_000 })
    .not.toBeNull();
  return storedByTitle(page, title);
}

async function save(page: Page) {
  await page
    .getByRole("button", { name: "この端末に保存", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "このブラウザに保存しました",
  );
}

async function openManualProject(page: Page, title: string) {
  await page.goto("/");
  await page.getByRole("button", { name: "新しく始める", exact: true }).click();
  await page.getByLabel("作業名", { exact: true }).fill(title);
  await page
    .getByLabel("文字起こし済みのテキスト", { exact: true })
    .fill("甲：実入力の第一発言です。\n乙：実入力の第二発言で問いを作ります。");
  await page
    .getByRole("button", { name: "読み込みと抽出結果を確認", exact: true })
    .click();
  await page
    .getByRole("button", { name: "原文を確認して整理を始める", exact: true })
    .click();
  await expect(page.locator('[data-id="U01"]')).toBeVisible();
}

async function detail(page: Page, id: string) {
  const hit = page.locator(`[data-id="${id}"] .speech-hit`);
  await hit.click();
  const panel = page.getByRole("complementary", { name: "選択した発言の詳細" });
  await expect(panel).toBeVisible();
  return panel;
}

test("rich状態r1/r2が原文版・問い版・旧版応答・履歴・Undoまで永続化される", async ({
  page,
}) => {
  const title = `rich-${Date.now()}`;
  await openManualProject(page, title);

  const first = await detail(page, "U01");
  await first.getByLabel("発言の分類", { exact: true }).selectOption("main");
  await first.getByLabel("変更理由", { exact: true }).fill("r1本筋の確認");
  await first.getByRole("button", { name: "訂正を保存", exact: true }).click();
  await first.getByRole("button", { name: "発言・原文", exact: true }).click();
  await first
    .getByLabel("訂正後の原文", { exact: true })
    .fill("訂正済みの第一発言です。");
  await first.getByLabel("変更理由", { exact: true }).fill("rich原文訂正");
  await first.getByRole("button", { name: "訂正を保存", exact: true }).click();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "問い・根拠", exact: true }).click();
  const reasoning = page.getByRole("region", { name: "問い・根拠" });
  const qform = reasoning
    .getByRole("heading", { name: /問いを記録/ })
    .locator("..");
  await qform.getByLabel("問い", { exact: true }).fill("実入力の問いv1？");
  await qform.getByLabel("登録理由", { exact: true }).fill("rich問いv1登録");
  await qform.getByRole("checkbox", { name: /U01/ }).check();
  await qform
    .getByRole("button", { name: "明示選択した発言に問いを追加", exact: true })
    .press("Enter");
  const response = reasoning
    .getByRole("heading", { name: /問い版への応答/ })
    .locator("..");
  const versions = response
    .getByRole("combobox", { name: "対象問い版", exact: true })
    .locator("option");
  const oldV1 = await versions.nth(1).getAttribute("value");
  expect(oldV1).toBeTruthy();
  await response
    .getByRole("combobox", { name: "対象問い版", exact: true })
    .selectOption(oldV1!);
  await response.getByRole("checkbox", { name: /U01/ }).check();
  await response.getByLabel("登録理由", { exact: true }).fill("rich旧v1応答");
  await response
    .getByRole("button", { name: "応答を登録", exact: true })
    .click();

  await reasoning
    .getByRole("button", { name: "版を変更", exact: true })
    .click();
  await reasoning.getByLabel("新しい問い").fill("実入力の問いv2？");
  await reasoning
    .getByLabel("変更理由", { exact: true })
    .fill("rich問い版変更");
  await reasoning
    .getByRole("button", { name: "新しい版を登録", exact: true })
    .click();
  await expect(reasoning).toContainText("旧版の応答対象は保持");
  await save(page);

  const r1 = await waitForStored(page, title);
  expect(r1?.sources.map((s) => s.versionId).length).toBeGreaterThanOrEqual(2);
  expect(r1?.sources.some((s) => s.text.includes("訂正済み"))).toBe(true);
  expect(r1?.reasoning?.questions[0]?.versionIds.length).toBe(2);
  expect(
    r1?.reasoning?.responses.some((r) => r.questionVersionId === oldV1),
  ).toBe(true);
  expect(r1?.revisions.some((r) => r.kind === "source-revision")).toBe(true);
  expect(r1?.utterances.find((u) => u.id === "U01")?.classification).toBe(
    "main",
  );
  const r1Revision = r1?.storageRevision ?? 0;

  await page.getByRole("button", { name: "議題の流れ", exact: true }).click();
  const target = await detail(page, "U01");
  await target
    .getByLabel("発言の分類", { exact: true })
    .selectOption("derived");
  await target
    .getByLabel("変更理由", { exact: true })
    .fill("rich分類r2自動保存");
  await target.getByRole("button", { name: "訂正を保存", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await storedByTitle(page, title))?.utterances.find(
          (u) => u.id === "U01",
        )?.classification,
      { timeout: 10_000 },
    )
    .toBe("derived");
  const r2 = await storedByTitle(page, title);
  expect(r2?.storageRevision).toBeGreaterThan(r1Revision);
  expect(r2?.reasoning?.questions[0]?.versionIds.length).toBe(2);
  expect(
    r2?.reasoning?.responses.some((r) => r.questionVersionId === oldV1),
  ).toBe(true);

  await page.getByRole("button", { name: "論点整理.", exact: false }).click();
  await page.locator("button.recent-open", { hasText: title }).click();
  const reopened = await detail(page, "U01");
  await expect(reopened.getByLabel("発言の分類", { exact: true })).toHaveValue(
    "derived",
  );
  await expect(reopened.locator("blockquote")).toContainText("訂正済み");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "問い・根拠", exact: true }).click();
  await expect(page.getByRole("region", { name: "問い・根拠" })).toContainText(
    "実入力の問いv1？",
  );
  await expect(page.getByRole("region", { name: "問い・根拠" })).toContainText(
    "実入力の問いv2？",
  );
  await expect(page.getByRole("region", { name: "問い・根拠" })).toContainText(
    oldV1!,
  );

  await page.getByRole("button", { name: "議題の流れ", exact: true }).click();
  const edited = await detail(page, "U01");
  await edited.getByLabel("この一言が重要", { exact: true }).check();
  await edited.getByLabel("話者", { exact: true }).fill("甲・確認済み");
  await edited
    .getByLabel("変更理由", { exact: true })
    .fill("rich追加メタデータ");
  await edited.getByRole("button", { name: "訂正を保存", exact: true }).click();
  await save(page);
  await page.getByRole("button", { name: "論点整理.", exact: false }).click();
  await page.locator("button.recent-open", { hasText: title }).click();
  await expect(
    (await detail(page, "U01")).getByLabel("この一言が重要", { exact: true }),
  ).toBeChecked();

  await page.getByRole("button", { name: "訂正履歴", exact: true }).click();
  await page
    .getByRole("button", { name: "直前の訂正を元に戻す", exact: true })
    .click();
  await page
    .getByRole("button", { name: "直前の訂正を元に戻す", exact: true })
    .click();
  await save(page);
  const finalRecord = await waitForStored(page, title);
  expect(
    finalRecord?.utterances.find((u) => u.id === "U01")?.classification,
  ).toBe("main");
  expect(finalRecord?.utterances.find((u) => u.id === "U01")?.important).toBe(
    false,
  );
  expect(finalRecord?.storageRevision).toBeGreaterThan(r1Revision);
  expect(finalRecord?.sources.map((s) => s.versionId)).toEqual(
    r1?.sources.map((s) => s.versionId),
  );
  expect(finalRecord?.reasoning?.questionVersions).toEqual(
    r1?.reasoning?.questionVersions,
  );
  expect(finalRecord?.reasoning?.responses).toEqual(r1?.reasoning?.responses);
  expect(
    finalRecord?.revisions.filter((r) => r.kind === "undo").length,
  ).toBeGreaterThanOrEqual(2);
  expect(finalRecord?.reasoning?.questions[0]?.versionIds.length).toBe(2);
  expect(
    finalRecord?.reasoning?.responses.some(
      (r) => r.questionVersionId === oldV1,
    ),
  ).toBe(true);

  await page.getByRole("button", { name: "論点整理.", exact: false }).click();
  await page.locator("button.recent-open", { hasText: title }).click();
  const last = await detail(page, "U01");
  await expect(last.getByLabel("発言の分類", { exact: true })).toHaveValue(
    "main",
  );
  await expect(
    last.getByLabel("この一言が重要", { exact: true }),
  ).not.toBeChecked();
  await expect(last.locator("blockquote")).toContainText("訂正済み");
});
