import { expect, test, type Page } from "@playwright/test";
import { createProject } from "../src/domain/project";
import { parseInputs } from "../src/input/parse";
import { exportProject } from "../src/export/project";
import type { Project } from "../src/domain/types";

const OLD_QUOTE = "この案は採用する。";
const NEW_QUOTE = "この案は採用しない。";

type Envelope = {
  scope: string;
  manifest: Record<string, unknown>;
  project: Project;
};

async function fixture(): Promise<Project> {
  const project = createProject(
    await parseInputs([
      {
        name: "SA.txt",
        format: "txt",
        role: "conversation",
        text: OLD_QUOTE,
      },
      {
        name: "SX.txt",
        format: "txt",
        role: "conversation",
        text: "downstream two\ndownstream three",
      },
      {
        name: "SB.txt",
        format: "txt",
        role: "conversation",
        text: "unrelated B",
      },
    ]),
    "R15 source dependency state",
    "full",
  );
  const source = (name: string) =>
    project.sources.find((item) => item.name === name)!;
  const sa = source("SA.txt");
  const sx = source("SX.txt");
  const sb = source("SB.txt");
  const utterance = (id: string) =>
    project.utterances.find((item) => item.id === id)!;
  // Fail at fixture creation if parser segmentation changes; never fabricate offsets.
  expect(utterance("U01").sourceId).toBe(sa.id);
  expect(utterance("U01").quote).toBe(OLD_QUOTE);
  expect(utterance("U02").sourceId).toBe(sx.id);
  expect(utterance("U02").quote).toBe("downstream two");
  expect(utterance("U03").sourceId).toBe(sx.id);
  expect(utterance("U03").quote).toBe("downstream three");
  expect(utterance("U04").sourceId).toBe(sb.id);
  expect(utterance("U04").quote).toBe("unrelated B");
  project.agendas = [
    {
      id: "R",
      title: "Root R",
      utteranceIds: ["U01", "U02"],
      boundary: "user-confirmed",
      decision: "undecided",
      answer: "none",
      agreement: "unknown",
      verification: "unverified",
      arrival: "R arrival",
      unresolved: [],
      nextAction: "R next",
      needsReview: false,
    },
    {
      id: "A",
      title: "Agenda A",
      utteranceIds: ["U03"],
      boundary: "user-confirmed",
      decision: "undecided",
      answer: "none",
      agreement: "unknown",
      verification: "unverified",
      arrival: "A arrival",
      unresolved: [],
      nextAction: "A next",
      needsReview: false,
      summaryDependencies: ["U03"],
    },
    {
      id: "B",
      title: "Agenda B",
      utteranceIds: ["U04"],
      boundary: "user-confirmed",
      decision: "undecided",
      answer: "none",
      agreement: "unknown",
      verification: "unverified",
      arrival: "B arrival",
      unresolved: [],
      nextAction: "B next",
      needsReview: false,
    },
  ];
  project.selectedAgendaId = "R";
  project.relations = [
    {
      id: "dep-01-02",
      from: "U01",
      to: "U02",
      kind: "derived",
      dependency: true,
      evidenceIds: ["U01", "U02"],
    },
    {
      id: "dep-02-03",
      from: "U02",
      to: "U03",
      kind: "derived",
      dependency: true,
      evidenceIds: ["U02", "U03"],
    },
  ];
  project.utterances.forEach((item) => (item.classification = "main"));
  return project;
}

async function importFixture(page: Page, project: Project) {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "r15-source-dependency-state.json",
    mimeType: "application/json",
    buffer: Buffer.from(exportProject(project, "json")),
  });
  await expect(page.getByRole("status")).toContainText("別コピーとして復元");
}

async function detail(page: Page, id: string) {
  await page.getByRole("button", { name: "議題の流れ", exact: true }).click();
  const hit = page.locator(`[data-id="${id}"] .speech-hit`);
  await expect(hit).toBeVisible();
  await hit.focus();
  await hit.press("Enter");
  const inspector = page.getByRole("complementary", {
    name: "選択した発言の詳細",
  });
  await expect(inspector).toBeVisible();
  return inspector;
}

