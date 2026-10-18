import { expect, test, type Page } from "@playwright/test";
import { exportProject, importProject } from "../src/export/project";
import type { Project } from "../src/domain/types";

async function rows(page: Page): Promise<Project[]> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("rontenseiri-projects-v1", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise<Project[]>((resolve, reject) => {
        const tx = db.transaction("projects", "readonly");
        const request = tx.objectStore("projects").getAll();
        let result: Project[] = [];
        request.onsuccess = () => (result = request.result);
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  });
}

async function save(page: Page) {
  await page
    .getByRole("button", { name: "この端末に保存", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "このブラウザに保存しました" }),
  ).toBeVisible();
}

test("読み込み前の欠落申告を保存し、JSON境界とUndoで状態を保つ", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新しく始める", exact: true }).click();
  const input = page.getByRole("group", { name: "読み込み前の欠落申告" });
  await page.getByLabel("作業名").fill("読み込み前欠落テスト");
  await page
    .getByLabel("文字起こし済みのテキスト")
    .fill("Aさん：確認します。\nBさん：お願いします。");
  await input
    .getByRole("button", { name: "欠落申告を追加", exact: true })
    .click();
  await input.getByLabel("欠落申告1の内容").fill("冒頭の背景説明");
  await input.getByLabel("欠落申告1の理由").fill("入力資料に含まれていない");
  await input.getByLabel("欠落申告1の位置").fill("会議開始前");
  await input
    .getByRole("button", { name: "欠落申告を追加", exact: true })
    .click();
  await input.getByLabel("欠落申告2の内容").fill("決定後の補足");
  await input.getByLabel("欠落申告2の理由").fill("別資料のみで共有された");
  await input.getByLabel("欠落申告2の位置").fill("末尾");
  await page
    .getByRole("button", { name: "読み込みと抽出結果を確認", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "原文を確認して整理を始める",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "原文を確認して整理を始める", exact: true })
    .click();
  await save(page);
  await expect.poll(async () => (await rows(page)).length).toBe(1);
  const saved = (await rows(page))[0];
  expect(saved.omissions).toEqual([
    {
      id: expect.any(String),
      description: "冒頭の背景説明",
      reason: "入力資料に含まれていない",
      location: "会議開始前",
    },
    {
      id: expect.any(String),
      description: "決定後の補足",
      reason: "別資料のみで共有された",
      location: "末尾",
    },
  ]);
  const restored = importProject(exportProject(saved, "json"));
  expect(restored.omissions).toEqual(saved.omissions);
  expect(restored.extent).toBe(saved.extent);
  expect(restored.sources).toEqual(saved.sources);
  expect(restored.utterances).toEqual(saved.utterances);
  expect(restored.revisions).toEqual(saved.revisions);
  const limited = exportProject(saved, "json", saved.agendas[0].id, false, [
    saved.agendas[0].utteranceIds[0],
  ]);
  expect(limited).not.toContain("冒頭の背景説明");
  expect(limited).not.toContain("入力資料に含まれていない");
  await page
    .getByRole("button", { name: "訂正履歴", exact: true })
    .press("Enter");
  await page
    .getByRole("button", { name: "直前の訂正を元に戻す", exact: true })
    .press("Enter");
  await expect
    .poll(async () => (await rows(page))[0]?.omissions)
    .toBeUndefined();
  expect((await rows(page))[0].extent).toBe(saved.extent);

  await page.getByRole("button", { name: "原文対応", exact: true }).click();
  const editor = page.getByRole("region", { name: "記録範囲と欠落申告" });
  await editor
    .getByRole("button", { name: "欠落申告を追加", exact: true })
    .click();
  await editor
    .getByRole("button", { name: "この申告を削除", exact: true })
    .click();
  await expect(editor.getByRole("status")).toContainText(
    "報告された項目はありません",
  );
  await editor
    .getByRole("button", { name: "未申告に戻す", exact: true })
    .click();
  await expect(editor.getByRole("status")).toContainText("未申告");
});

for (const state of [
  "unreported",
  "reported-empty",
  "reset-unreported",
] as const) {
  test(`読み込み前の${state}を空申告と混同せず引き渡す`, async ({ page }) => {
    await page.goto("/");
    await page
      .getByRole("button", { name: "新しく始める", exact: true })
      .click();
    const input = page.getByRole("group", { name: "読み込み前の欠落申告" });
    await page.getByLabel("作業名", { exact: true }).fill(`P1-${state}`);
    await page
      .getByLabel("文字起こし済みのテキスト", { exact: true })
      .fill("A：短い入力です。");
    if (state !== "unreported") {
      await input
        .getByRole("button", { name: "欠落申告を追加", exact: true })
        .click();
      await input
        .getByRole("button", { name: "この申告を削除", exact: true })
        .click();
      if (state === "reset-unreported")
        await input
          .getByRole("button", { name: "未申告に戻す", exact: true })
          .click();
    }
    await page
      .getByRole("button", { name: "読み込みと抽出結果を確認", exact: true })
      .click();
    await page
      .getByRole("button", { name: "原文を確認して整理を始める", exact: true })
      .click();
    await save(page);
    await expect.poll(async () => (await rows(page)).length).toBe(1);
    const saved = (await rows(page))[0];
    if (state === "reported-empty") {
      expect(saved.omissions).toEqual([]);
      expect(Object.hasOwn(saved, "omissions")).toBe(true);
      expect(saved.revisions.at(-1)?.kind).toBe("project-completeness");
    } else {
      expect(Object.hasOwn(saved, "omissions")).toBe(false);
      expect(saved.revisions).toEqual([]);
    }
    const json = exportProject(saved, "json", undefined, false);
    const restored = importProject(json);
    expect(Object.hasOwn(restored, "omissions")).toBe(
      state === "reported-empty",
    );
    expect(restored.omissions).toEqual(saved.omissions);
  });
}
