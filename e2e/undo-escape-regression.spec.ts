import { expect, test } from "@playwright/test";

async function sample(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "サンプルを見てみる", exact: true })
    .click();
  await expect(page.locator('[data-id="U10"]')).toBeVisible();
}

test("last node selection returns focus after Escape", async ({ page }) => {
  await sample(page);
  const node = page.getByRole("button", { name: /^U10 / });
  await node.focus();
  await node.press("Enter");
  await expect(
    page.getByRole("complementary", { name: "選択した発言の詳細" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("complementary", { name: "選択した発言の詳細" }),
  ).not.toBeVisible();
  await expect(node).toBeFocused();
});

test("Escape restores the latest node when the transcript origin was unmounted", async ({
  page,
}) => {
  await sample(page);
  await page.getByRole("button", { name: "発言と原文", exact: true }).click();
  const origin = page.getByRole("button", { name: /U10/ }).first();
  await origin.focus();
  await origin.press("Enter");
  await expect(
    page.getByRole("complementary", { name: "選択した発言の詳細" }),
  ).toContainText("U10");
  await page.getByRole("button", { name: "議題の流れ", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("complementary", { name: "選択した発言の詳細" }),
  ).toBeHidden();
  await expect(page.locator('[data-id="U10"] .speech-hit')).toBeFocused();
});

test("Undo becomes disabled after the only revision is undone", async ({
  page,
}) => {
  await sample(page);
  const node = page.getByRole("button", { name: /^U01 / });
  await node.click();
  const details = page.getByRole("complementary", {
    name: "選択した発言の詳細",
  });
  await details
    .getByLabel("発言の分類", { exact: true })
    .selectOption("derived");
  await details.getByLabel("変更理由", { exact: true }).fill("回帰テスト");
  await details
    .getByRole("button", { name: "訂正を保存", exact: true })
    .click();
  await page.getByRole("button", { name: "訂正履歴", exact: true }).click();
  const undo = page.getByRole("button", {
    name: "直前の訂正を元に戻す",
    exact: true,
  });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(undo).toBeDisabled();
});
