import { expect, test } from "@playwright/test";
import { createProject } from "../src/domain/project";
import { parseInputs } from "../src/input/parse";
import { splitUtterance } from "../src/domain/utterance-editing";
import { exportProject } from "../src/export/project";
import type { Project } from "../src/domain/types";

test("説明のないlineage old IDの完全JSONを拒否して現在の作業・元の保存版を保持する", async ({
  page,
}) => {
  const base = createProject(
    await parseInputs([
      {
        name: "history.txt",
        format: "txt",
        role: "conversation",
        text: "A: before after\nB: reply",
      },
    ]),
    "lineageを保持する現在作業",
    "unknown",
  );
  const p = splitUtterance(base, base.utterances[0].id, 6, "正規split");
  const valid = exportProject(p, "json", undefined, false);
  const malformed = JSON.parse(valid) as { project: Project };
  malformed.project.title = "開いてはいけないghost作業";
  malformed.project.lineage!.records[0].oldIds = ["ghost-old-id"];
  const all = () =>
    page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open("rontenseiri-projects-v1", 1);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      try {
        return await new Promise<Project[]>((resolve, reject) => {
          const tx = db.transaction("projects", "readonly");
          const r = tx.objectStore("projects").getAll();
          tx.oncomplete = () => resolve(r.result);
          tx.onerror = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    });
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "valid.json",
    mimeType: "application/json",
    buffer: Buffer.from(valid),
  });
  await expect(
    page.getByRole("status").filter({ hasText: "別コピーとして復元" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "この端末に保存", exact: true })
    .press("Enter");
  await expect(
    page.getByRole("status").filter({ hasText: "このブラウザに保存しました" }),
  ).toBeVisible();
  await expect.poll(async () => (await all()).length).toBe(1);
  const r1 = (await all())[0];
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.locator("input[type=file]").setInputFiles({
    name: "ghost.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(malformed)),
  });
  await expect(page.getByRole("alert")).toContainText("lineage history gap");
  await expect(page.locator(".project-breadcrumb")).toContainText(r1.title);
  await expect(page.locator(".project-breadcrumb")).not.toContainText(
    "開いてはいけないghost作業",
  );
  expect(await all()).toEqual([r1]);
});
