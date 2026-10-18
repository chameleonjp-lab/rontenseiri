import { expect, test } from "@playwright/test";
let observed: Record<string, unknown> = {};

async function sample(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "サンプルを見てみる", exact: true })
    .click();
  await expect(page.locator('[data-id="U01"]')).toBeVisible();
}

async function openU01(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: /^U01 / }).click();
  return page.getByRole("complementary", { name: "選択した発言の詳細" });
}

async function moveU01ToAnotherAgenda(
  details: import("@playwright/test").Locator,
) {
  await details
    .getByText("議題の所属・境界を別に変更", { exact: true })
    .click();
  const target = details.getByLabel("所属先の議題", { exact: true });
  const current = await target.inputValue();
  const options = await target.locator("option").evaluateAll((els) =>
    els.map((el) => ({
      value: (el as HTMLOptionElement).value,
      label: el.textContent,
    })),
  );
  const destination = options.find((option) => option.value !== current);
  expect(destination, "sample must contain a second agenda").toBeTruthy();
  await target.selectOption(destination!.value);
  const boundaryReason = "membership draft repro: move U01";
  await details
    .getByLabel("所属・境界の変更理由", { exact: true })
    .fill(boundaryReason);
  await details
    .getByRole("button", { name: "この発言の所属先だけ変更", exact: true })
    .click();
  await expect(details.locator(".agenda-mini strong")).toContainText(
    destination!.value,
  );
  return { from: current, to: destination!.value, boundaryReason };
}

test.afterEach(async ({}, testInfo) => {
  await testInfo.attach("inspector-draft-observation", {
    body: JSON.stringify(observed, null, 2),
    contentType: "application/json",
  });
  observed = {};
});

test("変更理由の未保存ドラフトは議題所属変更後も保持され後続保存に使える", async ({
  page,
}) => {
  await sample(page);
  const details = await openU01(page);
  const reason = "保持確認: 議題所属変更前の未保存理由";
  await details.getByLabel("変更理由", { exact: true }).fill(reason);
  const membership = await moveU01ToAnotherAgenda(details);

  await expect(details.getByLabel("変更理由", { exact: true })).toHaveValue(
    reason,
  );
  const classification = details.getByLabel("発言の分類", { exact: true });
  const original = await classification.inputValue();
  await classification.selectOption(original === "main" ? "derived" : "main");
  await details
    .getByRole("button", { name: "訂正を保存", exact: true })
    .click();
  await page.getByRole("button", { name: "訂正履歴", exact: true }).click();
  await expect(page.getByText(reason, { exact: true })).toBeVisible();

  observed = {
    result: "pass",
    draftField: "変更理由",
    membership,
    persistedBy: "classification correction history",
  };
});

test("話者の未保存ドラフトは議題所属変更後も保持され後続保存にpersistする", async ({
  page,
}) => {
  await sample(page);
  const details = await openU01(page);
  const speaker = details.getByLabel("話者", { exact: true });
  const draftSpeaker = "未保存話者: membership repro";
  await speaker.fill(draftSpeaker);
  const membership = await moveU01ToAnotherAgenda(details);

  observed = {
    result: "expected-preservation-assertion",
    draftField: "話者",
    expected: "speaker draft remains after membership move",
    draftSpeaker,
    membership,
  };
  await expect(speaker).toHaveValue(draftSpeaker);
  const reason = "保持確認: 話者ドラフトを後続保存";
  await details.getByLabel("変更理由", { exact: true }).fill(reason);
  await details
    .getByRole("button", { name: "訂正を保存", exact: true })
    .click();
  await expect(speaker).toHaveValue(draftSpeaker);
  await page.getByRole("button", { name: "訂正履歴", exact: true }).click();
  await expect(page.getByText(reason, { exact: true })).toBeVisible();

  observed = {
    result: "pass",
    draftField: "話者",
    membership,
    persistedBy: "speaker correction history",
  };
});

