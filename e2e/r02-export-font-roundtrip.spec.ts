import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { sampleProject } from "../src/analysis/sample";
import { exportProject, importProject } from "../src/export/project";

test("R02 exported scope survives JSON restore and real-font SVG rendering", async ({
  page,
}, testInfo) => {
  const project = sampleProject();
  project.extent = "excerpt";
  project.omissions = [
    {
      id: "synthetic-gap",
      description:
        "日本語の長文見切れ検査。架空の検査用情報です。".repeat(12) +
        "\r\n改行確認😀\u0000終端",
      reason: "前後の欠落を想定した架空の理由。".repeat(8),
      location: "位置限定用センチネル・冒頭および末尾。".repeat(12),
    },
  ];
  const before = JSON.stringify(project);
  const restored = importProject(exportProject(project, "json"));
  expect(restored.extent).toBe("excerpt");
  expect(restored.omissions).toEqual(project.omissions);
  const svg = exportProject(project, "svg");
  expect(exportProject(restored, "svg")).toBe(svg);
  expect(JSON.stringify(project)).toBe(before);
  expect(svg).toContain("[U+0000]");
  const agenda = project.agendas[0];
  const limited = exportProject(project, "svg", agenda.id, false, [
    agenda.utteranceIds[0],
  ]);
  expect(limited).toContain("この限定出力には含めません（申告有無は不明）");
  expect(limited).not.toContain("架空の検査用情報");
  expect(limited).not.toContain("架空の理由");
  expect(limited).not.toContain("位置限定用センチネル");

  await page.setContent(svg);
  await page.evaluate(() => document.fonts.ready);
  const metrics = await page.locator("svg").evaluate((element) => {
    const svg = element as SVGSVGElement;
    const view = svg.viewBox.baseVal;
    const report = Array.from(svg.children).filter(
      (child): child is SVGTextElement => child.tagName === "text",
    );
    const rows = report.map((text) => {
      const box = text.getBBox();
      return {
        text: text.textContent,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        font: getComputedStyle(text).fontFamily,
      };
    });
    const diagram = svg.querySelector<SVGGElement>("g[transform]")!;
    return {
      userAgent: navigator.userAgent,
      fontScope:
        "CSS family and this browser fallback rendering, not an actual resolved-font or real-device guarantee",
      view: { x: view.x, y: view.y, width: view.width, height: view.height },
      diagramTop: diagram.transform.baseVal.consolidate()!.matrix.f,
      rows,
    };
  });
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/r02-export-font-metrics.json",
    JSON.stringify(metrics, null, 2),
  );
  await page.screenshot({
    path: "artifacts/r02-export-font.png",
    fullPage: true,
  });
  await testInfo.attach("R02 SVG font rendering", {
    path: "artifacts/r02-export-font.png",
    contentType: "image/png",
  });
  await testInfo.attach("R02 SVG text bounds", {
    path: "artifacts/r02-export-font-metrics.json",
    contentType: "application/json",
  });
  expect(metrics.rows.length).toBeGreaterThanOrEqual(7);
  const renderedReport = metrics.rows.map((row) => row.text).join("");
  expect(renderedReport).toContain(
    project.omissions[0].description
      .replace(/\r\n|\r|\n/g, "")
      .replace("\u0000", "[U+0000]"),
  );
  expect(renderedReport).toContain(project.omissions[0].reason);
  expect(renderedReport).toContain(project.omissions[0].location!);
  expect(metrics.rows.map((r) => r.text).join("")).toContain("記録範囲: 抜粋");
  for (const row of metrics.rows) {
    expect(row.width).toBeGreaterThan(0);
    expect(row.x).toBeGreaterThanOrEqual(metrics.view.x);
    expect(row.x + row.width).toBeLessThanOrEqual(
      metrics.view.x + metrics.view.width,
    );
    expect(row.y).toBeGreaterThanOrEqual(metrics.view.y);
    expect(row.y + row.height).toBeLessThanOrEqual(metrics.diagramTop);
  }
  for (let i = 1; i < metrics.rows.length; i++) {
    expect(metrics.rows[i].y).toBeGreaterThanOrEqual(
      metrics.rows[i - 1].y + metrics.rows[i - 1].height,
    );
  }
});
