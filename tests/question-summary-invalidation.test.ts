import { describe, expect, it } from "vitest";
import { parseInputs } from "../src/input/parse";
import { createProject, validateProject } from "../src/domain/project";
import {
  addQuestion,
  linkResponse,
  reviseQuestion,
  retractQuestion,
  undoReasoning,
} from "../src/domain/reasoning";

import { exportProject, importProject } from "../src/export/project";
const at = "2020-01-01T00:00:00.000Z";

async function fixture(text = "費用は？\n100円です") {
  const parsed = await parseInputs([
    {
      name: "t.txt",
      format: "txt",
      role: "conversation",
      text,
    },
  ]);
  let p = createProject(parsed, "test", "full");
  p.agendas[0].summaryDependencies = ["U02"];
  p.agendas[0].arrival = "元の問いに対する回答要約";
  p.agendas.push({
    ...structuredClone(p.agendas[0]),
    id: "D",
    title: "無関係要約",
    utteranceIds: [],
    summaryDependencies: [],
    needsReview: false,
  });
  p = addQuestion(
    p,
    "費用は？",
    "original",
    ["U01"],
    "manual",
    undefined,
    "問い登録",
  );
  const q = p.reasoning!.questions[0];
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
  // This suite starts after the initial response's summary has been reviewed.
  // Undoing a later question edit must restore that reviewed baseline.
  p.agendas[0].needsReview = false;
  return { p, questionId: q.id, versionId: q.currentVersionId };
}

describe("question version summary invalidation", () => {
  it("問い改版は旧版応答を保持し依存要約を要再確認にする", async () => {
    const base = await fixture();
    const p = reviseQuestion(
      base.p,
      base.questionId,
      "税込の費用は？",
      "要求変更",
      ["U01"],
    );
    expect(p.agendas[0].needsReview).toBe(true);
    expect(p.agendas[0].arrival).toBe("元の問いに対する回答要約");
    expect(p.agendas[1].needsReview).toBe(false);
    expect(p.reasoning!.responses[0].questionVersionId).toBe(base.versionId);
    expect(p.reasoning!.questionVersions).toHaveLength(2);
    const undone = undoReasoning(p);
    expect(undone.agendas[0].needsReview).toBe(false);
    expect(undone.agendas[1].needsReview).toBe(false);
    expect(undone.reasoning!.questionVersions).toHaveLength(1);
  });

  it("問い撤回は応答履歴を保持し依存要約を要再確認にする", async () => {
    const base = await fixture();
    const p = retractQuestion(base.p, base.questionId, "要求撤回");
    expect(p.agendas[0].needsReview).toBe(true);
    expect(p.agendas[1].needsReview).toBe(false);
    expect(p.reasoning!.responses[0].questionVersionId).toBe(base.versionId);
    expect(p.reasoning!.questionVersions[0].status).toBe("retracted");
    const undone = undoReasoning(p);
    expect(undone.agendas[0].needsReview).toBe(false);
    expect(undone.agendas[1].needsReview).toBe(false);
    expect(undone.reasoning!.questionVersions[0].status).toBe("active");
  });
});

it.each(["revise", "retract"] as const)(
  "問い%sは応答から別議題の二段の明示依存を辿り無関係要約を保つ",
  async (action) => {
    const base = await fixture(
      "費用は？\n100円です\nこの回答を前提に進めます\n二段目の前提です\n別件の天気です",
    );
    const p = base.p;
    p.agendas[0].utteranceIds = ["U01", "U02"];
    p.agendas[1].utteranceIds = ["U05"];
    p.agendas[1].summaryDependencies = ["U05"];
    p.agendas.push({
      ...structuredClone(p.agendas[0]),
      id: "B",
      title: "依存する別議題",
      utteranceIds: ["U03"],
      summaryDependencies: ["U03"],
      needsReview: false,
    });
    p.agendas.push({
      ...structuredClone(p.agendas[0]),
      id: "C",
      title: "二段目の依存議題",
      utteranceIds: ["U04"],
      summaryDependencies: ["U04"],
      needsReview: false,
    });
    p.relations.push({
      id: "second-hop",
      from: "U03",
      to: "U04",
      kind: "derived",
      evidenceIds: ["U03"],
      dependency: true,
    });
    p.relations.push({
      id: "dependent",
      from: "U02",
      to: "U03",
      kind: "derived",
      evidenceIds: ["U02"],
      dependency: true,
    });
    expect(validateProject(p)).toBeDefined();
    const originalResponses = structuredClone(p.reasoning!.responses);
    const out =
      action === "revise"
        ? reviseQuestion(p, base.questionId, "税込の費用は？", "要求変更", [
            "U01",
          ])
        : retractQuestion(p, base.questionId, "要求撤回");
    expect(validateProject(out)).toBeDefined();
    expect(out.agendas.find((a) => a.id === "C")!.needsReview).toBe(true);
    const restored = importProject(
      exportProject(out, "json", undefined, false),
    );
    expect(restored.reasoning).toEqual(out.reasoning);
    expect(restored.agendas).toEqual(out.agendas);
    expect(restored.sources).toEqual(out.sources);
    expect(restored.revisions).toEqual(out.revisions);
    const restoredUndo = undoReasoning(restored);
    expect(restoredUndo.agendas).toEqual(p.agendas);
    expect(restoredUndo.reasoning!.responses).toEqual(originalResponses);
    expect(out.agendas.find((a) => a.id === "B")!.needsReview).toBe(true);
    expect(out.agendas.find((a) => a.id === "D")!.needsReview).toBe(false);
    expect(out.reasoning!.responses).toEqual(originalResponses);
    expect(out.agendas.map((a) => a.arrival)).toEqual(
      p.agendas.map((a) => a.arrival),
    );
    const undone = undoReasoning(out);
    expect(undone.agendas).toEqual(p.agendas);
    expect(undone.reasoning!.responses).toEqual(originalResponses);
  },
);
