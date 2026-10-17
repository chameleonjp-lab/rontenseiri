import { test, expect } from "@playwright/test";
import { createProject } from "../src/domain/project";
import { parseInputs } from "../src/input/parse";
import {
  addEvidence,
  addQuestion,
  linkResponse,
} from "../src/domain/reasoning";
import { exportProject } from "../src/export/project";

type Destination = "right" | "both" | "unresolved";
const time = {
  asOf: "2020-01-01T00:00:00.000Z",
  recordedAt: "2020-01-01T00:00:00.000Z",
};

async function makeFixture() {
  let project = createProject(
    await parseInputs([
      {
        name: "conversation.txt",
        format: "txt",
        role: "conversation",
        text: "A: left right\nB: unrelated evidence\nC: response",
      },
    ]),
    "e2e-split-evidence",
    "full",
  );
  const target = project.utterances[0];
  project = addQuestion(project, "left or right?", "original", [target.id]);
  const questionVersionId = project.reasoning!.questionVersions[0].id;
  project = addEvidence(project, {
    utteranceIds: [target.id],
    sourceIds: [target.sourceId],
    actor: "manual",
    certainty: "confirmed",
    time,
  });
  const evidenceId = project.reasoning!.evidence[0].id;
  project = linkResponse(project, {
    questionVersionId,
    utteranceIds: [target.id],
    kind: "answer",
    fulfillment: "fulfilled",
    actor: "manual",
    time,
    counterargumentToClaimIds: [],
    evidenceIds: [evidenceId],
  });
  return {
    project,
    target,
    evidenceId,
    questionVersionId,
    responseId: project.reasoning!.responses[0].id,
  };
}

test.describe("発言分割の実選択・保存・復元", () => {
  test.describe.configure({ mode: "serial" });
  for (const destination of ["right", "both", "unresolved"] as Destination[])
    test(`${destination} 選択を実UIで完了する`, async ({ page }) => {
      const { project, target, evidenceId, questionVersionId, responseId } =
        await makeFixture();
      const json = exportProject(project, "json");
      await page.goto("/");
      await page.getByLabel("JSONから復元").setInputFiles({
        name: "fixture.rontenseiri.json",
        mimeType: "application/json",
        buffer: Buffer.from(json),
      });
      await expect(
        page
          .getByRole("banner")
          .getByText("e2e-split-evidence", { exact: true }),
      ).toBeVisible();

      await page
        .getByRole("button", { name: "発言と原文", exact: true })
        .click();
      const targetRow = page
        .getByRole("button")
        .filter({ hasText: "left right" })
        .first();
      await expect(targetRow).toBeVisible();
      await targetRow.click();
      const detail = page.getByRole("complementary", {
        name: "選択した発言の詳細",
      });
      await expect(detail).toBeVisible();
      await expect(detail).toContainText(target.id);
      await detail.getByText("発言本文の区切りを編集", { exact: true }).click();
      await expect(
        detail.getByText("分割後の解釈参照先", { exact: true }),
      ).toBeVisible();
      const selects = detail.locator('select[aria-label$="の分割先"]');
      await expect(selects).toHaveCount(3);
      for (const id of [evidenceId, responseId, questionVersionId]) {
        const select = detail.locator(`select[aria-label="${id} の分割先"]`);
        await expect(select).toBeVisible();
        await select.selectOption(destination);
      }
      await detail
        .getByLabel("区切り・関係の変更理由")
        .fill(`E2E ${destination} 選択`);
      await detail.getByLabel("先頭から何文字で分けるか").fill("4");
      await detail
        .getByRole("button", { name: "この発言を2つに分ける", exact: true })
        .click();
      await expect(detail).toContainText("A: l");
      await page
        .getByRole("button", { name: "この端末に保存", exact: true })
        .click();
      await expect(page.getByRole("status")).toContainText("保存");

      await page.reload();
      await expect(page.getByText("最近の作業", { exact: true })).toBeVisible();
      const recent = page
        .locator(".recent-open")
        .filter({ hasText: "e2e-split-evidence" })
        .first();
      await expect(recent).toBeVisible();
      await recent.click();
      await expect(
        page
          .getByRole("banner")
          .getByText("e2e-split-evidence", { exact: true }),
      ).toBeVisible();

      await page.getByRole("button", { name: "出力", exact: true }).click();
      await expect(
        page.getByRole("dialog", { name: "資料を出力する" }),
      ).toBeVisible();
      const dialog = page.getByRole("dialog", { name: "資料を出力する" });
      await dialog
        .getByRole("button", { name: "出力内容をプレビュー", exact: true })
        .click();
      const preview = dialog.locator("pre.export-preview");
      await expect(preview).toContainText('"reasoning"');
      await expect(preview).toContainText('"lineage"');
      await expect(preview).toContainText(target.sourceId);

      await dialog.getByRole("button", { name: "ダイアログを閉じる" }).click();
      await page.getByRole("button", { name: "訂正履歴", exact: true }).click();
      const undo = page.getByRole("button", {
        name: "直前の訂正を元に戻す",
        exact: true,
      });
      await expect(undo).toBeEnabled();
      await undo.click();
      await expect(page.getByRole("status")).toContainText("元に戻しました");
      await page
        .getByRole("button", { name: "発言と原文", exact: true })
        .click();
      await expect(
        page.getByRole("button").filter({ hasText: "left right" }).first(),
      ).toBeVisible();
    });
});
