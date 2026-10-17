import { expect, test, type Page } from "@playwright/test";
import { sampleProject } from "../src/analysis/sample";
import { exportProject } from "../src/export/project";

async function openFixture(page: Page) {
  const p = sampleProject();
  p.title = "復帰の固定fixture";
  p.utterances = p.utterances.filter((u) =>
    ["U01", "U08", "U10"].includes(u.id),
  );
  p.utterances.forEach(
    (u) => (u.classification = u.id === "U08" ? "drift" : "main"),
  );
  p.agendas = [
    {
      ...p.agendas[0],
      id: "A",
      utteranceIds: ["U01", "U08", "U10"],
      needsReview: false,
    },
  ];
  p.selectedAgendaId = "A";
  p.relations = [
    {
      id: "fixed-return",
      from: "U08",
      to: "U10",
      kind: "return",
      evidenceIds: ["U08", "U10"],
    },
  ];
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "fixed.json",
    mimeType: "application/json",
    buffer: Buffer.from(exportProject(p, "json")),
  });
  await expect(page.locator('[data-id="U08"]')).toBeAttached();
  return p;
}
async function detail(page: Page, id: string) {
  const button = page.locator(`[data-id="${id}"] .speech-hit`);
  await button.focus();
  await button.press("Enter");
  const inspector = page.getByRole("complementary", {
    name: "選択した発言の詳細",
  });
  await expect(inspector).toBeVisible();
  return inspector;
}
async function save(page: Page) {
  await page
    .getByRole("button", { name: "この端末に保存", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "このブラウザに保存しました",
  );
}
async function reopen(page: Page) {
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "論点整理.", exact: true }).click();
  await page
    .locator(".recent-open")
    .filter({ hasText: "復帰の固定fixture" })
    .click();
}

test("復帰なしを実保存・同一タブ再開しても旧edgeが残らず、復帰先は不変", async ({
  page,
}) => {
  await openFixture(page);
  const inspector = await detail(page, "U08");
  await expect(inspector.getByLabel("この発言からの復帰先")).toHaveValue("U10");
  await inspector.getByLabel("この発言からの復帰先").selectOption("");
  await inspector
    .getByLabel("変更理由", { exact: true })
    .fill("原文に照合して復帰なし");
  await inspector
    .getByRole("button", { name: "訂正を保存", exact: true })
    .click();
  await expect(inspector.getByLabel("この発言からの復帰先")).toHaveValue("");
  await save(page);
  await reopen(page);
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  const reopened = await detail(page, "U08");
  await expect(reopened.getByLabel("この発言からの復帰先")).toHaveValue("");
  await page.keyboard.press("Escape");
  const target = await detail(page, "U10");
  await expect(target.getByLabel("発言の分類")).toHaveValue("main");
  await expect(target.locator("blockquote")).toContainText(
    "在宅勤務の試行の話に戻ると",
  );
});

test("復帰先分類と関係を明示的に扱い、同時変更を一回のUndoで戻す", async ({
  page,
}) => {
  await openFixture(page);
  const target = await detail(page, "U10");
  await target.getByLabel("発言の分類").selectOption("derived");
  await target
    .getByLabel("変更理由", { exact: true })
    .fill("分類と復帰線の同時訂正");
  await target.getByRole("button", { name: "訂正を保存", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("線を残すか外すか");
  await target.getByLabel("線を外して未確定", { exact: true }).check();
  await target.getByRole("button", { name: "訂正を保存", exact: true }).click();
  await expect(target.getByLabel("発言の分類")).toHaveValue("derived");
  await expect(page.locator(".react-flow__edge")).toHaveCount(0);
  await page.keyboard.press("Escape");
  const source = await detail(page, "U08");
  await expect(source.getByLabel("この発言からの復帰先")).toHaveValue(
    "__unknown",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "訂正履歴", exact: true }).click();
  await page
    .getByRole("button", { name: "直前の訂正を元に戻す", exact: true })
    .click();
  await page.getByRole("button", { name: "議題の流れ", exact: true }).click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  const restored = await detail(page, "U10");
  await expect(restored.getByLabel("発言の分類")).toHaveValue("main");
});

test("分類を派生へ訂正しても明示選択した復帰線を保持する", async ({ page }) => {
  await openFixture(page);
  const target = await detail(page, "U10");
  await target.getByLabel("発言の分類").selectOption("derived");
  await target.getByLabel("線を残して要確認", { exact: true }).check();
  await target
    .getByLabel("変更理由", { exact: true })
    .fill("線は残し要確認とする");
  await target.getByRole("button", { name: "訂正を保存", exact: true }).click();
  await expect(target.getByLabel("発言の分類")).toHaveValue("derived");
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await save(page);
  await reopen(page);
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
});
