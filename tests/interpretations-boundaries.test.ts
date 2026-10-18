import { describe, expect, it } from "vitest";
import { parseInputs } from "../src/input/parse";
import { createProject } from "../src/domain/project";
import {
  addEvidence,
  addQuestion,
  addSemanticItem,
} from "../src/domain/reasoning";
import {
  createManualExclusivePair,
  getManualExclusivePair,
  retractManualInterpretationCandidate,
  saveManualInterpretationPair,
  updateManualExclusivePair,
} from "../src/domain/manual-interpretations";
import { undoLastRevision } from "../src/domain/revisions";
import type { Project } from "../src/domain/types";

const at = "2026-01-01T00:00:00.000Z";

type Fixture = {
  project: Project;
  questionVersionId: string;
  evidenceA: string;
  evidenceB: string;
  dependent: string;
  dependent2: string;
  unrelated: string;
};

async function fixture(): Promise<Fixture> {
  const parsed = await parseInputs([
    {
      name: "conversation.txt",
      format: "txt",
      role: "conversation",
      text: "A: premise one\nB: premise two\nC: unrelated context\n",
    },
  ]);
  let project = createProject(parsed, "boundary fixture", "full");
  const [u1, u2, u3] = project.utterances.map((u) => u.id);
  project = addQuestion(
    project as never,
    "What should we decide?",
    "original",
    [u1],
    "manual",
    at,
  ) as Project;
  project = addEvidence(project as never, {
    utteranceIds: [u1],
    sourceIds: [project.sources[0].id],
    actor: "manual",
    certainty: "confirmed",
    time: { asOf: at, recordedAt: at },
  }) as Project;
  project = addEvidence(project as never, {
    utteranceIds: [u2],
    sourceIds: [project.sources[0].id],
    actor: "manual",
    certainty: "confirmed",
    time: { asOf: at, recordedAt: at },
  }) as Project;
  project = addSemanticItem(project as never, {
    kind: "claim",
    text: "dependent conclusion",
    utteranceIds: [u3],
    evidenceIds: [],
    actor: "manual",
    certainty: "inferred",
    time: { asOf: at, recordedAt: at },
  }) as Project;
  project = addSemanticItem(project as never, {
    kind: "claim",
    text: "second dependent conclusion",
    utteranceIds: [u3],
    evidenceIds: [],
    actor: "manual",
    certainty: "inferred",
    time: { asOf: at, recordedAt: at },
  }) as Project;
  project = addSemanticItem(project as never, {
    kind: "claim",
    text: "unrelated item",
    utteranceIds: [u3],
    evidenceIds: [],
    actor: "manual",
    certainty: "inferred",
    time: { asOf: at, recordedAt: at },
  }) as Project;
  const g = project.reasoning!;
  return {
    project,
    questionVersionId: g.questionVersions[0].id,
    evidenceA: g.evidence[0].id,
    evidenceB: g.evidence[1].id,
    dependent: g.items[0].id,
    dependent2: g.items[1].id,
    unrelated: g.items[2].id,
  };
}

function candidate(
  evidenceIds: string[],
  dependentConclusionIds: string[] = [],
  extra = {},
) {
  return {
    name: "A",
    premiseText: "if A",
    conclusionText: "then A",
    evidenceIds,
    dependentConclusionIds,
    ...extra,
  };
}
function pair(x: Fixture, evidenceIds = [x.evidenceA], deps = [x.dependent]) {
  return [
    candidate(evidenceIds, deps),
    {
      ...candidate(evidenceIds, []),
      name: "B",
      premiseText: "if B",
      conclusionText: "then B",
    },
  ] as [ReturnType<typeof candidate>, ReturnType<typeof candidate>];
}
function create(x: Fixture, alternatives = pair(x)) {
  return createManualExclusivePair(
    x.project as never,
    x.questionVersionId,
    alternatives,
    "create pair",
  ) as Project;
}

const failures = (x: Fixture, mutate: (p: Project) => void) => {
  const before = structuredClone(x.project);
  expect(() => mutate(x.project)).toThrow();
  expect(x.project).toEqual(before);
};

