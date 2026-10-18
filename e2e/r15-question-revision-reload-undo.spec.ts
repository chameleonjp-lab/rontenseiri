import { expect, test, type Page } from "@playwright/test";
import { createProject } from "../src/domain/project";
import { createReasoningGraph } from "../src/domain/reasoning";
import { parseInputs } from "../src/input/parse";
import { exportProject } from "../src/export/project";
import type { Project } from "../src/domain/types";

const OLD_QUESTION = "費用は？";
const NEW_QUESTION = "税込の費用は？";
const OLD_VERSION = "question-version-original";
const QUESTION = "question-cost";
const REASON = "税込条件を追加し、旧版の回答を新版へ移さない";
const WARNING = "訂正の影響があるため、この振り返りは要再確認です。";

type Envelope = {
  scope: string;
  manifest: Record<string, unknown>;
  project: Project;
};

async function fixture() {
  const p = createProject(
    await parseInputs([
      {
        name: "cost.txt",
        format: "txt",
        role: "conversation",
        text: "費用は？\n100円です\n別件の会場は確定した。",
      },
    ]),
    "R15 問い改版の保存・リロード・Undo",
    "full",
  );
  expect(p.utterances.map((u) => u.quote)).toEqual([
    OLD_QUESTION,
    "100円です",
    "別件の会場は確定した。",
  ]);
  p.utterances.forEach((u) => {
    u.classification = "main";
  });
  // Only the answer U02 is a summary dependency. The question U01 is deliberately
  // absent, so marking R requires following the old question-version response.
  p.agendas = [
    { id: "R", ids: ["U01", "U02"], deps: ["U02"] },
    { id: "B", ids: ["U03"], deps: ["U03"] },
  ].map(({ id, ids, deps }) => ({
    id,
    title: `Agenda ${id}`,
    utteranceIds: ids,
    summaryDependencies: deps,
    boundary: "user-confirmed" as const,
    decision: "decided" as const,
    answer: "present" as const,
    agreement: "explicit" as const,
    verification: "user-recorded" as const,
    arrival: `${id} の改版前の到達点`,
    unresolved: [],
    nextAction: `${id} の次の一手`,
    needsReview: false,
  }));
  p.selectedAgendaId = "R";
  p.relations = [];
  const time = {
    asOf: "2020-01-01T00:00:00.000Z",
    recordedAt: "2020-01-01T00:00:00.000Z",
  };
  // A pre-existing graph fixture, not a claim that question/response creation UI
  // was exercised. All mutations after import use the product's normal UI.
  p.reasoning = createReasoningGraph();
  p.reasoning.questions = [
    {
      id: QUESTION,
      origin: "original",
      versionIds: [OLD_VERSION],
      currentVersionId: OLD_VERSION,
    },
  ];
  p.reasoning.questionVersions = [
    {
      id: OLD_VERSION,
      questionId: QUESTION,
      text: OLD_QUESTION,
      status: "active",
      actor: "manual",
      time,
      sourceUtteranceIds: ["U01"],
    },
  ];
  p.reasoning.responses = [
    {
      id: "response-cost",
      questionVersionId: OLD_VERSION,
      utteranceIds: ["U02"],
      kind: "answer",
      fulfillment: "fulfilled",
      actor: "manual",
      time,
      counterargumentToClaimIds: [],
      evidenceIds: [],
    },
  ];
  return p;
}

