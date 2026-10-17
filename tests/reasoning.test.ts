import { describe, expect, it } from "vitest";
import type { Project } from "../src/domain/types";
import type { ReasoningProject } from "../src/domain/reasoning";
import {
  addEvidence,
  addQuestion,
  addSemanticItem,
  createReasoningGraph,
  linkResponse,
  reviseQuestion,
  undoReasoning,
} from "../src/domain/reasoning";
import { validateReasoning } from "../src/domain/reasoning-validation";

const project = (): ReasoningProject =>
  ({
    schemaVersion: 1,
    id: "p",
    title: "p",
    createdAt: "2020-01-01T00:00:00.000Z",
    updatedAt: "2020-01-01T00:00:00.000Z",
    extent: "full",
    sources: [
      {
        id: "s",
        versionId: "sv",
        name: "x",
        text: "質問",
        role: "conversation",
        format: "txt",
        createdAt: "2020-01-01T00:00:00.000Z",
        warnings: [],
        hash: "x",
      },
    ],
    utterances: [
      {
        id: "u",
        sourceId: "s",
        sourceVersionId: "sv",
        start: 0,
        end: 2,
        quote: "質問",
        speaker: "A",
        order: 0,
        line: 1,
        classification: "main",
        coverage: "mapped",
        important: true,
      },
    ],
    agendas: [
      {
        id: "a",
        title: "a",
        utteranceIds: ["u"],
        boundary: "candidate",
        decision: "undecided",
        answer: "none",
        agreement: "unknown",
        verification: "unverified",
        arrival: "",
        unresolved: [],
        nextAction: "",
        needsReview: false,
      },
    ],
    relations: [],
    revisions: [],
    runs: [],
    selectedAgendaId: "a",
    saved: false,
    reasoning: createReasoningGraph(),
  }) as ReasoningProject;

describe("reasoning model", () => {
  it("separates original/analysis questions and retains version history", () => {
    let p = addQuestion(
      project(),
      "何を決める?",
      "original",
      ["u"],
      "user-recorded",
      "2020-01-01T00:00:00.000Z",
    );
    const q = p.reasoning!.questions[0];
    p = reviseQuestion(
      p,
      q.id,
      "費用を含めて何を決める?",
      "条件を追加",
      ["u"],
      "manual",
      "2020-01-01T00:00:00.000Z",
    );
    expect(p.reasoning!.questions[0].versionIds).toHaveLength(2);
    expect(
      p.reasoning!.questionVersions.find((x) => x.id === q.currentVersionId)
        ?.status,
    ).toBe("superseded");
  });
  it("supports many-to-many response links and separates fulfillment", () => {
    let p = addQuestion(project(), "問い", "analysis", ["u"]);
    const qv = p.reasoning!.questionVersions[0];
    p = addEvidence(p, {
      utteranceIds: ["u"],
      sourceIds: ["s"],
      actor: "manual",
      certainty: "confirmed",
      time: {
        asOf: "2020-01-01T00:00:00.000Z",
        recordedAt: "2020-01-01T00:00:00.000Z",
      },
    });
    const e = p.reasoning!.evidence[0];
    p = linkResponse(p, {
      questionVersionId: qv.id,
      utteranceIds: ["u"],
      kind: "counterargument",
      fulfillment: "not-fulfilled",
      actor: "manual",
      time: {
        asOf: "2020-01-01T00:00:00.000Z",
        recordedAt: "2020-01-01T00:00:00.000Z",
      },
      counterargumentToClaimIds: [],
      evidenceIds: [e.id],
    });
    expect(p.reasoning!.responses[0].kind).toBe("counterargument");
    expect(p.reasoning!.responses[0].fulfillment).toBe("not-fulfilled");
  });
  it("rejects confirmed claims without evidence and supports snapshot undo", () => {
    expect(() =>
      addSemanticItem(project(), {
        kind: "claim",
        text: "確定",
        utteranceIds: ["u"],
        evidenceIds: [],
        actor: "manual",
        certainty: "confirmed",
        time: {
          asOf: "2020-01-01T00:00:00.000Z",
          recordedAt: "2020-01-01T00:00:00.000Z",
        },
      }),
    ).toThrow();
    const changed = addQuestion(project(), "問い", "analysis", ["u"]);
    const restored = undoReasoning(changed);
    expect(restored.reasoning!.questions).toHaveLength(0);
    expect(restored.reasoning!.revisions.at(-1)?.kind).toBe("undo");
  });
  it("accepts projects without the optional graph", () => {
    const p = project();
    delete (p as Project & { reasoning?: unknown }).reasoning;
    expect(() => validateReasoning(p)).not.toThrow();
  });
});
