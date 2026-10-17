import { describe, expect, it } from "vitest";
import { createProject } from "../src/domain/project";
import { parseInputs } from "../src/input/parse";
import {
  addEvidence,
  addQuestion,
  linkResponse,
} from "../src/domain/reasoning";
import { splitUtterance } from "../src/domain/utterance-editing";
import { undoLastRevision } from "../src/domain/revisions";
import { exportProject, importProject } from "../src/export/project";

const time = {
  asOf: "2020-01-01T00:00:00.000Z",
  recordedAt: "2020-01-01T00:00:00.000Z",
};
async function fixture() {
  return createProject(
    await parseInputs([
      {
        name: "conversation.txt",
        format: "txt",
        role: "conversation",
        text: "A: left right\nB: unrelated evidence\nC: response",
      },
    ]),
    "evidence-split",
    "full",
  );
}
async function targetFixture() {
  let project = await fixture();
  const target = project.utterances[0];
  project = addQuestion(project, "left or right?", "original", [target.id]);
  const questionVersionId = project.reasoning!.questionVersions[0].id;
  project = addEvidence(project, {
    utteranceIds: [target.id],
    sourceIds: [target.sourceId],
    actor: "manual",
    certainty: "confirmed",
    time,
  });
  const evidenceId = project.reasoning!.evidence[0].id;
  project = linkResponse(project, {
    questionVersionId,
    utteranceIds: [target.id],
    kind: "answer",
    fulfillment: "fulfilled",
    actor: "manual",
    time,
    counterargumentToClaimIds: [],
    evidenceIds: [evidenceId],
  });
  return {
    project,
    target,
    questionVersionId,
    evidenceId,
    responseId: project.reasoning!.responses[0].id,
  };
}
type Destination = "left" | "right" | "both" | "unresolved";

describe("split response evidence", () => {
  it.each<Destination>(["left", "right", "both", "unresolved"])(
    "keeps IDs/source IDs and applies %s destination consistently",
    async (destination) => {
      const { project, target, questionVersionId, evidenceId, responseId } =
        await targetFixture();
      const sourceId = target.sourceId;
      const split = splitUtterance(project, target.id, {
        offset: 4,
        reason: "本文境界を確認",
        reasoningDestinations: {
          [evidenceId]: destination,
          [responseId]: destination,
          [questionVersionId]: destination,
        },
      });
      const [left, right] = split.utterances.filter(
        (u) => u.sourceId === sourceId,
      );
      const expected =
        destination === "left"
          ? [left.id]
          : destination === "right"
            ? [right.id]
            : [left.id, right.id];
      const graph = split.reasoning!;
      const evidence = graph.evidence.find((e) => e.id === evidenceId)!;
      const response = graph.responses.find((r) => r.id === responseId)!;
      const question = graph.questionVersions.find(
        (q) => q.id === questionVersionId,
      )!;
      expect(evidence.id).toBe(evidenceId);
      expect(evidence.sourceIds).toEqual([sourceId]);
      expect(evidence.utteranceIds).toEqual(expected);
      expect(response.id).toBe(responseId);
      expect(response.utteranceIds).toEqual(expected);
      expect(response.evidenceIds).toEqual([evidenceId]);
      expect(response.fulfillment).toBe("unassessed");
      expect(question.sourceUtteranceIds).toEqual(expected);
      const record = split.lineage!.records.at(-1)!;
      expect(record.oldIds).toEqual([target.id]);
      expect(record.newIds).toEqual([left.id, right.id]);
      for (const id of [evidenceId, responseId, questionVersionId]) {
        const ref = record.references.find((r) => r.referenceId === id)!;
        expect(ref.targetIds).toEqual(
          destination === "left"
            ? [left.id]
            : destination === "right"
              ? [right.id]
              : [left.id, right.id],
        );
        expect(ref.status).toBe(
          destination === "unresolved" ? "unresolved" : "applied",
        );
      }
      expect(evidence.certainty).toBe(
        destination === "unresolved" ? "uncertain" : "confirmed",
      );
      const restored = importProject(exportProject(split, "json"));
      expect(restored.id).not.toBe(split.id);
      expect(restored.reasoning).toEqual(split.reasoning);
      expect(restored.lineage).toEqual(split.lineage);
      const undone = undoLastRevision(split);
      expect(undone.utterances).toEqual(project.utterances);
      expect(undone.sources).toEqual(project.sources);
      expect(undone.reasoning).toEqual(project.reasoning);
    },
  );

  it("preserves an unrelated fulfilled response and unrelated evidence byte-for-byte", async () => {
    let project = await fixture();
    const [target, unrelated] = project.utterances;
    project = addQuestion(project, "target?", "original", [target.id]);
    project = addQuestion(project, "unrelated?", "original", [unrelated.id]);
    const [, unrelatedQuestion] = project.reasoning!.questionVersions;
    project = addEvidence(project, {
      utteranceIds: [unrelated.id],
      sourceIds: [unrelated.sourceId],
      actor: "manual",
      certainty: "confirmed",
      time,
    });
    const unrelatedEvidence = project.reasoning!.evidence[0];
    project = linkResponse(project, {
      questionVersionId: unrelatedQuestion.id,
      utteranceIds: [unrelated.id],
      kind: "answer",
      fulfillment: "fulfilled",
      actor: "manual",
      time,
      counterargumentToClaimIds: [],
      evidenceIds: [unrelatedEvidence.id],
    });
    const before = {
      response: structuredClone(project.reasoning!.responses[0]),
      evidence: structuredClone(project.reasoning!.evidence[0]),
      question: structuredClone(unrelatedQuestion),
    };
    const split = splitUtterance(project, target.id, {
      offset: 4,
      reason: "locality",
    });
    expect(split.reasoning!.responses[0]).toEqual(before.response);
    expect(split.reasoning!.evidence[0]).toEqual(before.evidence);
    expect(
      split.reasoning!.questionVersions.find(
        (q) => q.id === unrelatedQuestion.id,
      ),
    ).toEqual(before.question);
  });
});
