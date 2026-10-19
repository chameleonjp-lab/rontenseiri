import { expect, test, type Page } from "@playwright/test";
import { exportProject } from "../src/export/project";
import {
  evidenceCorrectionFixture,
  evidenceCorrectionPatch,
  evidenceCorrectionIds,
  EVIDENCE_EDIT_REASON,
} from "../tests/fixtures/evidence-correction";
import type { Project } from "../src/domain/types";

const WARNING = "訂正の影響があるため、この振り返りは要再確認です。";

// Native read-only observation only: the browser never imports app modules or writes IDB.
async function stored(page: Page, wanted: string): Promise<Project | null> {
  return page.evaluate(async (idOrTitle) => {
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
          .getAll();
        request.onsuccess = () =>
          resolve(
            (request.result as Project[]).find(
              (p) => p.id === idOrTitle || p.title === idOrTitle,
            ) ?? null,
          );
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }, wanted);
}

async function durable(page: Page, idOrTitle: string, revisions: number) {
  await expect
    .poll(async () => (await stored(page, idOrTitle))?.revisions.length, {
      timeout: 10_000,
    })
    .toBe(revisions);
  await expect(page.locator(".save-state")).toContainText("現在版は保存済み");
  return (await stored(page, idOrTitle))!;
}

async function nav(page: Page, name: string) {
  const button = page.getByRole("button", { name, exact: true });
  if (!(await button.isVisible()))
    await page.getByRole("button", { name: "メニュー", exact: true }).click();
  await button.click();
}

async function agenda(page: Page, p: Project, id: string, view: string) {
  const a = p.agendas.find((x) => x.id === id)!;
  const button = page
    .locator(".sidebar-agendas")
    .getByRole("button", { name: new RegExp(`^\\d+ ${a.title}$`) });
  if (!(await button.isVisible()))
    await page.getByRole("button", { name: "メニュー", exact: true }).click();
  await button.click();
  await nav(page, view);
}

async function openFixture(page: Page, width: number) {
  const external: string[] = [];
  await page.route("**/*", async (route) => {
    const host = new URL(route.request().url()).hostname;
    if (!["127.0.0.1", "localhost"].includes(host)) {
      external.push(route.request().url());
      await route.abort();
    } else await route.continue();
  });
  await page.setViewportSize({ width, height: 980 });
  const fixture = await evidenceCorrectionFixture();
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "evidence-correction.json",
    mimeType: "application/json",
    buffer: Buffer.from(exportProject(fixture, "json", undefined, false)),
  });
  await expect(page.getByRole("status")).toContainText("別コピーとして復元");
  await page
    .getByRole("button", { name: "この端末に保存", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "出力", exact: true }),
  ).toBeVisible();
  const initial = await durable(page, fixture.title, fixture.revisions.length);
  return { fixture, initial, external };
}

function evidenceCard(page: Page, marker = "旧根拠") {
  return page
    .getByRole("region", { name: "問い・根拠" })
    .locator("article.reasoning-card")
    .filter({ hasText: evidenceCorrectionIds.evidenceId })
    .filter({ hasText: marker });
}

async function confirmSummary(page: Page, p: Project, id: string) {
  await agenda(page, p, id, "振り返り");
  const summary = page.locator(".summary-view");
  await summary
    .getByRole("button", { name: "まとめを編集", exact: true })
    .click();
  await summary
    .getByLabel("訂正理由", { exact: true })
    .fill(`根拠訂正前に${id}を確認`);
  await summary
    .getByRole("button", { name: "確認した整理内容を保存", exact: true })
    .click();
  await expect(summary.getByText(WARNING, { exact: true })).toHaveCount(0);
}

