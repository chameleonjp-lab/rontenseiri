import { expect, test, type Page } from "@playwright/test";

async function backgroundState(page: Page) {
  return page.locator(".app-shell > :not(.toast)").evaluateAll((elements) =>
    elements
      .filter((el) => !el.querySelector('[role="dialog"]'))
      .map((el) => ({
        tag: el.tagName,
        className: el.className,
        inert: (el as HTMLElement).inert,
        ariaHidden: el.getAttribute("aria-hidden"),
      })),
  );
}

for (const exit of ["button", "escape"] as const) {
  test(`modal ${exit} preserves prior inert and aria-hidden background states across reopen`, async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByRole("button", { name: "サンプルを見てみる", exact: true })
      .click();
    const opener = page.getByRole("button", { name: "出力", exact: true });
    await expect(opener).toBeVisible();
    await page.locator(".workspace").evaluate((el) => {
      (el as HTMLElement).inert = true;
      el.setAttribute("aria-hidden", "true");
    });
    await page.locator(".app-header").evaluate((el) => {
      el.setAttribute("aria-hidden", "false");
    });
    const before = await backgroundState(page);
    expect(before.some((el) => el.inert && el.ariaHidden === "true")).toBe(
      true,
    );
    expect(before.some((el) => !el.inert && el.ariaHidden === "false")).toBe(
      true,
    );
    for (let cycle = 0; cycle < 2; cycle++) {
      await opener.click();
      const dialog = page.getByRole("dialog", {
        name: "資料を出力する",
        exact: true,
      });
      await expect(dialog).toBeVisible();
      await expect
        .poll(async () => (await backgroundState(page)).every((el) => el.inert))
        .toBe(true);
      const close = dialog.getByRole("button", {
        name: "ダイアログを閉じる",
        exact: true,
      });
      if (exit === "button") await close.click();
      else {
        await close.focus();
        await page.keyboard.press("Escape");
      }
      await expect(dialog).toBeHidden();
      await expect.poll(() => backgroundState(page)).toEqual(before);
      await expect(opener).toBeFocused();
    }
  });
}
