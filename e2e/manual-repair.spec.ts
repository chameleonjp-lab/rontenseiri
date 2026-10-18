import { test, expect, type Locator, type Page } from "@playwright/test";
import {
  manualRepairFixture,
  repairResponse,
} from "../tests/fixtures/manual-repair";
import { exportProject } from "../src/export/project";
import type { Project } from "../src/domain/types";
import { enter, navigate, tabTo } from "./helpers/keyboard-navigation";

// After fixture import, interaction is only Tab/Shift+Tab/Enter/Space/arrow keys
// and text typing. No locator.focus/click/fill/selectOption in the tested route.
async function text(page: Page, target: Locator, value: string) {
  await tabTo(page, target);
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText(value);
}
async function toggle(page: Page, target: Locator) {
  await tabTo(page, target);
  await page.keyboard.press("Space");
  await expect(target).toBeFocused();
}
async function stored(page: Page): Promise<Project> {
  return page.evaluate(async () => {
    const path = "/src/storage/projects.ts";
    const { listProjects } = await import(path);
    const projects = await listProjects();
    if (projects.length !== 1)
      throw new Error(`Expected one project, got ${projects.length}`);
    return projects[0];
  });
}

for (const width of [1440, 390]) {
  test(`通常UI ${width}px: 原文→関連修正→解除→Undo→保存をキーボードだけで完了`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const externalRequests: string[] = [];
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
        externalRequests.push(url.origin);
        await route.abort();
      } else await route.continue();
    });
    await page.setViewportSize({ width, height: 980 });
    const fixture = await manualRepairFixture(),
      id = repairResponse(fixture).id;
    await page.goto("/");
    await page.locator("input[type=file]").setInputFiles({
      name: "manual-repair.rontenseiri.json",
      mimeType: "application/json",
      buffer: Buffer.from(exportProject(fixture, "json", undefined, false)),
    });
    await expect(page.getByRole("status")).toContainText("別コピーとして復元");
    await navigate(page, "問い・根拠");
    const panel = page.getByRole("region", { name: "問い・根拠" });
    const source = panel.getByRole("button", {
      name: /発言 U02 \/ 原文へ戻る/,
    });
    await enter(page, source);
    const inspector = page.getByRole("complementary", {
      name: "選択した発言の詳細",
    });
    await expect(inspector).toContainText("費用は100円");
    await enter(
      page,
      inspector.getByRole("button", { name: "発言・原文", exact: true }),
    );
    await expect(
      inspector.getByLabel("訂正後の原文", { exact: true }),
    ).toHaveValue(fixture.utterances[1].quote);
    await enter(
      page,
      inspector.getByRole("button", { name: "詳細を閉じる", exact: true }),
    );
    await expect(source).toBeFocused();
    const edit = panel.getByRole("button", {
      name: `応答 ${id} を修正`,
      exact: true,
    });
    await enter(page, edit);
    const form = panel.getByRole("form", { name: "応答関係の編集" });
    const version = form.getByRole("combobox", {
      name: "対象問い版",
      exact: true,
    });
    await expect(version).toBeFocused();
    await expect(version).toHaveValue("Q1-v1");
    // Explicitly choose the old version rather than accepting an implicit latest.
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Tab");
    await expect(version).toHaveValue("Q1-v1");
    const kind = form.getByRole("combobox", { name: "応答種別", exact: true });
    await tabTo(page, kind);
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Tab");
    await expect(kind).toHaveValue("counterargument");
    await expect(
      form.getByRole("combobox", { name: "要求充足", exact: true }),
    ).toHaveValue("fulfilled");
    const utterance = form.getByRole("checkbox", { name: /U01/ });
    await toggle(page, utterance);
    await expect(utterance).toBeChecked();
    await toggle(page, utterance);
    await expect(utterance).not.toBeChecked();
    await expect(form.getByRole("checkbox", { name: /U02/ })).toBeChecked();
    await toggle(
      page,
      form.getByRole("checkbox", { name: "E2 · 根拠2", exact: true }),
    );
    await toggle(
      page,
      form.getByRole("checkbox", { name: "E3 · 根拠3", exact: true }),
    );
    await toggle(
      page,
      form.getByRole("checkbox", { name: "I2 · 主張2", exact: true }),
    );
    await toggle(
      page,
      form.getByRole("checkbox", { name: "I3 · 主張3", exact: true }),
    );
    await text(
      page,
      form.getByLabel("登録理由", { exact: true }),
      "原文と照合して手動修復",
    );
    const apply = form.getByRole("button", {
      name: "応答の修正を保存",
      exact: true,
    });
    await enter(page, apply);
    await expect(
      form.getByRole("button", { name: "応答を登録", exact: true }),
    ).toBeFocused();
    await expect(panel).toContainText("根拠 E1, E3 · 反論先 I1, I3");
    await expect(panel).toContainText("要求充足：充足");
    await enter(page, edit);
    await text(
      page,
      form.getByLabel("登録理由", { exact: true }),
      "関連だけを解除して再検討",
    );
    await enter(
      page,
      form.getByRole("button", {
        name: "理由を記録して応答の関連を解除",
        exact: true,
      }),
    );
    await expect(version).toBeFocused();
    await expect(edit).toHaveCount(0);
    await expect(panel).toContainText("未回答・反論なしとは断定しません");
    await navigate(page, "訂正履歴");
    const undo = page.getByRole("button", {
      name: "直前の訂正を元に戻す",
      exact: true,
    });
    await enter(page, undo);
    await expect(undo).toBeFocused();
    await navigate(page, "問い・根拠");
    await expect(edit).toBeVisible();
    await expect(panel).toContainText("根拠 E1, E3 · 反論先 I1, I3");
    await enter(
      page,
      page.getByRole("button", { name: "この端末に保存", exact: true }),
    );
    await expect(page.getByRole("status")).toContainText(
      "このブラウザに保存しました",
    );
    await expect(
      page.getByRole("button", { name: "この端末に保存", exact: true }),
    ).toBeFocused();
    const saved = await stored(page),
      response = repairResponse(saved);
    expect(response).toEqual({
      ...repairResponse(fixture),
      kind: "counterargument",
      evidenceIds: ["E1", "E3"],
      counterargumentToClaimIds: ["I1", "I3"],
    });
    expect(saved.revisions.map((r) => r.kind)).toEqual([
      "reasoning:response-linked",
      "reasoning:response-updated",
      "reasoning:response-removed",
      "undo",
    ]);
    expect(saved.agendas[1]).toEqual(fixture.agendas[1]);
    expect(saved.agendas[0]).toEqual({
      ...fixture.agendas[0],
      needsReview: true,
    });
    // Ensure relation controls are within their panel and the page has no horizontal overflow.
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await enter(page, edit);
    for (const control of await form
      .locator("select,input,button,fieldset")
      .all()) {
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    }
    await page.screenshot({
      path: `artifacts/p3-manual-repair-${width}.png`,
      fullPage: true,
    });
    await page.reload();
    await enter(
      page,
      page.locator("button.recent-open", { hasText: saved.title }),
    );
    await navigate(page, "問い・根拠");
    await expect(edit).toBeVisible();
    expect(await stored(page)).toEqual(saved);
    expect(externalRequests).toEqual([]);
  });
}

