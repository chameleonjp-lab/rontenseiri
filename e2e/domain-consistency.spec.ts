import { expect, test } from "@playwright/test";

test("直接APIの復帰なしは正規化され、矛盾した外部状態の保存を拒否する", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const parsePath = "/src/input/parse.ts",
      projectPath = "/src/domain/project.ts",
      storagePath = "/src/storage/projects.ts",
      revisionsPath = "/src/domain/revisions.ts";
    const { parseInputs } = await import(parsePath);
    const { createProject, validateProject, reviseProject } = await import(
      projectPath
    );
    const { saveProject, loadProject } = await import(storagePath);
    const { undoLastRevision } = await import(revisionsPath);
    const parsed = await parseInputs([
      {
        name: "return.txt",
        format: "txt",
        role: "conversation",
        text: "派生した話題です\n本筋に戻ります",
      },
    ]);
    const p = createProject(parsed, "TXTからの復帰整合性", "full");
    p.utterances[0].classification = "drift";
    p.utterances[1].classification = "main";
    delete p.utterances[0].returnStatus;
    p.relations = [
      {
        id: "r1",
        from: "U01",
        to: "U02",
        kind: "return",
        evidenceIds: ["U01", "U02"],
      },
    ];
    const base = await saveProject({ ...validateProject(p), saved: true });
    const invalid = structuredClone(base);
    invalid.utterances.find(
      (u: { id: string }) => u.id === "U01",
    ).returnStatus = "none";
    let rejection = "";
    try {
      await saveProject(invalid);
    } catch (error) {
      rejection = String(error);
    }
    const afterRejected = await loadProject(base.id);
    const normalized = reviseProject(
      base,
      "U01",
      { returnStatus: "none" },
      "直接APIで復帰なし",
    );
    const saved = await saveProject(normalized);
    const restored = await loadProject(base.id);
    const undone = await saveProject(undoLastRevision(restored));
    const undoRestored = await loadProject(base.id);
    return {
      rejection,
      afterRejectedUnchanged:
        JSON.stringify(afterRejected) === JSON.stringify(base),
      normalizedEdges: normalized.relations.filter(
        (r: { from: string; kind: string }) =>
          r.from === "U01" && r.kind === "return",
      ).length,
      restoredStatus: restored.utterances.find(
        (u: { id: string }) => u.id === "U01",
      ).returnStatus,
      restoredEdges: restored.relations.filter(
        (r: { from: string; kind: string }) =>
          r.from === "U01" && r.kind === "return",
      ).length,
      targetClass: restored.utterances.find(
        (u: { id: string }) => u.id === "U02",
      ).classification,
      undoRelations:
        JSON.stringify(undoRestored.relations) ===
        JSON.stringify(base.relations),
      undoSources:
        JSON.stringify(undoRestored.sources) === JSON.stringify(base.sources),
      sourceStatus:
        undoRestored.utterances.find((u: { id: string }) => u.id === "U01")
          .returnStatus ?? null,
      newRevision: saved.storageRevision,
      undoRevision: undone.storageRevision,
    };
  });
  expect(result.rejection).toMatch(/returnStatus none.*return relation/);
  expect(result.afterRejectedUnchanged).toBe(true);
  expect(result.normalizedEdges).toBe(0);
  expect(result.restoredStatus).toBe("none");
  expect(result.restoredEdges).toBe(0);
  expect(result.targetClass).toBe("main");
  expect(result.undoRelations).toBe(true);
  expect(result.undoSources).toBe(true);
  expect(result.newRevision).toBeLessThan(result.undoRevision);
});
