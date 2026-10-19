import { parseInputs } from "../../src/input/parse";
import {
  createProject,
  reviseProject,
  validateProject,
} from "../../src/domain/project";
import { createReasoningGraph } from "../../src/domain/reasoning";
import type { Project } from "../../src/domain/types";

export const OLD_ITEM_TEXT = "費用は無条件で100円です";
export const NEW_ITEM_TEXT = "税込100円は社内利用の場合に限る";
export const ITEM_EDIT_REASON = "原文の条件と根拠を照合して主張を訂正";
export const ITEM_PATCH = {
  text: NEW_ITEM_TEXT,
  kind: "condition" as const,
  utteranceIds: ["U03"],
  evidenceIds: ["E2", "E1"],
};
export const CONFIRMED_AGENDAS = ["A", "N", "C", "B"];

/** Importable seed: the prior ordinary speaker correction leaves A stale. */
export async function semanticItemCorrectionFixture(): Promise<Project> {
  let p = createProject(
    await parseInputs([
      {
        name: "semantic-item-correction.txt",
        format: "txt",
        role: "conversation",
        text: "甲：費用の条件は？\n乙：100円です。\n乙：税込で社内利用の場合です。\n丙：その条件で検討します。\n丁：公開範囲は別件です。\n甲：旧根拠のまとめ\n乙：新根拠のまとめ\n丙：下流のまとめ",
      },
    ]),
    "R17意味項目の通常訂正",
    "full",
  );
  const base = p.agendas[0];
  p.agendas = [
    {
      ...base,
      id: "S",
      title: "原文と問い",
      utteranceIds: ["U01", "U02", "U03", "U04"],
      summaryDependencies: [],
    },
    {
      ...structuredClone(base),
      id: "A",
      title: "旧根拠に依存",
      utteranceIds: ["U06"],
      summaryDependencies: ["U02"],
      arrival: "旧根拠による要約",
    },
    {
      ...structuredClone(base),
      id: "N",
      title: "新根拠に依存",
      utteranceIds: ["U07"],
      summaryDependencies: ["U03"],
      arrival: "新根拠による要約",
    },
    {
      ...structuredClone(base),
      id: "C",
      title: "下流に依存",
      utteranceIds: ["U08"],
      summaryDependencies: ["U04"],
      arrival: "下流の判断",
    },
    {
      ...structuredClone(base),
      id: "B",
      title: "独立した公開範囲",
      utteranceIds: ["U05"],
      summaryDependencies: ["U05"],
      arrival: "独立した要約・非公開マーカー",
    },
  ];
  p.selectedAgendaId = "S";
  const g = createReasoningGraph();
  const time = {
    asOf: "2020-01-01T00:00:00.000Z",
    recordedAt: "2020-01-02T00:00:00.000Z",
  };
  g.questions = [
    {
      id: "Q1",
      origin: "original",
      versionIds: ["Q1-v1", "Q1-v2"],
      currentVersionId: "Q1-v2",
    },
  ];
  g.questionVersions = [
    {
      id: "Q1-v1",
      questionId: "Q1",
      text: "費用は？",
      status: "superseded",
      actor: "manual",
      time,
      sourceUtteranceIds: ["U01"],
    },
    {
      id: "Q1-v2",
      questionId: "Q1",
      text: "費用の条件は？",
      status: "active",
      actor: "manual",
      time,
      sourceUtteranceIds: ["U01"],
      supersedesId: "Q1-v1",
      reason: "条件を明示",
    },
  ];
  g.evidence = ["E1", "E2", "E3"].map((id, i) => ({
    id,
    utteranceIds: [["U02"], ["U03"], ["U05"]][i],
    sourceIds: [p.sources[0].id],
    actor: "manual",
    certainty: "uncertain",
    time,
    note: ["旧根拠", "新根拠", "独立根拠"][i],
  }));
  g.items = [
    {
      id: "I1",
      kind: "claim",
      text: OLD_ITEM_TEXT,
      utteranceIds: ["U02"],
      evidenceIds: ["E1"],
      actor: "user-recorded",
      certainty: "inferred",
      time,
      scope: "費用",
      termDefinition: "100円は登録時の解釈",
    },
    {
      id: "I-B",
      kind: "scope",
      text: "別件の公開範囲",
      utteranceIds: ["U05"],
      evidenceIds: ["E3"],
      actor: "manual",
      certainty: "uncertain",
      time,
    },
  ];
  g.responses = [
    {
      id: "R1",
      questionVersionId: "Q1-v1",
      utteranceIds: ["U04"],
      kind: "objection",
      fulfillment: "unassessed",
      counterargumentToClaimIds: ["I1"],
      evidenceIds: ["E2"],
      actor: "manual",
      time,
    },
  ];
  p.reasoning = g;
  p.relations = [
    {
      id: "new-to-downstream",
      from: "U03",
      to: "U04",
      kind: "derived",
      dependency: true,
      evidenceIds: [],
    },
  ];
  p = reviseProject(
    p,
    "U02",
    { speaker: "乙（話者訂正済み）" },
    "先行する通常の話者訂正",
  );
  return validateProject(p);
}

/** Domain equivalent of the UI's reason-bearing summary confirmation. */
export async function reviewedSemanticItemFixture(): Promise<Project> {
  let p = await semanticItemCorrectionFixture();
  for (const id of CONFIRMED_AGENDAS)
    p = reviseProject(
      p,
      id,
      { needsReview: false },
      `意味項目の訂正前に${id}を確認`,
    );
  return p;
}
