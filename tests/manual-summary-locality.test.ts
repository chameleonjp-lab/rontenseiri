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
import { semanticSnapshot } from "../src/domain/snapshot";

it.each([0, 1] as const)(
  "candidate %i root-evidence replacement is local and one Undo exactly restores all semantic IDs, references and history",
  async (side) => {
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
    // Re-reviewed summaries; B-only case also preserves an unrelated existing review flag.
    const reviewed = structuredClone(created);
    reviewed.agendas.forEach((a) => {
      a.needsReview = false;
    });
    const other = side === 0 ? 1 : 0;
    reviewed.agendas[other].needsReview = side === 1;
    const group = reviewed.reasoning!.exclusiveGroups[0];
    const alternatives = group.interpretationIds.map((id) => {
      const candidate = reviewed.reasoning!.interpretations.find(
        (i) => i.id === id,
      )!;
      const premise = reviewed.reasoning!.items.find(
        (i) => i.id === candidate.premiseItemIds[0],
      )!;
      const conclusion = reviewed.reasoning!.items.find(
        (i) => i.id === candidate.conclusionItemIds[0],
      )!;
      return {
        id,
        premise: premise.text,
        conclusion: conclusion.text,
        evidenceIds: [...premise.evidenceIds],
        dependentConclusionIds: [] as string[],
      };
    }) as ManualInterpretationPairForm["alternatives"];
    const before = semanticSnapshot(reviewed);
    const beforeProject = structuredClone(reviewed);
    const priorTopLevelRevisions = structuredClone(reviewed.revisions);
    const unchangedOtherAgenda = structuredClone(reviewed.agendas[other]);
    const replacement = structuredClone(alternatives);
    replacement[side].evidenceIds = [evidenceIds[2]];
    const reason = `change ${side === 0 ? "A" : "B"} evidence`;
    const updated = saveManualInterpretationPair(reviewed, {
      groupId: group.id,
      questionVersionId,
      reason,
      alternatives: replacement,
    });
    expect(reviewed).toEqual(beforeProject);
    const expectedReview = reviewed.agendas.map((a) => a.needsReview);
    expectedReview[side] = true;
    expectedReview[2] = true;
    expect(updated.agendas.map((a) => a.needsReview)).toEqual(expectedReview);
    expect(updated.agendas[other]).toEqual(unchangedOtherAgenda);
    const changed = updated.reasoning!.interpretations.find(
      (i) => i.id === group.interpretationIds[side],
    )!;
    for (const id of [
      ...changed.premiseItemIds,
      ...changed.conclusionItemIds,
    ]) {
      const item = updated.reasoning!.items.find((i) => i.id === id)!;
      expect(item.evidenceIds).toEqual([evidenceIds[2]]);
      expect(item.utteranceIds).toEqual([utteranceIds[2]]);
    }
    // Separate semantic history from the append-only top-level edit + Undo audit log.
    expect(updated.revisions.slice(0, -1)).toEqual(priorTopLevelRevisions);
    expect(updated.revisions).toHaveLength(priorTopLevelRevisions.length + 1);
    const edit = structuredClone(updated.revisions.at(-1)!);
    expect(edit).toMatchObject({
      kind: "reasoning:manual-exclusive-pair-updated",
      targetId: group.id,
      reason,
    });
    expect(edit.before).toEqual(before);
    const afterEdit = semanticSnapshot(updated);
    const semanticEdit = afterEdit.reasoning!.revisions.at(-1)!;
    expect(semanticEdit).toMatchObject({
      kind: "manual-exclusive-pair-updated",
      targetId: group.id,
      reason,
      before: { revisionId: edit.id },
      after: { revisionId: edit.id },
    });
    expect(afterEdit.reasoning!.revisions.slice(0, -1)).toEqual(
      before.reasoning!.revisions,
    );
    const expectedEditAfter = structuredClone(afterEdit);
    expectedEditAfter.reasoning!.revisions.pop();
    expect(edit.after).toEqual(expectedEditAfter);
    const updatedBeforeUndo = structuredClone(updated);
    const undone = undoLastRevision(updated);
    expect(updated).toEqual(updatedBeforeUndo);
    // Covers every interpretation/item/propagation ID, old evidenceIds/utteranceIds,
    // source references, uncertainty/retraction state, agendas and semantic history.
    expect(semanticSnapshot(undone)).toEqual(before);
    expect(undone.reasoning).toEqual(before.reasoning);
    expect(undone.revisions.slice(0, -2)).toEqual(priorTopLevelRevisions);
    expect(undone.revisions).toHaveLength(priorTopLevelRevisions.length + 2);
    expect(undone.revisions.at(-2)).toEqual(edit);
    const undo = undone.revisions.at(-1)!;
    expect(undo.id).not.toBe(edit.id);
    expect(Number.isNaN(Date.parse(undo.at))).toBe(false);
    expect(undo).toMatchObject({
      kind: "undo",
      targetId: group.id,
      reason: `Undo: ${reason}`,
    });
    expect(undo.before).toEqual(afterEdit);
    expect(undo.after).toEqual({ ...before, targetRevisionId: edit.id });
    const rereviewed = structuredClone(updated);
    rereviewed.agendas.forEach((a) => {
      a.needsReview = false;
    });
    const retracted = retractManualInterpretationCandidate(
      rereviewed,
      group.id,
      group.interpretationIds[side],
      `retract ${side === 0 ? "A" : "B"}`,
    );
    expect(retracted.agendas.map((a) => a.needsReview)).toEqual([
      false,
      false,
      true,
    ]);
    expect(semanticSnapshot(undoLastRevision(retracted))).toEqual(
      semanticSnapshot(rereviewed),
    );
  },
);
