import { expect, test, type Page } from "@playwright/test";
import { parseInputs } from "../src/input/parse";
import { createProject } from "../src/domain/project";
import { mergeUtterances } from "../src/domain/utterance-editing";
import { exportProject } from "../src/export/project";

async function open(page: Page, merged = false) {
  let p = createProject(
    await parseInputs([
      {
        name: "draft.vtt",
        format: "vtt",
        role: "conversation",
        text: "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n最初の字幕\n\n00:00:02.000 --> 00:00:03.000\n次の字幕\n",
      },
    ]),
    "字幕原文draft",
    "unknown",
  );
  if (merged) p = mergeUtterances(p, ["U01", "U02"], "同じ話者と利用者が確認");
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "draft.rontenseiri.json",
    mimeType: "application/json",
    buffer: Buffer.from(exportProject(p, "json", undefined, false)),
  });
  await expect(
    page.getByRole("status").filter({ hasText: "別コピーとして復元" }),
  ).toBeVisible();
  return p;
}
async function source(page: Page, id: string) {
  const hit = page.locator(`[data-id="${id}"] .speech-hit`);
  await hit.focus();
  await hit.press("Enter");
  const panel = page.getByRole("complementary", { name: "選択した発言の詳細" });
  await panel.getByRole("button", { name: "発言・原文", exact: true }).click();
  return panel;
}

test("未適用の字幕原文と理由は別の発言を選んで戻っても保持され、Projectへ勝手に適用されない", async ({
  page,
}) => {
  const p = await open(page);
  let panel = await source(page, "U01");
  await panel
    .getByLabel("訂正後の原文", { exact: true })
    .fill("最初の未適用draft😀");
  await panel.getByLabel("変更理由", { exact: true }).fill("第1draftの理由");
  await page.keyboard.press("Escape");
  panel = await source(page, "U02");
  await expect(panel.getByLabel("訂正後の原文", { exact: true })).toHaveValue(
    "次の字幕",
  );
  await panel
    .getByLabel("訂正後の原文", { exact: true })
    .fill("次の未適用draft");
  await panel.getByLabel("変更理由", { exact: true }).fill("第2draftの理由");
  await page.keyboard.press("Escape");
  panel = await source(page, "U01");
  await expect(panel.getByLabel("訂正後の原文", { exact: true })).toHaveValue(
    "最初の未適用draft😀",
  );
  await expect(panel.getByLabel("変更理由", { exact: true })).toHaveValue(
    "第1draftの理由",
  );
  await panel
    .getByRole("button", { name: "訂正を保存", exact: true })
    .press("Enter");
  await page.keyboard.press("Escape");
  panel = await source(page, "U02");
  await expect(panel.getByLabel("訂正後の原文", { exact: true })).toHaveValue(
    "次の未適用draft",
  );
  await expect(panel.getByLabel("変更理由", { exact: true })).toHaveValue(
    "第2draftの理由",
  );
  await page
    .getByRole("button", { name: "この端末に保存", exact: true })
    .press("Enter");
  await expect(
    page.getByRole("status").filter({ hasText: "このブラウザに保存しました" }),
  ).toBeVisible();
  const stored = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("rontenseiri-projects-v1", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise<unknown[]>((resolve, reject) => {
        const tx = db.transaction("projects", "readonly");
        const r = tx.objectStore("projects").getAll();
        tx.oncomplete = () => resolve(r.result);
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  });
  expect(JSON.stringify(stored)).toContain("最初の未適用draft😀");
  expect(JSON.stringify(stored)).not.toContain("次の未適用draft");
  expect(JSON.stringify(stored)).not.toContain("第2draftの理由");
  await expect(panel.getByLabel("訂正後の原文", { exact: true })).toHaveValue(
    "次の未適用draft",
  );
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "訂正履歴", exact: true })
    .press("Enter");
  await page
    .getByRole("button", { name: "直前の訂正を元に戻す", exact: true })
    .press("Enter");
  await page
    .getByRole("button", { name: "議題の流れ", exact: true })
    .press("Enter");
  panel = await source(page, "U01");
  await expect(panel.getByLabel("訂正後の原文", { exact: true })).toHaveValue(
    p.utterances[0].quote,
  );
  await expect(panel.getByLabel("変更理由", { exact: true })).toHaveValue("");
});

test("複合字幕の各本文draftを独立保持し、明示適用したcueだけを訂正する", async ({
  page,
}) => {
  const p = await open(page, true);
  const panel = await source(page, p.utterances[0].id);
  const choice = panel.getByLabel("訂正する字幕本文", { exact: true });
  await panel.getByLabel("訂正後の原文", { exact: true }).fill("第1cueのdraft");
  await panel.getByLabel("変更理由", { exact: true }).fill("第1cue理由");
  await choice.selectOption("1");
  await expect(panel.getByLabel("訂正後の原文", { exact: true })).toHaveValue(
    "次の字幕",
  );
  await expect(panel.getByLabel("変更理由", { exact: true })).toHaveValue("");
  await panel.getByLabel("訂正後の原文", { exact: true }).fill("第2cueのdraft");
  await panel.getByLabel("変更理由", { exact: true }).fill("第2cue理由");
  await choice.selectOption("0");
  await expect(panel.getByLabel("訂正後の原文", { exact: true })).toHaveValue(
    "第1cueのdraft",
  );
  await expect(panel.getByLabel("変更理由", { exact: true })).toHaveValue(
    "第1cue理由",
  );
  await panel
    .getByRole("button", { name: "訂正を保存", exact: true })
    .press("Enter");
  await expect(panel.getByLabel("訂正後の原文", { exact: true })).toHaveValue(
    "第1cueのdraft",
  );
  await expect(panel.getByLabel("変更理由", { exact: true })).toHaveValue("");
  await choice.selectOption("1");
  // New source version after the first cue apply must retain the other cue's
  // draft only if its exact cue body context still matches.
  await expect(panel.getByLabel("訂正後の原文", { exact: true })).toHaveValue(
    "第2cueのdraft",
  );
  await expect(panel.getByLabel("変更理由", { exact: true })).toHaveValue(
    "第2cue理由",
  );
});

test("明示破棄は選んだ字幕本文の原文と理由だけを戻す", async ({ page }) => {
  const p = await open(page, true);
  const panel = await source(page, p.utterances[0].id);
  await panel.getByLabel("訂正後の原文", { exact: true }).fill("第1保持draft");
  await panel.getByLabel("変更理由", { exact: true }).fill("第1保持理由");
  await panel.getByLabel("訂正する字幕本文", { exact: true }).selectOption("1");
  await panel.getByLabel("訂正後の原文", { exact: true }).fill("第2破棄draft");
  await panel.getByLabel("変更理由", { exact: true }).fill("第2破棄理由");
  await panel
    .getByRole("button", { name: "この本文の下書きを破棄", exact: true })
    .press("Enter");
  await expect(panel.getByLabel("訂正後の原文", { exact: true })).toHaveValue(
    "次の字幕",
  );
  await expect(panel.getByLabel("変更理由", { exact: true })).toHaveValue("");
  await panel.getByLabel("訂正する字幕本文", { exact: true }).selectOption("0");
  await expect(panel.getByLabel("訂正後の原文", { exact: true })).toHaveValue(
    "第1保持draft",
  );
  await expect(panel.getByLabel("変更理由", { exact: true })).toHaveValue(
    "第1保持理由",
  );
});
