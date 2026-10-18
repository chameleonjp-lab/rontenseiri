import { expect, test, type Page } from "@playwright/test";
import { incomingReturnsFixture } from "../tests/fixtures/incoming-returns";

async function openContext(page: Page, withoutTargetEvidence = false) {
  await page.goto("/");
  await page.evaluate(async () => {
    const path = "/e2e/fixtures/incoming-context-host.tsx";
    const { mountIncomingContextHost } = await import(path);
    mountIncomingContextHost();
  });
  const panel = page.getByRole("complementary", { name: "選択した発言の詳細" });
  await expect(panel).toBeVisible();
  if (withoutTargetEvidence)
    await page
      .getByRole("button", { name: "対象発言を根拠IDから除く", exact: true })
      .click();
  await panel.getByLabel("発言の分類").selectOption("derived");
  await panel.getByLabel("線を外して未確定", { exact: true }).check();
  await panel
    .getByLabel("変更理由", { exact: true })
    .fill("確認対象の文脈を保持");
  return panel;
}

async function relations(page: Page) {
  return JSON.parse((await page.getByLabel("現在の関係配列").textContent())!);
}

test("browser component: 保持線に表示した根拠本文の変更でも承認を無効化する", async ({
  page,
}) => {
  const original = incomingReturnsFixture().relations;
  const panel = await openContext(page);
  await page
    .getByRole("button", { name: "表示中の保持線の根拠を更新", exact: true })
    .click();
  const explanation = panel.getByRole("region", { name: "この発言への復帰線" });
  await expect(page.getByLabel("更新対象の本文")).toContainText(
    "【保持線の更新根拠】",
  );
  await expect(explanation).toContainText("U03 → U09");
  await expect(explanation).toContainText("【保持線の更新根拠】");
  await expect(
    panel.getByLabel("線を外して未確定", { exact: true }),
  ).not.toBeChecked();
  await expect(panel.getByLabel("変更理由", { exact: true })).toHaveValue(
    "確認対象の文脈を保持",
  );
  await expect(panel.getByLabel("発言の分類")).toHaveValue("derived");
  await panel.getByRole("button", { name: "訂正を保存", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("線を残すか外すか");
  expect(await relations(page)).toEqual(original);
  await panel.getByLabel("線を外して未確定", { exact: true }).check();
  await panel.getByRole("button", { name: "訂正を保存", exact: true }).click();
  await expect
    .poll(() => relations(page))
    .toEqual(original.filter((r) => !(r.kind === "return" && r.to === "U10")));
});

test("browser component: 確認に表示していない無関係な本文変更では承認と下書きを維持する", async ({
  page,
}) => {
  const original = incomingReturnsFixture().relations;
  const panel = await openContext(page);
  const explanation = panel.getByRole("region", { name: "この発言への復帰線" });
  const before = await explanation.innerText();
  await page
    .getByRole("button", { name: "表示外の本文を更新", exact: true })
    .click();
  await expect(page.getByLabel("更新対象の本文")).toContainText(
    "【表示外の更新本文】",
  );
  await expect.poll(() => explanation.innerText()).toBe(before);
  await expect(
    panel.getByLabel("線を外して未確定", { exact: true }),
  ).toBeChecked();
  await expect(panel.getByLabel("変更理由", { exact: true })).toHaveValue(
    "確認対象の文脈を保持",
  );
  await expect(panel.getByLabel("発言の分類")).toHaveValue("derived");
  expect(await relations(page)).toEqual(original);
  await panel.getByRole("button", { name: "訂正を保存", exact: true }).click();
  await expect
    .poll(() => relations(page))
    .toEqual(original.filter((r) => !(r.kind === "return" && r.to === "U10")));
});

test("browser component: 根拠IDにない対象発言でも表示本文変更後は再承認を要求する", async ({
  page,
}) => {
  const panel = await openContext(page, true);
  const original = await relations(page);
  const explanation = panel.getByRole("region", { name: "この発言への復帰線" });
  await expect(explanation).not.toContainText("根拠 U10");
  await page
    .getByRole("button", { name: "対象の本文を更新", exact: true })
    .click();
  await expect(panel.locator("blockquote")).toContainText(
    "【対象発言の更新本文】",
  );
  await expect(
    panel.getByLabel("線を外して未確定", { exact: true }),
  ).not.toBeChecked();
  await panel.getByRole("button", { name: "訂正を保存", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("線を残すか外すか");
  expect(await relations(page)).toEqual(original);
  await panel.getByLabel("線を外して未確定", { exact: true }).check();
  await panel.getByRole("button", { name: "訂正を保存", exact: true }).click();
  await expect
    .poll(() => relations(page))
    .toEqual(
      original.filter(
        (r: { kind: string; to: string }) =>
          !(r.kind === "return" && r.to === "U10"),
      ),
    );
});

test("browser component: 承認後の復帰線付け替えで再承認前の解除を拒否する", async ({
  page,
}) => {
  const panel = await openContext(page);
  const original = await relations(page);
  await page
    .getByRole("button", { name: "表示中の復帰線を付け替える", exact: true })
    .click();
  const explanation = panel.getByRole("region", { name: "この発言への復帰線" });
  await expect(explanation).toContainText("この発言への復帰線：1件");
  await expect(explanation).not.toContainText("U08 → U10");
  const reassigned = await relations(page);
  expect(reassigned).not.toEqual(original);
  expect(
    reassigned.find(
      (r: { kind: string; from: string }) =>
        r.kind === "return" && r.from === "U08",
    ),
  ).toMatchObject({ to: "U09" });
  expect(
    reassigned.find(
      (r: { kind: string; from: string }) =>
        r.kind === "return" && r.from === "U08",
    ).id,
  ).not.toBe(
    original.find(
      (r: { kind: string; from: string }) =>
        r.kind === "return" && r.from === "U08",
    ).id,
  );
  await expect(
    panel.getByLabel("線を外して未確定", { exact: true }),
  ).not.toBeChecked();
  await expect(panel.getByLabel("発言の分類")).toHaveValue("derived");
  await expect(panel.getByLabel("変更理由", { exact: true })).toHaveValue(
    "確認対象の文脈を保持",
  );
  await panel.getByRole("button", { name: "訂正を保存", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("線を残すか外すか");
  expect(await relations(page)).toEqual(reassigned);
  await panel.getByLabel("線を外して未確定", { exact: true }).check();
  await panel.getByRole("button", { name: "訂正を保存", exact: true }).click();
  await expect
    .poll(() => relations(page))
    .toEqual(
      reassigned.filter(
        (r: { kind: string; to: string }) =>
          !(r.kind === "return" && r.to === "U10"),
      ),
    );
});

test("browser component: 承認後の根拠ID差し替えで再承認前の解除を拒否する", async ({
  page,
}) => {
  const panel = await openContext(page);
  const original = await relations(page);
  await page
    .getByRole("button", { name: "表示中の根拠IDを差し替える", exact: true })
    .click();
  const expected = original.map((r: { id: string; evidenceIds: string[] }) =>
    r.id === "incoming-fixture-return-u03-u10"
      ? { ...r, evidenceIds: ["U10", "U16"] }
      : r,
  );
  const explanation = panel.getByRole("region", { name: "この発言への復帰線" });
  const changedEdge = explanation
    .locator("li")
    .filter({ hasText: "関係ID：incoming-fixture-return-u03-u10" });
  await expect(changedEdge).toContainText("根拠 U16");
  await expect(changedEdge).not.toContainText("根拠 U03");
  expect(await relations(page)).toEqual(expected);
  await expect(
    panel.getByLabel("線を外して未確定", { exact: true }),
  ).not.toBeChecked();
  await panel.getByRole("button", { name: "訂正を保存", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("線を残すか外すか");
  expect(await relations(page)).toEqual(expected);
  await panel.getByLabel("線を外して未確定", { exact: true }).check();
  await panel.getByRole("button", { name: "訂正を保存", exact: true }).click();
  await expect
    .poll(() => relations(page))
    .toEqual(
      expected.filter(
        (r: { kind: string; to: string }) =>
          !(r.kind === "return" && r.to === "U10"),
      ),
    );
});
