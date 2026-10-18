import type { ManualInterpretationPairForm } from "../src/domain/manual-interpretations";
import { expect, it } from "vitest";
import { parseInputs } from "../src/input/parse";
import { createProject } from "../src/domain/project";
import { addEvidence, addQuestion } from "../src/domain/reasoning";
import {
  saveManualInterpretationPair,
  retractManualInterpretationCandidate,
} from "../src/domain/manual-interpretations";
import { undoLastRevision } from "../src/domain/revisions";

it("invalidates only summaries explicitly depending on changed candidate old/new evidence, including no external dependent conclusion", async () => {
  let p = createProject(
    await parseInputs([
      {
        name: "manual-summary.txt",
        format: "txt",
        role: "conversation",
        text: "A: first premise\nB: second premise\nC: other premise",
      },
    ]),
    "manual summary locality",
    "full",
  );
  const utteranceIds = p.utterances.map((u) => u.id);
  const agenda = p.agendas[0];
  p.agendas = utteranceIds.map((id, index) => ({
    ...structuredClone(agenda),
    id: `agenda-${index}`,
    utteranceIds: [id],
    summaryDependencies: [id],
    needsReview: false,
  }));
  p.selectedAgendaId = p.agendas[0].id;
  p = addQuestion(
    p,
    "Which condition applies?",
    "original",
    [utteranceIds[0]],
    "manual",
  );
  for (const id of utteranceIds)
    p = addEvidence(p, {
      utteranceIds: [id],
      sourceIds: [p.sources[0].id],
      actor: "manual",
      certainty: "confirmed",
      time: { asOf: p.createdAt, recordedAt: p.createdAt },
    });
  const evidenceIds = p.reasoning!.evidence.map((e) => e.id);
  const questionVersionId = p.reasoning!.questionVersions[0].id;
  const originalUnrelated = structuredClone(p.agendas[2]);
  const created = saveManualInterpretationPair(p, {
    questionVersionId,
    reason: "manual pair",
    alternatives: [
      {
        premise: "if A",
        conclusion: "then A",
        evidenceIds: [evidenceIds[0]],
        dependentConclusionIds: [],
      },
      {
        premise: "if B",
        conclusion: "then B",
        evidenceIds: [evidenceIds[1]],
        dependentConclusionIds: [],
      },
    ],
  });
  expect(created.agendas.map((a) => a.needsReview)).toEqual([
    true,
    true,
    false,
  ]);
  expect(created.agendas[2]).toEqual(originalUnrelated);
  // Simulate explicit re-review of the existing summaries before changing A.
  const reviewed = structuredClone(created);
  reviewed.agendas.forEach((a) => {
    a.needsReview = false;
  });
  const group = reviewed.reasoning!.exclusiveGroups[0];
  const alternatives = group.interpretationIds.map((id) => {
    const candidate = reviewed.reasoning!.interpretations.find(
      (i) => i.id === id,
    )!;
    return {
      id,
      premise: reviewed.reasoning!.items.find(
        (i) => i.id === candidate.premiseItemIds[0],
      )!.text,
      conclusion: reviewed.reasoning!.items.find(
        (i) => i.id === candidate.conclusionItemIds[0],
      )!.text,
      evidenceIds: [
        ...reviewed.reasoning!.items.find(
          (i) => i.id === candidate.premiseItemIds[0],
        )!.evidenceIds,
      ],
      dependentConclusionIds: [] as string[],
    };
  }) as ManualInterpretationPairForm["alternatives"];
  const unchangedB = structuredClone(reviewed.agendas[1]);
  const updated = saveManualInterpretationPair(reviewed, {
    groupId: group.id,
    questionVersionId,
    reason: "change A evidence",
    alternatives: [
      { ...alternatives[0], evidenceIds: [evidenceIds[2]] },
      alternatives[1],
    ],
  });
  expect(updated.agendas.map((a) => a.needsReview)).toEqual([
    true,
    false,
    true,
  ]);
  expect(updated.agendas[1]).toEqual(unchangedB);
  expect(undoLastRevision(updated).agendas).toEqual(reviewed.agendas);
  const rereviewed = structuredClone(updated);
  rereviewed.agendas.forEach((a) => {
    a.needsReview = false;
  });
  const retracted = retractManualInterpretationCandidate(
    rereviewed,
    group.id,
    group.interpretationIds[0],
    "retract A",
  );
  expect(retracted.agendas.map((a) => a.needsReview)).toEqual([
    false,
    false,
    true,
  ]);
  expect(retracted.agendas[1]).toEqual(unchangedB);
  expect(undoLastRevision(retracted).agendas).toEqual(rereviewed.agendas);
});
