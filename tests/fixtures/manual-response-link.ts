import { parseInputs } from "../../src/input/parse";
import { createProject, validateProject } from "../../src/domain/project";
import { createReasoningGraph, linkResponse } from "../../src/domain/reasoning";
import type { Project } from "../../src/domain/types";
import type { ReasoningGraph } from "../../src/domain/reasoning-types";

const time = {
  asOf: "2020-01-01T00:00:00.000Z",
  recordedAt: "2020-01-01T00:00:00.000Z",
};

/** Stable project for response-link invalidation, with one deliberately absent response. */
export async function manualResponseLinkFixture(
  route: "direct" | "evidence" = "direct",
): Promise<Project> {
  let p = createProject(
    await parseInputs([
      {
        name: "manual-response-link.txt",
        format: "txt",
        role: "conversation",
        text: [
          "質問者：費用と開始日は？",
          "回答者：費用は100円、開始日は未確認です。",
          "担当者：この回答を要約します。",
          "確認者：要約を次の判断へ引き継ぎます。",
          "別担当：公開範囲は社内です。",
          "判断者：次の判断を記録します。",
        ].join("\n"),
      },
    ]),
    "手動応答リンク依存無効化",
    "full",
  );

  const baseAgenda = structuredClone(p.agendas[0]);
  p.agendas = [
    {
      ...baseAgenda,
      id: "S",
      title: "選択中の質問と応答",
      utteranceIds: ["U01", "U02", "U04"],
      summaryDependencies: [],
      arrival: "Sの質問と応答",
      needsReview: false,
    },
    {
      ...baseAgenda,
      id: "A",
      title: "応答要約",
      utteranceIds: ["U03"],
      summaryDependencies: ["U02"],
      arrival: "Aの応答要約",
      needsReview: false,
    },
    {
      ...baseAgenda,
      id: "C",
      title: "下流判断",
      utteranceIds: ["U06"],
      summaryDependencies: ["U04"],
      arrival: "Cの下流判断",
      needsReview: false,
    },
    {
      ...baseAgenda,
      id: "B",
      title: "無関係な公開範囲",
      utteranceIds: ["U05"],
      // Deliberately omit summaryDependencies: this is the full-object invariant.
      arrival: "無関係の要約・秘密マーカー",
      needsReview: false,
    },
  ];
  p.selectedAgendaId = "S";

  const g = createReasoningGraph();
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
      text: "費用と開始日は？",
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
      sourceUtteranceIds: ["U05"],
    },
  ];
  // E1 is already present: linkResponse is the only missing record.
  g.evidence = [
    {
      id: "E1",
      utteranceIds: ["U02"],
      sourceIds: [p.sources[0].id],
      actor: "manual",
      certainty: "confirmed",
      time,
      note: "手動確認した応答根拠",
    },
    {
      id: "E2",
      utteranceIds: ["U05"],
      sourceIds: [p.sources[0].id],
      actor: "manual",
      certainty: "confirmed",
      time,
      note: "既存応答の根拠",
    },
  ];
  g.items = [
    {
      id: "I1",
      kind: "claim",
      text: "応答要約の主張",
      utteranceIds: ["U03"],
      evidenceIds: route === "evidence" ? ["E1"] : [],
      actor: "manual",
      certainty: "inferred",
      time,
    },
    {
      id: "I2",
      kind: "scope",
      text: "社内公開の主張",
      utteranceIds: ["U05"],
      evidenceIds: ["E2"],
      actor: "manual",
      certainty: "confirmed",
      time,
    },
  ];
  p.reasoning = g;
  p = linkResponse(
    p,
    {
      questionVersionId: "Q2-v1",
      utteranceIds: ["U05"],
      kind: "clarification",
      fulfillment: "unassessed",
      actor: "manual",
      time,
      counterargumentToClaimIds: [],
      evidenceIds: ["E2"],
      note: "既存応答",
    },
    "既存応答を履歴へ登録",
  );
  p.relations =
    route === "direct"
      ? [
          {
            id: "manual-direct-hop-1",
            from: "U02",
            to: "U03",
            kind: "derived",
            dependency: true,
            evidenceIds: [],
          },
          {
            id: "manual-direct-hop-2",
            from: "U03",
            to: "U04",
            kind: "derived",
            dependency: true,
            evidenceIds: [],
          },
        ]
      : [
          {
            id: "manual-evidence-hop",
            from: "U03",
            to: "U04",
            kind: "derived",
            dependency: true,
            evidenceIds: [],
          },
        ];
  p.utterances.forEach((utterance) => {
    utterance.classification = "main";
  });
  return validateProject(p);
}

/** Value accepted by linkResponse; Q1's response is intentionally absent in the fixture. */
export const linkValue = (
  p: Project,
): Omit<ReasoningGraph["responses"][number], "id"> => ({
  questionVersionId: "Q1-v1",
  utteranceIds: ["U02"],
  kind: "answer",
  fulfillment: "fulfilled",
  actor: "manual",
  time,
  counterargumentToClaimIds: [],
  evidenceIds: ["E1"],
  note: `手動リンク (${p.relations.some((r) => r.id === "manual-evidence-hop") ? "evidence" : "direct"})`,
});
