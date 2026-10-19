import { expect, test, type Page } from "@playwright/test";
import { createProject } from "../src/domain/project";
import { parseInputs } from "../src/input/parse";
import { exportProject } from "../src/export/project";
import type { Project } from "../src/domain/types";

const OLD_QUOTE = "この案を採用する。";
const NEW_QUOTE = "この案を採用しない。";
const REASON = "原文照合で否定を補い、依存するまとめを再確認する";
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
        name: "root.txt",
        format: "txt",
        role: "conversation",
        text: OLD_QUOTE,
      },
      {
        name: "dependent.txt",
        format: "txt",
        role: "conversation",
        text: "採用を前提に準備する。",
      },
      {
        name: "independent.txt",
        format: "txt",
        role: "conversation",
        text: "別件の会場は確定した。",
      },
    ]),
    "R15 訂正の保存・リロード・Undo",
    "full",
  );
  expect(p.utterances.map((u) => u.quote)).toEqual([
    OLD_QUOTE,
    "採用を前提に準備する。",
    "別件の会場は確定した。",
  ]);
  expect(new Set(p.utterances.map((u) => u.sourceVersionId)).size).toBe(3);
  p.utterances.forEach((u) => {
    u.classification = "main";
  });
  p.agendas = ["R", "A", "B"].map((id, i) => ({
    id,
    title: `Agenda ${id}`,
    utteranceIds: [`U0${i + 1}`],
    summaryDependencies: [`U0${i + 1}`],
    boundary: "user-confirmed" as const,
    decision: "decided" as const,
    answer: "present" as const,
    agreement: "explicit" as const,
    verification: "user-recorded" as const,
    arrival: `${id} の訂正前の到達点`,
    unresolved: [],
    nextAction: `${id} の次の一手`,
    needsReview: false,
  }));
  p.selectedAgendaId = "R";
  p.relations = [
    {
      id: "root-dependent",
      from: "U01",
      to: "U02",
      kind: "derived",
      dependency: true,
      evidenceIds: ["U01", "U02"],
    },
  ];
  return p;
}

// Observation only: no storage/domain writes, mocking, module imports or app-state injection.
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
  // Navigation and persistence metadata may change without a semantic edit.
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
  // This destroys the React/module state. Reopen via the actual recent-project UI, not JSON import.
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
  for (const id of ["R", "A", "B"]) {
    await page
      .locator(".sidebar-agendas")
      .getByRole("button", { name: new RegExp(`Agenda ${id}`) })
      .click();
    const summary = page.locator(".summary-view");
    await expect(
      summary.getByText(`${id} の訂正前の到達点`, { exact: true }),
    ).toBeVisible();
    if (needsReview && id !== "B")
      await expect(summary.getByText(WARNING, { exact: true })).toBeVisible();
    else
      await expect(
        summary.getByText(WARNING, { exact: true }),
      ).not.toBeVisible();
  }
}

function assertCorrection(p: Project, before: Project) {
  expect(p.id).toBe(before.id);
  expect(p.utterances[0].quote).toBe(NEW_QUOTE);
  expect(p.utterances[0].sourceVersionId).not.toBe(
    before.utterances[0].sourceVersionId,
  );
  expect(p.sources).toHaveLength(before.sources.length + 1);
  expect(p.sources.slice(0, before.sources.length)).toEqual(before.sources);
  expect(p.utterances.slice(1)).toEqual(before.utterances.slice(1));
  expect(p.agendas.map((a) => [a.id, a.needsReview])).toEqual([
    ["R", true],
    ["A", true],
    ["B", false],
  ]);
  expect(p.agendas.find((a) => a.id === "B")).toEqual(
    before.agendas.find((a) => a.id === "B"),
  );
  expect(p.agendas.map((a) => a.arrival)).toEqual(
    before.agendas.map((a) => a.arrival),
  );
  expect(p.relations).toEqual(before.relations);
  expect(p.revisions).toHaveLength(1);
  expect(p.revisions[0]).toMatchObject({
    kind: "source-revision",
    targetId: "U01",
    reason: REASON,
  });
  for (const u of p.utterances) {
    const source = p.sources.find((s) => s.versionId === u.sourceVersionId)!;
    expect(source.id).toBe(u.sourceId);
    expect(source.text.slice(u.start, u.end)).toBe(u.quote);
  }
}

test("R15: 通常UIの原文訂正を自動保存し、リロード後の要再確認・完全出力・Undoを保つ", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "r15-reload-fixture.json",
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
  await attach("r15-initial-stored.json", initial);

  await page.getByRole("button", { name: "議題の流れ", exact: true }).click();
  const hit = page.locator('[data-id="U01"] .speech-hit');
  await hit.focus();
  await hit.press("Enter");
  const inspector = page.getByRole("complementary", {
    name: "選択した発言の詳細",
  });
  await inspector
    .getByRole("button", { name: "発言・原文", exact: true })
    .click();
  await expect(
    inspector.getByLabel("訂正後の原文", { exact: true }),
  ).toHaveValue(OLD_QUOTE);
  await inspector.getByLabel("訂正後の原文", { exact: true }).fill(NEW_QUOTE);
  await inspector.getByLabel("変更理由", { exact: true }).fill(REASON);
  await inspector
    .getByRole("button", { name: "訂正を保存", exact: true })
    .click();
  await expect(
    inspector.getByLabel("訂正後の原文", { exact: true }),
  ).toHaveValue(NEW_QUOTE);
  await page.keyboard.press("Escape");
  // Do not explicitly save again: exercise the real autosave debounce/transaction.
  const corrected = await durable(page, baseline.id, 1);
  assertCorrection(corrected, baseline);
  expect(corrected.storageRevision).toBeGreaterThan(initial.storageRevision!);
  await attach("r15-corrected-stored.json", corrected);

  await reloadAndOpen(page, corrected);
  await summaries(page, true);
  const reloaded = await preview(page);
  assertCorrection(reloaded.project, baseline);
  expect(content(reloaded.project)).toEqual(content(corrected));
  await attach("r15-reloaded-full-output.json", reloaded);
  await page.getByRole("button", { name: "訂正履歴", exact: true }).click();
  await expect(page.getByText(REASON, { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "直前の訂正を元に戻す", exact: true })
    .click();
  const undone = await durable(page, baseline.id, 2);
  expect(undone.utterances).toEqual(baseline.utterances);
  expect(undone.agendas).toEqual(baseline.agendas);
  expect(undone.relations).toEqual(baseline.relations);
  // Undo restores active references; source history is append-only, not deleted.
  expect(undone.sources).toEqual(corrected.sources);
  expect(undone.revisions[0]).toEqual(corrected.revisions[0]);
  expect(undone.revisions[1]).toMatchObject({
    kind: "undo",
    after: { targetRevisionId: corrected.revisions[0].id },
  });
  expect(undone.storageRevision).toBeGreaterThan(corrected.storageRevision!);
  await attach("r15-undone-stored.json", undone);

  await reloadAndOpen(page, undone);
  await summaries(page, false);
  const final = await preview(page);
  expect(content(final.project)).toEqual(content(undone));
  expect(final.project.utterances[0].quote).toBe(OLD_QUOTE);
  expect(final.project.utterances[0].sourceVersionId).toBe(
    baseline.utterances[0].sourceVersionId,
  );
  await page.getByRole("button", { name: "訂正履歴", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "直前の訂正を元に戻す", exact: true }),
  ).toBeDisabled();
  await attach("r15-undone-reloaded-full-output.json", final);
});
