import { describe, expect, it } from "vitest";
import { sampleProject } from "../src/analysis/sample";
import { reviseProject, validateProject } from "../src/domain/project";
import { undoLastRevision } from "../src/domain/revisions";
import { exportProject, importProject } from "../src/export/project";

function linkedProject() {
  const project = sampleProject();
  project.relations = [
    {
      id: "return-U08-U10",
      from: "U08",
      to: "U10",
      kind: "return",
      evidenceIds: ["U08", "U10"],
    },
  ];
  return validateProject(project);
}

describe("return relation consistency", () => {
  it("汎用APIはreturnStatus:noneとreturn edgeの共存を許可しない", () => {
    const project = linkedProject();
    // The public dd0 fixture names its second utterance U02; the authored
    // sample uses U03 for the same position, so keep the fixture otherwise
    // identical while translating that stable public ID.
    const second = project.utterances.find((u) => u.id === "U03")!;
    second.id = "U02";
    for (const agenda of project.agendas)
      agenda.utteranceIds = agenda.utteranceIds.map((id) =>
        id === "U03" ? "U02" : id,
      );
    project.utterances.find((u) => u.id === "U01")!.classification = "drift";
    project.utterances.find((u) => u.id === "U02")!.classification = "main";
    project.relations = [
      {
        id: "r1",
        from: "U01",
        to: "U02",
        kind: "return",
        evidenceIds: ["U01", "U02"],
      },
    ];
    const out = reviseProject(
      project,
      "U01",
      { returnStatus: "none" },
      "復帰なしに訂正",
    );
    expect(() => validateProject(out)).not.toThrow();
    expect(out.utterances.find((u) => u.id === "U01")?.returnStatus).toBe(
      "none",
    );
    expect(out.relations).toEqual([]);
  });

  it("rejects an explicitly none source with a return edge", () => {
    const project = linkedProject();
    const invalid = structuredClone(project);
    invalid.utterances.find((u) => u.id === "U08")!.returnStatus = "none";
    expect(() => validateProject(invalid)).toThrow(/returnStatus none/);
  });

  it("generic returnStatus none removes only source return edges and is undoable", () => {
    const project = linkedProject();
    const targetBefore = structuredClone(
      project.utterances.find((u) => u.id === "U10"),
    );
    const revised = reviseProject(
      project,
      "U08",
      { returnStatus: "none" },
      "復帰なしを確認",
    );
    expect(revised.relations.some((r) => r.kind === "return")).toBe(false);
    expect(revised.utterances.find((u) => u.id === "U10")).toEqual(
      targetBefore,
    );
    expect(revised.revisions.at(-1)?.before).toMatchObject({
      __projectSnapshot: { relations: project.relations },
    });

    const undone = undoLastRevision(revised);
    expect(undone.relations).toEqual(project.relations);
    expect(undone.utterances.find((u) => u.id === "U08")?.returnStatus).toBe(
      undefined,
    );
  });

  it("keeps legacy omitted status with an edge through JSON round-trip", () => {
    const project = linkedProject();
    const restored = importProject(
      exportProject(project, "json", undefined, false),
    );
    expect(restored.relations).toEqual(project.relations);
    expect(restored.utterances.find((u) => u.id === "U08")?.returnStatus).toBe(
      undefined,
    );
  });
});
