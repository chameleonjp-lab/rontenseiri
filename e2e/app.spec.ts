import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function sample(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "サンプルを見てみる", exact: true })
    .click();
  await expect(page.locator('[data-id="U01"]')).toBeVisible();
}

test("home, fixed agenda fixture and no unsolicited external request", async ({
  page,
}) => {
  const failures: string[] = [];
  const external: string[] = [];
  page.on("pageerror", (e) => failures.push(e.message));
  page.on("request", (r) => {
    if (
      !r
        .url()
        .startsWith(
          new URL(test.info().project.use.baseURL as string).origin,
        ) &&
      !r.url().startsWith("data:")
    )
      external.push(r.url());
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "会話の流れを、 見えるかたちに。" }),
  ).toBeVisible();
  await page.screenshot({ path: "artifacts/home-desktop.png", fullPage: true });
  await page
    .getByRole("button", { name: "サンプルを見てみる", exact: true })
    .click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(9);
  await expect(page.locator('[data-id="U10"]')).toContainText("本筋へ復帰");
  expect(failures).toEqual([]);
  expect(external).toEqual([]);
});

test("collapse, pan, zoom and view switches preserve semantic positions", async ({
  page,
}) => {
  await sample(page);
  const positions = await page
    .locator(".react-flow__node-speech")
    .evaluateAll((nodes) =>
      Object.fromEntries(
        nodes.map((n) => [
          n.getAttribute("data-id"),
          (n as HTMLElement).style.transform,
        ]),
      ),
    );
  await page
    .getByRole("button", { name: "枝を折りたたむ", exact: true })
    .click();
  await expect(page.locator('[data-id="U03"]')).not.toBeVisible();
  await expect(
    page.getByText("3件の枝を折り畳み中 · 配置は保持"),
  ).toBeVisible();
  await page.getByRole("button", { name: "枝を開く", exact: true }).click();
  await expect(page.locator('[data-id="U03"]')).toBeVisible();
  const after = await page
    .locator(".react-flow__node-speech")
    .evaluateAll((nodes) =>
      Object.fromEntries(
        nodes.map((n) => [
          n.getAttribute("data-id"),
          (n as HTMLElement).style.transform,
        ]),
      ),
    );
  expect(after).toEqual(positions);
  const canvas = page.locator(".flow-container");
  await canvas.focus();
  const viewport = page.locator(".react-flow__viewport");
  const before = await viewport.getAttribute("style");
  await canvas.press("ArrowRight");
  await expect(viewport).not.toHaveAttribute("style", before!);
  await page.getByRole("button", { name: "振り返り", exact: true }).click();
  await page.getByRole("button", { name: "議題の流れ", exact: true }).click();
  await expect(viewport).not.toHaveAttribute("style", before!);
  const pan = await viewport.getAttribute("style");
  await page.getByRole("button", { name: "発言を検索", exact: true }).click();
  const input = page.getByRole("textbox", { name: "発言を検索", exact: true });
  await input.fill("U08");
  await input.press("ArrowLeft");
  await expect(viewport).toHaveAttribute("style", pan!);
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await expect(
    page.getByRole("complementary", { name: "選択した発言の詳細" }),
  ).toContainText("U08");
  await page.getByRole("button", { name: "詳細を閉じる", exact: true }).click();
  await page.getByRole("button", { name: "全体表示", exact: true }).click();
  await page.screenshot({
    path: "artifacts/canvas-desktop.png",
    fullPage: true,
  });
});

