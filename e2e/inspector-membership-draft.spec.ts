import { expect, test } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const evidenceDir = "/workspace/rontenseiri-evidence/review-758b1db";
const evidencePath = `${evidenceDir}/inspector-membership-repro.json`;
const cases: Array<Record<string, unknown>> = [];
let observed: Record<string, unknown> = {};

async function sample(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "サンプルを見てみる", exact: true })
    .click();
  await expect(page.locator('[data-id="U01"]')).toBeVisible();
}

async function openU01(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: /^U01 / }).click();
  return page.getByRole("complementary", { name: "選択した発言の詳細" });
}

async function moveU01ToAnotherAgenda(
  details: import("@playwright/test").Locator,
) {
  await details
    .getByText("議題の所属・境界を別に変更", { exact: true })
    .click();
  const target = details.getByLabel("所属先の議題", { exact: true });
  const current = await target.inputValue();
  const options = await target.locator("option").evaluateAll((els) =>
    els.map((el) => ({
      value: (el as HTMLOptionElement).value,
      label: el.textContent,
    })),
  );
  const destination = options.find((option) => option.value !== current);
  expect(destination, "sample must contain a second agenda").toBeTruthy();
  await target.selectOption(destination!.value);
  const boundaryReason = "membership draft repro: move U01";
  await details
    .getByLabel("所属・境界の変更理由", { exact: true })
    .fill(boundaryReason);
  await details
    .getByRole("button", { name: "この発言の所属先だけ変更", exact: true })
    .click();
  await expect(details.locator(".agenda-mini strong")).toContainText(
    destination!.value,
  );
  return { from: current, to: destination!.value, boundaryReason };
}

test.afterEach(async ({}, testInfo) => {
  const completedCase = {
    ...observed,
    name: testInfo.title,
    status: testInfo.status,
    expectedStatus: testInfo.expectedStatus,
    errors: testInfo.errors.map((error) => error.message),
  };
  let priorCases: Array<Record<string, unknown>> = [];
  try {
    priorCases = JSON.parse(await readFile(evidencePath, "utf8")).cases ?? [];
  } catch {
    // The first test in a run creates the evidence file.
  }
  const mergedCases = [
    ...priorCases.filter((entry) => entry.name !== completedCase.name),
    completedCase,
  ];
  cases.splice(0, cases.length, ...mergedCases);
  observed = {};
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(
    evidencePath,
    JSON.stringify(
      {
        repoHead: "758b1db0160064504180cb04526ac1fb05791923",
        scope: "e2e/inspector-membership-draft.spec.ts",
        hypothesis:
          "Inspector同期effectがagenda membership変化で別欄unsaved draftを消す",
        sourceChanged: false,
        cases,
        note: "membership action UIを使用。所属・境界の変更理由は別labelで入力。",
      },
      null,
      2,
    ) + "\n",
  );
});

test("変更理由の未保存ドラフトは議題所属変更後も保持され後続保存に使える", async ({
  page,
}) => {
  await sample(page);
  const details = await openU01(page);
  const reason = "保持確認: 議題所属変更前の未保存理由";
  await details.getByLabel("変更理由", { exact: true }).fill(reason);
  const membership = await moveU01ToAnotherAgenda(details);

  await expect(details.getByLabel("変更理由", { exact: true })).toHaveValue(
    reason,
  );
  const classification = details.getByLabel("発言の分類", { exact: true });
  const original = await classification.inputValue();
  await classification.selectOption(original === "main" ? "derived" : "main");
  await details
    .getByRole("button", { name: "訂正を保存", exact: true })
    .click();
  await page.getByRole("button", { name: "訂正履歴", exact: true }).click();
  await expect(page.getByText(reason, { exact: true })).toBeVisible();

  observed = {
    result: "pass",
    draftField: "変更理由",
    membership,
    persistedBy: "classification correction history",
  };
});

test("話者の未保存ドラフトは議題所属変更後も保持され後続保存にpersistする", async ({
  page,
}) => {
  await sample(page);
  const details = await openU01(page);
  const speaker = details.getByLabel("話者", { exact: true });
  const draftSpeaker = "未保存話者: membership repro";
  await speaker.fill(draftSpeaker);
  const membership = await moveU01ToAnotherAgenda(details);

  observed = {
    result: "expected-preservation-assertion",
    draftField: "話者",
    expected: "speaker draft remains after membership move",
    draftSpeaker,
    membership,
  };
  await expect(speaker).toHaveValue(draftSpeaker);
  const reason = "保持確認: 話者ドラフトを後続保存";
  await details.getByLabel("変更理由", { exact: true }).fill(reason);
  await details
    .getByRole("button", { name: "訂正を保存", exact: true })
    .click();
  await expect(speaker).toHaveValue(draftSpeaker);
  await page.getByRole("button", { name: "訂正履歴", exact: true }).click();
  await expect(page.getByText(reason, { exact: true })).toBeVisible();

  observed = {
    result: "pass",
    draftField: "話者",
    membership,
    persistedBy: "speaker correction history",
  };
});

test("原文ドラフトは分類モードの保存後も保持される", async ({ page }) => {
  await sample(page);
  const details = await openU01(page);
  await details
    .getByRole("button", { name: "発言・原文", exact: true })
    .click();
  const quote = details.getByLabel("訂正後の原文", { exact: true });
  const original = await quote.inputValue();
  const draftQuote = `${original}（cross-mode draft repro）`;
  await quote.fill(draftQuote);
  await details
    .getByRole("button", { name: "分類・関係", exact: true })
    .click();
  const classification = details.getByLabel("発言の分類", { exact: true });
  const current = await classification.inputValue();
  await classification.selectOption(current === "main" ? "derived" : "main");
  await details.getByLabel("変更理由", { exact: true }).fill("cross-mode save");
  await details
    .getByRole("button", { name: "訂正を保存", exact: true })
    .click();
  await details
    .getByRole("button", { name: "発言・原文", exact: true })
    .click();

  observed = {
    result: "expected-preservation-assertion",
    draftField: "訂正後の原文",
    expected: "quote draft remains after classification-mode save",
    draftQuote,
  };
  await expect(quote).toHaveValue(draftQuote);
});
