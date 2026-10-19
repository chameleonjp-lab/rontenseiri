import { expect, test, type Page } from "@playwright/test";
import {
  manualResponseLinkFixture,
  linkValue,
} from "../tests/fixtures/manual-response-link";
import { exportProject } from "../src/export/project";
import type { Project } from "../src/domain/types";

const REASON = "原文と根拠を選び、欠けていた旧版への回答関係だけを補う";
const WARNING = "訂正の影響があるため、この振り返りは要再確認です。";

// Native IndexedDB observation only. No app module imports, writes or state injection.
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
async function durable(page: Page, id: string, revisionCount: number) {
  await expect
    .poll(async () => (await stored(page, id))?.revisions.length, {
      timeout: 10_000,
    })
    .toBe(revisionCount);
  await expect(page.locator(".save-state")).toContainText("現在版は保存済み");
  const p = await stored(page, id);
  expect(p?.saved).toBe(true);
  return p!;
}
async function nav(page: Page, name: string) {
  const target = page.getByRole("button", { name, exact: true });
  const menu = page.getByRole("button", { name: "メニュー", exact: true });
  await expect(target.or(menu).filter({ visible: true }).first()).toBeVisible();
  if (!(await target.isVisible())) await menu.click();
  await target.click();
}
async function agenda(page: Page, p: Project, id: string) {
  const target = page.locator(".sidebar-agendas").getByRole("button", {
    name: new RegExp(p.agendas.find((a) => a.id === id)!.title),
  });
  if (!(await target.isVisible()))
    await page.getByRole("button", { name: "メニュー", exact: true }).click();
  await target.click();
}
async function preview(page: Page, id?: string, revisionCount?: number) {
  if (id) await durable(page, id, revisionCount!);
  await page.getByRole("button", { name: "出力", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("出力範囲").selectOption("all");
  await dialog.getByLabel("形式").selectOption("json");
  await dialog
    .getByRole("button", { name: "出力内容をプレビュー", exact: true })
    .click();
  const result = JSON.parse(
    (await dialog.locator("pre.export-preview").textContent())!,
  ) as { scope: string; project: Project; manifest: Record<string, unknown> };
  expect(result.scope).toBe("full");
  expect(result.manifest).toMatchObject({
    fullBackup: true,
    limited: false,
    historyIncluded: true,
  });
  await dialog
    .getByRole("button", { name: "ダイアログを閉じる", exact: true })
    .click();
  return result;
}
const semantic = (p: Project) => ({
  utterances: p.utterances,
  agendas: p.agendas,
  relations: p.relations,
  selectedAgendaId: p.selectedAgendaId,
  reasoning: p.reasoning,
  ...(p.lineage === undefined ? {} : { lineage: p.lineage }),
});
const graphWithoutAudit = (p: Project) => {
  const { revisions: _audit, ...graph } = p.reasoning!;
  return graph;
};
async function attach(name: string, value: unknown) {
  await test.info().attach(name, {
    body: JSON.stringify(value, null, 2),
    contentType: "application/json",
  });
}
function assertAdded(p: Project, before: Project) {
  expect(p.sources).toEqual(before.sources);
  expect(p.utterances).toEqual(before.utterances);
  expect(p.relations).toEqual(before.relations);
  const responses = p.reasoning!.responses;
  expect(responses.slice(0, -1)).toEqual(before.reasoning!.responses);
  const added = responses.at(-1)!;
  const value = linkValue(before);
  expect(added).toEqual({
    ...value,
    id: expect.stringMatching(/^response-/),
    time: { asOf: expect.any(String), recordedAt: expect.any(String) },
    note: REASON,
  });
  for (const at of [added.time.asOf, added.time.recordedAt])
    expect(new Date(at).toISOString()).toBe(at);
  expect(added.kind).toBe("answer");
  expect(added.fulfillment).toBe("fulfilled");
  expect({
    ...graphWithoutAudit(p),
    responses: before.reasoning!.responses,
  }).toEqual(graphWithoutAudit(before));
  expect(p.agendas).toEqual(
    before.agendas.map((a) =>
      ["A", "C"].includes(a.id) ? { ...a, needsReview: true } : a,
    ),
  );
  expect(JSON.stringify(p.agendas.find((a) => a.id === "B"))).toBe(
    JSON.stringify(before.agendas.find((a) => a.id === "B")),
  );
  expect(p.revisions.slice(0, -1)).toEqual(before.revisions);
  expect(p.revisions.at(-1)).toMatchObject({
    kind: "reasoning:response-linked",
    reason: REASON,
    targetId: added.id,
    before: semantic(before),
  });
  expect(p.reasoning!.revisions.slice(0, -1)).toEqual(
    before.reasoning!.revisions,
  );
  return added;
}
async function visibleStates(page: Page, p: Project, changed: boolean) {
  await nav(page, "議題の流れ");
  for (const a of p.agendas) {
    const frame = page.locator(".agenda-frame").filter({
      has: page.getByRole("button", {
        name: `${a.id} ${a.title} 議題を選択`,
        exact: true,
      }),
    });
    await expect(frame).toHaveCount(1);
    await expect(frame.locator(".agenda-arrival")).toHaveText(
      changed && ["A", "C"].includes(a.id) ? "訂正の影響：要再確認" : a.arrival,
    );
  }
  // The list and graph share the same utterance detail inspector. ResponseLink
  // cards themselves live in ReasoningPanel, not canvas/list relation edges.
  for (const id of ["A", "C", "B"]) {
    const a = p.agendas.find((x) => x.id === id)!;
    await agenda(page, p, id);
    await nav(page, "発言と原文");
    const utterance = p.utterances.find((u) => u.id === a.utteranceIds[0])!;
    const row = page
      .locator(".transcript-select")
      .filter({ hasText: utterance.id });
    await expect(row).toContainText(utterance.quote);
    await row.click();
    const inspector = page.getByRole("complementary", {
      name: "選択した発言の詳細",
    });
    await expect(inspector).toContainText(utterance.quote);
    const warning = inspector.getByText("訂正の影響：振り返りは要再確認", {
      exact: true,
    });
    if (changed && id !== "B") await expect(warning).toBeVisible();
    else await expect(warning).toHaveCount(0);
    await inspector
      .getByRole("button", { name: "詳細を閉じる", exact: true })
      .click();
    await nav(page, "振り返り");
    const summary = page.locator(".summary-view");
    await expect(summary.getByText(a.arrival, { exact: true })).toBeVisible();
    if (changed && id !== "B")
      await expect(summary.getByText(WARNING, { exact: true })).toBeVisible();
    else
      await expect(summary.getByText(WARNING, { exact: true })).toHaveCount(0);
  }
}
async function responseState(page: Page, p: Project, addedId?: string) {
  await agenda(page, p, "S");
  await nav(page, "問い・根拠");
  const panel = page.getByRole("region", { name: "問い・根拠" });
  const value = linkValue(p);
  const cards = panel
    .getByRole("heading", { name: /問い版への応答/ })
    .locator("..")
    .locator("article.reasoning-card");
  await expect(cards).toHaveCount(
    p.reasoning!.responses.length + (addedId ? 1 : 0),
  );
  for (const r of p.reasoning!.responses)
    await expect(
      panel.getByRole("button", { name: `応答 ${r.id} を修正`, exact: true }),
    ).toBeVisible();
  if (addedId) {
    const card = cards.filter({
      has: page.getByRole("button", {
        name: `応答 ${addedId} を修正`,
        exact: true,
      }),
    });
    await expect(card).toContainText(
      `問い版 ${value.questionVersionId} · 発言 ${value.utteranceIds.join(", ")}`,
    );
    await expect(card.locator(".reasoning-tags > span").first()).toHaveText(
      "回答",
    );
    await expect(card).toContainText("要求充足：充足");
    await expect(card).toContainText(`根拠 ${value.evidenceIds.join(", ")}`);
    await expect(card).toContainText("登録時点");
  }
}
async function reload(page: Page, p: Project) {
  await page.reload();
  await page.locator("button.recent-open", { hasText: p.title }).click();
  await expect(
    page.getByRole("button", { name: "出力", exact: true }),
  ).toBeVisible();
}

for (const route of ["direct", "evidence"] as const) {
  for (const width of [1440, 390]) {
    test(`欠けた応答関係の追加 ${route} ${width}px: 局所失効・保存・再読込・Undo`, async ({
      page,
    }) => {
      const external: string[] = [];
      await page.route("**/*", async (r) => {
        if (
          !["127.0.0.1", "localhost"].includes(
            new URL(r.request().url()).hostname,
          )
        ) {
          external.push(r.request().url());
          await r.abort();
        } else await r.continue();
      });
      await page.setViewportSize({ width, height: 980 });
      const fixture = await manualResponseLinkFixture(route);
      await page.goto("/");
      await page.locator("input[type=file]").setInputFiles({
        name: "missing-response.json",
        mimeType: "application/json",
        buffer: Buffer.from(exportProject(fixture, "json", undefined, false)),
      });
      await expect(page.getByRole("status")).toContainText(
        "別コピーとして復元",
      );
      const baseline = (await preview(page)).project;
      expect(baseline.agendas).toEqual(fixture.agendas);
      expect(baseline.reasoning).toEqual(fixture.reasoning);
      expect(baseline.revisions).toEqual(fixture.revisions);
      expect(baseline.agendas.every((a) => !a.needsReview)).toBe(true);
      await page
        .getByRole("button", { name: "この端末に保存", exact: true })
        .click();
      const count = baseline.revisions.length;
      await durable(page, baseline.id, count);
      await visibleStates(page, baseline, false);
      await responseState(page, baseline);
      const value = linkValue(baseline);
      const form = page.getByRole("form", { name: "応答関係の編集" });
      const version = form.getByRole("combobox", {
        name: "対象問い版",
        exact: true,
      });
      await expect(version).toHaveValue("");
      await expect(
        form.getByRole("checkbox", { name: new RegExp(value.utteranceIds[0]) }),
      ).not.toBeChecked();
      await version.selectOption(value.questionVersionId);
      await form
        .getByRole("checkbox", { name: new RegExp(value.utteranceIds[0]) })
        .check();
      await form
        .getByRole("combobox", { name: "応答種別", exact: true })
        .selectOption("answer");
      await form
        .getByRole("combobox", { name: "要求充足", exact: true })
        .selectOption("fulfilled");
      for (const id of value.evidenceIds)
        await form
          .getByRole("checkbox", { name: new RegExp(`^${id} ·`) })
          .check();
      for (const id of value.counterargumentToClaimIds)
        await form
          .getByRole("checkbox", { name: new RegExp(`^${id} ·`) })
          .check();
      await form.getByLabel("登録理由", { exact: true }).fill(REASON);
      await form
        .getByRole("button", { name: "応答を登録", exact: true })
        .click();
      await expect(
        page.getByRole("region", { name: "問い・根拠" }),
      ).toContainText("応答を登録しました");
      const addedState = await durable(page, baseline.id, count + 1);
      const added = assertAdded(addedState, baseline);
      await attach("added-indexeddb.json", addedState);
      await reload(page, addedState);
      await visibleStates(page, baseline, true);
      await responseState(page, baseline, added.id);
      const output = await preview(page, baseline.id, count + 1);
      assertAdded(output.project, baseline);
      expect(output.project.reasoning).toEqual(addedState.reasoning);
      expect(output.project.revisions).toEqual(addedState.revisions);
      await attach("reloaded-full-output.json", output);
      await nav(page, "訂正履歴");
      await expect(page.getByText(REASON, { exact: true })).toBeVisible();
      await page
        .getByRole("button", { name: "直前の訂正を元に戻す", exact: true })
        .click();
      const undone = await durable(page, baseline.id, count + 2);
      expect(undone.agendas).toEqual(baseline.agendas);
      expect(graphWithoutAudit(undone)).toEqual(graphWithoutAudit(baseline));
      expect(undone.utterances).toEqual(baseline.utterances);
      expect(undone.relations).toEqual(baseline.relations);
      expect(undone.reasoning).toEqual(baseline.reasoning);
      expect(undone.revisions.slice(0, -1)).toEqual(addedState.revisions);
      const undo = undone.revisions.at(-1)!;
      expect(undo).toMatchObject({
        kind: "undo",
        targetId: added.id,
        reason: `Undo: ${REASON}`,
        after: { targetRevisionId: addedState.revisions.at(-1)!.id },
      });
      expect(undo.before).toEqual(semantic(output.project));
      // Shared Undo restores the graph snapshot; the project audit retains the
      // added-link event and complete before/after payloads of the Undo.
      expect(undo.after).toEqual({
        ...semantic(baseline),
        targetRevisionId: addedState.revisions.at(-1)!.id,
      });
      await attach("undone-indexeddb.json", undone);
      await reload(page, undone);
      await visibleStates(page, baseline, false);
      await responseState(page, baseline);
      const final = await preview(page, baseline.id, count + 2);
      expect(final.project.agendas).toEqual(baseline.agendas);
      expect(final.project.reasoning).toEqual(undone.reasoning);
      expect(final.project.revisions).toEqual(undone.revisions);
      await attach("undone-reloaded-full-output.json", final);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(external).toEqual([]);
    });
  }
}