test("keyboard detail, classification, exact source revision and history", async ({
  page,
}) => {
  await sample(page);
  const node = page.getByRole("button", { name: /^U01 Aさん/ });
  await node.focus();
  await node.press("Enter");
  const details = page.getByRole("complementary", {
    name: "選択した発言の詳細",
  });
  await expect(details).toContainText("週1日の在宅勤務を試してみたいです。");
  await page.getByLabel("発言の分類", { exact: true }).selectOption("derived");
  await page
    .getByLabel("変更理由", { exact: true })
    .fill("テスト：読み取りの訂正");
  await page.getByRole("button", { name: "訂正を保存", exact: true }).click();
  await expect(page.locator('[data-id="U01"] .badge')).toHaveText("派生");
  await page.getByRole("button", { name: "発言・原文", exact: true }).click();
  await page
    .getByLabel("訂正後の原文", { exact: true })
    .fill("週1日の在宅勤務をまず1か月試してみたいです。");
  await page
    .getByLabel("変更理由", { exact: true })
    .fill("テスト：文字起こしを確認");
  await page.getByRole("button", { name: "訂正を保存", exact: true }).click();
  await expect(details.locator("blockquote")).toHaveText(
    "週1日の在宅勤務をまず1か月試してみたいです。",
  );
  await page.screenshot({
    path: "artifacts/source-inspector.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(details).not.toBeVisible();
  await expect(page.locator('[data-id="U01"] .speech-node')).toHaveClass(
    /is-selected/,
  );
  await page.getByRole("button", { name: "訂正履歴", exact: true }).click();
  await expect(page.locator(".history-list article")).toHaveCount(2);
  await expect(page.locator(".history-list")).toContainText("文字起こしを確認");
});

test("manual text input, extraction preview, summary editing and explicit save", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "新しく始める", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("作業名", { exact: true }).fill("E2E保存テスト");
  await dialog
    .getByLabel("文字起こし済みのテキスト", { exact: true })
    .fill("Aさん：試行したいです。\nBさん：条件を確認しましょう。");
  await page
    .getByRole("button", { name: "読み込みと抽出結果を確認", exact: true })
    .click();
  await expect(page.getByText("抽出確認：2件の発言候補")).toBeVisible();
  await page
    .getByRole("button", { name: "原文を確認して整理を始める", exact: true })
    .click();
  await page.getByRole("button", { name: "振り返り", exact: true }).click();
  await page.getByRole("button", { name: "まとめを編集", exact: true }).click();
  await page
    .getByLabel("次の一手", { exact: true })
    .fill("担当者に条件を確認する");
  await page
    .getByLabel("未決事項（1行に1つ）", { exact: true })
    .fill("開始日\n評価基準");
  await page
    .getByLabel("訂正理由", { exact: true })
    .fill("テスト：原文を確認した");
  await page
    .getByRole("button", { name: "確認した整理内容を保存", exact: true })
    .click();
  await expect(page.locator(".next-action")).toContainText(
    "担当者に条件を確認する",
  );
  await page
    .getByRole("button", { name: "この端末に保存", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "このブラウザに保存しました",
  );
  await page.reload();
  await page
    .locator(".recent-open")
    .filter({ hasText: "E2E保存テスト" })
    .click();
  await page.getByRole("button", { name: "振り返り", exact: true }).click();
  await expect(page.locator(".next-action")).toContainText(
    "担当者に条件を確認する",
  );
});

test("limited JSON preview excludes other agenda and restores to a new copy", async ({
  page,
}) => {
  await sample(page);
  await page.getByRole("button", { name: "出力", exact: true }).click();
  await page.getByLabel("出力範囲", { exact: true }).selectOption("議題01");
  await expect(
    page.getByRole("button", { name: "出力内容をプレビュー", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("checkbox", { name: "U01を出力に含める", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "U07を出力に含める", exact: true })
    .check();
  await page
    .getByRole("button", { name: "出力内容をプレビュー", exact: true })
    .click();
  const text = await page.locator(".export-preview").innerText();
  const parsed = JSON.parse(text);
  expect(parsed.project.utterances).toHaveLength(2);
  expect(text).not.toContain("日程はそれで合意です");
  const event = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "確認した内容をダウンロード", exact: true })
    .click();
  const dl = await event;
  const bytes = await readFile((await dl.path())!);
  expect(JSON.parse(bytes.toString()).scope).toBe("agenda");
});

test.describe("mobile touch emulation (not iPhone real-device certification)", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  test("same agenda can be reviewed vertically with next action first", async ({
    page,
  }) => {
    await sample(page);
    await page.getByRole("button", { name: "拡大", exact: true }).tap();
    await expect(page.getByText("96%", { exact: true })).toBeVisible();
    await touchPanCanvas(page);
    const hit = await nodeHitCenter(page, "U01");
    await page.touchscreen.tap(hit.x, hit.y);
    await expect(
      page.getByRole("complementary", { name: "選択した発言の詳細" }),
    ).toContainText("選択中：議題01 → U01");
    await page.getByRole("button", { name: "詳細を閉じる", exact: true }).tap();
    await page.getByRole("button", { name: "メニュー", exact: true }).tap();
    await page.getByRole("button", { name: "振り返り", exact: true }).tap();
    await expect(page.locator(".next-action")).toBeVisible();
    await expect(page.locator(".summary-agenda-head")).toContainText("議題01");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    expect(overflow).toBe(false);
    await page.screenshot({
      path: "artifacts/review-mobile.png",
      fullPage: true,
    });
    await page.locator(".summary-speech").first().tap();
    await expect(
      page.getByRole("complementary", { name: "選択した発言の詳細" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "詳細を閉じる", exact: true }).tap();
    await expect(page.locator(".next-action")).toBeVisible();
  });
});

test("A-B-A occurrences and membership-only correction can be undone without changing evidence", async ({
  page,
}) => {
  await sample(page);
  await page.getByRole("button", { name: "発言を検索", exact: true }).click();
  await page
    .getByRole("textbox", { name: "発言を検索", exact: true })
    .fill("U09");
  await page.getByRole("button", { name: "検索", exact: true }).click();
  const details = page.getByRole("complementary", {
    name: "選択した発言の詳細",
  });
  await details
    .getByText("議題の所属・境界を別に変更", { exact: true })
    .click();
  await details
    .getByLabel("所属先の議題", { exact: true })
    .selectOption("議題02");
  await details
    .getByLabel("所属・境界の変更理由", { exact: true })
    .fill("E2E：同じ議題への再登場を確認");
  await details
    .getByRole("button", { name: "この発言の所属先だけ変更", exact: true })
    .click();
  await expect(details).toContainText("選択中：議題02 → U09");
  await expect(details.locator("blockquote")).toHaveText(
    "育成制度の担当や研修の仕組みはどうしますか。",
  );
  await expect(page.locator(".react-flow__node-agenda")).toHaveCount(4);
  await expect(page.locator('[data-id="agenda-議題01@U10"]')).toContainText(
    "再登場",
  );
  await details
    .getByRole("button", { name: "選択した発言の図へ戻る", exact: true })
    .click();
  await expect(page.locator('[data-id="U09"] .speech-node')).toHaveClass(
    /is-selected/,
  );
  await page.getByRole("button", { name: "訂正履歴", exact: true }).click();
  await page
    .getByRole("button", { name: "直前の訂正を元に戻す", exact: true })
    .click();
  await page.getByRole("button", { name: "議題の流れ", exact: true }).click();
  await expect(page.locator(".react-flow__node-agenda")).toHaveCount(2);
});

test("folded branches are unavailable for limited export and dialog focus is trapped", async ({
  page,
}) => {
  await sample(page);
  await page
    .getByRole("button", { name: "枝を折りたたむ", exact: true })
    .click();
  await page.getByRole("button", { name: "出力", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("出力範囲", { exact: true }).selectOption("議題01");
  await expect(
    dialog.getByRole("checkbox", { name: "U08を出力に含める", exact: true }),
  ).toHaveCount(0);
  await expect(dialog).toContainText("折り畳み中の3件も対象外");
  await dialog
    .getByRole("checkbox", { name: "U01を出力に含める", exact: true })
    .check();
  await dialog
    .getByRole("button", { name: "出力内容をプレビュー", exact: true })
    .click();
  const text = await dialog.locator(".export-preview").innerText();
  expect(text).toContain("週1日の在宅勤務を試してみたいです。");
  expect(text).not.toContain("採用や育成の制度全体");
  const last = dialog.getByRole("button", {
    name: "確認した内容をダウンロード",
    exact: true,
  });
  await last.focus();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "ダイアログを閉じる", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});

test("pointer selection reaches nodes and agenda headers while blank space pans", async ({
  page,
}) => {
  await sample(page);
  await page.getByRole("button", { name: "全体表示", exact: true }).click();
  const node = page.getByRole("button", {
    name: "U08 Aさん 採用や育成の制度全体も考えたいですね。 詳細を開く",
    exact: true,
  });
  await node.click();
  await expect(
    page.getByRole("complementary", { name: "選択した発言の詳細" }),
  ).toContainText("U08");
  await page.getByRole("button", { name: "詳細を閉じる", exact: true }).click();
  await page
    .getByRole("button", {
      name: "議題02 次回会議の日程 議題を選択",
      exact: true,
    })
    .click();
  await expect(
    page.locator('[data-id="agenda-議題02"] .agenda-frame'),
  ).toHaveClass(/selected-agenda/);
  const flow = page.locator(".flow-container");
  const box = (await flow.boundingBox())!;
  const viewport = page.locator(".react-flow__viewport");
  const before = await viewport.getAttribute("style");
  await page.mouse.move(box.x + 25, box.y + 70);
  await page.mouse.down();
  await page.mouse.move(box.x + 105, box.y + 95, { steps: 8 });
  await page.mouse.up();
  await expect(viewport).not.toHaveAttribute("style", before!);
  await expect(
    page.getByRole("complementary", { name: "選択した発言の詳細" }),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "拡大", exact: true }).click();
  const hit = await nodeHitCenter(page, "U01");
  await page.mouse.click(hit.x, hit.y);
  await expect(
    page.getByRole("complementary", { name: "選択した発言の詳細" }),
  ).toContainText("選択中：議題01 → U01");
});

async function nodeHitCenter(
  page: import("@playwright/test").Page,
  id: string,
) {
  const node = page.getByRole("button", { name: new RegExp(`^${id} `) });
  await expect
    .poll(() =>
      node.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return (
          document
            .elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
            ?.closest("button") === el
        );
      }),
    )
    .toBe(true);
  const rect = (await node.boundingBox())!;
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}
async function touchPanCanvas(page: import("@playwright/test").Page) {
  const box = (await page.locator(".flow-container").boundingBox())!;
  const viewport = page.locator(".react-flow__viewport");
  const before = await viewport.getAttribute("style");
  const cdp = await page.context().newCDPSession(page);
  const x = box.x + 12,
    y = box.y + 40;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y }],
  });
  for (let i = 1; i <= 8; i++)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: x + i * 3, y: y + i * 2 }],
    });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await cdp.detach();
  await expect(viewport).not.toHaveAttribute("style", before!);
}
