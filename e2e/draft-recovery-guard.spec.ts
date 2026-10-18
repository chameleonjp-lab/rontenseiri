import { expect, test, type Page } from "@playwright/test";
import { sampleProject } from "../src/analysis/sample";
import { exportProject } from "../src/export/project";

async function savedSample(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "サンプルを見てみる", exact: true })
    .press("Enter");
  await page
    .getByRole("button", { name: "この端末に保存", exact: true })
    .press("Enter");
  await expect(page.getByRole("status")).toContainText("保存しました");
}
async function cancelNavigation(page: Page, action: () => Promise<unknown>) {
  let prompt = "";
  page.once("dialog", async (dialog) => {
    prompt = dialog.message();
    await dialog.dismiss();
  });
  await action();
  await expect.poll(() => prompt).toContain("下書き");
}

test("saved Project with only an omission form draft protects view and copy switches", async ({
  page,
}) => {
  await savedSample(page);
  await page
    .getByRole("button", { name: "原文対応", exact: true })
    .press("Enter");
  const reason = page.getByLabel("この変更を適用する理由", { exact: true });
  await reason.fill("未適用の欠落申告理由");
  await cancelNavigation(page, () =>
    page
      .getByRole("button", { name: "発言と原文", exact: true })
      .press("Enter"),
  );
  await expect(reason).toHaveValue("未適用の欠落申告理由");
  await cancelNavigation(page, () =>
    page.locator("input[type=file]").setInputFiles({
      name: "copy.json",
      mimeType: "application/json",
      buffer: Buffer.from(exportProject(sampleProject(), "json")),
    }),
  );
  await expect(reason).toHaveValue("未適用の欠落申告理由");
  await page
    .getByRole("button", { name: "この端末に保存", exact: true })
    .press("Enter");
  await expect(reason).toHaveValue("未適用の欠落申告理由");
  // Clearing the draft returns to a clean state: navigation needs no discard.
  await reason.fill("");
  await page
    .getByRole("button", { name: "発言と原文", exact: true })
    .press("Enter");
  await expect(reason).toHaveCount(0);
});

test("summary draft survives form close/reopen and unrelated durable save; leaving asks", async ({
  page,
}) => {
  await savedSample(page);
  await page
    .getByRole("button", { name: "振り返り", exact: true })
    .press("Enter");
  const edit = page.getByRole("button", { name: "まとめを編集", exact: true });
  await edit.press("Enter");
  const next = page.getByLabel("次の一手", { exact: true });
  await next.fill("まだ適用していない次の一手");
  await edit.press("Enter");
  await edit.press("Enter");
  await expect(next).toHaveValue("まだ適用していない次の一手");
  await page
    .getByRole("button", { name: "この端末に保存", exact: true })
    .press("Enter");
  await expect(next).toHaveValue("まだ適用していない次の一手");
  await cancelNavigation(page, () =>
    page
      .getByRole("button", { name: "議題の流れ", exact: true })
      .press("Enter"),
  );
  await expect(next).toHaveValue("まだ適用していない次の一手");
});

test("reasoning form and utterance boundary drafts guard the views that would discard them", async ({
  page,
}) => {
  await savedSample(page);
  await page
    .getByRole("button", { name: "問い・根拠", exact: true })
    .press("Enter");
  const question = page.getByRole("textbox", { name: "問い", exact: true });
  await question.fill("未適用の問い");
  await cancelNavigation(page, () =>
    page
      .getByRole("button", { name: "議題の流れ", exact: true })
      .press("Enter"),
  );
  await expect(question).toHaveValue("未適用の問い");
  await question.fill("");
  await page
    .getByRole("button", { name: "議題の流れ", exact: true })
    .press("Enter");
  await page.locator('[data-id="U01"] .speech-hit').press("Enter");
  const panel = page.getByRole("complementary", { name: "選択した発言の詳細" });
  await panel
    .getByText("発言本文の区切りを編集", { exact: true })
    .press("Enter");
  const reason = panel.getByLabel("区切り・関係の変更理由", { exact: true });
  await reason.fill("未適用の区切り理由");
  await cancelNavigation(page, () =>
    panel
      .getByRole("button", { name: "詳細を閉じる", exact: true })
      .press("Enter"),
  );
  await expect(reason).toHaveValue("未適用の区切り理由");
});
