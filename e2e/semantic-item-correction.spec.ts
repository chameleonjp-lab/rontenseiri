import { expect, test, type Page } from "@playwright/test";
import { exportProject } from "../src/export/project";
import { semanticSnapshot } from "../src/domain/snapshot";
import { createManualExclusivePair } from "../src/domain/manual-interpretations";
import type { Project } from "../src/domain/types";
import {
  semanticItemCorrectionFixture,
  CONFIRMED_AGENDAS,
  ITEM_PATCH,
  ITEM_EDIT_REASON,
  OLD_ITEM_TEXT,
  NEW_ITEM_TEXT,
} from "../tests/fixtures/semantic-item-correction";

const WARNING = "訂正の影響があるため、この振り返りは要再確認です。";
const item = (p: Project) => p.reasoning!.items.find((x) => x.id === "I1")!;
// Native read-only observation: never import app modules or write storage in the browser.
async function stored(page: Page, id: string): Promise<Project | null> {
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
  }, id);
}
async function durable(page: Page, id: string, count: number) {
  await expect
    .poll(async () => (await stored(page, id))?.revisions.length, {
      timeout: 10_000,
    })
    .toBe(count);
  await expect(page.locator(".save-state")).toContainText("現在版は保存済み");
  return (await stored(page, id))!;
}
async function nav(page: Page, name: string) {
  const button = page.getByRole("button", { name, exact: true });
  if (!(await button.isVisible()))
    await page.getByRole("button", { name: "メニュー", exact: true }).click();
  await button.click();
}
async function agenda(page: Page, p: Project, id: string, view: string) {
  const button = page.locator(".sidebar-agendas").getByRole("button", {
    name: new RegExp(p.agendas.find((a) => a.id === id)!.title),
  });
  if (!(await button.isVisible()))
    await page.getByRole("button", { name: "メニュー", exact: true }).click();
  await button.click();
  await nav(page, view); // Close the mobile navigation before operating content.
}
async function open(page: Page, fixture: Project) {
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "semantic-item.json",
    mimeType: "application/json",
    buffer: Buffer.from(exportProject(fixture, "json", undefined, false)),
  });
  await expect(page.getByRole("status")).toContainText("別コピーとして復元");
  await page
    .getByRole("button", { name: "この端末に保存", exact: true })
    .click();
  return durable(page, fixture.title, fixture.revisions.length);
}
async function cleanBaseline(page: Page, initial: Project) {
  for (const id of CONFIRMED_AGENDAS) {
    await agenda(page, initial, id, "振り返り");
    const summary = page.locator(".summary-view");
    if (id === "A")
      await expect(summary.getByText(WARNING, { exact: true })).toBeVisible();
    await summary
      .getByRole("button", { name: "まとめを編集", exact: true })
      .click();
    await summary
      .getByLabel("訂正理由", { exact: true })
      .fill(`意味項目の訂正前に${id}を確認`);
    await summary
      .getByRole("button", { name: "確認した整理内容を保存", exact: true })
      .click();
    await expect(summary.getByText(WARNING, { exact: true })).toHaveCount(0);
  }
  await agenda(page, initial, "S", "問い・根拠");
  const p = await durable(page, initial.id, initial.revisions.length + 4);
  expect(p.agendas.every((a) => !a.needsReview)).toBe(true);
  expect(p.reasoning).toEqual(initial.reasoning);
  expect(
    p.revisions
      .slice(-4)
      .map((r) => ({ id: r.targetId, kind: r.kind, reason: r.reason })),
  ).toEqual(
    CONFIRMED_AGENDAS.map((id) => ({
      id,
      kind: "user-revision",
      reason: `意味項目の訂正前に${id}を確認`,
    })),
  );
  await test.info().attach("clean-confirmed-baseline.json", {
    body: JSON.stringify(p),
    contentType: "application/json",
  });
  return p;
}
async function preview(page: Page) {
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
async function visibleReview(page: Page, p: Project, changed: boolean) {
  await nav(page, "議題の流れ");
  for (const a of p.agendas) {
    const frame = page.locator(".agenda-frame").filter({
      has: page.getByRole("button", {
        name: `${a.id} ${a.title} 議題を選択`,
        exact: true,
      }),
    });
    await expect(frame.locator(".agenda-arrival")).toHaveText(
      changed && ["A", "N", "C"].includes(a.id)
        ? "訂正の影響：要再確認"
        : a.arrival || "到達点は未整理です。原文から確認できます。",
    );
  }
  await agenda(page, p, "C", "発言と原文");
  const row = page.locator(".transcript-select").filter({ hasText: "U08" });
  await expect(row).toContainText(
    p.utterances.find((u) => u.id === "U08")!.quote,
  );
  await row.click();
  const inspector = page.getByRole("complementary", {
    name: "選択した発言の詳細",
  });
  const detailWarning = inspector.getByText("訂正の影響：振り返りは要再確認", {
    exact: true,
  });
  if (changed) await expect(detailWarning).toBeVisible();
  else await expect(detailWarning).toHaveCount(0);
  await inspector
    .getByRole("button", { name: "詳細を閉じる", exact: true })
    .click();
  for (const id of ["A", "B"]) {
    await agenda(page, p, id, "振り返り");
    const warning = page
      .locator(".summary-view")
      .getByText(WARNING, { exact: true });
    if (changed && id === "A") await expect(warning).toBeVisible();
    else await expect(warning).toHaveCount(0);
  }
  await agenda(page, p, "S", "問い・根拠");
}

for (const width of [1440, 390]) {
  test(`${width}px 意味項目を訂正し保存・再開・Undoで内容と依存状態を保つ`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 980 });
    const external: string[] = [];
    await page.route("**/*", async (route) => {
      if (
        !["localhost", "127.0.0.1"].includes(
          new URL(route.request().url()).hostname,
        )
      ) {
        external.push(route.request().url());
        await route.abort();
      } else await route.continue();
    });
    const fixture = await semanticItemCorrectionFixture();
    const initial = await open(page, fixture);
    expect(initial.agendas).toEqual(fixture.agendas);
    const before = await cleanBaseline(page, initial);
    await page
      .getByRole("button", { name: "意味項目 I1 を修正", exact: true })
      .click();
    const form = page.getByRole("form", { name: "意味項目の編集" });
    await expect(
      form.getByRole("textbox", { name: "内容", exact: true }),
    ).toBeFocused();
    await expect(
      form.getByRole("textbox", { name: "内容", exact: true }),
    ).toHaveValue(OLD_ITEM_TEXT);
    await expect(
      form.getByRole("combobox", { name: "確度", exact: true }),
    ).toBeDisabled();
    await form
      .getByRole("textbox", { name: "内容", exact: true })
      .fill(NEW_ITEM_TEXT);
    await form
      .getByRole("combobox", { name: "項目", exact: true })
      .selectOption("condition");
    await form.getByRole("checkbox", { name: /^U02 / }).uncheck();
    await form.getByRole("checkbox", { name: /^U03 / }).check();
    await form.getByRole("checkbox", { name: /^E2 / }).check();
    // Order is explicit: E1 was retained, E2 appended by the UI.
    await form.getByLabel("登録理由", { exact: true }).fill(ITEM_EDIT_REASON);
    await form
      .getByRole("button", { name: "意味項目の修正を保存", exact: true })
      .click();
    await expect(
      page.getByText("意味項目を修正しました。依存する振り返りは要再確認です", {
        exact: true,
      }),
    ).toBeVisible();
    const changed = await durable(page, before.id, before.revisions.length + 1);
    expect(item(changed)).toEqual({
      ...item(before),
      ...ITEM_PATCH,
      evidenceIds: ["E1", "E2"],
    });
    expect(changed.agendas).toEqual(
      before.agendas.map((a) =>
        ["A", "N", "C"].includes(a.id) ? { ...a, needsReview: true } : a,
      ),
    );
    expect(changed.reasoning!.responses).toEqual(before.reasoning!.responses);
    expect(changed.reasoning!.questionVersions).toEqual(
      before.reasoning!.questionVersions,
    );
    expect(changed.reasoning!.evidence).toEqual(before.reasoning!.evidence);
    expect(changed.sources).toEqual(before.sources);
    expect(changed.utterances).toEqual(before.utterances);
    expect(changed.reasoning!.items).toEqual(
      before.reasoning!.items.map((x) =>
        x.id === "I1" ? { ...x, ...ITEM_PATCH, evidenceIds: ["E1", "E2"] } : x,
      ),
    );
    expect(changed.revisions.slice(0, -1)).toEqual(before.revisions);
    expect(changed.revisions.at(-1)).toMatchObject({
      targetId: "I1",
      kind: "reasoning:semantic-item-updated",
      reason: ITEM_EDIT_REASON,
    });
    await reopen(page, changed);
    await visibleReview(page, before, true);
    const card = page.getByRole("article", {
      name: "意味項目 I1",
      exact: true,
    });
    await expect(card).toContainText(`条件：${NEW_ITEM_TEXT}`);
    await expect(card).toContainText("E1, E2");
    await expect(card).toContainText("利用者登録（身元未検証）");
    const exported = await preview(page);
    expect(exported.reasoning).toEqual(changed.reasoning);
    expect(exported.revisions).toEqual(changed.revisions);
    expect(exported.agendas).toEqual(changed.agendas);
    await nav(page, "訂正履歴");
    await page
      .getByRole("button", { name: "直前の訂正を元に戻す", exact: true })
      .click();
    const undone = await durable(page, before.id, before.revisions.length + 2);
    expect(semanticSnapshot(undone)).toEqual(semanticSnapshot(before));
    expect(undone.revisions.slice(0, -1)).toEqual(changed.revisions);
    expect(undone.revisions.at(-1)!.after).toMatchObject({
      targetRevisionId: changed.revisions.at(-1)!.id,
    });
    await reopen(page, undone);
    await visibleReview(page, before, false);
    await expect(
      page.getByRole("article", { name: "意味項目 I1", exact: true }),
    ).toContainText(`主張：${OLD_ITEM_TEXT}`);
    const undoExport = await preview(page);
    expect(undoExport.reasoning).toEqual(before.reasoning);
    expect(undoExport.revisions).toEqual(undone.revisions);
    expect(external).toEqual([]);
  });
}