async function sourceDetail(page: Page, id: string) {
  const inspector = await detail(page, id);
  await inspector
    .getByRole("button", { name: "発言・原文", exact: true })
    .click();
  return inspector;
}

async function exportPreview(page: Page): Promise<Envelope> {
  await page.getByRole("button", { name: "出力", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("出力範囲").selectOption("all");
  await dialog.getByLabel("形式").selectOption("json");
  await dialog
    .getByRole("button", { name: "出力内容をプレビュー", exact: true })
    .click();
  const text = await dialog.locator("pre.export-preview").textContent();
  expect(text).toBeTruthy();
  const result = JSON.parse(text!) as Envelope;
  expect(result.scope).toBe("full");
  expect(result.manifest).toMatchObject({
    limited: false,
    fullBackup: true,
    historyIncluded: true,
    schemaVersion: 1,
  });
  await dialog
    .getByRole("button", { name: "ダイアログを閉じる", exact: true })
    .click();
  return result;
}

async function attach(name: string, value: unknown) {
  await test.info().attach(name, {
    body: JSON.stringify(value, null, 2),
    contentType: "application/json",
  });
}

function state(project: Project) {
  return {
    sources: project.sources.map(({ id, versionId, name, text }) => ({
      id,
      versionId,
      name,
      text,
    })),
    utterances: Object.fromEntries(
      project.utterances.map((u) => [
        u.id,
        {
          quote: u.quote,
          sourceId: u.sourceId,
          sourceVersionId: u.sourceVersionId,
          classification: u.classification,
        },
      ]),
    ),
    agendas: Object.fromEntries(
      project.agendas.map((a) => [
        a.id,
        {
          utteranceIds: a.utteranceIds,
          summaryDependencies: a.summaryDependencies,
          needsReview: a.needsReview,
          arrival: a.arrival,
        },
      ]),
    ),
    relations: project.relations,
    revisions: project.revisions,
  };
}

function agenda(project: Project, id: string) {
  return project.agendas.find((item) => item.id === id)!;
}

test("R15: 原文訂正は明示依存チェーンだけを要再確認にし、通常のUndoで復元する", async ({
  page,
}) => {
  const original = await fixture();
  await attach("r15-before.json", JSON.parse(exportProject(original, "json")));
  await importFixture(page, original);

  // B is a negative-control classification edit. A must remain valid before B is undone.
  const bInspector = await detail(page, "U04");
  await bInspector.getByLabel("発言の分類").selectOption("derived");
  await bInspector
    .getByLabel("変更理由", { exact: true })
    .fill("Bの分類を確認するため");
  await bInspector
    .getByRole("button", { name: "訂正を保存", exact: true })
    .click();
  const afterB = await exportPreview(page);
  await attach("r15-after-B.json", afterB);
  expect(
    afterB.project.utterances.find((u) => u.id === "U04")!.classification,
  ).toBe("derived");
  expect(agenda(afterB.project, "A").needsReview).toBe(false);
  expect(agenda(afterB.project, "B").needsReview).toBe(true);
  expect(agenda(afterB.project, "R").needsReview).toBe(false);
  const bChangedState = state(afterB.project);
  await page.getByRole("button", { name: "訂正履歴", exact: true }).click();
  await page
    .getByRole("button", { name: "直前の訂正を元に戻す", exact: true })
    .click();
  const afterUndoB = await exportPreview(page);
  await attach("r15-after-undo-B.json", afterUndoB);
  expect(state(afterUndoB.project).utterances.U04.classification).toBe("main");
  expect(agenda(afterUndoB.project, "A").needsReview).toBe(false);
  expect(agenda(afterUndoB.project, "B").needsReview).toBe(false);
  expect(state(afterUndoB.project).sources).toEqual(state(original).sources);
  expect(state(afterUndoB.project).relations).toEqual(
    state(original).relations,
  );
  expect(bChangedState.utterances.U04.classification).not.toBe(
    state(afterUndoB.project).utterances.U04.classification,
  );

  const before = afterUndoB;
  expect(agenda(before.project, "A").utteranceIds).toEqual(["U03"]);
  expect(agenda(before.project, "A").summaryDependencies).toEqual(["U03"]);
  expect(before.project.relations).toEqual(original.relations);
  const u02Before = before.project.utterances.find((u) => u.id === "U02")!;
  const u03Before = before.project.utterances.find((u) => u.id === "U03")!;
  const u04Before = before.project.utterances.find((u) => u.id === "U04")!;
  expect(u02Before.sourceVersionId).toBe(u03Before.sourceVersionId);
  expect(u02Before.sourceVersionId).toBe(
    before.project.sources.find((s) => s.name === "SX.txt")!.versionId,
  );
  expect(u02Before.quote).toBe("downstream two");
  expect(u03Before.quote).toBe("downstream three");

  const inspector = await sourceDetail(page, "U01");
  await expect(
    inspector.getByLabel("訂正後の原文", { exact: true }),
  ).toHaveValue(OLD_QUOTE);
  await inspector.getByLabel("訂正後の原文", { exact: true }).fill(NEW_QUOTE);
  await inspector
    .getByLabel("変更理由", { exact: true })
    .fill("原文を照合し、採用するから採用しないへ否定を明確化");
  await inspector
    .getByRole("button", { name: "訂正を保存", exact: true })
    .click();
  await expect(
    inspector.getByLabel("訂正後の原文", { exact: true }),
  ).toHaveValue(NEW_QUOTE);
  await page.keyboard.press("Escape");

  // Graph surface: the root agenda and the transitive summary agenda show scoped warnings.
  await page.getByRole("button", { name: "議題の流れ", exact: true }).click();
  await expect(page.locator('[data-id="agenda-R"]')).toContainText(
    "訂正の影響：要再確認",
  );
  await expect(page.locator('[data-id="agenda-A"]')).toContainText(
    "訂正の影響：要再確認",
  );
  await expect(page.locator('[data-id="agenda-B"]')).not.toContainText(
    "訂正の影響：要再確認",
  );
  // Transcript/source surface: use the actual Inspector source tab and retain dependent quotes.
  const dependent = await sourceDetail(page, "U03");
  await expect(
    dependent.getByLabel("訂正後の原文", { exact: true }),
  ).toHaveValue(u03Before.quote);
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-id="U02"]')).toContainText(u02Before.quote);
  await expect(page.locator('[data-id="U03"]')).toContainText(u03Before.quote);
  await expect(page.locator('[data-id="U04"]')).toContainText(u04Before.quote);

  // Visit the actual transcript view, not only the graph/Inspector source tab.
  await page.getByRole("button", { name: "発言と原文", exact: true }).click();
  const agendaNav = page.locator(".sidebar-agendas");
  const transcript = page.locator(".transcript-list");
  await agendaNav.getByRole("button", { name: /Root R/ }).click();
  await expect(transcript).toContainText(NEW_QUOTE);
  await expect(transcript).toContainText(u02Before.quote);
  await agendaNav.getByRole("button", { name: /Agenda A/ }).click();
  await expect(transcript).toContainText(u03Before.quote);
  await agendaNav.getByRole("button", { name: /Agenda B/ }).click();
  await expect(transcript).toContainText(u04Before.quote);

  // Summary surface: navigate to A and R explicitly; warning and arrival are scoped.
  await page.getByRole("button", { name: "振り返り", exact: true }).click();
  await page.getByRole("button", { name: /Agenda A/ }).click();
  await expect(page.getByRole("heading", { name: /Agenda A/ })).toBeVisible();
  await expect(
    page.getByText("訂正の影響があるため、この振り返りは要再確認です。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "本筋の到達点" }),
  ).toBeVisible();
  await expect(
    page.locator(".summary-view").getByText("A arrival", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Root R/ }).click();
  await expect(page.getByRole("heading", { name: /Root R/ })).toBeVisible();
  await expect(
    page.getByText("訂正の影響があるため、この振り返りは要再確認です。", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.locator(".summary-view").getByText("R arrival", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Agenda B/ }).click();
  await expect(
    page.locator(".summary-view").getByText("B arrival", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("訂正の影響があるため、この振り返りは要再確認です。", {
      exact: true,
    }),
  ).not.toBeVisible();

  const afterA = await exportPreview(page);
  await attach("r15-after-A.json", afterA);
  const afterU01 = afterA.project.utterances.find((u) => u.id === "U01")!;
  const afterU02 = afterA.project.utterances.find((u) => u.id === "U02")!;
  const afterU03 = afterA.project.utterances.find((u) => u.id === "U03")!;
  const afterU04 = afterA.project.utterances.find((u) => u.id === "U04")!;
  const oldSource = afterA.project.sources.find(
    (s) =>
      s.versionId ===
      before.project.utterances.find((u) => u.id === "U01")!.sourceVersionId,
  )!;
  const newSource = afterA.project.sources.find(
    (s) => s.versionId === afterU01.sourceVersionId,
  )!;
  expect(oldSource.versionId).not.toBe(newSource.versionId);
  expect(oldSource.text).toContain(OLD_QUOTE);
  expect(newSource.text).toContain(NEW_QUOTE);
  expect(afterU01.quote).toBe(NEW_QUOTE);
  expect(afterU02.sourceVersionId).toBe(u02Before.sourceVersionId);
  expect(afterU03.sourceVersionId).toBe(u03Before.sourceVersionId);
  expect(afterU02.quote).toBe(u02Before.quote);
  expect(afterU03.quote).toBe(u03Before.quote);
  expect(afterU04.sourceVersionId).toBe(u04Before.sourceVersionId);
  expect(afterU04.quote).toBe(u04Before.quote);
  expect(afterU04).toEqual(u04Before);
  expect(agenda(afterA.project, "B")).toEqual(agenda(before.project, "B"));
  expect(agenda(afterA.project, "R").needsReview).toBe(true);
  expect(agenda(afterA.project, "A").needsReview).toBe(true);
  expect(agenda(afterA.project, "B").needsReview).toBe(false);
  expect(afterA.project.relations.map((r) => r.id)).toEqual([
    "dep-01-02",
    "dep-02-03",
  ]);
  expect(afterA.project.revisions.at(-1)!.reason).toContain(
    "採用するから採用しない",
  );

  await page.getByRole("button", { name: "訂正履歴", exact: true }).click();
  await page
    .getByRole("button", { name: "直前の訂正を元に戻す", exact: true })
    .click();
  const afterUndoA = await exportPreview(page);
  await attach("r15-after-undo-A.json", afterUndoA);
  expect(afterUndoA.project.utterances.find((u) => u.id === "U01")!.quote).toBe(
    OLD_QUOTE,
  );
  expect(
    afterUndoA.project.utterances.find((u) => u.id === "U01")!.sourceVersionId,
  ).toBe(
    before.project.utterances.find((u) => u.id === "U01")!.sourceVersionId,
  );
  expect(agenda(afterUndoA.project, "R").needsReview).toBe(false);
  expect(agenda(afterUndoA.project, "A").needsReview).toBe(false);
  expect(agenda(afterUndoA.project, "B").needsReview).toBe(false);
  expect(afterUndoA.project.utterances.find((u) => u.id === "U02")!.quote).toBe(
    u02Before.quote,
  );
  expect(afterUndoA.project.utterances.find((u) => u.id === "U03")!.quote).toBe(
    u03Before.quote,
  );
  expect(afterUndoA.project.utterances.find((u) => u.id === "U04")!.quote).toBe(
    u04Before.quote,
  );
  expect(afterUndoA.project.utterances).toEqual(before.project.utterances);
  expect(afterUndoA.project.agendas).toEqual(before.project.agendas);
  expect(afterUndoA.project.relations).toEqual(before.project.relations);
});
