import { expect, test, type Page } from "@playwright/test";
import { createProject } from "../src/domain/project";
import { createReasoningGraph } from "../src/domain/reasoning";
import { parseInputs } from "../src/input/parse";
import { exportProject } from "../src/export/project";
import type { Project } from "../src/domain/types";
import {
  attach,
  content,
  durable,
  preview,
  reloadAndOpen,
} from "./helpers/response-persistence";

const OLD_QUESTION = "費用は？";
const NEW_QUESTION = "税込の費用は？";
const NEW_VERSION = "question-version-tax";
const RESPONSE = "response-cost";
const OLD_VERSION = "question-version-original";
const QUESTION = "question-cost";
const INDEPENDENT_QUESTION = "question-venue";
const INDEPENDENT_VERSION = "question-version-venue";
const INDEPENDENT_RESPONSE = "response-venue";
const REASON =
  "配列先頭の対象応答の要求充足だけを部分充足から充足へ訂正し、2番目の独立応答を全フィールド保持する";
const WARNING = "訂正の影響があるため、この振り返りは要再確認です。";

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
    "R15 先頭の部分充足から充足への訂正と2番目独立応答の保存・リロード・Undo",
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
  // A depends only on target U02. Independent B and its response use U03.
  // A question sources are U01, never U02/U03; B has its own question/version.
  // No relation, evidence, claim, interpretation or uncertainty edge can bypass
  // the target response or connect the two components.
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
    arrival: `${id} の付替え前の到達点`,
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
      versionIds: [OLD_VERSION, NEW_VERSION],
      currentVersionId: NEW_VERSION,
    },
    {
      id: INDEPENDENT_QUESTION,
      origin: "analysis",
      versionIds: [INDEPENDENT_VERSION],
      currentVersionId: INDEPENDENT_VERSION,
    },
  ];
  p.reasoning.questionVersions = [
    {
      id: OLD_VERSION,
      questionId: QUESTION,
      text: OLD_QUESTION,
      status: "superseded",
      actor: "manual",
      time,
      sourceUtteranceIds: ["U01"],
    },
    {
      id: NEW_VERSION,
      questionId: QUESTION,
      text: NEW_QUESTION,
      status: "active",
      actor: "manual",
      time,
      sourceUtteranceIds: ["U01"],
      supersedesId: OLD_VERSION,
    },
    {
      id: INDEPENDENT_VERSION,
      questionId: INDEPENDENT_QUESTION,
      text: "別件の会場は確定した？",
      status: "active",
      actor: "manual",
      time,
      sourceUtteranceIds: ["U03"],
    },
  ];
  // Target deliberately precedes the independent response; preserve both identities.
  p.reasoning.responses = [
    {
      id: RESPONSE,
      questionVersionId: OLD_VERSION,
      utteranceIds: ["U02"],
      kind: "answer",
      fulfillment: "partially-fulfilled",
      actor: "manual",
      time,
      counterargumentToClaimIds: [],
      evidenceIds: [],
      note: "原文で確認した回答",
    },
    {
      id: INDEPENDENT_RESPONSE,
      questionVersionId: INDEPENDENT_VERSION,
      utteranceIds: ["U03"],
      kind: "answer",
      fulfillment: "not-fulfilled",
      actor: "user-recorded",
      time: {
        asOf: "2020-02-01T00:00:00.000Z",
        recordedAt: "2020-02-02T00:00:00.000Z",
      },
      counterargumentToClaimIds: [],
      evidenceIds: [],
      note: "独立応答：回答ありと要求充足は別記録",
    },
  ];
  p.reasoning.evidence = [];
  return p;
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
      summary.getByText(`${id} の付替え前の到達点`, { exact: true }),
    ).toBeVisible();
    await expect(
      summary
        .locator(".assessment-grid")
        .getByText("回答あり", { exact: true }),
    ).toBeVisible();
    if (needsReview && id === "A")
      await expect(summary.getByText(WARNING, { exact: true })).toBeVisible();
    else
      await expect(
        summary.getByText(WARNING, { exact: true }),
      ).not.toBeVisible();
  }
}