async function previewFullJSON(page: Page): Promise<Project> {
  await page.getByRole("button", { name: "出力", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("出力範囲").selectOption("all");
  await dialog.getByLabel("形式").selectOption("json");
  await dialog
    .getByRole("button", { name: "出力内容をプレビュー", exact: true })
    .click();
  const dto = JSON.parse(
    (await dialog.locator("pre.export-preview").textContent())!,
  );
  expect(dto.manifest).toMatchObject({
    fullBackup: true,
    limited: false,
    historyIncluded: true,
  });
  await dialog
    .getByRole("button", { name: "ダイアログを閉じる", exact: true })
    .click();
  return dto.project as Project;
}

async function reopen(page: Page, p: Project) {
  await page.reload();
  await page.locator("button.recent-open", { hasText: p.title }).click();
  await expect(
    page.getByRole("button", { name: "出力", exact: true }),
  ).toBeVisible();
}

async function reviewDiagram(page: Page, p: Project, changed: boolean) {
  await nav(page, "議題の流れ");
  for (const a of p.agendas) {
    const frame = page.locator(".agenda-frame").filter({
      has: page.getByRole("button", {
        name: `${a.id} ${a.title} 議題を選択`,
        exact: true,
      }),
    });
    await expect(frame.locator(".agenda-arrival")).toHaveText(
      changed && ["A", "C"].includes(a.id)
        ? "訂正の影響：要再確認"
        : a.arrival || "到達点は未整理です。原文から確認できます。",
    );
  }
  await agenda(page, p, "A", "振り返り");
  const aWarning = page
    .locator(".summary-view")
    .getByText(WARNING, { exact: true });
  if (changed) await expect(aWarning).toBeVisible();
  else await expect(aWarning).toHaveCount(0);
  await agenda(page, p, "C", "振り返り");
  const cWarning = page
    .locator(".summary-view")
    .getByText(WARNING, { exact: true });
  if (changed) await expect(cWarning).toBeVisible();
  else await expect(cWarning).toHaveCount(0);
  await agenda(page, p, "B", "振り返り");
  await expect(
    page.locator(".summary-view").getByText(WARNING, { exact: true }),
  ).toHaveCount(0);
  await agenda(page, p, "S", "問い・根拠");
}

for (const width of [1440, 390]) {
  test(`登録済み根拠を正規確認・訂正・保存・再開・共有Undoする ${width}px`, async ({
    page,
  }) => {
    const { fixture, initial, external } = await openFixture(page, width);
    expect(initial.id).not.toBe("");
    await confirmSummary(page, initial, "A");
    await confirmSummary(page, initial, "C");
    await confirmSummary(page, initial, "B");
    await agenda(page, initial, "S", "問い・根拠");
    const clean = await durable(page, initial.id, initial.revisions.length + 3);
    expect(clean.agendas.every((a) => !a.needsReview)).toBe(true);
    expect(clean.reasoning).toEqual(initial.reasoning);
    expect(clean.revisions.slice(-3).map((r) => r.targetId)).toEqual([
      "A",
      "C",
      "B",
    ]);

    await evidenceCard(page)
      .getByRole("button", {
        name: `根拠 ${evidenceCorrectionIds.evidenceId} を修正`,
        exact: true,
      })
      .click();
    const edit = page.getByRole("form", { name: "根拠の修正" });
    await expect(edit.getByLabel("注記", { exact: true })).toBeFocused();
    await edit
      .getByRole("checkbox", {
        name: new RegExp(evidenceCorrectionIds.oldUtteranceId),
      })
      .uncheck();
    await edit
      .getByRole("checkbox", {
        name: new RegExp(evidenceCorrectionIds.newUtteranceId),
      })
      .check();
    await edit
      .getByLabel("注記", { exact: true })
      .fill(evidenceCorrectionPatch.note);
    await edit
      .getByLabel("訂正理由", { exact: true })
      .fill(EVIDENCE_EDIT_REASON);
    await edit
      .getByRole("button", { name: "根拠の修正を保存", exact: true })
      .click();
    await expect(page.getByText(/根拠 E1 を修正しました/)).toBeVisible();
    await expect
      .poll(async () =>
        (await stored(page, clean.id))?.reasoning?.evidence.find(
          (e) => e.id === "E1",
        ),
      )
      .toMatchObject({
        id: "E1",
        utteranceIds: ["U03"],
        note: evidenceCorrectionPatch.note,
      });
    const changed = await durable(page, clean.id, clean.revisions.length + 1);
    expect(
      changed.reasoning!.evidence.find((e) => e.id === "E1"),
    ).toMatchObject({
      id: "E1",
      utteranceIds: evidenceCorrectionPatch.utteranceIds,
      note: evidenceCorrectionPatch.note,
      actor: "user-recorded",
      certainty: "confirmed",
      time: {
        asOf: "2020-01-01T00:00:00.000Z",
        recordedAt: "2020-01-02T00:00:00.000Z",
      },
    });
    expect(changed.reasoning!.responses).toEqual(clean.reasoning!.responses);
    expect(changed.reasoning!.items).toEqual(clean.reasoning!.items);
    expect(changed.reasoning!.evidence).toEqual(
      clean.reasoning!.evidence!.map((e) =>
        e.id === "E1" ? { ...e, ...evidenceCorrectionPatch } : e,
      ),
    );
    expect(changed.agendas).toEqual(
      clean.agendas.map((a) =>
        ["A", "C"].includes(a.id) ? { ...a, needsReview: true } : a,
      ),
    );
    expect(changed.revisions.slice(0, -1)).toEqual(clean.revisions);
    expect(changed.revisions.at(-1)).toMatchObject({
      targetId: "E1",
      kind: "reasoning:evidence-updated",
      reason: EVIDENCE_EDIT_REASON,
    });

    await reopen(page, changed);
    await reviewDiagram(page, changed, true);
    await agenda(page, changed, "S", "問い・根拠");
    await expect(
      evidenceCard(page, evidenceCorrectionPatch.note),
    ).toContainText(evidenceCorrectionPatch.note);
    await expect(
      evidenceCard(page, evidenceCorrectionPatch.note),
    ).toContainText(evidenceCorrectionIds.newUtteranceId);
    await expect(
      evidenceCard(page, evidenceCorrectionPatch.note),
    ).not.toContainText(evidenceCorrectionIds.oldUtteranceId);
    const exported = await previewFullJSON(page);
    expect(exported.reasoning).toEqual(changed.reasoning);
    expect(exported.agendas).toEqual(changed.agendas);
    expect(exported.revisions).toEqual(changed.revisions);

    await nav(page, "訂正履歴");
    await page
      .getByRole("button", { name: "直前の訂正を元に戻す", exact: true })
      .click();
    const undone = await durable(
      page,
      changed.id,
      changed.revisions.length + 1,
    );
    expect(undone.reasoning).toEqual(clean.reasoning);
    expect(undone.agendas).toEqual(clean.agendas);
    expect(undone.revisions.slice(0, -1)).toEqual(changed.revisions);
    expect(undone.revisions.at(-1)).toMatchObject({
      after: { targetRevisionId: changed.revisions.at(-1)!.id },
    });
    await reopen(page, undone);
    await reviewDiagram(page, undone, false);
    await agenda(page, undone, "S", "問い・根拠");
    await expect(evidenceCard(page, "旧根拠")).toContainText("旧根拠");
    await expect(evidenceCard(page, "旧根拠")).toContainText(
      evidenceCorrectionIds.oldUtteranceId,
    );
    await expect(evidenceCard(page, "旧根拠")).not.toContainText(
      evidenceCorrectionPatch.note,
    );
    expect(await previewFullJSON(page)).toMatchObject({
      reasoning: clean.reasoning,
      agendas: clean.agendas,
      revisions: undone.revisions,
    });
    expect(external).toEqual([]);
  });
}

test("根拠訂正の空選択・理由なし・ナビゲーション拒否は下書きと保存履歴を保持する", async ({
  page,
}) => {
  const { initial, external } = await openFixture(page, 1440);
  await agenda(page, initial, "S", "問い・根拠");
  const card = evidenceCard(page);
  const start = card.getByRole("button", {
    name: `根拠 ${evidenceCorrectionIds.evidenceId} を修正`,
    exact: true,
  });
  await start.click();
  await expect(
    page
      .getByRole("form", { name: "根拠の修正" })
      .getByLabel("注記", { exact: true }),
  ).toBeFocused();
  const edit = page.getByRole("form", { name: "根拠の修正" });
  await expect(
    page.getByRole("button", { name: /根拠 E2 を修正/ }),
  ).toBeDisabled();
  await edit.getByLabel("注記", { exact: true }).fill("空選択の下書き");
  await edit
    .getByRole("checkbox", {
      name: new RegExp(evidenceCorrectionIds.oldUtteranceId),
    })
    .uncheck();
  await edit.getByLabel("訂正理由", { exact: true }).fill("空選択を拒否");
  await edit
    .getByRole("button", { name: "根拠の修正を保存", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(/発言|根拠/);
  await expect(edit.getByLabel("注記", { exact: true })).toHaveValue(
    "空選択の下書き",
  );
  await edit
    .getByRole("checkbox", {
      name: new RegExp(evidenceCorrectionIds.oldUtteranceId),
    })
    .check();
  await edit.getByLabel("訂正理由", { exact: true }).fill("   ");
  await edit
    .getByRole("button", { name: "根拠の修正を保存", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("修正理由");
  await expect(edit.getByLabel("注記", { exact: true })).toHaveValue(
    "空選択の下書き",
  );
  let dialogMessage = "";
  page.once("dialog", async (dialog) => {
    dialogMessage = dialog.message();
    await dialog.dismiss();
  });
  await nav(page, "振り返り");
  await expect.poll(() => dialogMessage).toContain("下書き");
  await expect(edit).toBeVisible();
  expect((await stored(page, initial.id))!.revisions).toEqual(
    initial.revisions,
  );
  await edit
    .getByRole("button", { name: "根拠の修正をキャンセル", exact: true })
    .click();
  await expect(start).toBeFocused();
  await nav(page, "振り返り");
  expect((await stored(page, initial.id))!.reasoning).toEqual(
    initial.reasoning,
  );
  expect(external).toEqual([]);
});
