import { expect, test, type Page, type Dialog } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { incomingReturnsFixture } from "../tests/fixtures/incoming-returns";
import {
  reviseProject,
  reviseSource,
  validateProject,
} from "../src/domain/project";
import { invalidateDependents } from "../src/domain/invalidation";
import { addQuestion } from "../src/domain/reasoning";
import { splitUtterance } from "../src/domain/utterance-editing";
import { undoLastRevision } from "../src/domain/revisions";
import { parseInputs } from "../src/input/parse";
import { exportProject } from "../src/export/project";
import { buildSourceCoverage } from "../src/domain/coverage";
import type { Project } from "../src/domain/types";

// Faults affect only the projects object store. Abort occurs after the native
// put request succeeds, before transaction commit: this is not a mocked DB.
async function installFault(page: Page) {
  await page.addInitScript(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (
      ...args: Parameters<typeof original>
    ) {
      const mode = (window as Window & { __p5Fault?: "quota" | "abort" })
        .__p5Fault;
      if (this.name === "projects" && mode === "quota")
        throw new DOMException("P5 quota injection", "QuotaExceededError");
      const request = original.apply(this, args);
      if (this.name === "projects" && mode === "abort") {
        request.addEventListener("success", () => this.transaction.abort(), {
          once: true,
        });
      }
      return request;
    };
  });
}
async function fault(page: Page, mode?: "quota" | "abort") {
  await page.evaluate((value) => {
    (window as Window & { __p5Fault?: "quota" | "abort" }).__p5Fault = value;
  }, mode);
}
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
        let all: Project[] = [];
        r.onsuccess = () => {
          all = r.result;
        };
        tx.oncomplete = () => resolve(all);
        tx.onabort = tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  });
}
async function richFixture(title: string) {
  let p = incomingReturnsFixture();
  p.title = title;
  p = reviseSource(
    p,
    "U01",
    p.utterances[0].quote + "（r1で原文訂正済み）",
    "P5 r1原文",
  );
  p = splitUtterance(p, "U16", 5, "P5 r1 lineage");
  p = addQuestion(
    p,
    "保存失敗時に訂正を失わないか？",
    "original",
    ["U01"],
    "manual",
    undefined,
    "P5 r1問い",
  );
  const reference = await parseInputs([
    {
      name: "reference.vtt",
      format: "vtt",
      role: "reference",
      text: "WEBVTT\n\nreference-cue\n00:00:01.000 --> 00:00:02.000\n参照字幕😀\n",
    },
  ]);
  const lastOrder = Math.max(...p.utterances.map((u) => u.order));
  const referenceUtterances = reference.utterances.map((u, index) => ({
    ...u,
    id: `P5-REF-${index + 1}`,
    order: lastOrder + index + 1,
  }));
  p.utterances.push(...referenceUtterances);
  p.sources.push(
    ...reference.sources.map((source) => ({
      ...source,
      coverage: buildSourceCoverage(source, referenceUtterances),
    })),
  );
  p.extent = "excerpt";
  p.omissions = [
    {
      id: "p5-omission",
      description: "議論の前半は入力外",
      reason: "受領資料に含まれない",
      location: "開始前",
    },
  ];
  expect(p.sources.length).toBeGreaterThan(1);
  expect(p.sources.some((s) => (s.cueLedger?.length ?? 0) > 0)).toBe(true);
  expect(p.relations.length).toBeGreaterThan(0);
  expect(p.reasoning!.questions.length).toBeGreaterThan(0);
  expect(p.lineage!.records.length).toBeGreaterThan(0);
  return validateProject(p);
}
async function setImport(page: Page, text: string) {
  await page.locator("input[type=file]").setInputFiles({
    name: "p5.rontenseiri.json",
    mimeType: "application/json",
    buffer: Buffer.from(text),
  });
}
async function restore(page: Page, text: string) {
  const close = page.getByRole("button", { name: "通知を閉じる", exact: true });
  if (await close.isVisible()) await close.click();
  const confirm = (dialog: Dialog) => dialog.accept();
  page.on("dialog", confirm);
  try {
    await setImport(page, text);
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "別コピーとして復元しました" }),
    ).toBeVisible();
  } finally {
    page.off("dialog", confirm);
  }
}
async function persist(page: Page) {
  await page
    .getByRole("button", { name: "この端末に保存", exact: true })
    .press("Enter");
  await expect(
    page.getByRole("status").filter({ hasText: "このブラウザに保存しました" }),
  ).toBeVisible();
}
async function openFixture(page: Page, title: string, save: boolean) {
  await page.goto("/");
  await restore(
    page,
    exportProject(await richFixture(title), "json", undefined, false),
  );
  if (save) {
    await persist(page);
    await expect.poll(async () => (await rows(page)).length).toBe(1);
  }
  const hit = page.locator('[data-id="U01"] .speech-hit');
  await hit.focus();
  await hit.press("Enter");
  const panel = page.getByRole("complementary", { name: "選択した発言の詳細" });
  await expect(panel).toBeVisible();
  return panel;
}
const reason = "P5 r2適用済み分類訂正";
async function applyR2AndDraft(page: Page) {
  const panel = page.getByRole("complementary", { name: "選択した発言の詳細" });
  await panel.getByLabel("発言の分類", { exact: true }).selectOption("derived");
  await panel.getByLabel("変更理由", { exact: true }).fill(reason);
  await panel
    .getByRole("button", { name: "訂正を保存", exact: true })
    .press("Enter");
  await panel.getByLabel("発言の分類", { exact: true }).selectOption("main");
  await panel.getByLabel("話者", { exact: true }).fill("未適用DRAFT話者");
  await panel.getByLabel("変更理由", { exact: true }).fill("未適用DRAFT理由");
  return panel;
}
async function failedSave(page: Page) {
  const button = page.getByRole("button", {
    name: "この端末に保存",
    exact: true,
  });
  await button.press("Enter");
  await expect(page.getByRole("alert")).toContainText(/保存/);
  await expect(page.getByRole("alert")).not.toContainText("保存しました");
  await expect(
    page.getByRole("status").filter({ hasText: "このブラウザに保存しました" }),
  ).toHaveCount(0);
  await expect(button).toBeFocused();
}
async function backup(page: Page, lastSaved = false) {
  const name = lastSaved
    ? "最後に保存した版を完全JSONで退避"
    : "現在の訂正を完全JSONで退避";
  const button = page.getByRole("button", { name, exact: true });
  const recoveryVisible = await button.isVisible();
  // Verify a real Tab route from the header's save control, not just locator.press.
  await page
    .getByRole("button", { name: "この端末に保存", exact: true })
    .focus();
  await page.keyboard.press("Tab"); // existing Output control
  if (recoveryVisible) {
    await page.keyboard.press("Tab"); // current recovery
    if (lastSaved) await page.keyboard.press("Tab");
    await expect(button).toBeFocused();
  } else {
    expect(lastSaved).toBe(false);
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "資料を出力する" });
    await expect(dialog.getByLabel("出力範囲", { exact: true })).toHaveValue(
      "all",
    );
    await expect(dialog.getByLabel("形式", { exact: true })).toHaveValue(
      "json",
    );
    await expect(
      dialog.getByLabel("人物ラベルを仮名化", { exact: true }),
    ).not.toBeChecked();
    await dialog
      .getByRole("button", { name: "出力内容をプレビュー", exact: true })
      .press("Enter");
    await dialog
      .getByRole("button", { name: "確認した内容をダウンロード", exact: true })
      .focus();
  }
  const downloadEvent = page.waitForEvent("download");
  await page.keyboard.press("Enter");
  const download = await downloadEvent;
  const file = await download.path();
  expect(file).toBeTruthy();
  const text = await readFile(file!, "utf8");
  const data = JSON.parse(text) as {
    scope: string;
    manifest: { fullBackup: boolean; historyIncluded: boolean };
    project: Project;
  };
  expect(data.scope).toBe("full");
  expect(data.manifest.fullBackup).toBe(true);
  expect(data.manifest.historyIncluded).toBe(true);
  expect(text).not.toContain("未適用DRAFT話者");
  expect(text).not.toContain("未適用DRAFT理由");
  if (!recoveryVisible)
    await page
      .getByRole("button", { name: "ダイアログを閉じる", exact: true })
      .press("Enter");
  return { text, project: data.project };
}
function sameApplied(actual: Project, expected: Project) {
  expect(actual.sources).toEqual(expected.sources);
  expect(actual.utterances).toEqual(expected.utterances);
  expect(actual.relations).toEqual(expected.relations);
  expect(actual.agendas).toEqual(expected.agendas);
  expect(actual.reasoning).toEqual(expected.reasoning);
  expect(actual.omissions).toEqual(expected.omissions);
  expect(actual.lineage).toEqual(expected.lineage);
  expect(actual.extent).toBe(expected.extent);
}
async function reloadAcceptingLoss(page: Page) {
  const confirm = (dialog: Dialog) => dialog.accept();
  page.on("dialog", confirm);
  try {
    await page.reload();
  } finally {
    page.off("dialog", confirm);
  }
}
for (const mode of ["quota", "abort"] as const) {
  test(`P5 ${mode}: failed r2 retains exact persisted r1 and drafts; full current JSON restores only as a copy`, async ({
    page,
  }, testInfo) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await installFault(page);
    await openFixture(page, `P5-${mode}`, true);
    const r1 = (await rows(page))[0];
    const savedAt = await page.locator(".save-state small").innerText();
    await fault(page, mode); // before the applied edit and its automatic save
    const panel = await applyR2AndDraft(page);
    // Automatic failure announces without moving focus out of the draft field.
    const draftReason = panel.getByLabel("変更理由", { exact: true });
    await expect(page.getByRole("alert")).toContainText("保存失敗");
    await expect(draftReason).toBeFocused();
    await failedSave(page);
    expect((await rows(page))[0]).toEqual(r1);
    expect(await page.locator(".save-state small").innerText()).toBe(savedAt);
    await expect(panel.getByLabel("発言の分類", { exact: true })).toHaveValue(
      "main",
    );
    await expect(panel.getByLabel("話者", { exact: true })).toHaveValue(
      "未適用DRAFT話者",
    );
    await expect(draftReason).toHaveValue("未適用DRAFT理由");
    await expect(
      page.getByText("未保存の変更があります", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("region", { name: "保存と復旧" }),
    ).toContainText("未適用のフォーム下書きは含みません");
    const expectedR2 = invalidateDependents(
      reviseProject(r1, "U01", { classification: "derived" }, reason),
      ["U01"],
    );
    const saved = await backup(page);
    sameApplied(saved.project, expectedR2);
    expect(saved.project.id).toBe(r1.id);
    expect(saved.project.revisions.slice(0, r1.revisions.length)).toEqual(
      r1.revisions,
    );
    expect(saved.project.revisions).toHaveLength(r1.revisions.length + 1);
    expect(saved.project.revisions.at(-1)?.reason).toBe(reason);
    expect(saved.project.utterances[0].speaker).toBe(r1.utterances[0].speaker);
    const old = await backup(page, true);
    expect(old.project).toEqual(r1); // includes unchanged storageRevision and timestamp
    await expect(panel.getByLabel("話者", { exact: true })).toHaveValue(
      "未適用DRAFT話者",
    );
    expect((await rows(page))[0]).toEqual(r1);
    await page.screenshot({
      path: testInfo.outputPath(`p5-${mode}-unsaved.png`),
      fullPage: true,
    });
    // Cancelling copy switch and closing/reopening the inspector keep the draft.
    let copyPrompt = "";
    page.once("dialog", async (dialog) => {
      copyPrompt = dialog.message();
      await dialog.dismiss();
    });
    await setImport(page, saved.text);
    await expect.poll(() => copyPrompt).toContain("下書き");
    await expect(draftReason).toHaveValue("未適用DRAFT理由");
    await panel
      .getByRole("button", { name: "詳細を閉じる", exact: true })
      .press("Enter");
    await expect(panel).toBeHidden();
    await page.locator('[data-id="U01"] .speech-hit').press("Enter");
    await expect(panel).toBeVisible();
    await expect(draftReason).toHaveValue("未適用DRAFT理由");
    await expect(panel.getByLabel("話者", { exact: true })).toHaveValue(
      "未適用DRAFT話者",
    );
    await expect(panel.getByLabel("発言の分類", { exact: true })).toHaveValue(
      "main",
    );
    // A deliberate reload recovers only the committed r1, never an imaginary r2.
    await reloadAcceptingLoss(page);
    await expect(
      page.getByRole("button", { name: "新しく始める", exact: true }),
    ).toBeVisible();
    expect(await rows(page)).toEqual([r1]);
    await page
      .locator(".recent-open")
      .filter({ hasText: `P5-${mode}` })
      .press("Enter");
    await expect(
      page.getByText("現在版は保存済み", { exact: true }),
    ).toBeVisible();
    expect(await page.locator(".save-state small").innerText()).toBe(savedAt);
    await restore(page, saved.text);
    await expect(
      page.getByText("未保存の変更があります", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("まだ保存していません", { exact: true }),
    ).toBeVisible();
    const pending = await backup(page);
    expect(pending.project.id).not.toBe(r1.id);
    expect(pending.project.saved).toBe(false);
    expect(pending.project.storageRevision).toBe(0);
    sameApplied(pending.project, saved.project);
    expect(await rows(page)).toEqual([r1]);
    await fault(page);
    await persist(page);
    await expect.poll(async () => (await rows(page)).length).toBe(2);
    const all = await rows(page);
    expect(all.find((p) => p.id === r1.id)).toEqual(r1);
    const copy = all.find((p) => p.id !== r1.id)!;
    sameApplied(copy, saved.project);
    expect(copy.revisions).toEqual(saved.project.revisions);
    expect(copy.saved).toBe(true);
    expect(copy.storageRevision).toBe(1);
    await page
      .getByRole("button", { name: "訂正履歴", exact: true })
      .press("Enter");
    await page
      .getByRole("button", { name: "直前の訂正を元に戻す", exact: true })
      .press("Enter");
    await persist(page);
    const undone = (await rows(page)).find((p) => p.id === copy.id)!;
    sameApplied(undone, undoLastRevision(saved.project));
    expect(undone.revisions.at(-1)?.kind).toBe("undo");
    expect((await rows(page)).find((p) => p.id === r1.id)).toEqual(r1);
    await reloadAcceptingLoss(page);
    expect((await rows(page)).find((p) => p.id === copy.id)).toEqual(undone);
    expect(pageErrors).toEqual([]);
  });

  test(`P5 first-save ${mode}: current correction has a full backup without any last-saved ref`, async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await installFault(page);
    const panel = await openFixture(page, `P5-first-save-${mode}`, false);
    await fault(page, mode);
    await failedSave(page);
    expect(await rows(page)).toEqual([]);
    await applyR2AndDraft(page);
    await failedSave(page);
    await expect(
      page.getByText("未保存の変更があります", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("まだ保存していません", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", {
        name: "最後に保存した版を完全JSONで退避",
        exact: true,
      }),
    ).toBeDisabled();
    const saved = await backup(page);
    expect(saved.project.utterances[0].classification).toBe("derived");
    expect(saved.project.sources.length).toBeGreaterThan(1);
    expect(saved.project.relations.length).toBeGreaterThan(0);
    expect(saved.project.reasoning!.questions.length).toBeGreaterThan(0);
    expect(saved.project.lineage!.records.length).toBeGreaterThan(0);
    expect(saved.project.revisions.at(-1)?.reason).toBe(reason);
    expect(await rows(page)).toEqual([]);
    await expect(panel.getByLabel("話者", { exact: true })).toHaveValue(
      "未適用DRAFT話者",
    );
    await reloadAcceptingLoss(page);
    await expect(
      page.getByText("保存した作業がここに表示されます。", { exact: false }),
    ).toBeVisible();
    expect(await rows(page)).toEqual([]);
    await restore(page, saved.text);
    const pending = await backup(page);
    expect(pending.project.id).not.toBe(saved.project.id);
    expect(pending.project.saved).toBe(false);
    expect(pending.project.storageRevision).toBe(0);
    sameApplied(pending.project, saved.project);
    await fault(page);
    await persist(page);
    await expect.poll(async () => (await rows(page)).length).toBe(1);
    const copy = (await rows(page))[0];
    expect(copy.id).not.toBe(saved.project.id);
    sameApplied(copy, saved.project);
    expect(copy.revisions).toEqual(saved.project.revisions);
    expect(copy.storageRevision).toBe(1);
    expect(pageErrors).toEqual([]);
  });
}

