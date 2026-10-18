import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import { parseInputs } from "../src/input/parse";
import { createProject } from "../src/domain/project";
import { exportProject } from "../src/export/project";

test("50,000文字・500発言の全体表示とパン入力を実データ経路で確認", async ({
  page,
}) => {
  test.setTimeout(60000);
  const text =
    Array.from({ length: 500 }, (_, i) =>
      `話者: ${String(i).padStart(3, "0")} `.padEnd(99, "あ"),
    ).join("\n") + "あ";
  const parsed = await parseInputs([
    { name: "架空の最大入力.txt", text, format: "txt", role: "conversation" },
  ]);
  const project = createProject(parsed, "架空の性能フィクスチャ", "full");
  expect([...text]).toHaveLength(50000);
  expect(project.utterances).toHaveLength(500);
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "maximum.json",
    mimeType: "application/json",
    buffer: Buffer.from(exportProject(project, "json", undefined, true)),
  });
  const first = page.locator(`[data-id="${project.utterances[0].id}"]`),
    last = page.locator(`[data-id="${project.utterances.at(-1)!.id}"]`);
  await expect(first).toBeAttached();
  await expect(last).toBeAttached();
  await page.getByRole("button", { name: "全体表示", exact: true }).click();
  const canvas = page.locator(".flow-container");
  await expect(async () => {
    const boundary = await canvas.boundingBox();
    const a = await first.boundingBox(),
      b = await last.boundingBox();
    expect(a!.x).toBeGreaterThanOrEqual(boundary!.x - 2);
    expect(b!.x + b!.width).toBeLessThanOrEqual(
      boundary!.x + boundary!.width + 2,
    );
  }).toPass();
  await page.screenshot({
    path: "artifacts/500-node-overview.png",
    fullPage: true,
  });
  await canvas.focus();
  const values = await canvas.evaluate(async (el) => {
    const values: number[] = [];
    for (let i = 0; i < 20; i++) {
      const start = performance.now();
      el.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      values.push(performance.now() - start);
    }
    return values;
  });
  expect(values.every((n) => Number.isFinite(n) && n >= 0)).toBe(true);
  const sorted = values.toSorted((a, b) => a - b);
  await writeFile(
    "artifacts/browser-500-node.json",
    JSON.stringify(
      {
        environment: "headless Chromium on cloud Linux, synthetic fixture",
        nodes: 500,
        codePoints: 50000,
        metric:
          "keyboard event to second requestAnimationFrame; not paint instrumentation or real-device p95",
        count: values.length,
        medianMs: sorted[Math.ceil(values.length * 0.5) - 1],
        p95Ms: sorted[Math.ceil(values.length * 0.95) - 1],
        values,
        gate: "G4/G5 real-device and memory gates remain unverified",
      },
      null,
      2,
    ) + "\n",
  );
});
