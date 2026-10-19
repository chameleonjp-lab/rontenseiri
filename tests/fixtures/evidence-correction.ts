import { parseInputs } from "../../src/input/parse";
import {
  createProject,
  reviseProject,
  validateProject,
} from "../../src/domain/project";
import { createReasoningGraph } from "../../src/domain/reasoning";
import type { Project } from "../../src/domain/types";

export const evidenceCorrectionPatch = {
  utteranceIds: ["U03"],
  note: "訂正後の注記",
};
export const evidenceCorrectionIds = {
  evidenceId: "E1",
  oldUtteranceId: "U02",
  newUtteranceId: "U03",
  consumerUtteranceId: "U04",
  independentUtteranceId: "U05",
  crossSourceUtteranceId: "U09",
};
export const EVIDENCE_EDIT_REASON = "根拠発言と注記を原文照合で訂正";

export async function evidenceCorrectionFixture(): Promise<Project> {
  let p = createProject(
    await parseInputs([
      {
        name: "evidence-correction.txt",
        format: "txt",
        role: "conversation",
        text: "甲：費用の条件は？\n乙：旧根拠です。\n乙：新根拠です。\n丙：その根拠を踏まえます。\n丁：独立した別件です。\n甲：旧根拠の要約です。\n丙：下流の判断です。\n丙：下流の補足です。",
      },
      {
        name: "evidence-correction-reference.txt",
        format: "txt",
        role: "reference",
        text: "別資料の根拠発言です。",
      },
    ]),
    "R17 Evidence correction",
    "full",
  );
  const base = p.agendas[0];
  p.agendas = [
    {
      ...base,
      id: "S",
      title: "根拠",
      utteranceIds: ["U01", "U02", "U03", "U04"],
      summaryDependencies: [],
    },
    {
      ...base,
      id: "A",
      title: "旧・新根拠の要約",
      utteranceIds: ["U06"],
      summaryDependencies: ["U02"],
      arrival: "根拠要約",
    },
    {
      ...base,
      id: "C",
      title: "下流の消費者",
      utteranceIds: ["U07", "U08"],
      summaryDependencies: ["U04"],
      arrival: "下流判断",
    },
    {
      ...base,
      id: "B",
      title: "独立",
      utteranceIds: ["U05"],
      summaryDependencies: ["U05"],
      arrival: "独立要約",
    },
  ];
  const time = {
    asOf: "2020-01-01T00:00:00.000Z",
    recordedAt: "2020-01-02T00:00:00.000Z",
  };
  const sourceId = p.sources[0].id;
  const g = createReasoningGraph();
  g.evidence = [
    {
      id: "E1",
      utteranceIds: ["U02"],
      sourceIds: [sourceId],
      actor: "user-recorded",
      certainty: "confirmed",
      note: "旧根拠",
      time,
    },
    {
      id: "E2",
      utteranceIds: ["U05"],
      sourceIds: [sourceId],
      actor: "manual",
      certainty: "uncertain",
      note: "独立根拠",
      time,
    },
  ];
  g.items = [
    {
      id: "I1",
      kind: "claim",
      text: "費用の主張",
      utteranceIds: ["U02"],
      evidenceIds: ["E1"],
      actor: "manual",
      certainty: "confirmed",
      time,
    },
    {
      id: "I2",
      kind: "scope",
      text: "独立主張",
      utteranceIds: ["U05"],
      evidenceIds: ["E2"],
      actor: "manual",
      certainty: "uncertain",
      time,
    },
    {
      id: "I3",
      kind: "claim",
      text: "新根拠から導いた主張",
      utteranceIds: ["U03"],
      evidenceIds: [],
      actor: "manual",
      certainty: "inferred",
      time,
    },
  ];
  g.questions = [
    {
      id: "Q1",
      origin: "original",
      versionIds: ["Q1-v1"],
      currentVersionId: "Q1-v1",
    },
  ];
  g.questionVersions = [
    {
      id: "Q1-v1",
      questionId: "Q1",
      text: "費用は？",
      status: "active",
      actor: "manual",
      time,
      sourceUtteranceIds: ["U01"],
    },
  ];
  g.responses = [
    {
      id: "R1",
      questionVersionId: "Q1-v1",
      utteranceIds: ["U04"],
      kind: "answer",
      fulfillment: "unassessed",
      actor: "manual",
      time,
      counterargumentToClaimIds: ["I3"],
      evidenceIds: [],
    },
  ];
  g.positionChanges = [
    {
      id: "PC1",
      subject: "費用",
      beforeItemId: "I1",
      afterItemId: "I3",
      triggerEvidenceIds: ["E1"],
      candidateReasonIds: [],
      actor: "manual",
      time,
    },
  ];
  g.interpretations = [
    {
      id: "INT1",
      questionVersionId: "Q1-v1",
      premiseItemIds: ["I2"],
      conclusionItemIds: ["I2"],
      certainty: "inferred",
      actor: "manual",
      time,
    },
  ];
  p.reasoning = g;
  p.selectedAgendaId = "S";
  p.relations = [
    {
      id: "U02-to-U03",
      from: "U02",
      to: "U03",
      kind: "derived",
      dependency: true,
      evidenceIds: [],
    },
    {
      id: "U04-to-U07",
      from: "U04",
      to: "U07",
      kind: "derived",
      dependency: true,
      evidenceIds: [],
    },
  ];
  p = reviseProject(p, "S", { needsReview: false }, "通常確認した要約");
  return validateProject(p);
}