test("原文ドラフトは分類モードの保存後も保持される", async ({ page }) => {
  await sample(page);
  const details = await openU01(page);
  await details
    .getByRole("button", { name: "発言・原文", exact: true })
    .click();
  const quote = details.getByLabel("訂正後の原文", { exact: true });
  const original = await quote.inputValue();
  const draftQuote = `${original}（cross-mode draft repro）`;
  await quote.fill(draftQuote);
  await details
    .getByRole("button", { name: "分類・関係", exact: true })
    .click();
  const classification = details.getByLabel("発言の分類", { exact: true });
  const current = await classification.inputValue();
  await classification.selectOption(current === "main" ? "derived" : "main");
  await details.getByLabel("変更理由", { exact: true }).fill("cross-mode save");
  await details
    .getByRole("button", { name: "訂正を保存", exact: true })
    .click();
  await details
    .getByRole("button", { name: "発言・原文", exact: true })
    .click();

  observed = {
    result: "expected-preservation-assertion",
    draftField: "訂正後の原文",
    expected: "quote draft remains after classification-mode save",
    draftQuote,
  };
  await expect(quote).toHaveValue(draftQuote);
});

test("原文ドラフトは所属保存後も保持され後続の原文保存が再読込後も残る", async ({
  page,
}) => {
  await sample(page);
  const details = await openU01(page);
  await details
    .getByRole("button", { name: "発言・原文", exact: true })
    .click();
  const quote = details.getByLabel("訂正後の原文", { exact: true });
  const original = await quote.inputValue();
  const draftQuote = `${original}（所属保存前の未保存ドラフト）`;
  await quote.fill(draftQuote);
  const membership = await moveU01ToAnotherAgenda(details);
  await expect(quote).toHaveValue(draftQuote);

  const savedQuote = `${draftQuote}（後続の原文保存）`;
  const sourceReason = "所属保存後の原文訂正理由";
  await quote.fill(savedQuote);
  await details.getByLabel("変更理由", { exact: true }).fill(sourceReason);
  await details
    .getByRole("button", { name: "訂正を保存", exact: true })
    .click();
  await expect(quote).toHaveValue(savedQuote);
  await page
    .getByRole("button", { name: "この端末に保存", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("保存しました");
  const stored = await page.evaluate(
    async ({ wantedQuote, wantedReason }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("rontenseiri-projects-v1", 1);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const rows = await new Promise<
        Array<{
          utterances: Array<{ id: string; quote: string }>;
          revisions: Array<{ reason?: string }>;
        }>
      >((resolve, reject) => {
        const request = db
          .transaction("projects", "readonly")
          .objectStore("projects")
          .getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      db.close();
      const project = rows.find((row) =>
        row.utterances.some(
          (utterance) =>
            utterance.id === "U01" && utterance.quote === wantedQuote,
        ),
      );
      return {
        quotePersisted: Boolean(project),
        reasonPersisted: Boolean(
          project?.revisions.some(
            (revision) => revision.reason === wantedReason,
          ),
        ),
      };
    },
    { wantedQuote: savedQuote, wantedReason: sourceReason },
  );
  expect(stored).toEqual({ quotePersisted: true, reasonPersisted: true });

  await page.reload();
  await page
    .locator("button.recent-open", {
      hasText: "在宅勤務の試行会議（架空サンプル）",
    })
    .click();
  await page.getByRole("button", { name: /^U01 / }).click();
  const reloaded = page.getByRole("complementary", {
    name: "選択した発言の詳細",
  });
  await reloaded
    .getByRole("button", { name: "発言・原文", exact: true })
    .click();
  await expect(
    reloaded.getByLabel("訂正後の原文", { exact: true }),
  ).toHaveValue(savedQuote);
  await page.getByRole("button", { name: "訂正履歴", exact: true }).click();
  await expect(page.getByText(sourceReason, { exact: true })).toBeVisible();
  observed = {
    result: "pass",
    draftQuote,
    savedQuote,
    sourceReason,
    membership,
    persistedBy: "IndexedDB and correction-history DOM after reload",
  };
});
