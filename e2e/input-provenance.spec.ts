import { expect, test, type Page } from "@playwright/test";
import { parseInputs } from "../src/input/parse";
import { createProject } from "../src/domain/project";
import { exportProject } from "../src/export/project";
import type { Project } from "../src/domain/types";

async function rows(page: Page): Promise<Project[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("rontenseiri-projects-v1", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise<Project[]>((resolve, reject) => {
        const tx = db.transaction("projects", "readonly");
        const r = tx.objectStore("projects").getAll();
        let result: Project[] = [];
        r.onsuccess = () => {
          result = r.result;
        };
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  });
}
async function restore(page: Page, json: string) {
  const close = page.getByRole("button", { name: "通知を閉じる", exact: true });
  if (await close.isVisible()) await close.click();
  await page.locator("input[type=file]").setInputFiles({
    name: "provenance.json",
    mimeType: "application/json",
    buffer: Buffer.from(json),
  });
  await expect(
    page.getByRole("status").filter({ hasText: "別コピーとして復元しました" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "この端末に保存", exact: true }),
  ).toBeVisible();
}
async function save(page: Page) {
  await page
    .getByRole("button", { name: "この端末に保存", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "このブラウザに保存しました" }),
  ).toBeVisible();
}

test("入力外の欠落申告は下書きと適用を区別し、保存・キーボードUndo・JSON別コピーで保持する", async ({
  page,
}) => {
  const project = createProject(
    await parseInputs([
      {
        name: "excerpt.txt",
        format: "txt",
        role: "conversation",
        text: "本文😀\r\n続き",
      },
    ]),
    "P1欠落申告",
    "excerpt",
  );
  await page.goto("/");
  await restore(page, exportProject(project, "json", undefined, false));
  await save(page);
  await expect.poll(async () => (await rows(page)).length).toBe(1);
  const initial = (await rows(page))[0];
  await page.getByRole("button", { name: "原文対応", exact: true }).click();
  const editor = page.getByRole("region", { name: "記録範囲と欠落申告" });
  await expect(editor).toContainText("未申告");
  await editor
    .getByRole("button", { name: "欠落申告を追加", exact: true })
    .click();
  await editor.getByLabel("欠落申告1の内容").fill("入力前の冒頭説明がない");
  await editor
    .getByLabel("欠落申告1の理由")
    .fill("途中からの記録と提供者が申告");
  await editor.getByLabel("欠落申告1の位置").fill("会議開始時。原文位置は不明");
  expect((await rows(page))[0].omissions).toBeUndefined();
  await editor
    .getByLabel("この変更を適用する理由")
    .fill("利用者による記録範囲の申告");
  await editor
    .getByRole("button", { name: "記録範囲と欠落申告を保存", exact: true })
    .press("Enter");
  await expect
    .poll(async () => (await rows(page))[0]?.omissions?.length)
    .toBe(1);
  const applied = (await rows(page))[0];
  expect(applied.omissions![0]).toMatchObject({
    description: "入力前の冒頭説明がない",
    reason: "途中からの記録と提供者が申告",
    location: "会議開始時。原文位置は不明",
  });
  expect(applied.sources).toEqual(initial.sources);
  expect(applied.revisions.at(-1)?.kind).toBe("project-completeness");
  const backup = exportProject(applied, "json", undefined, false);
  await page
    .getByRole("button", { name: "訂正履歴", exact: true })
    .press("Enter");
  await page
    .getByRole("button", { name: "直前の訂正を元に戻す", exact: true })
    .press("Enter");
  await expect
    .poll(async () => (await rows(page))[0]?.omissions)
    .toBeUndefined();
  await page
    .getByRole("button", { name: "原文対応", exact: true })
    .press("Enter");
  await expect(editor).toContainText("未申告");
  await restore(page, backup);
  await save(page);
  await expect.poll(async () => (await rows(page)).length).toBe(2);
  const all = await rows(page);
  const copy = all.find((p) => p.id !== initial.id)!;
  expect(copy.omissions).toEqual(applied.omissions);
  expect(copy.sources).toEqual(applied.sources);
  expect(copy.revisions).toEqual(applied.revisions);
  expect(all.find((p) => p.id === initial.id)?.omissions).toBeUndefined();
});

