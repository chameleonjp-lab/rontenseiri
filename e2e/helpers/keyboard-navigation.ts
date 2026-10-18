import { expect, type Locator, type Page } from "@playwright/test";

// These helpers deliberately retain the keyboard-only interaction contract.
export async function tabTo(page: Page, target: Locator) {
  for (let i = 0; i < 220; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(
    `Keyboard could not reach ${(await target.getAttribute("aria-label")) || (await target.textContent())}`,
  );
}
export async function enter(page: Page, target: Locator) {
  await tabTo(page, target);
  await page.keyboard.press("Enter");
}
export async function navigate(page: Page, name: string) {
  const target = page.getByRole("button", { name, exact: true });
  const menu = page.getByRole("button", { name: "メニュー", exact: true });
  // A project reload can temporarily show neither control. That is NOT the
  // mobile state. Wait for a real visible entry before selecting the route:
  // desktop/open sidebar -> target; closed mobile sidebar -> menu.
  // filter(visible) also avoids choosing the desktop-hidden menu by DOM order.
  await expect(target.or(menu).filter({ visible: true }).first()).toBeVisible();
  if (!(await target.isVisible())) await enter(page, menu);
  await enter(page, target);
}
