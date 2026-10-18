import { expect, test } from "@playwright/test";

test("fold, search, limited export and re-expand preserve scope and node identity", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "サンプルを見てみる", exact: true })
    .click();
  const hit = page.locator('[data-id="U08"] .speech-hit');
  const before = await hit.evaluate(
    (node) => node.closest<HTMLElement>(".react-flow__node")!.style.transform,
  );
  await page
    .getByRole("button", { name: "枝を折りたたむ", exact: true })
    .click();
  await expect(hit).toBeHidden();
  await page.getByRole("button", { name: "発言を検索", exact: true }).click();
  const search = page
    .locator(".canvas-search")
    .getByRole("textbox", { name: "発言を検索", exact: true });
  await search.fill("U08");
  await search.press("Enter");
  await expect(hit).toBeVisible();
  await expect(page.locator('[data-id="U08"] .speech-node')).toHaveClass(
    /is-selected/,
  );
  await expect(
    page.getByRole("button", { name: "枝を折りたたむ", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "出力", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("出力範囲", { exact: true }).selectOption("議題01");
  await dialog
    .getByRole("checkbox", { name: "U08を出力に含める", exact: true })
    .check();
  await dialog
    .getByRole("button", { name: "出力内容をプレビュー", exact: true })
    .click();
  const first = JSON.parse(await dialog.locator(".export-preview").innerText());
  expect(first.manifest.allowedUtteranceIds).toEqual(["U08"]);
  expect(first.project.utterances.map((u: { id: string }) => u.id)).toEqual([
    "U08",
  ]);
  expect(first.project.sources[0].text).toBe(first.project.utterances[0].quote);
  expect(first.project.reasoning).toBeUndefined();
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "枝を折りたたむ", exact: true })
    .click();
  await page.getByRole("button", { name: "出力", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("出力範囲", { exact: true }).selectOption("議題01");
  await expect(
    dialog.getByRole("checkbox", { name: "U08を出力に含める", exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByRole("checkbox", { name: "U01を出力に含める", exact: true })
    .check();
  await dialog
    .getByRole("button", { name: "出力内容をプレビュー", exact: true })
    .click();
  const second = JSON.parse(
    await dialog.locator(".export-preview").innerText(),
  );
  expect(second.manifest.allowedUtteranceIds).toEqual(["U01"]);
  expect(JSON.stringify(second)).not.toContain(
    first.project.utterances[0].quote,
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "枝を開く", exact: true }).click();
  await expect(hit).toBeVisible();
  expect(
    await hit.evaluate(
      (node) => node.closest<HTMLElement>(".react-flow__node")!.style.transform,
    ),
  ).toBe(before);
  await expect(
    page.locator('.react-flow__node:not([aria-hidden="true"]) .speech-node'),
  ).toHaveCount(8);
  expect(
    await page
      .locator('.react-flow__node:not([aria-hidden="true"]) .speech-hit')
      .evaluateAll((nodes) =>
        nodes
          .map(
            (node) =>
              node.closest<HTMLElement>(".react-flow__node")!.dataset.id,
          )
          .sort(),
      ),
  ).toEqual(["U01", "U03", "U07", "U08", "U09", "U10", "U13", "U16"]);
});
