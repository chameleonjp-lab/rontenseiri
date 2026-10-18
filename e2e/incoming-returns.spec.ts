import { expect, test, type Page } from "@playwright/test";
import { incomingReturnsFixture } from "../tests/fixtures/incoming-returns";
import { exportProject } from "../src/export/project";
import type { Project } from "../src/domain/types";

async function openFixture(page: Page) {
  const project = incomingReturnsFixture();
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "incoming.json",
    mimeType: "application/json",
    buffer: Buffer.from(exportProject(project, "json", undefined, false)),
  });
  const hit = page.locator('[data-id="U10"] .speech-hit');
  await hit.focus();
  await hit.press("Enter");
  const panel = page.getByRole("complementary", { name: "選択した発言の詳細" });
  await expect(panel).toBeVisible();
  return { project, panel };
}

async function stored(page: Page, title: string) {
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
          .getAll();
        request.onsuccess = () =>
          resolve(
            (request.result as Project[]).find((p) => p.title === wanted) ??
              null,
          );
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }, title);
}

async function save(page: Page) {
  await page
    .getByRole("button", { name: "この端末に保存", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "このブラウザに保存しました",
  );
}

test("複数のincoming復帰線は始点と全根拠を説明し、全解除は対象だけ、UndoはID・順序・根拠まで復元", async ({
  page,
}) => {
  const { project, panel } = await openFixture(page);
  const incoming = project.relations.filter(
    (r) => r.kind === "return" && r.to === "U10",
  );
  expect(incoming).toHaveLength(2);
  const explanation = panel.getByRole("region", { name: "この発言への復帰線" });
  await expect(explanation).toBeVisible();
  const preserved = project.relations.filter(
    (r) =>
      r.kind === "return" &&
      r.to !== "U10" &&
      incoming.some((edge) => edge.from === r.from),
  );
  expect(preserved).toHaveLength(1);
  await expect(explanation).toContainText(
    "解除対象外・同じ始点から別の復帰先への線は保持",
  );
  for (const relation of [...incoming, ...preserved]) {
    await expect(explanation).toContainText(
      `${relation.from} → ${relation.to}`,
    );
    await expect(explanation).toContainText(`関係ID：${relation.id}`);
    for (const id of relation.evidenceIds) {
      await expect(explanation).toContainText(
        `根拠 ${id}：「${project.utterances.find((u) => u.id === id)!.quote}」`,
      );
    }
  }
  await panel.getByLabel("発言の分類").selectOption("derived");
  await expect(
    panel.getByRole("group", { name: "この発言を復帰先から分類変更します" }),
  ).toContainText("上記2件すべて");
  await panel
    .getByLabel("変更理由", { exact: true })
    .fill("複数の復帰線だけを解除");
  await panel.getByRole("button", { name: "訂正を保存", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("線を残すか外すか");
  await expect(explanation).toBeVisible();
  await panel.getByLabel("線を外して未確定", { exact: true }).check();
  await panel.getByRole("button", { name: "訂正を保存", exact: true }).click();
  await expect(explanation).toHaveCount(0);
  await save(page);
  const remaining = project.relations.filter(
    (r) => !(r.kind === "return" && r.to === "U10"),
  );
  await expect
    .poll(async () => (await stored(page, project.title))?.relations)
    .toEqual(remaining);
  const changed = (await stored(page, project.title))!;
  expect(changed.revisions).toHaveLength(project.revisions.length + 1);
  for (const from of new Set(incoming.map((r) => r.from))) {
    expect(changed.utterances.find((u) => u.id === from)?.returnStatus).toBe(
      "unknown",
    );
  }
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "訂正履歴", exact: true }).click();
  await page
    .getByRole("button", { name: "直前の訂正を元に戻す", exact: true })
    .click();
  await expect
    .poll(async () => (await stored(page, project.title))?.relations)
    .toEqual(project.relations);
  const restored = (await stored(page, project.title))!;
  expect(restored.utterances).toEqual(project.utterances);
  expect(restored.agendas).toEqual(project.agendas);
  await page.reload();
  await page.locator(".recent-open").filter({ hasText: project.title }).click();
  await expect(page.locator('[data-id="U10"]')).toBeAttached();
  expect((await stored(page, project.title))?.relations).toEqual(
    project.relations,
  );
});

test("複数incomingの保持選択は全edgeのID・順序・根拠を変えない", async ({
  page,
}) => {
  const { project, panel } = await openFixture(page);
  await panel.getByLabel("発言の分類").selectOption("derived");
  await panel.getByLabel("線を残して要確認", { exact: true }).check();
  await panel
    .getByLabel("変更理由", { exact: true })
    .fill("全復帰線を保持して再確認");
  await panel.getByRole("button", { name: "訂正を保存", exact: true }).click();
  await expect(
    panel.getByRole("region", { name: "この発言への復帰線" }),
  ).toBeVisible();
  await save(page);
  await expect
    .poll(async () => (await stored(page, project.title))?.relations)
    .toEqual(project.relations);
});
