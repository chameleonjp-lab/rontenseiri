import { expect, test, type Page } from "@playwright/test";
import { createProject } from "../src/domain/project";
import { createReasoningGraph } from "../src/domain/reasoning";
import { parseInputs } from "../src/input/parse";
import { exportProject } from "../src/export/project";
import type { Project } from "../src/domain/types";

const OLD_QUESTION = "費用は？";
const RESPONSE = "response-cost";
const OLD_VERSION = "question-version-original";
const QUESTION = "question-cost";
const REASON = "原文を確認し、回答の原文や問いを残して応答の関連だけを解除する";
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
    "R15 応答解除の保存・リロード・Undo",
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
  // A depends only on answer U02; B only on independent U03.
  // No question dependency or relation can accidentally provide propagation.
  p.agendas = [
    { id: "A", ids: ["U01", "U02"], deps: ["U02"] },
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
    arrival: `${id} の解除前の到達点`,
    unresolved: [],
    nextAction: `${id} の次の一手`,
    needsReview: false,
  }));
  p.selectedAgendaId = "A";
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
      id: RESPONSE,
      questionVersionId: OLD_VERSION,
      utteranceIds: ["U02"],
      kind: "answer",
      fulfillment: "fulfilled",
      actor: "manual",
      time,
      counterargumentToClaimIds: [],
      evidenceIds: ["evidence-question"],
      note: "原文で確認した回答",
    },
  ];
  // Nonempty evidence is preserved, but it cannot route through old answer U02.
  p.reasoning.evidence = [
    {
      id: "evidence-question",
      utteranceIds: ["U01"],
      sourceIds: [p.sources[0].id],
      actor: "manual",
      certainty: "confirmed",
      time,
      note: "問い原文（回答U02を参照しない独立した根拠）",
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

async function preview(
  page: Page,
  saved?: { id: string; revisionCount: number },
): Promise<Envelope> {
  if (saved) {
    // Agenda navigation is a project mutation too. Observe its real autosave
    // before generating, rather than waiting on a preview cleared by a later save.
    await expect
      .poll(
        async () => {
          const p = await stored(page, saved.id);
          return {
            agenda: p?.selectedAgendaId,
            revisionCount: p?.revisions.length,
          };
        },
        { timeout: 10_000 },
      )
      .toEqual({ agenda: "A", revisionCount: saved.revisionCount });
    await expect(page.locator(".save-state")).toContainText("現在版は保存済み");
  }
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
  for (const id of ["A", "B"]) {
    await page
      .locator(".sidebar-agendas")
      .getByRole("button", { name: new RegExp(`Agenda ${id}`) })
      .click();
    const summary = page.locator(".summary-view");
    await expect(
      summary.getByText(`${id} の解除前の到達点`, { exact: true }),
    ).toBeVisible();
    if (needsReview && id === "A")
      await expect(summary.getByText(WARNING, { exact: true })).toBeVisible();
    else
      await expect(
        summary.getByText(WARNING, { exact: true }),
      ).not.toBeVisible();
  }
}

async function responseUI(page: Page, removed: boolean) {
  await page
    .locator(".sidebar-agendas")
    .getByRole("button", { name: /Agenda A/ })
    .click();
  await page.getByRole("button", { name: "問い・根拠", exact: true }).click();
  const panel = page.getByRole("region", { name: "問い・根拠" });
  const versions = panel.locator(".reasoning-version");
  await expect(versions).toHaveCount(1);
  for (const question of [OLD_QUESTION])
    await expect(
      versions.filter({
        has: page.getByText(question, { exact: true }),
      }),
    ).toContainText("現行");
  const responses = panel
    .getByRole("heading", { name: /問い版への応答/ })
    .locator("..");
  const card = responses.locator("article.reasoning-card");
  await expect(card).toHaveCount(removed ? 0 : 1);
  await expect(
    panel.getByRole("button", { name: `応答 ${RESPONSE} を修正`, exact: true }),
  ).toHaveCount(removed ? 0 : 1);
  if (!removed) {
    await expect(card).toContainText(`問い版 ${OLD_VERSION} · 発言 U02`);
    await expect(card).toContainText("要求充足：充足");
    await expect(card).toContainText("根拠 evidence-question");
  }
  return panel;
}

function assertRemoval(p: Project, before: Project) {
  expect(p.id).toBe(before.id);
  expect(p.sources).toEqual(before.sources);
  expect(p.utterances).toEqual(before.utterances);
  expect(p.relations).toEqual(before.relations);
  const { responses, revisions, ...graph } = p.reasoning!;
  const {
    responses: originalResponses,
    revisions: originalRevisions,
    ...originalGraph
  } = before.reasoning!;
  expect(originalRevisions).toEqual([]);
  expect(originalResponses).toHaveLength(1);
  expect(responses).toEqual([]);
  // Questions, versions, evidence and all other graph fields survive removal.
  expect(graph).toEqual(originalGraph);
  // Removing a link does not silently classify the agenda as unanswered.
  expect(p.agendas).toEqual(
    before.agendas.map((a) => ({ ...a, needsReview: a.id === "A" })),
  );
  expect(p.revisions).toHaveLength(1);
  expect(p.revisions[0]).toMatchObject({
    kind: "reasoning:response-removed",
    targetId: RESPONSE,
    reason: REASON,
  });
  const snapshotBefore = p.revisions[0].before as {
    reasoning: Project["reasoning"];
    agendas: Project["agendas"];
  };
  const snapshotAfter = p.revisions[0].after as typeof snapshotBefore;
  expect(snapshotBefore.reasoning).toEqual(before.reasoning);
  // Shared history captures the graph before its audit pointer is appended.
  expect(snapshotAfter.reasoning).toEqual({ ...p.reasoning, revisions: [] });
  expect(snapshotBefore.agendas).toEqual(before.agendas);
  expect(snapshotAfter.agendas).toEqual(p.agendas);
  expect(revisions).toHaveLength(1);
  expect(revisions[0]).toMatchObject({
    kind: "response-removed",
    targetId: RESPONSE,
    before: { revisionId: p.revisions[0].id },
    after: { revisionId: p.revisions[0].id },
    reason: REASON,
  });
}

test("R15: 通常UIで応答だけを解除し、自動保存・リロード・Undoで依存警告と独立まとめを保つ", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "r15-response-removal-fixture.json",
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
  await attach("r15-response-removal-initial-stored.json", initial);

  const panel = await responseUI(page, false);
  await panel
    .getByRole("button", { name: `応答 ${RESPONSE} を修正`, exact: true })
    .click();
  const form = panel.getByRole("form", { name: "応答関係の編集" });
  await expect(
    form.getByRole("combobox", { name: "対象問い版", exact: true }),
  ).toHaveValue(OLD_VERSION);
  await expect(form.getByRole("checkbox", { name: /U02/ })).toBeChecked();
  // Do not edit or save another response revision before removing this link.
  await form.getByLabel("登録理由", { exact: true }).fill(REASON);
  await form
    .getByRole("button", {
      name: "理由を記録して応答の関連を解除",
      exact: true,
    })
    .click();
  await expect(panel).toContainText("未回答・反論なしとは断定しません");
  await expect(
    panel.getByRole("button", { name: `応答 ${RESPONSE} を修正`, exact: true }),
  ).toHaveCount(0);
  // No explicit save: wait for the real autosave debounce and IDB transaction.
  const revised = await durable(page, baseline.id, 1);
  assertRemoval(revised, baseline);
  expect(revised.storageRevision).toBeGreaterThan(initial.storageRevision!);
  await attach("r15-response-removal-revised-stored.json", revised);

  await reloadAndOpen(page, revised);
  await summaries(page, true);
  await responseUI(page, true);
  const reloaded = await preview(page, { id: baseline.id, revisionCount: 1 });
  assertRemoval(reloaded.project, baseline);
  expect(content(reloaded.project)).toEqual(content(revised));
  await attach("r15-response-removal-reloaded-full-output.json", reloaded);
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
  await attach("r15-response-removal-undone-stored.json", undone);

  await reloadAndOpen(page, undone);
  await summaries(page, false);
  await responseUI(page, false);
  const final = await preview(page, { id: baseline.id, revisionCount: 2 });
  expect(content(final.project)).toEqual(content(undone));
  await page.getByRole("button", { name: "訂正履歴", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "直前の訂正を元に戻す", exact: true }),
  ).toBeDisabled();
  await attach("r15-response-removal-undone-reloaded-full-output.json", final);
});