test("VTT本文統合と一cue訂正は時刻行を引用に入れず来歴を保存・JSON復元・Undoする", async ({
  page,
}) => {
  const text =
    "WEBVTT\r\n\r\nraw-dup\r\n00:00:01.000 --> 00:00:03.000\r\n最初😀\r\n複数行\r\n\r\nNOTE 入力の注記\r\n\r\nraw-dup\r\n00:00:02.000 --> 00:00:04.000\r\n次の本文\r\n";
  const project = createProject(
    await parseInputs([
      { name: "overlap.vtt", format: "vtt", role: "conversation", text },
    ]),
    "P1字幕来歴",
    "unknown",
  );
  await page.goto("/");
  await restore(page, exportProject(project, "json", undefined, false));
  await save(page);
  const hit = page.locator('[data-id="U01"] .speech-hit');
  await hit.focus();
  await hit.press("Enter");
  const panel = page.getByRole("complementary", { name: "選択した発言の詳細" });
  await panel.getByText("発言本文の区切りを編集", { exact: true }).click();
  await panel
    .getByLabel("区切り・関係の変更理由")
    .fill("同じ話者と利用者が確認して統合");
  await panel
    .getByRole("button", { name: "直後の同じ話者の発言と統合", exact: true })
    .click();
  await expect
    .poll(async () => (await rows(page))[0]?.utterances.length)
    .toBe(1);
  const merged = (await rows(page))[0];
  expect(merged.utterances[0].quote).toBe("最初😀\r\n複数行\n次の本文");
  expect(merged.utterances[0].cueSpans).toHaveLength(2);
  expect(merged.utterances[0].time).toBeUndefined();
  expect(merged.sources[0].text).toBe(text);
  expect(merged.sources[0].cueLedger!.map((c) => c.rawId)).toEqual([
    "raw-dup",
    "raw-dup",
  ]);
  await panel.getByText("字幕cueの出典対応", { exact: true }).click();
  await expect(panel).toContainText("00:00:01.000 --> 00:00:03.000");
  await expect(panel).toContainText("00:00:02.000 --> 00:00:04.000");
  await panel.getByRole("button", { name: "発言・原文", exact: true }).click();
  await panel.getByLabel("訂正する字幕本文").selectOption("1");
  await panel.getByLabel("訂正後の原文").fill("訂正👩‍💻した本文");
  await panel
    .getByLabel("変更理由", { exact: true })
    .fill("第2cueの本文だけを訂正");
  await panel.getByRole("button", { name: "訂正を保存", exact: true }).click();
  await expect
    .poll(async () => (await rows(page))[0]?.utterances[0]?.quote)
    .toBe("最初😀\r\n複数行\n訂正👩‍💻した本文");
  const corrected = (await rows(page))[0];
  const source = corrected.sources.find(
    (s) => s.versionId === corrected.utterances[0].sourceVersionId,
  )!;
  expect(source.text).toBe(text.replace("次の本文", "訂正👩‍💻した本文"));
  expect(source.cueLedger!.map((c) => c.time)).toEqual(
    project.sources[0].cueLedger!.map((c) => c.time),
  );
  const backup = exportProject(corrected, "json", undefined, false);
  await restore(page, backup);
  await save(page);
  await expect.poll(async () => (await rows(page)).length).toBe(2);
  const restored = (await rows(page)).find((p) => p.id !== corrected.id)!;
  expect(restored.sources).toEqual(corrected.sources);
  expect(restored.utterances).toEqual(corrected.utterances);
  await page
    .getByRole("button", { name: "訂正履歴", exact: true })
    .press("Enter");
  await page
    .getByRole("button", { name: "直前の訂正を元に戻す", exact: true })
    .press("Enter");
  await expect
    .poll(
      async () =>
        (await rows(page)).find((p) => p.id === restored.id)?.utterances[0]
          .quote,
    )
    .toBe(merged.utterances[0].quote);
});
