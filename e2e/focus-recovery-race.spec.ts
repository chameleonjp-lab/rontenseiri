import { expect, test } from "@playwright/test";

test("delayed detail-close focus recovery must not steal a newer keyboard navigation target", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "サンプルを見てみる", exact: true })
    .press("Enter");
  await page.locator('[data-id="U01"] .speech-hit').press("Enter");
  const panel = page.getByRole("complementary", { name: "選択した発言の詳細" });
  const close = panel.getByRole("button", {
    name: "詳細を閉じる",
    exact: true,
  });
  // Let selection's own focus transfer finish before controlling close's frame.
  await expect(close).toBeFocused();
  await page.evaluate(() => {
    const original = window.requestAnimationFrame;
    const state = window as Window & {
      __closeRecoveryFrame?: FrameRequestCallback;
    };
    window.requestAnimationFrame = (callback) => {
      window.requestAnimationFrame = original;
      state.__closeRecoveryFrame = callback;
      return 0;
    };
  });
  await close.press("Escape");
  await expect(panel).toBeHidden();
  const history = page.getByRole("button", { name: "訂正履歴", exact: true });
  await history.focus();
  await expect(history).toBeFocused();
  // Deliver the pending frame between focus and Enter: no sleeps or wider timeout.
  await page.evaluate(() => {
    const state = window as Window & {
      __closeRecoveryFrame?: FrameRequestCallback;
    };
    const callback = state.__closeRecoveryFrame;
    if (!callback)
      throw new Error("detail-close recovery frame was not captured");
    delete state.__closeRecoveryFrame;
    callback(performance.now());
  });
  await expect(history).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "直前の訂正を元に戻す", exact: true }),
  ).toBeVisible();
  await expect(panel).toBeHidden();
});
