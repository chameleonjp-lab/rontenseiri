import { expect, test } from "@playwright/test";
import { labels } from "../src/domain/types";

const sampleTitle = "在宅勤務の試行会議（架空サンプル）";

async function openSample(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page
    .getByRole("button", { name: "サンプルを見てみる", exact: true })
    .click();
  await expect(page.getByText(sampleTitle, { exact: true })).toBeVisible();
}

async function editU01(
  page: import("@playwright/test").Page,
  classification: "main" | "derived" | "drift",
  reason: string,
) {
  await page.getByRole("button", { name: /^U01 Aさん/ }).click();
  const details = page.getByRole("complementary", {
    name: "選択した発言の詳細",
  });
  await expect(details).toBeVisible();
  await details
    .getByLabel("発言の分類", { exact: true })
    .selectOption(classification);
  await details.getByLabel("変更理由", { exact: true }).fill(reason);
  await details
    .getByRole("button", { name: "訂正を保存", exact: true })
    .click();
  await expect(page.locator('[data-id="U01"] .badge')).toHaveText(
    labels.classification[classification],
  );
}

test("2ページ共有contextで旧revisionの保存を拒否し、最新保存内容を保持する", async ({
  page,
}) => {
  const secondPage = await page.context().newPage();
  try {
    await openSample(page);
    await page
      .getByRole("button", { name: "この端末に保存", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "このブラウザに保存しました",
    );

    await secondPage.goto("/");
    await secondPage
      .locator(".recent-open")
      .filter({ hasText: sampleTitle })
      .click();
    await expect(
      secondPage.getByText(sampleTitle, { exact: true }),
    ).toBeVisible();

    await editU01(page, "derived", "G5ページ1の最新保存");
    await page
      .getByRole("button", { name: "この端末に保存", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("保存しました");

    // The second page still starts at main. Change to drift, not main→main:
    // a real revision must exist before the competing save is attempted.
    await editU01(secondPage, "drift", "G5ページ2の古いrevision");
    const secondDetails = secondPage.getByRole("complementary", {
      name: "選択した発言の詳細",
    });
    const speakerDraft = secondDetails.getByLabel("話者", { exact: true });
    const reasonDraft = secondDetails.getByLabel("変更理由", { exact: true });
    await speakerDraft.fill("競合しても保持する未保存の話者");
    await reasonDraft.fill("競合しても保持する未保存の理由");
    await secondPage
      .getByRole("button", { name: "この端末に保存", exact: true })
      .click();
    await expect(secondPage.getByRole("alert")).toContainText("保存の競合");
    await expect(speakerDraft).toHaveValue("競合しても保持する未保存の話者");
    await expect(reasonDraft).toHaveValue("競合しても保持する未保存の理由");
    await expect(
      secondDetails.getByLabel("発言の分類", { exact: true }),
    ).toHaveValue("drift");
    await secondPage
      .getByRole("button", { name: "訂正履歴", exact: true })
      .click();
    await expect(secondPage.locator(".history-list article")).toHaveCount(1);
    await expect(secondPage.locator(".history-list")).toContainText(
      "G5ページ2の古いrevision",
    );
    await expect(speakerDraft).toHaveValue("競合しても保持する未保存の話者");
    await expect(reasonDraft).toHaveValue("競合しても保持する未保存の理由");

    const verifier = await page.context().newPage();
    try {
      await verifier.goto("/");
      await verifier
        .locator(".recent-open")
        .filter({ hasText: sampleTitle })
        .click();
      await expect(verifier.locator('[data-id="U01"] .badge')).toHaveText(
        "派生",
      );
      await verifier
        .getByRole("button", { name: "訂正履歴", exact: true })
        .click();
      await expect(verifier.locator(".history-list article")).toHaveCount(1);
      await expect(verifier.locator(".history-list")).toContainText(
        "G5ページ1の最新保存",
      );
      await expect(verifier.locator(".history-list")).not.toContainText(
        "G5ページ2の古いrevision",
      );
    } finally {
      await verifier.close();
    }
  } finally {
    await secondPage.close();
  }
});

test("不正JSONのfile UI importでも既存作業を変更しない", async ({ page }) => {
  await openSample(page);
  await page.getByRole("button", { name: "発言を検索", exact: true }).click();
  await page
    .getByRole("textbox", { name: "発言を検索", exact: true })
    .fill("U01");
  await page.getByRole("button", { name: "検索", exact: true }).click();
  await expect(
    page.getByRole("complementary", { name: "選択した発言の詳細" }),
  ).toContainText("U01");

  await page
    .locator('input[type="file"][accept=".json,.rontenseiri.json"]')
    .setInputFiles({
      name: "invalid.json",
      mimeType: "application/json",
      buffer: Buffer.from("{ not valid json", "utf8"),
    });

  await expect(page.getByRole("alert")).toContainText("JSONを解釈できません");
  await expect(page.getByText(sampleTitle, { exact: true })).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "選択した発言の詳細" }),
  ).toContainText("U01");
  await expect(page.locator('[data-id="U01"]')).toBeVisible();
});