test("修正下書き・検証失敗・キャンセルは登録済み項目や保存履歴を変えない", async ({
  page,
}) => {
  const before = await open(page, await semanticItemCorrectionFixture());
  await nav(page, "問い・根拠");
  await page
    .getByRole("button", { name: "意味項目 I1 を修正", exact: true })
    .click();
  const form = page.getByRole("form", { name: "意味項目の編集" });
  await form.getByRole("textbox", { name: "内容", exact: true }).fill(" ");
  await form.getByLabel("登録理由", { exact: true }).fill("失敗する下書き");
  await form
    .getByRole("button", { name: "意味項目の修正を保存", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("item text required");
  await expect(form.getByLabel("登録理由", { exact: true })).toHaveValue(
    "失敗する下書き",
  );
  let message = "";
  page.once("dialog", async (dialog) => {
    message = dialog.message();
    await dialog.dismiss();
  });
  await nav(page, "振り返り");
  await expect.poll(() => message).toContain("下書き");
  await expect(form).toBeVisible();
  expect((await stored(page, before.id))!.revisions).toEqual(before.revisions);
  await form
    .getByRole("button", { name: "意味項目の修正をキャンセル", exact: true })
    .click();
  await expect(
    form.getByRole("textbox", { name: "内容", exact: true }),
  ).toHaveValue("");
  await nav(page, "振り返り");
  expect((await stored(page, before.id))!.reasoning).toEqual(before.reasoning);
  await nav(page, "問い・根拠");
  await page
    .getByRole("article", { name: "意味項目 I1", exact: true })
    .getByRole("button", { name: "発言 U02 の原文へ", exact: true })
    .click();
  const inspector = page.getByRole("complementary", {
    name: "選択した発言の詳細",
  });
  await expect(inspector).toContainText(
    before.utterances.find((u) => u.id === "U02")!.quote,
  );
});

test("排他的解釈の前提・結論には専用編集への境界を表示する", async ({
  page,
}) => {
  const fixture = createManualExclusivePair(
    await semanticItemCorrectionFixture(),
    "Q1-v1",
    [
      {
        name: "A",
        premiseText: "税込",
        conclusionText: "条件付き",
        evidenceIds: ["E1"],
      },
      {
        name: "B",
        premiseText: "税別",
        conclusionText: "未確定",
        evidenceIds: ["E2"],
      },
    ],
    "比較候補を登録",
  );
  const before = await open(page, fixture);
  await nav(page, "問い・根拠");
  for (const i of before.reasoning!.interpretations)
    for (const id of [...i.premiseItemIds, ...i.conclusionItemIds]) {
      const card = page.getByRole("article", {
        name: `意味項目 ${id}`,
        exact: true,
      });
      await expect(
        card.getByRole("button", {
          name: `意味項目 ${id} を修正`,
          exact: true,
        }),
      ).toBeDisabled();
      await expect(card).toContainText("解釈候補の専用編集");
    }
  await expect(
    page.getByRole("button", { name: "意味項目 I1 を修正", exact: true }),
  ).toBeEnabled();
  expect((await stored(page, before.id))!.reasoning).toEqual(before.reasoning);
});
