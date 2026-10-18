import { describe, expect, it } from "vitest";
import type { Project } from "../src/domain/types";
import { invalidateDependents } from "../src/domain/invalidation";

const project = (): Project => {
  const utterances = ["a", "b", "c", "d"].map((id, order) => ({
    id,
    sourceId: "s",
    sourceVersionId: "sv",
    start: order,
    end: order + 1,
    quote: id,
    speaker: "x",
    order,
    line: order + 1,
    classification: "main" as const,
    coverage: "mapped" as const,
    important: false,
  }));
  return {
    schemaVersion: 1,
    id: "p",
    title: "p",
    createdAt: "now",
    updatedAt: "now",
    extent: "full",
    sources: [],
    utterances,
    agendas: ["A", "B", "C", "D"].map((id, i) => ({
      id,
      title: id,
      utteranceIds: ["a", "b", "c", "d"][i] ? [["a", "b", "c", "d"][i]] : [],
      boundary: "candidate" as const,
      decision: "undecided" as const,
      answer: "none" as const,
      agreement: "unknown" as const,
      verification: "unverified" as const,
      arrival: "",
      unresolved: [],
      nextAction: "",
      needsReview: false,
    })),
    relations: [
      {
        id: "ab",
        from: "a",
        to: "b",
        kind: "derived",
        dependency: true,
        evidenceIds: [],
      },
      {
        id: "bc",
        from: "b",
        to: "c",
        kind: "derived",
        dependency: true,
        evidenceIds: [],
      },
      {
        id: "ca",
        from: "c",
        to: "a",
        kind: "derived",
        dependency: true,
        evidenceIds: [],
      },
      {
        id: "dc",
        from: "d",
        to: "c",
        kind: "derived",
        dependency: true,
        evidenceIds: ["a"],
      },
    ],
    revisions: [],
    runs: [],
    selectedAgendaId: "A",
    saved: false,
  };
};

describe("invalidateDependents", () => {
  it("propagates A to B/C, leaves unrelated D, and does not mutate input", () => {
    const p = project();
    const before = structuredClone(p);
    const out = invalidateDependents(p, ["a"]);
    expect(out.agendas.map((a) => a.needsReview)).toEqual([
      true,
      true,
      true,
      false,
    ]);
    expect(p).toEqual(before);
  });

  it("uses explicit relation evidence as a propagation root", () => {
    const p = project();
    const out = invalidateDependents(p, ["a"]);
    expect(out.agendas.find((a) => a.id === "C")?.needsReview).toBe(true);
  });

  it("keeps already marked review and ignores empty roots", () => {
    const p = project();
    p.agendas[3].needsReview = true;
    const out = invalidateDependents(p, []);
    expect(out).toEqual(p);
  });
});
