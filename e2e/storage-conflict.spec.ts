import { test, expect } from "@playwright/test";

test("旧保存版の上書きを拒否し、新版・履歴・Undo後の保存版を保持する", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const storagePath = "/src/storage/projects.ts",
      projectPath = "/src/domain/project.ts",
      parsePath = "/src/input/parse.ts",
      revisionsPath = "/src/domain/revisions.ts";
    const { saveProject, loadProject } = await import(storagePath);
    const { createProject, reviseProject } = await import(projectPath);
    const { parseInputs } = await import(parsePath);
    const { undoLastRevision } = await import(revisionsPath);
    const inputs = [
      {
        name: "実入力.txt",
        text: "A：開始日を決めます。\nB：来週を提案します。",
        role: "conversation",
        format: "txt",
      },
    ];
    const parsed = await parseInputs(inputs);
    let p = createProject(parsed, "保存競合の固定fixture", "full");
    p = reviseProject(p, "U01", { classification: "main" }, "r1");
    const r1 = await saveProject(p);
    const stale = structuredClone(r1);
    const r2 = await saveProject(
      reviseProject(r1, "U01", { classification: "derived" }, "r2"),
    );
    let conflict = "";
    try {
      await saveProject(stale);
    } catch (error) {
      conflict = String(error);
    }
    const latest = await loadProject(p.id);
    const unchanged = JSON.stringify(latest) === JSON.stringify(r2);
    const undone = await saveProject(undoLastRevision(latest));
    const final = await loadProject(p.id);
    return {
      conflict,
      unchanged,
      staleClass: stale.utterances[0].classification,
      latestClass: latest.utterances[0].classification,
      latestReasons: latest.revisions.map((r: { reason: string }) => r.reason),
      first: r1.storageRevision,
      second: r2.storageRevision,
      third: undone.storageRevision,
      finalClass: final.utterances[0].classification,
      undoKind: final.revisions.at(-1).kind,
      sourceUnchanged:
        JSON.stringify(final.sources) === JSON.stringify(r1.sources),
    };
  });
  expect(result.conflict).toContain("保存の競合");
  expect(result.conflict).not.toContain("保存容量が不足");
  expect(result.unchanged).toBe(true);
  expect(result.staleClass).toBe("main");
  expect(result.latestClass).toBe("derived");
  expect(result.latestReasons).toContain("r2");
  expect(result.second).toBe(result.first + 1);
  expect(result.third).toBe(result.second + 1);
  expect(result.finalClass).toBe("main");
  expect(result.undoKind).toBe("undo");
  expect(result.sourceUnchanged).toBe(true);
});
