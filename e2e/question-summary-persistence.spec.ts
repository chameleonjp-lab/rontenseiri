import { expect, test, type Page } from "@playwright/test";
import { createProject } from "../src/domain/project";
import { parseInputs } from "../src/input/parse";
import { addQuestion, linkResponse } from "../src/domain/reasoning";
import { exportProject } from "../src/export/project";
import type { Project } from "../src/domain/types";

const OLD_QUESTION = "費用は？";
const NEW_QUESTION = "税込の費用は？";
const REASON = "税込条件を追加し、旧版の回答を新版へ移さない";
const CONFIRM_REASON = "初回リンク後の要約を通常確認";
const WARNING = "訂正の影響があるため、この振り返りは要再確認です。";

async function fixture(action: "revise" | "retract") {
  const parsed = await parseInputs([
    {
      name: "t.txt",
      format: "txt",
      role: "conversation",
      text: "費用は？\n100円です",
    },
  ]);
  let p = createProject(parsed, `問い要約永続化-${action}`, "full");
  p.agendas[0].summaryDependencies = ["U02"];
  p.agendas[0].arrival = "元の問いに対する回答要約";
  p = addQuestion(
    p,
    OLD_QUESTION,
    "original",
    ["U01"],
    "manual",
    undefined,
    "問い登録",
  );
  const q = p.reasoning!.questions[0];
  p = linkResponse(
    p,
    {
      questionVersionId: q.currentVersionId,
      utteranceIds: ["U02"],
      kind: "answer",
      fulfillment: "fulfilled",
      actor: "manual",
      time: {
        asOf: "2020-01-01T00:00:00.000Z",
        recordedAt: "2020-01-01T00:00:00.000Z",
      },
      counterargumentToClaimIds: [],
      evidenceIds: [],
    },
    "回答登録",
  );
  // The imported fixture must arrive in the invalidated state; only the UI
  // confirmation below may establish the clean baseline.
  expect(p.agendas[0].needsReview).toBe(true);
  return { p, action, questionId: q.id, oldVersion: q.currentVersionId };
}

// Observation only: this never writes domain or storage state.
async function stored(page: Page, idOrTitle: string): Promise<Project | null> {
  return page.evaluate(async (wanted) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open("rontenseiri-projects-v1", 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    try {
      return await new Promise<Project | null>((resolve, reject) => {
        const r = db
          .transaction("projects", "readonly")
          .objectStore("projects")
          .getAll();
        r.onsuccess = () =>
          resolve(
            (r.result as Project[]).find(
              (p) => p.id === wanted || p.title === wanted,
            ) ?? null,
          );
        r.onerror = () => reject(r.error);
      });
    } finally {
      db.close();
    }
  }, idOrTitle);
}

async function durable(page: Page, id: string, revisions: number) {
  await expect
    .poll(async () => (await stored(page, id))?.revisions.length, {
      timeout: 10_000,
    })
    .toBe(revisions);
  await expect(page.locator(".save-state")).toContainText("現在版は保存済み");
  return (await stored(page, id))!;
}

async function confirmSummary(page: Page) {
  await page.getByRole("button", { name: "振り返り", exact: true }).click();
  const sidebar = page.locator(".sidebar-agendas");
  await sidebar.getByRole("button").first().click();
  const summary = page.locator(".summary-view");
  await expect(summary.getByText(WARNING, { exact: true })).toBeVisible();
  await expect(
    summary.getByText("元の問いに対する回答要約", { exact: true }),
  ).toBeVisible();
  await summary
    .getByRole("button", { name: "まとめを編集", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "訂正理由", exact: true })
    .fill(CONFIRM_REASON);
  await page
    .getByRole("button", { name: "確認した整理内容を保存", exact: true })
    .click();
  await expect(summary.getByText(WARNING, { exact: true })).not.toBeVisible();
  await expect(
    summary.getByText("元の問いに対する回答要約", { exact: true }),
  ).toBeVisible();
}

