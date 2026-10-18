import { expect, test, type Page } from "@playwright/test";
const sampleTitle = "在宅勤務の試行会議（架空サンプル）";
let observed: Record<string, unknown> = {};

async function openSample(page: Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "サンプルを見てみる", exact: true })
    .click();
  await expect(page.getByText(sampleTitle, { exact: true })).toBeVisible();
}

async function focusedState(page: Page) {
  return page.evaluate(() => {
    const element = document.activeElement as HTMLElement | null;
    const hiddenAncestor = element?.closest<HTMLElement>(
      '[aria-hidden="true"], [inert], [hidden]',
    );
    const style = element ? getComputedStyle(element) : null;
    const rects = element?.getClientRects().length ?? 0;
    return {
      tag: element?.tagName ?? null,
      id: element?.getAttribute("data-id") ?? null,
      ariaLabel: element?.getAttribute("aria-label") ?? null,
      flowNodeId:
        element?.closest<HTMLElement>(".react-flow__node")?.dataset.id ?? null,
      className: element?.className ?? null,
      body: element === document.body,
      hiddenAncestor: hiddenAncestor?.outerHTML.slice(0, 240) ?? null,
      inert: Boolean(hiddenAncestor?.closest("[inert]")),
      ariaHidden: Boolean(hiddenAncestor?.closest('[aria-hidden="true"]')),
      cssVisibility: style?.visibility ?? null,
      cssDisplay: style?.display ?? null,
      rects,
    };
  });
}

async function assertUsableFocus(page: Page, originalId: string) {
  await expect(
    page.getByRole("complementary", { name: "選択した発言の詳細" }),
  ).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.tagName))
    .not.toBe("BODY");
  const state = await focusedState(page);
  assertUsableFocusState(state, originalId);
  return state;
}

function assertUsableFocusState(
  state: Awaited<ReturnType<typeof focusedState>>,
  originalId: string,
) {
  expect(state.body, "closing details must not leave focus on BODY").toBe(
    false,
  );
  expect(
    state.hiddenAncestor,
    "focused element must not be in a hidden subtree",
  ).toBeNull();
  expect(state.inert, "focused element must not be in an inert subtree").toBe(
    false,
  );
  expect(state.ariaHidden, "focused element must not be aria-hidden").toBe(
    false,
  );
  expect(state.cssVisibility).not.toBe("hidden");
  expect(state.cssDisplay).not.toBe("none");
  expect(
    state.rects,
    "focused element must have a rendered box",
  ).toBeGreaterThan(0);
  const original =
    state.id === originalId || state.ariaLabel?.startsWith(`${originalId} `);
  const selectedAgenda = state.ariaLabel?.includes("議題を選択") ?? false;
  expect(
    original || selectedAgenda,
    "focus must recover to original node or selected agenda",
  ).toBe(true);
}

async function transcriptSelect(page: Page, id: string) {
  await page.getByRole("button", { name: "発言と原文", exact: true }).click();
  const row = page.locator("article", {
    has: page.getByText(id, { exact: true }),
  });
  await expect(row).toBeVisible();
  await row.locator("button.transcript-select").click();
  await expect(
    page.getByRole("complementary", { name: "選択した発言の詳細" }),
  ).toBeVisible();
}

async function collapse(page: Page) {
  await page.getByRole("button", { name: "議題の流れ", exact: true }).click();
  const collapseButton = page.getByRole("button", {
    name: "枝を折りたたむ",
    exact: true,
  });
  await expect(collapseButton).toBeVisible();
  await collapseButton.click();
  await expect(page.getByText(/件の枝を折り畳み中/)).toBeVisible();
}

test.afterEach(async ({}, testInfo) => {
  await testInfo.attach("focus-recovery-observation", {
    body: JSON.stringify(observed, null, 2),
    contentType: "application/json",
  });
  observed = {};
});

for (const exit of ["button", "escape"] as const)
  test(`折り畳み後に原文から開いた非表示ノードを${exit}で閉じてもBODYやhiddenへフォーカスしない`, async ({
    page,
  }) => {
    await openSample(page);
    await collapse(page);
    const hiddenNode = page.locator('[data-id="U03"]');
    await expect(hiddenNode).toHaveAttribute("aria-hidden", "true");
    await expect(hiddenNode).toHaveJSProperty("inert", true);
    await expect(hiddenNode.locator(".speech-hit")).toHaveCSS(
      "visibility",
      "hidden",
    );

    // U03 is a derived branch node: transcript remains a legal route to its Inspector
    // even while the graph branch is collapsed.
    await transcriptSelect(page, "U03");
    await page.getByRole("button", { name: "議題の流れ", exact: true }).click();
    await expect(
      page.getByRole("complementary", { name: "選択した発言の詳細" }),
    ).toBeVisible();
    if (exit === "button")
      await page
        .getByRole("button", { name: "詳細を閉じる", exact: true })
        .click();
    else {
      await page
        .getByRole("button", { name: "詳細を閉じる", exact: true })
        .focus();
      await page.keyboard.press("Escape");
    }

    const originalVisibleAfterCollapse = await page
      .locator('[data-id="U03"]')
      .isVisible()
      .catch(() => false);
    const focus = await assertUsableFocus(page, "U03");
    expect(originalVisibleAfterCollapse).toBe(false);
    expect(focus.flowNodeId).toBe("agenda-議題01");
    observed = {
      result: "focus-recovery-assertion",
      originalId: "U03",
      originalVisibleAfterCollapse,
      focus,
    };
  });

test("折り畳みなしの表示中ノードはEscapeと閉じるボタンの両方で元ノードへ戻る", async ({
  page,
}) => {
  await openSample(page);
  await page.getByRole("button", { name: "議題の流れ", exact: true }).click();

  await page.locator('[data-id="U01"] .speech-hit').click();
  await expect(
    page.getByRole("complementary", { name: "選択した発言の詳細" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  const escapeFocus = await assertUsableFocus(page, "U01");
  await expect(page.locator('[data-id="U01"] .speech-hit')).toBeFocused();

  await page.locator('[data-id="U01"] .speech-hit').click();
  await expect(
    page.getByRole("complementary", { name: "選択した発言の詳細" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "詳細を閉じる", exact: true }).click();
  const buttonFocus = await assertUsableFocus(page, "U01");
  await expect(page.locator('[data-id="U01"] .speech-hit')).toBeFocused();

  observed = {
    result: "positive-control",
    originalId: "U01",
    escapeFocus,
    buttonFocus,
  };
});
