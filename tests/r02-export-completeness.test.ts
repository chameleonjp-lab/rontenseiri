import { describe, expect, it } from "vitest";
import { sampleProject } from "../src/analysis/sample";
import { exportProject } from "../src/export/project";

describe("R02 exported record scope", () => {
  for (const format of ["md", "svg"] as const) {
    for (const [extent, label] of [
      ["full", "全文（利用者申告）"],
      ["excerpt", "抜粋"],
      ["unknown", "不明"],
    ] as const) {
      it(`${format} preserves ${extent} separately from export selection`, () => {
        const project = sampleProject();
        project.extent = extent;
        expect(exportProject(project, format)).toContain(`記録範囲: ${label}`);
      });
    }
    it(`${format} distinguishes absent and empty omission reports`, () => {
      const project = sampleProject();
      delete project.omissions;
      expect(exportProject(project, format)).toContain("欠落申告: 未申告");
      project.omissions = [];
      expect(exportProject(project, format)).toContain(
        "欠落申告: なし（利用者申告）",
      );
    });
    it(`${format} retains reports without changing source or exposing them in limited export`, () => {
      const project = sampleProject();
      project.extent = "excerpt";
      project.omissions = [
        {
          id: "private-gap",
          description: "未収録の相談",
          reason: "提供対象外",
          location: "前半",
        },
      ];
      const before = JSON.stringify(project);
      const full = exportProject(project, format);
      for (const value of ["未収録の相談", "提供対象外", "前半"])
        expect(full).toContain(value);
      const agenda = project.agendas[0];
      const limited = exportProject(project, format, agenda.id, false, [
        agenda.utteranceIds[0],
      ]);
      expect(limited).toContain("記録範囲: 抜粋");
      expect(limited).toContain("この限定出力には含めません（申告有無は不明）");
      expect(limited).not.toContain("欠落申告: 未申告");
      expect(limited).not.toContain("未収録の相談");
      expect(limited).not.toContain("提供対象外");
      expect(JSON.stringify(project)).toBe(before);
    });
  }
  it("Markdown reports cannot introduce images, links or HTML", () => {
    const project = sampleProject();
    project.omissions = [
      {
        id: "gap",
        description: "![image](https://example.invalid/image)",
        reason: "<img src='https://example.invalid/x'>",
        location: "\n# forged heading",
      },
    ];
    const md = exportProject(project, "md");
    expect(md).not.toContain("![image](");
    expect(md).not.toContain("<img");
    expect(md).not.toContain("\n# forged heading");
    expect(md).toContain("&lt;img");
  });
  it("SVG escapes omission text and keeps long reports inside the expanded canvas", () => {
    const project = sampleProject();
    project.omissions = [
      {
        id: "gap",
        description: '<script>alert("x")</script>' + "長い記録".repeat(50),
        reason: "未収録",
      },
    ];
    const svg = exportProject(project, "svg");
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("記録範囲:");
    const header = svg.split("<g transform=")[0];
    const decode = (value: string) =>
      value
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&");
    const texts = [...header.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/g)].map(
      (match) => decode(match[1]),
    );
    expect(texts.join("")).toContain(project.omissions[0].description);
    const shift = Number(svg.match(/translate\(0,(\d+)\)/)?.[1]);
    const ys = [...header.matchAll(/<text[^>]* y="(\d+)"/g)].map((match) =>
      Number(match[1]),
    );
    expect(Math.max(...ys) + 14).toBeLessThan(shift);
    const height = Number(svg.match(/viewBox="[^ ]+ 0 [^ ]+ ([^"]+)"/)?.[1]);
    expect(height).toBeGreaterThan(shift + 300);
    expect(svg).toMatch(/<g transform="translate\(0,\d+\)">/);
  });
});
