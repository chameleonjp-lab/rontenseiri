import { describe, expect, it } from "vitest";
import { exportProject, importProject } from "../src/export/project";
import { semanticSnapshot } from "../src/domain/snapshot";
import { validateProject } from "../src/domain/project";
import {
  clearIncomingReturns,
  undoLastRevision,
} from "../src/domain/revisions";
import { incomingReturnsFixture } from "./fixtures/incoming-returns";

const incomingReturnsFixtureIds = [
  "incoming-fixture-return-u03-u10",
  "incoming-fixture-return-u08-u10",
];

function relationShape(project: ReturnType<typeof incomingReturnsFixture>) {
  return project.relations.map(({ id, from, to, kind, evidenceIds }) => ({
    id,
    from,
    to,
    kind,
    evidenceIds,
  }));
}

describe("clearIncomingReturns", () => {
  it("removes only return edges whose target is U10", () => {
    const project = incomingReturnsFixture();
    const before = relationShape(project);
    const result = clearIncomingReturns(project, "U10", "復帰先を再確認");

    expect(result.relations).toEqual(
      before.filter(({ id }) => !incomingReturnsFixtureIds.includes(id)),
    );
    expect(
      result.relations.filter((r) => r.kind === "return" && r.to === "U10"),
    ).toEqual([]);
    expect(result.relations).toContainEqual(
      expect.objectContaining({
        id: "incoming-fixture-return-u03-u09",
        from: "U03",
        to: "U09",
        kind: "return",
        evidenceIds: ["U09", "U03"],
      }),
    );
    expect(result.relations).toContainEqual(
      expect.objectContaining({
        id: "incoming-fixture-main-u07-u10",
        from: "U07",
        to: "U10",
        kind: "main",
      }),
    );
    expect(result.utterances.find((u) => u.id === "U03")?.returnStatus).toBe(
      "unknown",
    );
    expect(result.utterances.find((u) => u.id === "U08")?.returnStatus).toBe(
      "unknown",
    );
    expect(result.utterances.find((u) => u.id === "U09")?.returnStatus).toBe(
      "unknown",
    );
    expect(result.utterances.find((u) => u.id === "U10")?.classification).toBe(
      project.utterances.find((u) => u.id === "U10")?.classification,
    );
    expect(result.agendas.find((a) => a.id === "議題01")?.needsReview).toBe(
      true,
    );
    expect(result.revisions).toHaveLength(1);
    expect(result.revisions[0]).toMatchObject({
      targetId: "U10",
      kind: "incoming-return-clear",
      reason: "復帰先を再確認",
    });
    expect(result.revisions[0].before).toEqual(semanticSnapshot(project));
    expect(result.revisions[0].after).toEqual(semanticSnapshot(result));
  });

  it("does not mutate its input and one Undo restores the exact semantic snapshot", () => {
    const project = incomingReturnsFixture();
    const before = semanticSnapshot(project);
    const serializedBefore = JSON.stringify(project);
    const result = clearIncomingReturns(project, "U10", "入力を保持");

    expect(JSON.stringify(project)).toBe(serializedBefore);
    expect(semanticSnapshot(project)).toEqual(before);

    const undone = undoLastRevision(result);
    expect(semanticSnapshot(undone)).toEqual(before);
    expect(undone.relations).toEqual(project.relations);
    expect(undone.utterances.map((u) => u.id)).toEqual(
      project.utterances.map((u) => u.id),
    );
    expect(undone.relations.map((r) => r.id)).toEqual(
      project.relations.map((r) => r.id),
    );
    expect(undone.relations.map((r) => r.evidenceIds)).toEqual(
      project.relations.map((r) => r.evidenceIds),
    );
    expect(undone.revisions).toHaveLength(2);
    expect(validateProject(undone)).toBeTruthy();
  });

  it("survives JSON export/import and then restores exactly with Undo", () => {
    const original = incomingReturnsFixture();
    const result = clearIncomingReturns(original, "U10", "JSON往復");
    const imported = importProject(exportProject(result, "json"));

    expect(semanticSnapshot(imported)).toEqual(semanticSnapshot(result));
    expect(imported.revisions).toHaveLength(1);
    expect(semanticSnapshot(undoLastRevision(imported))).toEqual(
      semanticSnapshot(original),
    );
  });

  it("rejects an invalid target, blank reason, and a target with no incoming return", () => {
    const project = incomingReturnsFixture();
    expect(() => clearIncomingReturns(project, "missing", "理由")).toThrow();
    expect(() => clearIncomingReturns(project, "U10", "   ")).toThrow();
    expect(() => clearIncomingReturns(project, "U16", "解除")).toThrow();
    expect(project.revisions).toHaveLength(0);
  });
});
