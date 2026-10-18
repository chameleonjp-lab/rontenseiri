import { test, expect } from "@playwright/test";
import { sampleProject } from "../src/analysis/sample";

async function sample(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "サンプルを見てみる", exact: true })
    .click();
  await expect(page.locator('[data-id="U01"]')).toBeVisible();
}

test("依存候補はdetailsを開くまで生成せず、閉じても入力draftを保持する", async ({
  page,
}) => {
  await sample(page);
  await page.getByRole("button", { name: /^U01 Aさん/ }).press("Enter");

  const inspector = page.getByRole("complementary", {
    name: "選択した発言の詳細",
  });
  const dependencySummary = inspector.getByText("意味上の依存関係を指定", {
    exact: true,
  });
  const dependencyDetails = dependencySummary.locator("..");
  const dependencySelect = inspector.getByLabel("この根拠に依存する後続発言", {
    exact: true,
  });

  await expect(dependencySelect).toHaveCount(0);
  await dependencySummary.click();
  await expect(dependencySelect).toBeVisible();
  const fixture = sampleProject();
  const selectedUtterance = fixture.utterances.find((u) => u.id === "U01")!;
  const expectedIds = fixture.utterances
    .filter((u) => u.order > selectedUtterance.order)
    .map((u) => u.id);
  await expect
    .poll(() =>
      dependencySelect
        .locator("option")
        .evaluateAll((options) => options.map((o) => o.value)),
    )
    .toEqual(["", ...expectedIds]);

  await dependencySelect.selectOption({ index: 1 });
  const selected = await dependencySelect.inputValue();
  const reason = inspector.getByLabel("依存関係を変更する理由", {
    exact: true,
  });
  await reason.fill("依存関係を確認したため");
  await dependencyDetails.locator("summary").click();
  await dependencySummary.click();

  await expect(dependencySelect).toHaveValue(selected);
  await expect(reason).toHaveValue("依存関係を確認したため");
});
