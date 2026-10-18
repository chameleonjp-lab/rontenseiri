import { expect, test, type Locator, type Page } from "@playwright/test";
import { enter, navigate, tabTo } from "./helpers/keyboard-navigation";

import type { Project as StoredProject } from "../src/domain/types";

const title = () =>
  `手動排他e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const graph = (p: StoredProject | null) => p?.reasoning ?? null;

async function readStored(page: Page, wantedTitle: string) {
  return page.evaluate(async (wanted) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("rontenseiri-projects-v1", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise<StoredProject[]>((resolve, reject) => {
      const request = db
        .transaction("projects", "readonly")
        .objectStore("projects")
        .getAll();
      request.onsuccess = () => resolve(request.result as StoredProject[]);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return rows.find((row) => row.title === wanted) ?? null;
  }, wantedTitle);
}

async function seed(page: Page, projectTitle: string) {
  await page.goto("/");
  await page.evaluate(async (wantedTitle) => {
    const { parseInputs } = await import("/src/input/parse.ts");
    const { createProject } = await import("/src/domain/project.ts");
    const { addQuestion, addEvidence, addSemanticItem } =
      await import("/src/domain/reasoning.ts");
    const { saveProject } = await import("/src/storage/projects.ts");
    let project = createProject(
      await parseInputs([
        {
          name: "manual-fixture.txt",
          text: "甲：契約は月末に更新します。\n乙：更新条件は書面で確認します。\n甲：既存条件を引き継ぎます。",
          role: "conversation",
          format: "txt",
        },
      ]),
      wantedTitle,
      "full",
    );
    project = addQuestion(
      project,
      "月末更新の条件は何か？",
      "original",
      ["U01"],
      "manual",
      "2020-01-01T00:00:00.000Z",
      "fixture question",
    );
    project = addEvidence(
      project,
      {
        utteranceIds: ["U01"],
        sourceIds: [project.sources[0].id],
        actor: "manual",
        certainty: "confirmed",
        note: "fixture evidence A",
        time: {
          asOf: "2020-01-01T00:00:00.000Z",
          recordedAt: "2020-01-01T00:00:00.000Z",
        },
      },
      "fixture evidence A",
    );
    project = addEvidence(
      project,
      {
        utteranceIds: ["U02"],
        sourceIds: [project.sources[0].id],
        actor: "manual",
        certainty: "confirmed",
        note: "fixture evidence B",
        time: {
          asOf: "2020-01-01T00:00:00.000Z",
          recordedAt: "2020-01-01T00:00:00.000Z",
        },
      },
      "fixture evidence B",
    );
    project = addSemanticItem(
      project,
      {
        kind: "claim",
        text: "既存の更新結論",
        utteranceIds: ["U03"],
        evidenceIds: [],
        actor: "manual",
        certainty: "uncertain",
        time: {
          asOf: "2020-01-01T00:00:00.000Z",
          recordedAt: "2020-01-01T00:00:00.000Z",
        },
      },
      "fixture dependency",
    );
    await saveProject({ ...project, saved: true });
  }, projectTitle);
  await page.reload();
  const recent = page
    .locator("button.recent-open")
    .filter({ hasText: projectTitle })
    .first();
  await expect(recent).toBeVisible();
  await recent.click();
  await navigate(page, "問い・根拠");
  await expect(
    page.getByRole("region", { name: "手動の排他解釈" }),
  ).toBeVisible();
}

async function fillCandidate(
  region: Locator,
  side: "A" | "B",
  premise: string,
  conclusion: string,
  evidence: RegExp,
) {
  await region.getByLabel(`${side}の前提`, { exact: true }).fill(premise);
  await region.getByLabel(`${side}の結論`, { exact: true }).fill(conclusion);
  await region
    .getByRole("group", { name: `${side}の明示根拠` })
    .getByRole("checkbox", { name: evidence })
    .check();
  await region
    .getByRole("group", { name: `${side}の依存結論` })
    .getByRole("checkbox", { name: "既存の更新結論" })
    .check();
}

function pairSnapshot(p: StoredProject | null) {
  const r = graph(p);
  if (!r || r.exclusiveGroups.length !== 1) return null;
  const group = r.exclusiveGroups[0];
  const interpretations = group.interpretationIds.map((id) =>
    r.interpretations.find((i) => i.id === id)!,
  );
  return {
    group: { ...group },
    interpretations: interpretations.map((i) => ({ ...i })),
    items: interpretations.flatMap((i) =>
      [...i.premiseItemIds, ...i.conclusionItemIds].map((id) =>
        r.items.find((x) => x.id === id)!,
      ),
    ),
    links: r.uncertaintyPropagation
      .filter((x) =>
        interpretations.some(
          (i) =>
            [...i.premiseItemIds, ...i.conclusionItemIds].includes(
              x.fromItemId,
            ) ||
            [...i.premiseItemIds, ...i.conclusionItemIds].includes(x.toItemId),
        ),
      )
      .map((x) => ({ ...x })),
  };
}

async function exercise(page: Page, projectTitle: string) {
  const region = page.getByRole("region", { name: "手動の排他解釈" });
  const persist = async () => {
    await page
      .getByRole("button", { name: "この端末に保存", exact: true })
      .click();
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: "このブラウザに保存しました" }),
    ).toContainText("このブラウザに保存しました");
  };
  const question = region.locator("select").first();
  await expect(question).toHaveCount(1);
  await question.selectOption({ index: 1 });
  await expect(question).not.toHaveValue("");
  await fillCandidate(
    region,
    "A",
    "月末に更新する",
    "既存条件を維持する",
    /U01/,
  );
  await fillCandidate(region, "B", "月末に更新する", "条件を再確認する", /U02/);
  const unrelatedQuestion = page
    .getByRole("region", { name: "問い・根拠" })
    .locator("form")
    .last()
    .locator("textarea")
    .first();
  await unrelatedQuestion.fill("ペア保存中も保持する別の問い下書き");
  const reason = region.getByRole("textbox", {
    name: "候補の変更理由",
    exact: true,
  });
  await reason.fill("利用者が二つの排他的解釈を記録");
  await enter(
    page,
    region.getByRole("button", { name: "A/Bを一括保存", exact: true }),
  );
  await expect(region.getByRole("status")).toHaveText(
    "A/Bと排他関係を一括保存しました。両方とも未確定です。",
  );
  await expect(unrelatedQuestion).toHaveValue(
    "ペア保存中も保持する別の問い下書き",
  );
  await unrelatedQuestion.fill("");
  await persist();
  const pair = await readStored(page, projectTitle);
  expect(pairSnapshot(pair)?.interpretations.map((i) => i.certainty)).toEqual([
    "uncertain",
    "uncertain",
  ]);
  expect(pairSnapshot(pair)?.group.mutuallyExclusive).toBe(true);
  const savedPair = pairSnapshot(pair)!;
  expect(savedPair.interpretations).toHaveLength(2);
  expect(savedPair.group.interpretationIds).toEqual(
    savedPair.interpretations.map((i) => i.id),
  );
  expect(savedPair.interpretations.map((i) => i.exclusiveGroupId)).toEqual([
    savedPair.group.id,
    savedPair.group.id,
  ]);
  expect(savedPair.interpretations.map((i) => i.questionVersionId)).toEqual([
    graph(pair)!.questionVersions[0].id,
    graph(pair)!.questionVersions[0].id,
  ]);
  expect(savedPair.interpretations.map((i) => i.candidateName)).toEqual([
    "A",
    "B",
  ]);
  expect(savedPair.items.map((item) => item.text)).toEqual([
    "月末に更新する",
    "既存条件を維持する",
    "月末に更新する",
    "条件を再確認する",
  ]);
  expect(savedPair.items.map((item) => item.certainty)).toEqual([
    "uncertain",
    "uncertain",
    "uncertain",
    "uncertain",
  ]);
  expect(savedPair.items.map((item) => item.utteranceIds)).toEqual([
    ["U01"],
    ["U01"],
    ["U02"],
    ["U02"],
  ]);
  expect(savedPair.items.map((item) => item.evidenceIds)).toEqual([
    [graph(pair)!.evidence[0].id],
    [graph(pair)!.evidence[0].id],
    [graph(pair)!.evidence[1].id],
    [graph(pair)!.evidence[1].id],
  ]);
  expect(
    savedPair.links.map((link) => [
      link.fromItemId,
      link.toItemId,
      link.status,
    ]),
  ).toEqual(
    savedPair.interpretations.flatMap((i) => [
      [i.premiseItemIds[0], i.conclusionItemIds[0], "unresolved"],
      [i.conclusionItemIds[0], graph(pair)!.items[0].id, "unresolved"],
    ]),
  );

  const groupButton = region
    .getByRole("button", { name: /比較・修正/ })
    .first();
  await groupButton.click();
  await expect(question).toHaveValue(
    pairSnapshot(pair)!.interpretations[0].questionVersionId as string,
  );
  const sourceButton = region.getByRole("button", {
    name: "Aの原文 U01へ",
    exact: true,
  });
  await reason.fill("原文を開いても保持する候補下書き");
  await enter(page, sourceButton);
  await expect(
    page.getByRole("complementary", { name: "選択した発言の詳細" }),
  ).toContainText("U01");
  await page.getByRole("button", { name: "詳細を閉じる", exact: true }).click();
  await expect(sourceButton).toBeFocused();
  await expect(reason).toHaveValue("原文を開いても保持する候補下書き");

  await region
    .getByRole("textbox", { name: "Aの結論", exact: true })
    .fill("修正後も条件を維持する");
  await reason.fill("ペアのAだけを修正");
  await region
    .getByRole("button", { name: "A/Bを一括保存", exact: true })
    .click();
  await persist();
  const updated = await readStored(page, projectTitle);
  const beforeB = pairSnapshot(pair)!.interpretations[1];
  const afterB = pairSnapshot(updated)!.interpretations[1];
  expect(afterB).toEqual(beforeB);
  expect(
    pairSnapshot(updated)!.items.filter((x) =>
      [beforeB.premiseItemIds[0], beforeB.conclusionItemIds[0]].includes(x.id),
    ),
  ).toEqual(
    pairSnapshot(pair)!.items.filter((x) =>
      [beforeB.premiseItemIds[0], beforeB.conclusionItemIds[0]].includes(x.id),
    ),
  );
  expect(
    pairSnapshot(updated)!.links.filter(
      (x) =>
        [beforeB.premiseItemIds[0], beforeB.conclusionItemIds[0]].includes(
          x.fromItemId,
        ) ||
        [beforeB.premiseItemIds[0], beforeB.conclusionItemIds[0]].includes(
          x.toItemId,
        ),
    ),
  ).toEqual(
    pairSnapshot(pair)!.links.filter(
      (x) =>
        [beforeB.premiseItemIds[0], beforeB.conclusionItemIds[0]].includes(
          x.fromItemId,
        ) ||
        [beforeB.premiseItemIds[0], beforeB.conclusionItemIds[0]].includes(
          x.toItemId,
        ),
    ),
  );

  await groupButton.click();
  await reason.fill("Aを修正してから撤回");
  await region.getByRole("button", { name: "Aを撤回", exact: true }).click();
  await persist();
  await expect(region.getByRole("status")).toContainText("Aを撤回しました。");
  await navigate(page, "訂正履歴");
  await expect(
    page.getByRole("heading", { name: "訂正の経緯を、残す。" }),
  ).toBeVisible();
  const graphBeforeUndo = graph(updated);
  await page
    .getByRole("button", { name: "直前の訂正を元に戻す", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("元に戻しました");
  await persist();
  await navigate(page, "問い・根拠");
  const graphAfterUndo = graph(await readStored(page, projectTitle));
  expect(graphAfterUndo).toEqual(graphBeforeUndo);

  await region
    .getByRole("button", { name: /比較・修正/ })
    .first()
    .click();
  await region
    .getByRole("textbox", { name: "Aの前提", exact: true })
    .fill("失敗しても保存されない前提");
  const aEvidence = region
    .getByRole("group", { name: "Aの明示根拠" })
    .getByRole("checkbox")
    .first();
  await aEvidence.uncheck();
  await region
    .getByRole("textbox", { name: "候補の変更理由", exact: true })
    .fill("失敗後も残る下書き");
  const dbBeforeInvalid = await readStored(page, projectTitle);
  await region
    .getByRole("button", { name: "A/Bを一括保存", exact: true })
    .click();
  await expect(region.getByRole("alert")).toBeVisible();
  await expect(
    region.getByRole("textbox", { name: "Aの前提", exact: true }),
  ).toHaveValue("失敗しても保存されない前提");
  await expect(
    region.getByRole("textbox", { name: "Aの結論", exact: true }),
  ).toHaveValue("修正後も条件を維持する");
  await expect(
    region.getByRole("textbox", { name: "Bの前提", exact: true }),
  ).toHaveValue("月末に更新する");
  await expect(
    region.getByRole("textbox", { name: "Bの結論", exact: true }),
  ).toHaveValue("条件を再確認する");
  await expect(reason).toHaveValue("失敗後も残る下書き");
  expect(await readStored(page, projectTitle)).toEqual(dbBeforeInvalid);
  await page.screenshot({
    path: test
      .info()
      .outputPath(`manual-interpretations-${page.viewportSize()!.width}.png`),
    fullPage: true,
  });
  return { final: dbBeforeInvalid, pair: pairSnapshot(pair) };
}

test.describe("手動の排他解釈", () => {
  test("desktop: exact pair persistence, reciprocal refs, update isolation, source focus, retract undo, and atomic invalid save", async ({
    page,
  }) => {
    const external: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).hostname !== "127.0.0.1")
        external.push(request.url());
    });
    const projectTitle = title();
    await seed(page, projectTitle);
    const result = await exercise(page, projectTitle);
    await page.reload();
    const recent = page
      .locator("button.recent-open")
      .filter({ hasText: projectTitle })
      .first();
    await recent.click();
    expect(await readStored(page, projectTitle)).toEqual(result.final);
    expect(external).toEqual([]);
  });

  test("390px: keyboard save path and full JSON copy preserve every reasoning ID/value exactly", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const external: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).hostname !== "127.0.0.1")
        external.push(request.url());
    });
    const projectTitle = title();
    await seed(page, projectTitle);
    const result = await exercise(page, projectTitle);
    await page.evaluate(async (sourceTitle) => {
      const { loadProject, saveProject } =
        await import("/src/storage/projects.ts");
      const { exportProject, importProject } =
        await import("/src/export/project.ts");
      const rows = await new Promise<any[]>((resolve, reject) => {
        const r = indexedDB.open("rontenseiri-projects-v1", 1);
        r.onsuccess = () => {
          const q = r.result
            .transaction("projects", "readonly")
            .objectStore("projects")
            .getAll();
          q.onsuccess = () => resolve(q.result);
          q.onerror = () => reject(q.error);
        };
        r.onerror = () => reject(r.error);
      });
      const source = await loadProject(
        rows.find((p) => p.title === sourceTitle).id,
      );
      const copy = {
        ...importProject(exportProject(source, "json")),
        id: `${source.id}-copy`,
        title: `${sourceTitle}-JSON別コピー`,
        saved: true,
        storageRevision: undefined,
      };
      await saveProject(copy);
    }, projectTitle);
    const copy = await readStored(page, `${projectTitle}-JSON別コピー`);
    expect(copy?.id).not.toBe(result.final?.id);
    expect(copy?.reasoning).toEqual(result.final?.reasoning);
    expect(copy?.reasoning?.questions).toEqual(
      result.final?.reasoning?.questions,
    );
    expect(copy?.reasoning?.questionVersions).toEqual(
      result.final?.reasoning?.questionVersions,
    );
    expect(copy?.reasoning?.responses).toEqual(
      result.final?.reasoning?.responses,
    );
    expect(copy?.reasoning?.evidence).toEqual(
      result.final?.reasoning?.evidence,
    );
    expect(copy?.reasoning?.items).toEqual(result.final?.reasoning?.items);
    expect(copy?.reasoning?.interpretations).toEqual(
      result.final?.reasoning?.interpretations,
    );
    expect(copy?.reasoning?.exclusiveGroups).toEqual(
      result.final?.reasoning?.exclusiveGroups,
    );
    expect(copy?.reasoning?.uncertaintyPropagation).toEqual(
      result.final?.reasoning?.uncertaintyPropagation,
    );
    expect(copy?.reasoning?.revisions).toEqual(
      result.final?.reasoning?.revisions,
    );
    await page.screenshot({
      path: test.info().outputPath("manual-interpretations-mobile.png"),
      fullPage: true,
    });
    expect(external).toEqual([]);
  });
});