async function responseUI(page: Page, changed: boolean) {
  await page
    .locator(".sidebar-agendas")
    .getByRole("button", { name: /Agenda A/ })
    .click();
  await page.getByRole("button", { name: "問い・根拠", exact: true }).click();
  const panel = page.getByRole("region", { name: "問い・根拠" });
  const versions = panel.locator(".reasoning-version");
  await expect(versions).toHaveCount(3);
  await expect(
    versions.filter({ has: page.getByText(OLD_QUESTION, { exact: true }) }),
  ).toContainText("新版に置換");
  await expect(
    versions.filter({ has: page.getByText(NEW_QUESTION, { exact: true }) }),
  ).toContainText("現行");
  await expect(
    versions.filter({
      has: page.getByText("別件の会場は確定した？", { exact: true }),
    }),
  ).toContainText("現行");
  const cards = panel
    .getByRole("heading", { name: /問い版への応答/ })
    .locator("..")
    .locator("article.reasoning-card");
  await expect(cards).toHaveCount(2);
  const target = cards.filter({
    has: page.getByRole("button", {
      name: `応答 ${RESPONSE} を修正`,
      exact: true,
    }),
  });
  const independent = cards.filter({
    has: page.getByRole("button", {
      name: `応答 ${INDEPENDENT_RESPONSE} を修正`,
      exact: true,
    }),
  });
  // Observe both identities in their original order, not just the edited card.
  await expect(
    cards.nth(0).getByRole("button", {
      name: `応答 ${RESPONSE} を修正`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    cards.nth(1).getByRole("button", {
      name: `応答 ${INDEPENDENT_RESPONSE} を修正`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(target).toHaveCount(1);
  await expect(independent).toHaveCount(1);
  await expect(target).toContainText(`問い版 ${OLD_VERSION} · 発言 U02`);
  await expect(target).toContainText(
    `要求充足：${changed ? "充足" : "部分充足"}`,
  );
  await expect(target.locator(".reasoning-tags > span").first()).toHaveText(
    "回答",
  );
  await expect(independent).toContainText(
    `問い版 ${INDEPENDENT_VERSION} · 発言 U03`,
  );
  await expect(independent).toContainText("要求充足：未充足");
  await expect(
    independent.locator(".reasoning-tags > span").first(),
  ).toHaveText("回答");
  await expect(independent).toContainText(
    "登録時点 2020-02-02T00:00:00.000Z / 対象時点 2020-02-01T00:00:00.000Z",
  );
  return panel;
}

function assertCorrection(p: Project, before: Project) {
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
  expect(graph).toEqual(originalGraph);
  // Match the target strictly by ID; never apply a fulfillment patch to every response.
  expect(originalResponses.map((r) => r.id)).toEqual([
    RESPONSE,
    INDEPENDENT_RESPONSE,
  ]);
  const expectedById = new Map(
    originalResponses.map((r) => [
      r.id,
      r.id === RESPONSE ? { ...r, fulfillment: "fulfilled" as const } : r,
    ]),
  );
  expect(responses.map((r) => r.id)).toEqual([RESPONSE, INDEPENDENT_RESPONSE]);
  expect(responses.find((r) => r.id === RESPONSE)).toEqual({
    ...originalResponses.find((r) => r.id === RESPONSE)!,
    fulfillment: "fulfilled",
  });
  expect(responses).toEqual(
    originalResponses.map((r) => expectedById.get(r.id)),
  );
  expect(responses.find((r) => r.id === INDEPENDENT_RESPONSE)).toEqual(
    originalResponses.find((r) => r.id === INDEPENDENT_RESPONSE),
  );
  expect(p.agendas).toEqual(
    before.agendas.map((a) => ({ ...a, needsReview: a.id === "A" })),
  );
  expect(p.revisions).toHaveLength(1);
  expect(p.revisions[0]).toMatchObject({
    kind: "reasoning:response-updated",
    targetId: RESPONSE,
    reason: REASON,
  });
  const snapshotBefore = p.revisions[0].before as {
    reasoning: Project["reasoning"];
    agendas: Project["agendas"];
  };
  const snapshotAfter = p.revisions[0].after as {
    reasoning: Project["reasoning"];
    agendas: Project["agendas"];
  };
  expect(snapshotBefore.reasoning).toEqual(before.reasoning);
  expect(snapshotBefore.agendas).toEqual(before.agendas);
  expect(snapshotAfter.agendas).toEqual(p.agendas);
  expect(snapshotAfter.reasoning).toEqual({
    ...p.reasoning,
    revisions: originalRevisions,
  });
  expect(snapshotAfter.reasoning!.responses).toEqual(responses);
  expect(snapshotAfter.reasoning!.questions).toEqual(
    before.reasoning!.questions,
  );
  expect(snapshotAfter.reasoning!.questionVersions).toEqual(
    before.reasoning!.questionVersions,
  );
  expect(
    snapshotBefore.reasoning!.responses.find((r) => r.id === RESPONSE)!
      .questionVersionId,
  ).toBe(OLD_VERSION);
  expect(
    snapshotAfter.reasoning!.responses.find((r) => r.id === RESPONSE)!
      .questionVersionId,
  ).toBe(OLD_VERSION);
  expect(revisions).toHaveLength(1);
  expect(p.revisions[0].id).toEqual(expect.stringMatching(/^revision-.+/));
  expect(revisions[0].id).toEqual(
    expect.stringMatching(/^reasoning-revision-.+/),
  );
  expect(revisions[0]).toMatchObject({
    at: p.revisions[0].at,
    kind: "response-updated",
    targetId: RESPONSE,
    before: { revisionId: p.revisions[0].id },
    after: { revisionId: p.revisions[0].id },
    reason: REASON,
  });
}

test("R15: 配列先頭の部分充足から充足へのUI訂正は2番目の独立応答と順序を保存・リロード・Undoで保持する", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "r15-response-fulfillment-restore-target-first-fixture.json",
    mimeType: "application/json",
    buffer: Buffer.from(exportProject(await fixture(), "json")),
  });
  await expect(page.getByRole("status")).toContainText("別コピーとして復元");
  const baseline = (await preview(page)).project;
  // Assert the intended graph, including identity/order and absent bypasses.
  expect(baseline.reasoning!.questions).toEqual([
    {
      id: QUESTION,
      origin: "original",
      versionIds: [OLD_VERSION, NEW_VERSION],
      currentVersionId: NEW_VERSION,
    },
    {
      id: INDEPENDENT_QUESTION,
      origin: "analysis",
      versionIds: [INDEPENDENT_VERSION],
      currentVersionId: INDEPENDENT_VERSION,
    },
  ]);
  expect(
    baseline.reasoning!.questionVersions.map((v) => ({
      id: v.id,
      questionId: v.questionId,
      status: v.status,
      sources: v.sourceUtteranceIds,
    })),
  ).toEqual([
    {
      id: OLD_VERSION,
      questionId: QUESTION,
      status: "superseded",
      sources: ["U01"],
    },
    {
      id: NEW_VERSION,
      questionId: QUESTION,
      status: "active",
      sources: ["U01"],
    },
    {
      id: INDEPENDENT_VERSION,
      questionId: INDEPENDENT_QUESTION,
      status: "active",
      sources: ["U03"],
    },
  ]);
  expect(baseline.relations).toEqual([]);
  expect(baseline.reasoning).toMatchObject({
    evidence: [],
    items: [],
    interpretations: [],
    positionChanges: [],
    exclusiveGroups: [],
    uncertaintyPropagation: [],
  });
  expect(baseline.reasoning!.responses.map((r) => r.id)).toEqual([
    RESPONSE,
    INDEPENDENT_RESPONSE,
  ]);
  expect(
    baseline.reasoning!.responses.find((r) => r.id === RESPONSE),
  ).toMatchObject({
    id: RESPONSE,
    questionVersionId: OLD_VERSION,
    utteranceIds: ["U02"],
    kind: "answer",
    fulfillment: "partially-fulfilled",
    evidenceIds: [],
    counterargumentToClaimIds: [],
  });
  expect(
    baseline.reasoning!.responses.find((r) => r.id === INDEPENDENT_RESPONSE),
  ).toMatchObject({
    id: INDEPENDENT_RESPONSE,
    questionVersionId: INDEPENDENT_VERSION,
    utteranceIds: ["U03"],
    kind: "answer",
    fulfillment: "not-fulfilled",
    evidenceIds: [],
    counterargumentToClaimIds: [],
  });
  // Exact memberships and all graph edge containers rule out indirect routes:
  // only U02 can invalidate A, only U03 can invalidate B. The independent
  // response must retain its separate not-fulfilled value.
  expect(
    baseline.agendas.map((a) => ({ id: a.id, utteranceIds: a.utteranceIds })),
  ).toEqual([
    { id: "A", utteranceIds: ["U01", "U02"] },
    { id: "B", utteranceIds: ["U03"] },
  ]);
  expect(baseline.agendas.map((a) => a.summaryDependencies)).toEqual([
    ["U02"],
    ["U03"],
  ]);
  expect(baseline.revisions).toEqual([]);
  expect(baseline.agendas.every((a) => !a.needsReview)).toBe(true);
  await page
    .getByRole("button", { name: "この端末に保存", exact: true })
    .click();
  const initial = await durable(page, baseline.id, 0);
  expect(content(initial)).toEqual(content(baseline));
  await attach(
    `r15-response-fulfillment-restore-target-first-initial-stored.json`,
    initial,
  );

  const panel = await responseUI(page, false);
  await panel
    .getByRole("button", { name: `応答 ${RESPONSE} を修正`, exact: true })
    .click();
  const form = panel.getByRole("form", { name: "応答関係の編集" });
  const version = form.getByRole("combobox", {
    name: "対象問い版",
    exact: true,
  });
  await expect(version).toHaveValue(OLD_VERSION);
  const kind = form.getByRole("combobox", {
    name: "応答種別",
    exact: true,
  });
  const fulfillment = form.getByRole("combobox", {
    name: "要求充足",
    exact: true,
  });
  await expect(kind).toHaveValue("answer");
  await expect(fulfillment).toHaveValue("partially-fulfilled");
  await fulfillment.selectOption("fulfilled");
  await expect(version).toHaveValue(OLD_VERSION);
  await expect(kind).toHaveValue("answer");
  await expect(fulfillment).toHaveValue("fulfilled");
  await expect(form.getByRole("checkbox", { name: /U02/ })).toBeChecked();
  await expect(form.getByRole("checkbox", { name: /U01/ })).not.toBeChecked();
  await expect(form.getByRole("checkbox", { name: /U03/ })).not.toBeChecked();
  await form.getByLabel("登録理由", { exact: true }).fill(REASON);
  await form
    .getByRole("button", { name: "応答の修正を保存", exact: true })
    .click();
  // No explicit save: wait for the real autosave debounce and IDB transaction.
  const revised = await durable(page, baseline.id, 1);
  assertCorrection(revised, baseline);
  expect(revised.storageRevision).toBeGreaterThan(initial.storageRevision!);
  await attach(
    `r15-response-fulfillment-restore-target-first-revised-stored.json`,
    revised,
  );

  await reloadAndOpen(page, revised);
  await summaries(page, true);
  await responseUI(page, true);
  const reloaded = await preview(page, {
    id: baseline.id,
    revisionCount: 1,
  });
  assertCorrection(reloaded.project, baseline);
  expect(content(reloaded.project)).toEqual(content(revised));
  await attach(
    `r15-response-fulfillment-restore-target-first-reloaded-full-output.json`,
    reloaded,
  );
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
  await attach(
    `r15-response-fulfillment-restore-target-first-undone-stored.json`,
    undone,
  );

  await reloadAndOpen(page, undone);
  await summaries(page, false);
  await responseUI(page, false);
  const final = await preview(page, { id: baseline.id, revisionCount: 2 });
  expect(content(final.project)).toEqual(content(undone));
  await page.getByRole("button", { name: "訂正履歴", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "直前の訂正を元に戻す", exact: true }),
  ).toBeDisabled();
  await attach(
    `r15-response-fulfillment-restore-target-first-undone-reloaded-full-output.json`,
    final,
  );
});
