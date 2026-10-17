import { describe, expect, it } from "vitest";
import type { Classification, Project } from "../src/domain/types";
import { layoutProject } from "../src/domain/layout";

function project(count = 7): Project {
  const utterances = Array.from({ length: count }, (_, index) => ({
    id: `U${index + 1}`,
    sourceId: "s",
    sourceVersionId: "s1",
    start: index,
    end: index + 1,
    quote: `発言${index + 1}`,
    speaker: "話者",
    order: index,
    line: index + 1,
    classification: (index === 2
      ? "derived"
      : index === 4 || index === 5
        ? "drift"
        : index === 6
          ? "unknown"
          : "main") as Classification,
    coverage: "mapped" as const,
    important: false,
  }));
  return {
    schemaVersion: 1,
    id: "p",
    title: "p",
    createdAt: "",
    updatedAt: "",
    extent: "full",
    sources: [],
    utterances,
    agendas: [
      {
        id: "A",
        title: "議題",
        utteranceIds: utterances.map((u) => u.id),
        boundary: "user-confirmed",
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
    relations: [
      { id: "d", from: "U4", to: "U5", kind: "drift", evidenceIds: [] },
      { id: "r", from: "U5", to: "U1", kind: "return", evidenceIds: [] },
    ],
    revisions: [],
    runs: [],
    selectedAgendaId: "A",
    saved: false,
  };
}

describe("layoutProject", () => {
  it("keeps chronological x and puts branches below the main band", () => {
    const result = layoutProject(project());
    expect(result.nodes.find((n) => n.id === "U1")?.x).toBe(35);
    expect(result.nodes.find((n) => n.id === "U2")?.x).toBe(295);
    expect(result.nodes.find((n) => n.id === "U3")?.y).toBe(315);
    expect(result.nodes.find((n) => n.id === "U5")?.y).toBe(570);
    expect(result.nodes.find((n) => n.id === "U7")?.y).toBe(655);
    expect(result.blocks[0].x).toBeLessThanOrEqual(35);
    expect(result.blocks[0].width).toBeGreaterThan(260);
  });

  it("does not let return relations change semantic coordinates", () => {
    const before = layoutProject(project());
    const changed = project();
    changed.relations = changed.relations.filter(
      (relation) => relation.kind !== "return",
    );
    expect(layoutProject(changed).nodes).toEqual(before.nodes);
  });

  it("is unchanged by selection, collapse, or split/merge UI concepts", () => {
    const before = layoutProject(project());
    const changed = project();
    changed.selectedAgendaId = "";
    changed.agendas = changed.agendas.map((agenda) => ({
      ...agenda,
      utteranceIds: [...agenda.utteranceIds].reverse(),
    }));
    expect(
      layoutProject(changed).nodes.map((node) => [node.id, node.x]),
    ).toEqual(before.nodes.map((node) => [node.id, node.x]));
  });

  it("lays out 500 nodes without mutating source data", () => {
    const input = project(500);
    const snapshot = JSON.stringify(input);
    const result = layoutProject(input);
    expect(result.nodes).toHaveLength(500);
    expect(
      result.nodes.every(
        (node) => Number.isFinite(node.x) && Number.isFinite(node.y),
      ),
    ).toBe(true);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});
