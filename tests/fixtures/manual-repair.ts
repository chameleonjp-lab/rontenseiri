import { parseInputs } from "../../src/input/parse";
import { createProject, validateProject } from "../../src/domain/project";
import { createReasoningGraph, linkResponse } from "../../src/domain/reasoning";
import type { Project } from "../../src/domain/types";

export async function manualRepairFixture(): Promise<Project> {
  let p = createProject(
    await parseInputs([
      {
        name: "manual-repair.txt",
        format: "txt",
        role: "conversation",
        text: "甲：費用と開始日は？\n乙：費用は100円です。開始日は未確認です。\n丙：無関係の公開範囲は社内です。",
      },
    ]),
    "P3手動修復・2問3発言",
    "full",
  );
  p.agendas[0].utteranceIds = ["U01", "U02"];
  p.agendas[0].summaryDependencies = ["U02"];
  p.agendas[0].arrival = "費用の回答に依存する要約";
  p.agendas[0].answer = "partial";
  p.agendas.push({
    ...structuredClone(p.agendas[0]),
    id: "unrelated",
    title: "無関係の公開範囲",
    utteranceIds: ["U03"],
    summaryDependencies: ["U03"],
    arrival: "無関係の要約・秘密マーカー",
    needsReview: false,
  });
  const g = createReasoningGraph();
  const time = {
    asOf: "2020-01-01T00:00:00.000Z",
    recordedAt: "2020-01-01T00:00:00.000Z",
  };
  g.questions = [
    {
      id: "Q1",
      origin: "original",
      versionIds: ["Q1-v1", "Q1-v2"],
      currentVersionId: "Q1-v2",
    },
    {
      id: "Q2",
      origin: "analysis",
      versionIds: ["Q2-v1"],
      currentVersionId: "Q2-v1",
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
      text: "税込費用と開始日は？",
      status: "active",
      actor: "manual",
      time,
      sourceUtteranceIds: ["U01"],
      supersedesId: "Q1-v1",
      reason: "条件を追加",
    },
    {
      id: "Q2-v1",
      questionId: "Q2",
      text: "公開範囲は？",
      status: "active",
      actor: "manual",
      time,
      sourceUtteranceIds: ["U03"],
    },
  ];
  g.evidence = ["E1", "E2", "E3"].map((id, i) => ({
    id,
    utteranceIds: [i === 1 ? "U02" : "U01"],
    sourceIds: [p.sources[0].id],
    actor: "manual",
    certainty: "uncertain",
    time,
    note: `根拠${i + 1}`,
  }));
  g.items = ["I1", "I2", "I3"].map((id, i) => ({
    id,
    kind: "claim",
    text: `主張${i + 1}`,
    utteranceIds: ["U01"],
    evidenceIds: ["E1"],
    actor: "manual",
    certainty: "inferred",
    time,
  }));
  g.responses = [
    {
      id: "unrelated-response",
      questionVersionId: "Q2-v1",
      utteranceIds: ["U03"],
      kind: "clarification",
      fulfillment: "unassessed",
      actor: "manual",
      time,
      counterargumentToClaimIds: [],
      evidenceIds: [],
    },
  ];
  p.reasoning = g;
  p = linkResponse(
    p,
    {
      questionVersionId: "Q1-v1",
      utteranceIds: ["U02"],
      kind: "answer",
      fulfillment: "fulfilled",
      actor: "manual",
      time,
      counterargumentToClaimIds: ["I1", "I2"],
      evidenceIds: ["E1", "E2"],
    },
    "旧版への応答を原文から明示登録",
  );
  return validateProject(p);
}

export const repairResponse = (p: Project) =>
  p.reasoning!.responses.find((r) => r.id !== "unrelated-response")!;
export const semanticState = (p: Project) => ({
  reasoning: p.reasoning,
  agendas: p.agendas,
  utterances: p.utterances,
  relations: p.relations,
  revisions: p.revisions,
  selectedAgendaId: p.selectedAgendaId,
});