// Observation only: no storage/domain writes, module imports or app-state injection.
async function stored(page: Page, id: string): Promise<Project | null> {
  return page.evaluate(async (wanted) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("rontenseiri-projects-v1", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<Project | null>((resolve, reject) => {
        const request = db
          .transaction("projects", "readonly")
          .objectStore("projects")
          .get(`project:${wanted}`);
        request.onsuccess = () =>
          resolve((request.result as Project | undefined) ?? null);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }, id);
}

function content(p: Project) {
  const {
    selectedAgendaId: _selection,
    saved: _saved,
    storageRevision: _generation,
    updatedAt: _updated,
    ...rest
  } = p;
  return rest;
}

async function attach(name: string, value: unknown) {
  await test.info().attach(name, {
    body: JSON.stringify(value, null, 2),
    contentType: "application/json",
  });
}

async function preview(page: Page): Promise<Envelope> {
  await page.getByRole("button", { name: "出力", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("出力範囲").selectOption("all");
  await dialog.getByLabel("形式").selectOption("json");
  await dialog
    .getByRole("button", { name: "出力内容をプレビュー", exact: true })
    .click();
  const envelope = JSON.parse(
    (await dialog.locator("pre.export-preview").textContent())!,
  ) as Envelope;
  expect(envelope.scope).toBe("full");
  expect(envelope.manifest).toMatchObject({
    limited: false,
    fullBackup: true,
    historyIncluded: true,
    schemaVersion: 1,
  });
  await dialog
    .getByRole("button", { name: "ダイアログを閉じる", exact: true })
    .click();
  return envelope;
}

async function durable(page: Page, id: string, revisionCount: number) {
  await expect
    .poll(async () => (await stored(page, id))?.revisions.length, {
      timeout: 10_000,
    })
    .toBe(revisionCount);
  await expect(page.locator(".save-state")).toContainText("現在版は保存済み");
  const p = await stored(page, id);
  expect(p).not.toBeNull();
  expect(p!.saved).toBe(true);
  return p!;
}

async function reloadAndOpen(page: Page, p: Project) {
  await page.reload();
  const recent = page.locator("button.recent-open", { hasText: p.title });
  await expect(recent).toHaveCount(1);
  await recent.click();
  await expect(
    page.getByRole("button", { name: "訂正履歴", exact: true }),
  ).toBeVisible();
}

async function summaries(page: Page, needsReview: boolean) {
  await page.getByRole("button", { name: "振り返り", exact: true }).click();
  for (const id of ["R", "B"]) {
    await page
      .locator(".sidebar-agendas")
      .getByRole("button", { name: new RegExp(`Agenda ${id}`) })
      .click();
    const summary = page.locator(".summary-view");
    await expect(
      summary.getByText(`${id} の改版前の到達点`, { exact: true }),
    ).toBeVisible();
    if (needsReview && id === "R")
      await expect(summary.getByText(WARNING, { exact: true })).toBeVisible();
    else
      await expect(
        summary.getByText(WARNING, { exact: true }),
      ).not.toBeVisible();
  }
}

async function questionUI(page: Page, revised: boolean) {
  await page
    .locator(".sidebar-agendas")
    .getByRole("button", { name: /Agenda R/ })
    .click();
  await page.getByRole("button", { name: "問い・根拠", exact: true }).click();
  const panel = page.getByRole("region", { name: "問い・根拠" });
  const versions = panel.locator(".reasoning-version");
  await expect(versions).toHaveCount(revised ? 2 : 1);
  const old = versions.filter({
    has: page.getByText(OLD_QUESTION, { exact: true }),
  });
  await expect(old).toContainText(revised ? "新版に置換" : "現行");
  if (revised)
    await expect(
      versions.filter({
        has: page.getByText(NEW_QUESTION, { exact: true }),
      }),
    ).toContainText("現行");
  else
    await expect(panel.getByText(NEW_QUESTION, { exact: true })).toHaveCount(0);
  const responses = panel
    .getByRole("heading", { name: /問い版への応答/ })
    .locator("..");
  await expect(responses.locator("article.reasoning-card")).toHaveCount(1);
  await expect(responses.locator("article.reasoning-card")).toContainText(
    `問い版 ${OLD_VERSION} · 発言 U02`,
  );
  await expect(responses.locator("article.reasoning-card")).toContainText(
    "要求充足：充足",
  );
  return panel;
}

function assertRevision(p: Project, before: Project) {
  expect(p.id).toBe(before.id);
  expect(p.sources).toEqual(before.sources);
  expect(p.utterances).toEqual(before.utterances);
  expect(p.relations).toEqual(before.relations);
  expect(p.reasoning!.responses).toEqual(before.reasoning!.responses);
  const q = p.reasoning!.questions[0];
  expect(q.id).toBe(QUESTION);
  expect(q.currentVersionId).not.toBe(OLD_VERSION);
  expect(q.versionIds).toEqual([OLD_VERSION, q.currentVersionId]);
  expect(p.reasoning!.questionVersions).toHaveLength(2);
  expect(p.reasoning!.questionVersions[0]).toEqual({
    ...before.reasoning!.questionVersions[0],
    status: "superseded",
  });
  expect(p.reasoning!.questionVersions[1]).toMatchObject({
    id: q.currentVersionId,
    questionId: QUESTION,
    text: NEW_QUESTION,
    status: "active",
    supersedesId: OLD_VERSION,
    sourceUtteranceIds: ["U01"],
    actor: "manual",
    reason: REASON,
  });
  expect(p.agendas).toEqual(
    before.agendas.map((a) => ({ ...a, needsReview: a.id === "R" })),
  );
  expect(p.revisions).toHaveLength(1);
  expect(p.revisions[0]).toMatchObject({
    kind: "reasoning:question-revised",
    targetId: QUESTION,
    reason: REASON,
  });
  expect(p.reasoning!.revisions).toHaveLength(1);
  expect(p.reasoning!.revisions[0]).toMatchObject({
    kind: "question-revised",
    targetId: QUESTION,
    before: { revisionId: p.revisions[0].id },
    after: { revisionId: p.revisions[0].id },
    reason: REASON,
  });
}

test("R15: 通常UIの問い改版は旧版応答と依存まとめを保存し、リロード・Undo後も整合する", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "r15-question-fixture.json",
    mimeType: "application/json",
    buffer: Buffer.from(exportProject(await fixture(), "json")),
  });
  await expect(page.getByRole("status")).toContainText("別コピーとして復元");
  const baseline = (await preview(page)).project;
  expect(baseline.revisions).toEqual([]);
  expect(baseline.agendas.every((a) => !a.needsReview)).toBe(true);
  await page
    .getByRole("button", { name: "この端末に保存", exact: true })
    .click();
  const initial = await durable(page, baseline.id, 0);
  expect(content(initial)).toEqual(content(baseline));
  await attach("r15-question-initial-stored.json", initial);

  const panel = await questionUI(page, false);
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
  // No explicit save: wait for the real autosave debounce and IDB transaction.
  const revised = await durable(page, baseline.id, 1);
  assertRevision(revised, baseline);
  expect(revised.storageRevision).toBeGreaterThan(initial.storageRevision!);
  await attach("r15-question-revised-stored.json", revised);

  await reloadAndOpen(page, revised);
  await summaries(page, true);
  await questionUI(page, true);
  const reloaded = await preview(page);
  assertRevision(reloaded.project, baseline);
  expect(content(reloaded.project)).toEqual(content(revised));
  await attach("r15-question-reloaded-full-output.json", reloaded);
  await page.getByRole("button", { name: "訂正履歴", exact: true }).click();
  await expect(page.getByText(REASON, { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "直前の訂正を元に戻す", exact: true })
    .click();
  const undone = await durable(page, baseline.id, 2);
  expect(undone.agendas).toEqual(baseline.agendas);
  expect(undone.reasoning).toEqual(baseline.reasoning);
  expect(undone.sources).toEqual(baseline.sources);
  expect(undone.utterances).toEqual(baseline.utterances);
  expect(undone.relations).toEqual(baseline.relations);
  expect(undone.revisions[0]).toEqual(revised.revisions[0]);
  expect(undone.revisions[1]).toMatchObject({
    kind: "undo",
    after: { targetRevisionId: revised.revisions[0].id },
  });
  expect(undone.storageRevision).toBeGreaterThan(revised.storageRevision!);
  await attach("r15-question-undone-stored.json", undone);

  await reloadAndOpen(page, undone);
  await summaries(page, false);
  await questionUI(page, false);
  const final = await preview(page);
  expect(content(final.project)).toEqual(content(undone));
  await page.getByRole("button", { name: "訂正履歴", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "直前の訂正を元に戻す", exact: true }),
  ).toBeDisabled();
  await attach("r15-question-undone-reloaded-full-output.json", final);
});
