import { test, expect } from "@playwright/test";
import { sampleProject } from "../src/analysis/sample";

test("枝DOMは保持しつつ視覚・AX・focusから除外し、同じ要素と配置で再展開する", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "サンプルを見てみる", exact: true })
    .click();
  const fixture = sampleProject();
  const branches = fixture.utterances.filter(
    (u) => u.classification === "derived" || u.classification === "drift",
  );
  expect(branches.length).toBeGreaterThan(0);
  const branch = branches[0];
  const node = page.locator(`[data-id="${branch.id}"].react-flow__node`);
  const hit = node.locator(".speech-hit");
  const original = await hit.elementHandle();
  await hit.press("Enter");
  await expect(page.locator(".inspector")).toContainText(branch.id);
  const transform = await node.evaluate(
    (el) => (el as HTMLElement).style.transform,
  );
  const count = await page.locator(".speech-node").count();
  await page
    .getByRole("button", { name: "枝を折りたたむ", exact: true })
    .click();
  await expect(node).toHaveAttribute("aria-hidden", "true");
  await expect(node).toHaveJSProperty("inert", true);
  await expect(node).toHaveCSS("visibility", "hidden");
  await expect(hit).toBeHidden();
  await expect(
    page.getByRole("button", { name: new RegExp(`^${branch.id} `) }),
  ).toHaveCount(0);
  expect(
    await hit.evaluate((el) => {
      el.focus();
      return document.activeElement === el;
    }),
  ).toBe(false);
  await expect(page.locator(".speech-node")).toHaveCount(count);
  const hiddenIds = new Set(branches.map((u) => u.id));
  const hiddenEdges = fixture.relations
    .filter(
      (r) => r.kind !== "main" || hiddenIds.has(r.from) || hiddenIds.has(r.to),
    )
    .map((r) => r.id)
    .sort();
  const retainedEdges = page.locator(".react-flow__edge.view-collapsed");
  await expect(retainedEdges).toHaveCount(hiddenEdges.length);
  expect(
    await retainedEdges.evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-id")).sort(),
    ),
  ).toEqual(hiddenEdges);
  for (const edge of await retainedEdges.all()) {
    await expect(edge).toHaveCSS("visibility", "hidden");
    await expect(edge).toHaveAttribute("aria-hidden", "true");
  }
  const visibleIds = await page
    .locator('.react-flow__node:not([aria-hidden="true"]) .speech-hit')
    .evaluateAll((els) =>
      els
        .map((el) => el.closest<HTMLElement>(".react-flow__node")!.dataset.id!)
        .sort(),
    );
  expect(visibleIds).toEqual(
    fixture.utterances
      .filter((u) => !branches.some((b) => b.id === u.id))
      .map((u) => u.id)
      .sort(),
  );
  await page.getByRole("button", { name: "枝を開く", exact: true }).focus();
  for (const key of ["Tab", "Shift+Tab"]) {
    for (let i = 0; i < 24; i++) {
      await page.keyboard.press(key);
      expect(
        await page.evaluate(
          () =>
            document.activeElement?.closest(
              '[inert], [aria-hidden="true"].react-flow__node',
            ) !== null,
        ),
      ).toBe(false);
    }
  }
  const canvas = page.locator(".flow-container");
  await canvas.focus();
  const before = await page
    .locator(".react-flow__viewport")
    .getAttribute("style");
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".react-flow__viewport")).not.toHaveAttribute(
    "style",
    before!,
  );
  const zoom = await page.getByLabel("表示倍率", { exact: true }).textContent();
  await page.keyboard.press("+");
  await expect(page.getByLabel("表示倍率", { exact: true })).not.toHaveText(
    zoom!,
  );
  await page.getByRole("button", { name: "枝を開く", exact: true }).click();
  await expect(node).not.toHaveAttribute("aria-hidden", "true");
  await expect(node).toHaveJSProperty("inert", false);
  await expect(hit).toBeVisible();
  expect(
    await original!.evaluate(
      (el, id) =>
        el === document.querySelector(`[data-id="${id}"] .speech-hit`),
      branch.id,
    ),
  ).toBe(true);
  expect(await node.evaluate((el) => (el as HTMLElement).style.transform)).toBe(
    transform,
  );
  await page
    .getByRole("button", { name: "枝を折りたたむ", exact: true })
    .click();
  await expect(hit).toBeHidden();
  await page
    .getByRole("button", { name: "選択ノードへ戻る", exact: true })
    .click();
  await expect(node).not.toHaveAttribute("aria-hidden", "true");
  await expect(hit).toBeVisible();
  await expect(hit).toBeInViewport({ ratio: 0.99 });
  await expect(page.locator(".inspector")).toContainText(branch.id);
});
