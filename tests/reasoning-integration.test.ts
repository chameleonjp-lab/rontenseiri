import { describe, expect, it } from "vitest";
import type { Project } from "../src/domain/types";
import {
  addQuestion,
  createReasoningGraph,
  linkResponse,
  undoReasoning,
} from "../src/domain/reasoning";

const base = (): Project => ({
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
      name: "会話",
      text: "問い 応答",
      role: "conversation",
      format: "txt",
      createdAt: "2020-01-01T00:00:00.000Z",
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
      quote: "問い",
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
      title: "議題",
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

describe("reasoning shared-history integration", () => {
  it("keeps 20 edits bounded instead of recursively nesting prior graph revisions", () => {
    let p = base();
    for (let i = 0; i < 20; i++)
      p = addQuestion(p, `問い${i}`, "inferred", ["u"]);
    const serialized = JSON.stringify(p);
    expect(p.revisions).toHaveLength(20);
    expect(p.reasoning!.revisions).toHaveLength(20);
    expect(serialized.length).toBeLessThan(1_000_000);
    expect(
      p.reasoning!.revisions.every((r) => JSON.stringify(r).length < 500),
    ).toBe(true);
  });
  it("supports sequential reasoning undo while retaining the event trail", () => {
    let p = addQuestion(base(), "一つ目", "original", ["u"]);
    p = addQuestion(p, "二つ目", "analysis", ["u"]);
    p = undoReasoning(p);
    expect(p.reasoning!.questions).toHaveLength(1);
    p = undoReasoning(p);
    expect(p.reasoning!.questions).toHaveLength(0);
    expect(
      p.reasoning!.revisions.filter((r) => r.kind === "undo"),
    ).toHaveLength(2);
    expect(p.revisions.filter((r) => r.kind === "undo")).toHaveLength(2);
  });
  it("keeps the response target version and fulfillment independent from kind", () => {
    let p = addQuestion(base(), "元の問い", "original", ["u"]);
    const first = p.reasoning!.questionVersions[0];
    p = addQuestion(p, "分析用の問い", "analysis", ["u"]);
    const second = p.reasoning!.questionVersions[1];
    p = linkResponse(p, {
      questionVersionId: first.id,
      utteranceIds: ["u"],
      kind: "answer",
      fulfillment: "not-fulfilled",
      actor: "manual",
      time: {
        asOf: "2020-01-01T00:00:00.000Z",
        recordedAt: "2020-01-01T00:00:00.000Z",
      },
      counterargumentToClaimIds: [],
      evidenceIds: [],
    });
    p = linkResponse(p, {
      questionVersionId: second.id,
      utteranceIds: ["u"],
      kind: "clarification",
      fulfillment: "fulfilled",
      actor: "manual",
      time: {
        asOf: "2020-01-01T00:00:00.000Z",
        recordedAt: "2020-01-01T00:00:00.000Z",
      },
      counterargumentToClaimIds: [],
      evidenceIds: [],
    });
    expect(
      p.reasoning!.responses.map((r) => [r.questionVersionId, r.fulfillment]),
    ).toEqual([
      [first.id, "not-fulfilled"],
      [second.id, "fulfilled"],
    ]);
  });
});