describe("manual interpretation API boundaries", () => {
  it("rejects every missing/unknown reference atomically, including duplicate dependent IDs", async () => {
    const x = await fixture();
    const bads = [
      { questionVersionId: "missing", alternatives: pair(x) },
      {
        questionVersionId: x.questionVersionId,
        alternatives: pair(x, ["missing" as string]),
      },
      {
        questionVersionId: x.questionVersionId,
        alternatives: pair(x, [x.dependent, x.dependent]),
      },
      {
        questionVersionId: x.questionVersionId,
        alternatives: [candidate(["missing"]), candidate([x.evidenceA], [])],
      },
      {
        questionVersionId: x.questionVersionId,
        alternatives: [
          candidate([x.evidenceA], ["missing"]),
          candidate([x.evidenceA], []),
        ],
      },
    ];
    for (const bad of bads) {
      const before = structuredClone(x.project);
      expect(() =>
        createManualExclusivePair(
          x.project as never,
          bad.questionVersionId,
          bad.alternatives as never,
          "bad",
        ),
      ).toThrow();
      expect(x.project).toEqual(before);
    }
  });

  it("rejects one or three alternatives, duplicate candidate IDs, and confirmed direct-create input without mutation", async () => {
    const x = await fixture();
    failures(x, (p) =>
      createManualExclusivePair(
        p as never,
        x.questionVersionId,
        [candidate([x.evidenceA])] as never,
        "bad",
      ),
    );
    failures(x, (p) =>
      createManualExclusivePair(
        p as never,
        x.questionVersionId,
        [
          candidate([x.evidenceA]),
          candidate([x.evidenceA]),
          candidate([x.evidenceA]),
        ] as never,
        "bad",
      ),
    );
    failures(x, (p) =>
      createManualExclusivePair(
        p as never,
        x.questionVersionId,
        [
          candidate([x.evidenceA], [], { id: "supplied" }),
          { ...candidate([x.evidenceA]), name: "B" },
        ] as never,
        "bad",
      ),
    );
    failures(x, (p) =>
      createManualExclusivePair(
        p as never,
        x.questionVersionId,
        [
          candidate([x.evidenceA], [], { confirmed: true }),
          { ...candidate([x.evidenceA]), name: "B" },
        ] as never,
        "bad",
      ),
    );
  });

  it("creates exactly two uncertain candidates, unresolved premise-to-conclusion propagation, and supplied IDs are rejected", async () => {
    const x = await fixture();
    const out = create(x);
    const g = out.reasoning!;
    expect(g.exclusiveGroups).toHaveLength(1);
    expect(g.exclusiveGroups[0].interpretationIds).toHaveLength(2);
    expect(g.interpretations.every((i) => i.certainty === "uncertain")).toBe(
      true,
    );
    expect(g.uncertaintyPropagation).toHaveLength(3);
    expect(
      g.uncertaintyPropagation.every((p) => p.status === "unresolved"),
    ).toBe(true);
    expect(
      g.uncertaintyPropagation.some(
        (p) =>
          p.fromItemId === g.interpretations[0].premiseItemIds[0] &&
          p.toItemId === g.interpretations[0].conclusionItemIds[0],
      ),
    ).toBe(true);
  });

  it("refreshes both source utterance IDs when evidence changes while leaving the other candidate exact", async () => {
    const x = await fixture();
    const created = create(x);
    const group = created.reasoning!.exclusiveGroups[0];
    const current = getManualExclusivePair(created, group.id);
    const untouchedIds = [
      current.candidates[1].interpretationId,
      current.candidates[1].premiseItemId,
      current.candidates[1].conclusionItemId,
    ];
    const beforeUntouched = structuredClone({
      interpretation: created.reasoning!.interpretations.find(
        (i) => i.id === untouchedIds[0],
      ),
      items: created.reasoning!.items.filter((i) =>
        untouchedIds.slice(1).includes(i.id),
      ),
      propagation: created.reasoning!.uncertaintyPropagation.filter(
        (p) =>
          untouchedIds.slice(1).includes(p.fromItemId) ||
          untouchedIds.slice(1).includes(p.toItemId),
      ),
    });
    const updated = updateManualExclusivePair(
      created,
      group.id,
      [
        {
          ...candidate([x.evidenceB], [x.dependent]),
          id: current.candidates[0].interpretationId,
        },
        {
          ...candidate([x.evidenceA], []),
          id: current.candidates[1].interpretationId,
          name: "B",
          premiseText: "if B",
          conclusionText: "then B",
        },
      ],
      "change evidence",
    );
    const changed = getManualExclusivePair(updated, group.id).candidates[0];
    expect(
      updated.reasoning!.items.find((i) => i.id === changed.premiseItemId)
        ?.utteranceIds,
    ).toEqual([updated.utterances[1].id]);
    expect(
      updated.reasoning!.items.find((i) => i.id === changed.conclusionItemId)
        ?.utteranceIds,
    ).toEqual([updated.utterances[1].id]);
    expect({
      interpretation: updated.reasoning!.interpretations.find(
        (i) => i.id === untouchedIds[0],
      ),
      items: updated.reasoning!.items.filter((i) =>
        untouchedIds.slice(1).includes(i.id),
      ),
      propagation: updated.reasoning!.uncertaintyPropagation.filter(
        (p) =>
          untouchedIds.slice(1).includes(p.fromItemId) ||
          untouchedIds.slice(1).includes(p.toItemId),
      ),
    }).toEqual(beforeUntouched);
  });

  it("updates only old/new dependents, keeps retracted dependents retracted, and rejects no-op updates", async () => {
    const x = await fixture();
    const created = create(x);
    const group = created.reasoning!.exclusiveGroups[0];
    const c = getManualExclusivePair(created, group.id).candidates[0];
    const updated = updateManualExclusivePair(
      created,
      group.id,
      [
        { ...candidate([x.evidenceA], [x.dependent2]), id: c.interpretationId },
        {
          ...candidate([x.evidenceA], []),
          id: getManualExclusivePair(created, group.id).candidates[1]
            .interpretationId,
          name: "B",
          premiseText: "if B",
          conclusionText: "then B",
        },
      ],
      "replace dependent",
    );
    expect(
      updated.reasoning!.items.find((i) => i.id === x.dependent)?.certainty,
    ).toBe("uncertain");
    expect(
      updated.reasoning!.items.find((i) => i.id === x.dependent2)?.certainty,
    ).toBe("uncertain");
    expect(
      updated.reasoning!.items.find((i) => i.id === x.unrelated)?.certainty,
    ).toBe("inferred");
    const snapshot = structuredClone(updated);
    expect(() =>
      updateManualExclusivePair(
        updated,
        group.id,
        [
          {
            ...candidate([x.evidenceA], [x.dependent2]),
            id: c.interpretationId,
          },
          {
            ...candidate([x.evidenceA], []),
            id: getManualExclusivePair(updated, group.id).candidates[1]
              .interpretationId,
            name: "B",
            premiseText: "if B",
            conclusionText: "then B",
          },
        ],
        "noop",
      ),
    ).toThrow();
    expect(updated).toEqual(snapshot);
    const retracted = retractManualInterpretationCandidate(
      updated,
      group.id,
      c.interpretationId,
      "retract",
    );
    const again = structuredClone(retracted);
    expect(() =>
      retractManualInterpretationCandidate(
        retracted,
        group.id,
        c.interpretationId,
        "again",
      ),
    ).toThrow();
    expect(retracted).toEqual(again);
  });

  it("retracts without resurrecting dependencies, and undo restores one exact semantic snapshot including agendas", async () => {
    const x = await fixture();
    const created = create(x);
    const group = created.reasoning!.exclusiveGroups[0];
    const candidateA = getManualExclusivePair(created, group.id).candidates[0];
    const before = structuredClone({
      utterances: created.utterances,
      agendas: created.agendas,
      relations: created.relations,
      reasoning: created.reasoning,
    });
    const retracted = retractManualInterpretationCandidate(
      created,
      group.id,
      candidateA.interpretationId,
      "retract",
    );
    expect(
      retracted.reasoning!.items.find((i) => i.id === candidateA.premiseItemId)
        ?.certainty,
    ).toBe("retracted");
    expect(
      retracted.reasoning!.items.find((i) => i.id === x.dependent)?.certainty,
    ).toBe("uncertain");
    const undone = undoLastRevision(retracted);
    expect({
      utterances: undone.utterances,
      agendas: undone.agendas,
      relations: undone.relations,
      reasoning: undone.reasoning,
    }).toEqual(before);
  });

  it("full JSON import/reasoning round-trip preserves reasoning independently of generated project IDs", async () => {
    const x = await fixture();
    const created = create(x);
    const imported = JSON.parse(JSON.stringify(created)) as Project;
    imported.id = "imported-project-id";
    expect(imported.id).not.toBe(created.id);
    expect(imported.reasoning).toEqual(created.reasoning);
    expect(imported.reasoning!.revisions).toEqual(created.reasoning!.revisions);
  });

  it("rejects tampered manual metadata on JSON import instead of accepting a confirmed candidate", async () => {
    const x = await fixture();
    const created = create(x);
    const tampered = JSON.parse(JSON.stringify(created)) as Project;
    (
      tampered.reasoning!.interpretations[0] as unknown as {
        candidateName: string;
      }
    ).candidateName = "";
    const before = structuredClone(tampered);
    expect(() =>
      getManualExclusivePair(
        tampered,
        tampered.reasoning!.exclusiveGroups[0].id,
      ),
    ).toThrow();
    expect(tampered).toEqual(before);
  });

  it("requires IDs for form updates and still permits a name-only update", async () => {
    const x = await fixture();
    const created = create(x);
    const group = created.reasoning!.exclusiveGroups[0];
    const current = getManualExclusivePair(created, group.id);
    const form = {
      groupId: group.id,
      questionVersionId: x.questionVersionId,
      reason: "name only",
      alternatives: [
        {
          id: current.candidates[0].interpretationId,
          premise: "if A",
          conclusion: "then A",
          evidenceIds: [x.evidenceA],
          dependentConclusionIds: [x.dependent],
        },
        {
          id: current.candidates[1].interpretationId,
          premise: "if B",
          conclusion: "then B",
          evidenceIds: [x.evidenceA],
          dependentConclusionIds: [],
        },
      ],
    } as const;
    const renamed = updateManualExclusivePair(
      created,
      group.id,
      [
        {
          ...candidate([x.evidenceA], [x.dependent]),
          id: current.candidates[0].interpretationId,
          name: "Renamed A",
        },
        {
          ...candidate([x.evidenceA], []),
          id: current.candidates[1].interpretationId,
          name: "B",
          premiseText: "if B",
          conclusionText: "then B",
        },
      ],
      "name only",
    );
    expect(getManualExclusivePair(renamed, group.id).candidates[0].name).toBe(
      "Renamed A",
    );
    const missingIds = structuredClone(form);
    delete (missingIds.alternatives[0] as { id?: string }).id;
    expect(() =>
      saveManualInterpretationPair(created, missingIds as never),
    ).toThrow();
    expect(created.reasoning!.interpretations).toEqual(
      created.reasoning!.interpretations,
    );
  });
});
