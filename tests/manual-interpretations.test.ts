import { describe, expect, it } from "vitest";
import {
  addEvidence,
  addQuestion,
  addSemanticItem,
  undoReasoning,
} from "../src/domain/reasoning";
import { createReasoningGraph } from "../src/domain/reasoning";
import type { ReasoningProject } from "../src/domain/reasoning";
import {
  saveManualInterpretationPair,
  retractManualInterpretationCandidate,
  getManualExclusivePair,
} from "../src/domain/manual-interpretations";

const at = "2020-01-01T00:00:00.000Z";
const base = (): ReasoningProject => ({
  schemaVersion: 1,
  id: "p",
  title: "p",
  createdAt: at,
  updatedAt: at,
  extent: "full",
  sources: [
    {
      id: "s",
      versionId: "sv",
      name: "source",
      text: "text",
      role: "conversation",
      format: "txt",
      createdAt: at,
      warnings: [],
      hash: "h",
    },
  ],
  utterances: [
    {
      id: "u",
      sourceId: "s",
      sourceVersionId: "sv",
      start: 0,
      end: 1,
      quote: "text",
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
});

function prepared() {
  let p = addQuestion(base(), "何を決める?", "original", ["u"], "manual", at);
  p = addEvidence(p, {
    utteranceIds: ["u"],
    sourceIds: ["s"],
    actor: "manual",
    certainty: "confirmed",
    time: { asOf: at, recordedAt: at },
  });
  p = addSemanticItem(p, {
    kind: "claim",
    text: "dependent",
    utteranceIds: ["u"],
    evidenceIds: [],
    actor: "manual",
    certainty: "inferred",
    time: { asOf: at, recordedAt: at },
  });
  p = addSemanticItem(p, {
    kind: "claim",
    text: "unrelated",
    utteranceIds: ["u"],
    evidenceIds: [],
    actor: "manual",
    certainty: "inferred",
    time: { asOf: at, recordedAt: at },
  });
  return {
    p,
    qv: p.reasoning!.questionVersions[0].id,
    evidence: p.reasoning!.evidence[0].id,
    dependent: p.reasoning!.items[0].id,
    unrelated: p.reasoning!.items[1].id,
  };
}

describe("manual exclusive interpretation pair", () => {
  it("creates exactly two candidates atomically and invalidates only selected dependents", () => {
    const x = prepared();
    const out = saveManualInterpretationPair(x.p, {
      questionVersionId: x.qv,
      reason: "manual alternatives",
      alternatives: [
        {
          premise: "if A",
          conclusion: "then A",
          evidenceIds: [x.evidence],
          dependentConclusionIds: [x.dependent],
        },
        {
          premise: "if B",
          conclusion: "then B",
          evidenceIds: [x.evidence],
          dependentConclusionIds: [],
        },
      ],
    });
    const pair = getManualExclusivePair(
      out,
      out.reasoning!.exclusiveGroups[0].id,
    );
    expect(pair.candidates).toHaveLength(2);
    expect(out.reasoning!.exclusiveGroups[0].interpretationIds).toHaveLength(2);
    expect(
      out.reasoning!.items.find((i) => i.id === x.dependent)?.certainty,
    ).toBe("uncertain");
    expect(
      out.reasoning!.items.find((i) => i.id === x.unrelated)?.certainty,
    ).toBe("inferred");
    expect(out.reasoning!.uncertaintyPropagation).toHaveLength(3);
  });

  it("rejects invalid evidence and leaves the input byte-for-byte unchanged", () => {
    const x = prepared();
    const before = structuredClone(x.p);
    expect(() =>
      saveManualInterpretationPair(x.p, {
        questionVersionId: x.qv,
        reason: "bad",
        alternatives: [
          {
            premise: "A",
            conclusion: "A",
            evidenceIds: ["missing"],
            dependentConclusionIds: [],
          },
          {
            premise: "B",
            conclusion: "B",
            evidenceIds: [x.evidence],
            dependentConclusionIds: [],
          },
        ],
      }),
    ).toThrow();
    expect(x.p).toEqual(before);
  });

  it("retracts one candidate while retaining the exact pair and undo restores the full snapshot", () => {
    const x = prepared();
    const created = saveManualInterpretationPair(x.p, {
      questionVersionId: x.qv,
      reason: "create",
      alternatives: [
        {
          premise: "A",
          conclusion: "A",
          evidenceIds: [x.evidence],
          dependentConclusionIds: [x.dependent],
        },
        {
          premise: "B",
          conclusion: "B",
          evidenceIds: [x.evidence],
          dependentConclusionIds: [],
        },
      ],
    });
    const groupId = created.reasoning!.exclusiveGroups[0].id;
    const first = created.reasoning!.exclusiveGroups[0].interpretationIds[0];
    const retracted = retractManualInterpretationCandidate(
      created,
      groupId,
      first,
      "remove A",
    );
    expect(
      retracted.reasoning!.exclusiveGroups[0].interpretationIds,
    ).toHaveLength(2);
    expect(
      retracted.reasoning!.interpretations.find((i) => i.id === first)
        ?.certainty,
    ).toBe("retracted");
    const undone = undoReasoning(retracted);
    expect(undone.reasoning!.interpretations).toEqual(
      created.reasoning!.interpretations,
    );
    expect(undone.reasoning!.items).toEqual(created.reasoning!.items);
    expect(undone.reasoning!.exclusiveGroups).toEqual(
      created.reasoning!.exclusiveGroups,
    );
  });
});
