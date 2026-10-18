import { expect, test } from "@playwright/test";
import { manualRepairFixture } from "../tests/fixtures/manual-repair";
import { exportProject } from "../src/export/project";
import { enter, navigate } from "./helpers/keyboard-navigation";
import {
  armProjectReadGate,
  installProjectReadGate,
  projectReadGateState,
  releaseProjectReadGate,
} from "./helpers/project-read-gate";

for (const width of [1440, 390]) {
  test(`navigation readiness ${width}px: native project reload waits for the visible desktop/mobile entry`, async ({
    page,
  }, testInfo) => {
    await installProjectReadGate(page);
    await page.setViewportSize({ width, height: 980 });
    const fixture = await manualRepairFixture();
    await page.goto("/");
    await page.locator("input[type=file]").setInputFiles({
      name: "readiness.rontenseiri.json",
      mimeType: "application/json",
      buffer: Buffer.from(exportProject(fixture, "json", undefined, false)),
    });
    await expect(page.getByRole("status")).toContainText("別コピーとして復元");
    // Setup only. The navigation route under test remains keyboard-only.
    await page
      .getByRole("button", { name: "この端末に保存", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "このブラウザに保存しました",
    );
    const target = page.getByRole("button", {
      name: "問い・根拠",
      exact: true,
    });
    const menu = page.getByRole("button", { name: "メニュー", exact: true });
    const readStoredProjects = () =>
      page.evaluate(async () => {
        const path = "/src/storage/projects.ts";
        const { listProjects } = await import(path);
        return listProjects();
      });
    const persisted = await readStoredProjects();
    expect(persisted).toHaveLength(1);

    // Repeat the real reload/open cycle, not a synthetic replacement DOM.
    for (let cycle = 0; cycle < 2; cycle++) {
      await page.reload();
      const recent = page.locator("button.recent-open", {
        hasText: fixture.title,
      });
      await expect(recent).toBeVisible();
      await armProjectReadGate(page);
      await enter(page, recent);
      await expect
        .poll(() => projectReadGateState(page))
        .toMatchObject({ blocked: true, reads: 1 });
      await expect(target).not.toBeVisible();
      await expect(menu).not.toBeVisible();
      const wouldChooseHiddenMenu = !(await target.isVisible());
      expect(wouldChooseHiddenMenu).toBe(true);
      let finished = false;
      const navigation = navigate(page, "問い・根拠").then(() => {
        finished = true;
      });
      // An ordered browser round-trip while the native success is still held:
      // there is no layout delay or timeout relaxation used to manufacture readiness.
      const duringRead = await projectReadGateState(page);
      expect(duringRead.blocked).toBe(true);
      expect(finished).toBe(false);
      await releaseProjectReadGate(page);
      if (width === 1440) {
        await expect(target).toBeVisible();
        await expect(menu).not.toBeVisible();
      } else {
        await expect(menu).toBeVisible();
      }
      await navigation;
      await expect(
        page.getByRole("region", { name: "問い・根拠" }),
      ).toBeVisible();
      await expect(
        page.locator(
          'nav[aria-label="作業画面"] button[aria-label="問い・根拠"]',
        ),
      ).toHaveAttribute("aria-current", "page");
      const state = await page.evaluate(() => ({
        viewport: innerWidth,
        menuDisplay: getComputedStyle(
          document.querySelector("button.mobile-menu")!,
        ).display,
        workspaceMounted: !!document.querySelector(
          'nav[aria-label="作業画面"]',
        ),
      }));
      expect(state.workspaceMounted).toBe(true);
      expect(state.menuDisplay === "none").toBe(width === 1440);
      expect(await readStoredProjects()).toEqual(persisted);
      await testInfo.attach(
        `navigation-readiness-${width}-reload-${cycle}.json`,
        {
          body: JSON.stringify({
            width,
            cycle,
            wouldChooseHiddenMenu,
            duringRead,
            state,
          }),
          contentType: "application/json",
        },
      );
    }
  });
}
