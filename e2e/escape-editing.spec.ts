import { expect, test, type Page } from "@playwright/test";

async function openInspector(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "サンプルを見てみる", exact: true })
    .click();
  const node = page.locator('[data-id="U01"] .speech-hit');
  await node.focus();
  await node.press("Enter");
  const panel = page.getByRole("complementary", { name: "選択した発言の詳細" });
  await expect(panel).toBeVisible();
  return { node, panel };
}

test("Escape in a text input retains the inspector draft; explicit exit restores node focus", async ({
  page,
}) => {
  const { node, panel } = await openInspector(page);
  const speaker = panel.getByLabel("話者", { exact: true });
  await speaker.fill("未保存の話者");
  await panel.getByLabel("変更理由", { exact: true }).fill("未保存の理由");
  await speaker.press("Escape");
  await expect(panel).toBeVisible();
  await expect(speaker).toBeFocused();
  await expect(speaker).toHaveValue("未保存の話者");
  await expect(panel.getByLabel("変更理由", { exact: true })).toHaveValue(
    "未保存の理由",
  );
  const close = panel.getByRole("button", {
    name: "詳細を閉じる",
    exact: true,
  });
  await close.focus();
  await close.press("Escape");
  await expect(panel).toBeHidden();
  await expect(node).toBeFocused();
});

test("Escape in the source textarea does not discard the unsaved quotation", async ({
  page,
}) => {
  const { panel } = await openInspector(page);
  await panel.getByRole("button", { name: "発言・原文", exact: true }).click();
  const quote = panel.getByLabel("訂正後の原文", { exact: true });
  await quote.fill("原文訂正の未保存ドラフト");
  await quote.press("Escape");
  await expect(panel).toBeVisible();
  await expect(quote).toBeFocused();
  await expect(quote).toHaveValue("原文訂正の未保存ドラフト");
});

test("IME composition and already-consumed Escape do not close details", async ({
  page,
}) => {
  const { node, panel } = await openInspector(page);
  const close = panel.getByRole("button", {
    name: "詳細を閉じる",
    exact: true,
  });
  await close.focus();
  await close.evaluate((target) =>
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
        isComposing: true,
      }),
    ),
  );
  await expect(panel).toBeVisible();
  await close.evaluate((target) => {
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    event.preventDefault();
    target.dispatchEvent(event);
  });
  await expect(panel).toBeVisible();
  await close.press("Escape");
  await expect(panel).toBeHidden();
  await expect(node).toBeFocused();
});
