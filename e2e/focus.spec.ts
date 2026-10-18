import { expect, test, type Page } from "@playwright/test";

async function openSample(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "サンプルを見てみる", exact: true })
    .click();
  await expect(page.locator('[data-id="U01"]')).toBeVisible();
}

async function openDetail(page: Page, id: string) {
  const hit = page.locator(`[data-id="${id}"] .speech-hit`);
  await hit.focus();
  await hit.press("Enter");
  const panel = page.getByRole("complementary", { name: "選択した発言の詳細" });
  await expect(panel).toBeVisible();
  return { hit, panel };
}

async function expectFocusedInsideGraph(page: Page, id: string) {
  await expect(page.locator(`[data-id="${id}"] .speech-hit`)).toBeFocused();
  const inside = await page
    .locator(`[data-id="${id}"] .speech-hit`)
    .evaluate((node) => {
      const n = node.getBoundingClientRect();
      const g = node.closest(".flow-container")!.getBoundingClientRect();
      return (
        n.left >= g.left &&
        n.right <= g.right &&
        n.top >= g.top &&
        n.bottom <= g.bottom
      );
    });
  expect(inside).toBe(true);
}

test("U01をEnterで詳細化し、詳細を閉じると元のnode buttonへfocusを戻す", async ({
  page,
}) => {
  await openSample(page);
  const { hit, panel } = await openDetail(page, "U01");
  await panel
    .getByRole("button", { name: "詳細を閉じる", exact: true })
    .click();
  await expect(panel).toBeHidden();
  await expect(hit).toBeFocused();
});

test("図へ戻るはパン後もU01をfitViewしてfocusし、発言一覧と議題の流れを往復できる", async ({
  page,
}) => {
  await openSample(page);
  const graph = page.locator(".flow-container");
  const first = await openDetail(page, "U01");
  await first.panel
    .getByRole("button", { name: "選択した発言の図へ戻る", exact: true })
    .click();
  await expectFocusedInsideGraph(page, "U01");

  const box = await graph.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width - 5, box!.y + box!.height - 5, {
    steps: 5,
  });
  await page.mouse.up();
  await page.getByRole("button", { name: "発言と原文", exact: true }).click();
  await page.getByRole("button", { name: /U01/ }).first().click();
  const fromTranscript = page.getByRole("complementary", {
    name: "選択した発言の詳細",
  });
  await fromTranscript
    .getByRole("button", { name: "選択した発言の図へ戻る", exact: true })
    .click();
  await expectFocusedInsideGraph(page, "U01");

  await page.getByRole("button", { name: "発言と原文", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "発言から、確かめる。" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "議題の流れ", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "議題の流れ", exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-id="U01"] .speech-hit')).toBeVisible();
});