test("P5 autosave failure keeps the focused draft; later successful autosave clears stale failure state", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installFault(page);
  const panel = await openFixture(page, "P5-auto-retry", true);
  const [r1] = await rows(page);
  await fault(page, "quota");
  await applyR2AndDraft(page);
  const reason = panel.getByLabel("変更理由", { exact: true });
  await expect(page.getByRole("alert")).toContainText("保存失敗");
  await expect(reason).toBeFocused();
  await expect(reason).toHaveValue("未適用DRAFT理由");
  await expect(panel.getByLabel("話者", { exact: true })).toHaveValue(
    "未適用DRAFT話者",
  );
  expect(await rows(page)).toEqual([r1]);
  await expect(
    page.getByRole("status").filter({ hasText: "保存しました" }),
  ).toHaveCount(0);
  await fault(page);
  await panel.getByLabel("発言の分類", { exact: true }).selectOption("drift");
  await reason.fill("P5 r3 自動保存の再成功");
  await panel
    .getByRole("button", { name: "訂正を保存", exact: true })
    .press("Enter");
  await expect(
    page.getByText("現在版は保存済み", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "保存と復旧", exact: true }),
  ).toHaveCount(0);
  const [r3] = await rows(page);
  expect(r3.storageRevision).toBe(r1.storageRevision! + 1);
  expect(r3.revisions.at(-1)?.reason).toBe("P5 r3 自動保存の再成功");
  expect(r3.utterances.find((u) => u.id === "U01")?.speaker).toBe(
    "未適用DRAFT話者",
  );
  const savedTime = await page.evaluate(
    (timestamp) => new Date(timestamp).toLocaleTimeString("ja-JP"),
    r3.updatedAt,
  );
  await expect(page.locator(".save-state small")).toContainText(savedTime);
  expect(errors).toEqual([]);
});
