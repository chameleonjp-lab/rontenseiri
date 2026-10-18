import { describe, expect, it } from "vitest";
import { sampleProject } from "../src/analysis/sample";
import {
  resolveLineageTransfer,
  splitUtterance,
} from "../src/domain/utterance-editing";
import { exportProject, importProject } from "../src/export/project";
import { undoLastRevision } from "../src/domain/revisions";

function fixture() {
  const p = sampleProject();
  const second = p.utterances.find((u) => u.id === "U03")!;
  second.id = "U02";
  p.agendas[0].utteranceIds = p.agendas[0].utteranceIds.map((id) =>
    id === "U03" ? "U02" : id,
  );
  p.relations = [];
  p.reasoning = {
    questions: [
      {
        id: "q",
        origin: "original",
        versionIds: ["qv"],
        currentVersionId: "qv",
      },
    ],
    questionVersions: [
      {
        id: "qv",
        questionId: "q",
        text: "?",
        status: "active",
        actor: "manual",
        time: { asOf: "2026-01-01", recordedAt: "2026-01-01" },
        sourceUtteranceIds: ["U01", "U02"],
      },
    ],
    responses: [
      {
        id: "r",
        questionVersionId: "qv",
        utteranceIds: ["U01", "U02"],
        kind: "answer",
        fulfillment: "fulfilled",
        actor: "manual",
        time: { asOf: "2026-01-01", recordedAt: "2026-01-01" },
        counterargumentToClaimIds: [],
        evidenceIds: ["e"],
      },
    ],
    evidence: [
      {
        id: "e",
        utteranceIds: ["U01", "U02"],
        sourceIds: ["sample-source"],
        actor: "manual",
        certainty: "confirmed",
        time: { asOf: "2026-01-01", recordedAt: "2026-01-01" },
      },
    ],
    items: [
      {
        id: "i",
        kind: "claim",
        text: "claim",
        utteranceIds: ["U01", "U02"],
        evidenceIds: ["e"],
        actor: "manual",
        certainty: "confirmed",
        time: { asOf: "2026-01-01", recordedAt: "2026-01-01" },
      },
    ],
    positionChanges: [],
    interpretations: [],
    exclusiveGroups: [],
    uncertaintyPropagation: [],
    revisions: [],
  };
  const first = splitUtterance(p, "U01", 2, "split U01");
  const a = first.lineage!.records.at(-1)!;
  const secondSplit = splitUtterance(first, "U02", 2, "split U02");
  const b = secondSplit.lineage!.records.at(-1)!;
  return { p: secondSplit, a, b };
}

function refs(project: ReturnType<typeof fixture>["p"]) {
  const graph = project.reasoning!;
  return {
    question: graph.questionVersions[0].sourceUtteranceIds,
    response: graph.responses[0].utteranceIds,
    evidence: graph.evidence[0].utteranceIds,
    item: graph.items[0].utteranceIds,
  };
}

describe("multi-root split transfer locality", () => {
  it("applied selection replaces only the selected root and survives JSON and Undo", () => {
    const { p, a, b } = fixture();
    let resolved = p;
    for (const referenceId of ["e", "qv", "r", "i"])
      resolved = resolveLineageTransfer(
        resolved,
        a.id,
        referenceId,
        [a.newIds[0]],
        "applied",
        "select A",
      );
    const r = refs(resolved);
    for (const ids of Object.values(r)) {
      expect(ids).toEqual([a.newIds[0], ...b.newIds]);
      expect(ids).toContain(a.newIds[0]);
      expect(ids).toEqual(expect.arrayContaining(b.newIds));
      expect(ids).not.toContain("U02");
      expect(ids).not.toContain("U01");
      expect(ids).not.toContain(a.newIds[1]);
    }
    expect(resolved.reasoning!.responses[0].fulfillment).toBe("unassessed");
    const roundTrip = importProject(
      exportProject(resolved, "json", undefined, true),
    );
    expect(refs(roundTrip)).toEqual(r);
    for (const referenceId of ["e", "qv", "r", "i"]) {
      const reference = roundTrip
        .lineage!.records.find((record) => record.id === a.id)!
        .references.find((ref) => ref.referenceId === referenceId)!;
      expect(reference.targetIds).toEqual([a.newIds[0]]);
      expect(reference.status).toBe("applied");
    }
    expect(roundTrip.reasoning!.responses[0].fulfillment).toBe("unassessed");
    let undone = resolved;
    for (let i = 0; i < 4; i++) undone = undoLastRevision(undone);
    expect(refs(undone)).toEqual(refs(p));
  });

  it("unresolved transfer keeps the other root's current references", () => {
    const { p, a, b } = fixture();
    const selected = resolveLineageTransfer(
      p,
      a.id,
      "e",
      [a.newIds[0]],
      "applied",
      "select A",
    );
    const resolved = resolveLineageTransfer(
      selected,
      a.id,
      "e",
      [a.newIds[0]],
      "unresolved",
      "unresolved",
    );
    const r = refs(resolved);
    for (const ids of Object.values(r)) {
      expect(ids).toEqual([...a.newIds, ...b.newIds]);
      expect(ids).toEqual(expect.arrayContaining(b.newIds));
      expect(ids).not.toContain("U02");
      expect(ids).not.toContain("U01");
    }
    expect(
      resolved
        .lineage!.records.find((x) => x.id === a.id)!
        .references.find((x) => x.referenceId === "e")!.status,
    ).toBe("unresolved");
    const roundTrip = importProject(
      exportProject(resolved, "json", undefined, true),
    );
    expect(refs(roundTrip)).toEqual(r);
    const reference = roundTrip
      .lineage!.records.find((record) => record.id === a.id)!
      .references.find((ref) => ref.referenceId === "e")!;
    expect(reference.targetIds).toEqual(a.newIds);
    expect(reference.status).toBe("unresolved");
    expect(roundTrip.reasoning!.responses[0].fulfillment).toBe("unassessed");
    const undone = undoLastRevision(roundTrip);
    expect(refs(undone)).toEqual(refs(selected));
    expect(
      undone
        .lineage!.records.find((record) => record.id === a.id)!
        .references.find((ref) => ref.referenceId === "e")!.status,
    ).toBe("applied");
  });
});
