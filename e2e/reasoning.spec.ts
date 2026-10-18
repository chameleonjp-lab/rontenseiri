import { test, expect } from "@playwright/test";

async function sample(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "サンプルを見てみる", exact: true })
    .click();
  await page.getByRole("button", { name: "問い・根拠", exact: true }).click();
  await expect(page.getByRole("region", { name: "問い・根拠" })).toBeVisible();
}

test("マウスとキーボードで、明示選択した発言だけに問いを追加できる", async ({
  page,
}) => {
  await sample(page);
  const panel = page.getByRole("region", { name: "問い・根拠" });
  const form = panel.getByRole("heading", { name: /問いを記録/ }).locator("..");
  await form.getByLabel("問い").fill("開始日を確認する？");
  await form.getByLabel("登録理由").fill("利用者が確認したため");
  await form.getByRole("checkbox", { name: /U01/ }).check();
  await form
    .getByRole("button", { name: "明示選択した発言に問いを追加" })
    .press("Enter");
  await expect(panel).toContainText("開始日を確認する？");
  await expect(panel).toContainText("根拠 U01");
});

test("問い改訂は旧版を応答対象として保持し、共通Undoと原文IDへ戻れる", async ({
  page,
}) => {
  await sample(page);
  const panel = page.getByRole("region", { name: "問い・根拠" });
  const form = panel.getByRole("heading", { name: /問いを記録/ }).locator("..");
  await form.getByLabel("問い").fill("旧版の問い");
  await form.getByLabel("登録理由").fill("初回記録");
  await form.getByRole("checkbox", { name: /U01/ }).check();
  await form
    .getByRole("button", { name: "明示選択した発言に問いを追加" })
    .click();
  await panel.getByRole("button", { name: "版を変更" }).click();
  await panel.getByLabel("新しい問い").fill("新版の問い");
  await panel.getByLabel("変更理由").fill("条件を明確化");
  await panel.getByRole("button", { name: "新しい版を登録" }).click();
  await expect(panel).toContainText("旧版の応答対象は保持");
  const responseSection = panel
    .getByRole("heading", { name: /問い版への応答/ })
    .locator("..");
  const oldVersion = await responseSection
    .getByLabel("対象問い版")
    .locator("option")
    .nth(1)
    .getAttribute("value");
  await responseSection.getByLabel("対象問い版").selectOption(oldVersion!);
  await responseSection.getByRole("checkbox", { name: /U01/ }).check();
  await responseSection.getByLabel("登録理由").fill("旧版に対する応答を保持");
  await responseSection.getByRole("button", { name: "応答を登録" }).click();
  await expect(responseSection).toContainText(oldVersion!);
  await page.getByRole("button", { name: "訂正履歴", exact: true }).click();
  await page
    .getByRole("button", { name: "直前の訂正を元に戻す", exact: true })
    .click();
  await page.getByRole("button", { name: "問い・根拠", exact: true }).click();
  await expect(panel).toContainText("新版の問い");
  await expect(panel.getByText(oldVersion!, { exact: false })).not.toHaveCount(
    0,
  );
  const original = panel
    .getByRole("button", { name: /U01 .*原文へ戻る/ })
    .first();
  await original.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("complementary", { name: "選択した発言の詳細" }),
  ).toContainText("U01");
  await page.screenshot({
    path: "artifacts/reasoning-evidence.png",
    fullPage: true,
  });
});
