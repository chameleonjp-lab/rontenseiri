import { expect, test } from "@playwright/test";

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

async function saveClassification(
  details: import("@playwright/test").Locator,
  value: "main" | "derived",
  reason: string,
) {
  await details.getByLabel("発言の分類", { exact: true }).selectOption(value);
  await details.getByLabel("変更理由", { exact: true }).fill(reason);
  await details
    .getByRole("button", { name: "訂正を保存", exact: true })
    .click();
}

async function undoLatest(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "訂正履歴", exact: true }).click();
  const undo = page.getByRole("button", {
    name: "直前の訂正を元に戻す",
    exact: true,
  });
  await expect(undo).toBeEnabled();
  await undo.click();
}

test("classification save then Undo restores the dropdown for the same selection", async ({
  page,
}) => {
  await sample(page);
  const details = await openU01(page);
  const classification = details.getByLabel("発言の分類", { exact: true });
  const original = await classification.inputValue();
  const changed = original === "derived" ? "main" : "derived";
  await saveClassification(
    details,
    changed,
    "Inspector draft sync classification",
  );
  await undoLatest(page);
  await expect(classification).toHaveValue(original);
});

test("source quote save then Undo restores the latest textarea for the same selection", async ({
  page,
}) => {
  await sample(page);
  const details = await openU01(page);
  await details
    .getByRole("button", { name: "発言・原文", exact: true })
    .click();
  const quote = details.getByLabel("訂正後の原文", { exact: true });
  const original = await quote.inputValue();
  await quote.fill(`${original}（同期確認）`);
  await details
    .getByLabel("変更理由", { exact: true })
    .fill("Inspector draft sync source");
  await details
    .getByRole("button", { name: "訂正を保存", exact: true })
    .click();
  await undoLatest(page);
  await expect(quote).toHaveValue(original);
});

test("an unrelated browser save does not clear an in-progress Inspector draft", async ({
  page,
}) => {
  await sample(page);
  const details = await openU01(page);
  const speaker = details.getByLabel("話者", { exact: true });
  await speaker.fill("編集中の話者");
  await page
    .getByRole("button", { name: "この端末に保存", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("保存しました");
  await expect(speaker).toHaveValue("編集中の話者");
});
