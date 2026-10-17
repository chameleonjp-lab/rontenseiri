import { describe, expect, it } from "vitest";
import { parseInputs } from "../src/input/parse";
import { createProject, validateProject } from "../src/domain/project";
import { invalidateDependents } from "../src/domain/invalidation";
import {
  addInterpretation,
  addQuestion,
  addSemanticItem,
  reviseQuestion,
  retractQuestion,
  undoReasoning,
} from "../src/domain/reasoning";

const at = "2020-01-01T00:00:00.000Z";

async function fixture() {
  const parsed = await parseInputs([
    {
      name: "question.txt",
      format: "txt",
      role: "conversation",
      text: "問いです\n前提です\n結論です\n無関係です",
    },
  ]);
  let p = createProject(parsed, "test", "full");
  const original = p.agendas[0];
  p.agendas[0] = {
    ...original,
    utteranceIds: ["U01", "U02"],
    summaryDependencies: ["U02"],
  };
  p.agendas.push({
    ...structuredClone(original),
    id: "B",
    title: "解釈依存要約",
    utteranceIds: ["U03", "U04"],
    summaryDependencies: ["U03"],
    needsReview: false,
  });
  p.agendas.push({
    ...structuredClone(original),
    id: "D",
    title: "無関係要約",
    utteranceIds: [],
    summaryDependencies: [],
    needsReview: false,
  });
  p = validateProject(p);
  p = addQuestion(p, "問いです", "original", ["U01"], "manual", at, "問い登録");
  const versionId = p.reasoning!.questionVersions[0].id;
  p = addSemanticItem(
    p,
    {
      kind: "claim",
      text: "前提",
      utteranceIds: ["U02"],
      evidenceIds: [],
      actor: "manual",
      certainty: "inferred",
      time: { asOf: at, recordedAt: at },
    },
    "前提登録",
  );
  p = addSemanticItem(
    p,
    {
      kind: "claim",
      text: "結論",
      utteranceIds: ["U03"],
      evidenceIds: [],
      actor: "manual",
      certainty: "inferred",
      time: { asOf: at, recordedAt: at },
    },
    "結論登録",
  );
  const [premise, conclusion] = p.reasoning!.items;
  p = addInterpretation(
    p,
    {
      questionVersionId: versionId,
      premiseItemIds: [premise.id],
      conclusionItemIds: [conclusion.id],
      certainty: "inferred",
      actor: "manual",
      time: { asOf: at, recordedAt: at },
    },
    "解釈登録",
  );
  return { p: validateProject(p), questionId: p.reasoning!.questions[0].id };
}

describe("question version interpretation invalidation", () => {
  it("改版は応答リンク無しでも解釈の前提・結論要約を要再確認にする", async () => {
    const base = await fixture();
    const p = reviseQuestion(
      base.p,
      base.questionId,
      "更新した問い",
      "要求変更",
      ["U01"],
    );

    expect(validateProject(p)).toBeDefined();
    expect(p.agendas.find((a) => a.id === "議題01")!.needsReview).toBe(true);
    expect(p.agendas.find((a) => a.id === "B")!.needsReview).toBe(true);
    expect(p.agendas.find((a) => a.id === "D")!.needsReview).toBe(false);
    expect(p.reasoning!.items).toEqual(base.p.reasoning!.items);
    expect(p.reasoning!.interpretations).toEqual(
      base.p.reasoning!.interpretations,
    );
    expect(p.reasoning!.questionVersions).toHaveLength(2);

    const undone = undoReasoning(p);
    expect(undone.agendas).toEqual(base.p.agendas);
    expect(undone.reasoning!.questions).toEqual(base.p.reasoning!.questions);
    expect(undone.reasoning!.questionVersions).toEqual(
      base.p.reasoning!.questionVersions,
    );
    expect(undone.reasoning!.items).toEqual(base.p.reasoning!.items);
    expect(undone.reasoning!.interpretations).toEqual(
      base.p.reasoning!.interpretations,
    );
  });

  it("撤回は応答リンク無しでも解釈の前提・結論要約を要再確認にする", async () => {
    const base = await fixture();
    const p = retractQuestion(base.p, base.questionId, "要求撤回");

    expect(validateProject(p)).toBeDefined();
    expect(p.agendas.find((a) => a.id === "議題01")!.needsReview).toBe(true);
    expect(p.agendas.find((a) => a.id === "B")!.needsReview).toBe(true);
    expect(p.agendas.find((a) => a.id === "D")!.needsReview).toBe(false);
    expect(p.reasoning!.items).toEqual(base.p.reasoning!.items);
    expect(p.reasoning!.questionVersions[0].status).toBe("retracted");

    const undone = undoReasoning(p);
    expect(undone.agendas).toEqual(base.p.agendas);
    expect(undone.reasoning!.questions).toEqual(base.p.reasoning!.questions);
    expect(undone.reasoning!.questionVersions).toEqual(
      base.p.reasoning!.questionVersions,
    );
    expect(undone.reasoning!.items).toEqual(base.p.reasoning!.items);
    expect(undone.reasoning!.interpretations).toEqual(
      base.p.reasoning!.interpretations,
    );
  });

  it("意味項目から解釈を経て反対側の意味項目・要約へ伝播する", async () => {
    const base = await fixture();
    const p = invalidateDependents(base.p, ["U02"]);

    expect(p.agendas.find((a) => a.id === "議題01")!.needsReview).toBe(true);
    expect(p.agendas.find((a) => a.id === "B")!.needsReview).toBe(true);
    expect(p.agendas.find((a) => a.id === "D")!.needsReview).toBe(false);
    expect(base.p.agendas.every((a) => !a.needsReview)).toBe(true);
  });
});