test("非空応答・根拠・全履歴のIndexedDB→full JSON→reload→Undo一致", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const fixturePath = "/tests/fixtures/manual-repair.ts",
      reasoningPath = "/src/domain/reasoning.ts",
      storagePath = "/src/storage/projects.ts",
      jsonPath = "/src/export/project.ts",
      undoPath = "/src/domain/revisions.ts";
    const { manualRepairFixture, repairResponse, semanticState } = await import(
      fixturePath
    );
    const { updateResponse, removeResponse } = await import(reasoningPath);
    const { saveProject, loadProject } = await import(storagePath);
    const { exportProject, importProject } = await import(jsonPath);
    const { undoLastRevision } = await import(undoPath);
    const original = await manualRepairFixture(),
      id = repairResponse(original).id;
    const edited = updateResponse(
      original,
      id,
      {
        evidenceIds: ["E3", "E1"],
        counterargumentToClaimIds: ["I3", "I1"],
        kind: "counterargument",
      },
      "永続化照合の修正",
    );
    const saved = await saveProject(edited),
      loaded = await loadProject(saved.id);
    const json = importProject(exportProject(loaded, "json", undefined, false));
    const removed = removeResponse(json, id, "永続化照合の解除");
    const removedSaved = await saveProject(removed);
    return {
      expected: semanticState(edited),
      loaded: semanticState(loaded),
      json: semanticState(json),
      removed: semanticState(removed),
      removedId: removedSaved.id,
      original: semanticState(original),
    };
  });
  expect(result.loaded).toEqual(result.expected);
  expect(result.json).toEqual(result.expected);
  expect(result.removed.reasoning.responses).toHaveLength(1);
  expect(result.removed.reasoning.evidence).toHaveLength(3);
  expect(result.removed.revisions).toHaveLength(3);
  await page.reload();
  const restored = await page.evaluate(async (id) => {
    const storagePath = "/src/storage/projects.ts",
      undoPath = "/src/domain/revisions.ts",
      fixturePath = "/tests/fixtures/manual-repair.ts";
    const { loadProject, saveProject } = await import(storagePath);
    const { undoLastRevision } = await import(undoPath);
    const { semanticState } = await import(fixturePath);
    const loaded = await loadProject(id);
    const undoRemoval = undoLastRevision(loaded);
    const undoEdit = undoLastRevision(undoRemoval);
    const persisted = await saveProject(undoEdit);
    return {
      loaded: semanticState(loaded),
      undoRemoval: semanticState(undoRemoval),
      undoEdit: semanticState(await loadProject(persisted.id)),
    };
  }, result.removedId);
  expect(restored.loaded).toEqual(result.removed);
  // Audit events accumulate; all active semantic data and order restore exactly.
  const withoutHistory = (state: typeof result.expected) => {
    const { revisions: _revisions, ...rest } = state;
    return rest;
  };
  expect(withoutHistory(restored.undoRemoval)).toEqual(
    withoutHistory(result.expected),
  );
  expect(withoutHistory(restored.undoEdit)).toEqual(
    withoutHistory(result.original),
  );
  expect(restored.undoEdit.revisions.slice(0, 3)).toEqual(
    result.removed.revisions,
  );
  expect(
    restored.undoEdit.revisions.map((r: { kind: string }) => r.kind),
  ).toEqual([
    "reasoning:response-linked",
    "reasoning:response-updated",
    "reasoning:response-removed",
    "undo",
    "undo",
  ]);
});