async function questionAction(page: Page, action: "revise" | "retract") {
  await page.getByRole("button", { name: "問い・根拠", exact: true }).click();
  const panel = page.getByRole("region", { name: "問い・根拠" });
  if (action === "revise") {
    await panel.getByRole("button", { name: "版を変更", exact: true }).click();
    await panel
      .getByRole("textbox", { name: "新しい問い", exact: true })
      .fill(NEW_QUESTION);
    await panel
      .getByRole("textbox", { name: "変更理由", exact: true })
      .fill(REASON);
    await panel
      .getByRole("button", { name: "新しい版を登録", exact: true })
      .click();
  } else {
    page.once("dialog", async (dialog) => {
      await dialog.accept("撤回理由");
    });
    await panel.getByRole("button", { name: "撤回", exact: true }).click();
  }
}

async function run(action: "revise" | "retract", page: Page) {
  const f = await fixture(action);
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: `question-summary-${action}.json`,
    mimeType: "application/json",
    buffer: Buffer.from(exportProject(f.p, "json")),
  });
  await expect(page.getByRole("status")).toContainText("別コピーとして復元");
  const imported = await stored(page, f.p.id);
  expect(imported).toBeNull();
  expect(f.p.agendas[0].needsReview).toBe(true);
  await confirmSummary(page);
  const baseRevisions = f.p.revisions.length;
  const clean = await (async () => {
    await page
      .getByRole("button", { name: "この端末に保存", exact: true })
      .click();
    return durable(page, f.p.title, baseRevisions + 1);
  })();
  expect(clean.agendas[0].needsReview).toBe(false);
  await expect(page.locator(".summary-view")).not.toContainText(WARNING);
  const originalResponse = structuredClone(clean.reasoning!.responses[0]);
  const originalSources = structuredClone(clean.sources);
  await questionAction(page, action);
  const changed = await durable(page, f.p.title, baseRevisions + 2);
  expect(changed.agendas[0].needsReview).toBe(true);
  expect(changed.agendas[0].arrival).toBe("元の問いに対する回答要約");
  expect(
    changed.reasoning!.questionVersions.find((v) => v.id === f.oldVersion)!
      .status,
  ).toBe(action === "revise" ? "superseded" : "retracted");
  expect(changed.reasoning!.responses[0]).toEqual(originalResponse);
  expect(changed.sources).toEqual(originalSources);
  expect(changed.reasoning!.responses[0].questionVersionId).toBe(f.oldVersion);
  expect(changed.reasoning!.responses[0].fulfillment).toBe("fulfilled");
  expect(changed.reasoning!.responses[0].kind).toBe("answer");
  await page.reload();
  await expect(
    page.locator("button.recent-open", { hasText: f.p.title }),
  ).toHaveCount(1);
  await page.locator("button.recent-open", { hasText: f.p.title }).click();
  await expect(
    page.getByRole("button", { name: "訂正履歴", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "振り返り", exact: true }).click();
  await expect(
    page.locator(".summary-view").getByText(WARNING, { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "訂正履歴", exact: true }).click();
  await page
    .getByRole("button", { name: "直前の訂正を元に戻す", exact: true })
    .click();
  const undo = await durable(page, f.p.title, baseRevisions + 3);
  expect(undo.agendas).toEqual(clean.agendas);
  expect(undo.reasoning).toEqual(clean.reasoning);
  expect(undo.utterances).toEqual(clean.utterances);
  expect(undo.agendas[0].needsReview).toBe(false);
  expect(undo.reasoning!.responses[0]).toEqual(originalResponse);
  expect(undo.sources).toEqual(originalSources);
  expect(undo.reasoning!.questionVersions[0].status).toBe("active");
  if (action === "revise")
    expect(undo.reasoning!.questions[0].currentVersionId).toBe(f.oldVersion);
}

test("問い改版は通常確認後に保存・再読込・Undoできる", async ({ page }) =>
  run("revise", page));
test("問い撤回は通常確認後に保存・再読込・Undoできる", async ({ page }) =>
  run("retract", page));
