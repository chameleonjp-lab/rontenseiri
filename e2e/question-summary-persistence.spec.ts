import { expect, test } from "@playwright/test";

test("問い改版と撤回の再確認状態・旧版応答を保存復元しUndoで元へ戻す", async ({
  page,
}) => {
  await page.goto("/");
  const results = await page.evaluate(async () => {
    const parsePath = "/src/input/parse.ts",
      projectPath = "/src/domain/project.ts",
      reasoningPath = "/src/domain/reasoning.ts",
      storagePath = "/src/storage/projects.ts",
      revisionsPath = "/src/domain/revisions.ts";
    const { parseInputs } = await import(parsePath);
    const { createProject } = await import(projectPath);
    const { addQuestion, linkResponse, reviseQuestion, retractQuestion } =
      await import(reasoningPath);
    const { saveProject, loadProject } = await import(storagePath);
    const { undoLastRevision } = await import(revisionsPath);
    const rows = [];
    for (const action of ["revise", "retract"]) {
      const parsed = await parseInputs([
        {
          name: "t.txt",
          format: "txt",
          role: "conversation",
          text: "費用は？\n100円です",
        },
      ]);
      let p = createProject(parsed, `問い要約永続化-${action}`, "full");
      p.agendas[0].summaryDependencies = ["U02"];
      p.agendas[0].arrival = "元の問いに対する回答要約";
      p.agendas[0].needsReview = false;
      p = addQuestion(
        p,
        "費用は？",
        "original",
        ["U01"],
        "manual",
        undefined,
        "問い登録",
      );
      const q = p.reasoning.questions[0];
      const at = new Date().toISOString();
      p = linkResponse(
        p,
        {
          questionVersionId: q.currentVersionId,
          utteranceIds: ["U02"],
          kind: "answer",
          fulfillment: "fulfilled",
          actor: "manual",
          time: { asOf: at, recordedAt: at },
          counterargumentToClaimIds: [],
          evidenceIds: [],
        },
        "回答登録",
      );
      const linkReview = p.agendas[0].needsReview;
      // The later question-edit scenario starts after reviewing the newly
      // registered response; registration itself now invalidates the summary.
      p.agendas[0].needsReview = false;
      const originalResponse = JSON.stringify(p.reasoning.responses);
      const beforeReview = p.agendas[0].needsReview;
      p = await saveProject({ ...p, saved: true });
      const changed =
        action === "revise"
          ? reviseQuestion(p, q.id, "税込の費用は？", "要求変更", ["U01"])
          : retractQuestion(p, q.id, "要求撤回");
      await saveProject(changed);
      const restored = await loadProject(p.id);
      await saveProject(undoLastRevision(restored));
      const undo = await loadProject(p.id);
      rows.push({
        action,
        linkReview,
        beforeReview,
        review: restored.agendas[0].needsReview,
        arrival: restored.agendas[0].arrival,
        oldResponseUnchanged:
          JSON.stringify(restored.reasoning.responses) === originalResponse,
        oldTarget: restored.reasoning.responses[0].questionVersionId,
        oldVersion: q.currentVersionId,
        oldStatus: restored.reasoning.questionVersions.find(
          (v: { id: string }) => v.id === q.currentVersionId,
        ).status,
        undoReview: undo.agendas[0].needsReview,
        undoCurrent: undo.reasoning.questions[0].currentVersionId,
        undoResponseUnchanged:
          JSON.stringify(undo.reasoning.responses) === originalResponse,
        undoSourceUnchanged:
          JSON.stringify(undo.sources) === JSON.stringify(p.sources),
      });
    }
    return rows;
  });
  expect(results).toHaveLength(2);
  for (const row of results) {
    expect(row.linkReview).toBe(true);
    expect(row.beforeReview).toBe(false);
    expect(row.review).toBe(true);
    expect(row.arrival).toBe("元の問いに対する回答要約");
    expect(row.oldResponseUnchanged).toBe(true);
    expect(row.oldTarget).toBe(row.oldVersion);
    expect(row.oldStatus).toBe(
      row.action === "revise" ? "superseded" : "retracted",
    );
    expect(row.undoReview).toBe(false);
    expect(row.undoCurrent).toBe(row.oldVersion);
    expect(row.undoResponseUnchanged).toBe(true);
    expect(row.undoSourceUnchanged).toBe(true);
  }
});
