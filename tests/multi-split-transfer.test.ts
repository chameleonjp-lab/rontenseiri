import { describe, expect, it } from "vitest";
import { createProject, validateProject } from "../src/domain/project";
import { parseInputs } from "../src/input/parse";
import {
  addEvidence,
  addQuestion,
  linkResponse,
} from "../src/domain/reasoning";
import {
  lineageTargetIds,
  mergeUtterances,
  resolveLineageTransfer,
  splitUtterance,
} from "../src/domain/utterance-editing";
import { undoLastRevision } from "../src/domain/revisions";
import { exportProject, importProject } from "../src/export/project";

const time = {
  asOf: "2020-01-01T00:00:00.000Z",
  recordedAt: "2020-01-01T00:00:00.000Z",
};

async function fixture() {
  let project = createProject(
    await parseInputs([
      {
        name: "conversation.txt",
        format: "txt",
        role: "conversation",
        text: "A: old answer evidence\nB: context",
      },
    ]),
    "multi-split-transfer",
    "full",
  );
  const original = project.utterances[0];
  project = addQuestion(project, "old answer?", "original", [original.id]);
  const questionVersionId = project.reasoning!.questionVersions[0].id;
  project = addEvidence(project, {
    utteranceIds: [original.id],
    sourceIds: [original.sourceId],
    actor: "manual",
    certainty: "confirmed",
    time,
  });
  const evidenceId = project.reasoning!.evidence[0].id;
  project = linkResponse(project, {
    questionVersionId,
    utteranceIds: [original.id],
    kind: "answer",
    fulfillment: "fulfilled",
    actor: "manual",
    time,
    counterargumentToClaimIds: [],
    evidenceIds: [evidenceId],
  });
  return { project, original, evidenceId };
}

async function twoRootFixture() {
  let project = createProject(
    await parseInputs([
      {
        name: "conversation.txt",
        format: "txt",
        role: "conversation",
        text: "A: first answer\nA: second answer\nB: context",
      },
    ]),
    "two-root-transfer",
    "full",
  );
  const roots = project.utterances.slice(0, 2);
  project = addQuestion(
    project,
    "both answers?",
    "original",
    roots.map((u) => u.id),
  );
  const questionVersionId = project.reasoning!.questionVersions[0].id;
  project = addEvidence(project, {
    utteranceIds: roots.map((u) => u.id),
    sourceIds: [...new Set(roots.map((u) => u.sourceId))],
    actor: "manual",
    certainty: "confirmed",
    time,
  });
  const evidenceId = project.reasoning!.evidence[0].id;
  project = linkResponse(project, {
    questionVersionId,
    utteranceIds: roots.map((u) => u.id),
    kind: "answer",
    fulfillment: "fulfilled",
    actor: "manual",
    time,
    counterargumentToClaimIds: [],
    evidenceIds: [evidenceId],
  });
  return { project, roots, evidenceId };
}

function activeReferencedUtteranceIds(
  project: ReturnType<typeof createProject>,
) {
  const refs: string[] = [];
  for (const agenda of project.agendas) refs.push(...agenda.utteranceIds);
  for (const relation of project.relations)
    refs.push(relation.from, relation.to, ...relation.evidenceIds);
  for (const value of Object.values(project.reasoning ?? {})) {
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      if (!entry || typeof entry !== "object") continue;
      for (const key of ["utteranceIds", "sourceUtteranceIds"])
        if (Array.isArray((entry as Record<string, unknown>)[key]))
          refs.push(...((entry as Record<string, unknown>)[key] as string[]));
    }
  }
  return refs;
}

describe("multi-split lineage transfer", () => {
  it("resolves the first split to live LR without reviving retired U/L across save and undo", async () => {
    const { project: base, original, evidenceId } = await fixture();
    const first = splitUtterance(base, original.id, {
      offset: 8,
      reason: "UをL/Rへ分割",
    });
    const firstRecord = first.lineage!.records.at(-1)!;
    // Use lineage IDs rather than positional assumptions: the first split creates exactly L/R.
    const firstChildren = firstRecord.newIds.map((id) =>
      first.utterances.find((u) => u.id === id)!,
    );
    const l = firstChildren[0];
    const r = firstChildren[1];
    expect(l.quote + r.quote).toBe(original.quote);

    const second = splitUtterance(first, l.id, {
      offset: 3,
      reason: "LをLL/LRへ分割",
    });
    const secondRecord = second.lineage!.records.at(-1)!;
    const secondChildren = secondRecord.newIds.map((id) =>
      second.utterances.find((u) => u.id === id)!,
    );
    const ll = secondChildren[0];
    const lr = secondChildren[1];
    expect(ll.quote + lr.quote).toBe(l.quote);
    expect(second.utterances.some((u) => u.id === original.id)).toBe(false);
    expect(second.utterances.some((u) => u.id === l.id)).toBe(false);

    const firstEvidenceRef = firstRecord.references.find(
      (ref) => ref.referenceId === evidenceId,
    )!;
    const resolved = resolveLineageTransfer(
      second,
      firstRecord.id,
      firstEvidenceRef.referenceId,
      [lr.id],
    );
    expect(lineageTargetIds(resolved, firstRecord.id)).toContain(lr.id);
    expect(
      resolved
        .lineage!.records.find((r) => r.id === firstRecord.id)!
        .references.find((ref) => ref.referenceId === evidenceId)!.targetIds,
    ).toEqual([lr.id]);
    expect(resolved.utterances.map((u) => u.id)).not.toContain(original.id);
    expect(resolved.utterances.map((u) => u.id)).not.toContain(l.id);
    expect(activeReferencedUtteranceIds(resolved)).not.toContain(original.id);
    expect(activeReferencedUtteranceIds(resolved)).not.toContain(l.id);
    expect(() => validateProject(resolved)).not.toThrow();

    const restored = importProject(exportProject(resolved, "json"));
    expect(restored.utterances.map((u) => u.id)).toEqual(
      resolved.utterances.map((u) => u.id),
    );
    expect(
      restored.reasoning!.evidence.find((e) => e.id === evidenceId)!
        .utteranceIds,
    ).toEqual(
      resolved.reasoning!.evidence.find((e) => e.id === evidenceId)!
        .utteranceIds,
    );
    expect(activeReferencedUtteranceIds(restored)).not.toContain(original.id);
    expect(activeReferencedUtteranceIds(restored)).not.toContain(l.id);
    expect(() => validateProject(restored)).not.toThrow();

    const undone = undoLastRevision(resolved);
    expect(undone.utterances.map((u) => u.id)).toEqual(
      resolved.utterances.map((u) => u.id),
    );
    expect(undone.utterances.map((u) => u.id)).not.toContain(original.id);
    expect(undone.utterances.map((u) => u.id)).not.toContain(l.id);
    expect(activeReferencedUtteranceIds(undone)).not.toContain(original.id);
    expect(activeReferencedUtteranceIds(undone)).not.toContain(l.id);
    expect(() => validateProject(undone)).not.toThrow();
  });

  it.each(["applied", "unresolved"] as const)(
    "preserves the second root through %s transfer, JSON roundtrip and Undo",
    async (status) => {
      const { project: base, roots, evidenceId } = await twoRootFixture();
      const first = splitUtterance(base, roots[0].id, {
        offset: 7,
        reason: "U01をA/Bへ分割",
      });
      const firstRecord = first.lineage!.records.at(-1)!;
      const aId = firstRecord.newIds[0];
      const second = splitUtterance(first, roots[1].id, {
        offset: 8,
        reason: "U02をC/Dへ分割",
      });
      const secondRecord = second.lineage!.records.at(-1)!;
      const referenceIds = [
        evidenceId,
        second.reasoning!.questionVersions[0].id,
        second.reasoning!.responses[0].id,
      ];
      let resolved = second;
      for (const referenceId of referenceIds)
        resolved = resolveLineageTransfer(
          resolved,
          firstRecord.id,
          referenceId,
          [aId],
          status,
        );
      const selectedTargets = status === "applied" ? [aId] : firstRecord.newIds;
      const expectedIds = [...selectedTargets, ...secondRecord.newIds];
      expect(resolved.reasoning!.evidence[0].utteranceIds).toEqual(expectedIds);
      expect(
        resolved.reasoning!.questionVersions[0].sourceUtteranceIds,
      ).toEqual(expectedIds);
      expect(resolved.reasoning!.responses[0].utteranceIds).toEqual(
        expectedIds,
      );
      expect(resolved.reasoning!.evidence[0].certainty).toBe("uncertain");
      expect(resolved.reasoning!.responses[0].fulfillment).toBe("unassessed");
      const record = resolved.lineage!.records.find(
        (r) => r.id === firstRecord.id,
      )!;
      for (const referenceId of referenceIds) {
        const ref = record.references.find(
          (r) => r.referenceId === referenceId,
        )!;
        expect(ref.targetIds).toEqual(selectedTargets);
        expect(ref.status).toBe(status);
      }
      expect(record.status).toBe(
        status === "unresolved" ? "unresolved" : "pending",
      );
      const activeIds = new Set(resolved.utterances.map((u) => u.id));
      expect(
        activeReferencedUtteranceIds(resolved).every((id) => activeIds.has(id)),
      ).toBe(true);
      for (const root of roots)
        expect(activeReferencedUtteranceIds(resolved)).not.toContain(root.id);
      const restored = importProject(exportProject(resolved, "json"));
      expect(restored.reasoning).toEqual(resolved.reasoning);
      expect(
        restored.lineage!.records.find((r) => r.id === firstRecord.id)!
          .references,
      ).toEqual(record.references);
      let undone = restored;
      for (let i = 0; i < referenceIds.length; i++)
        undone = undoLastRevision(undone);
      expect(undone.reasoning).toEqual(second.reasoning);
      expect(
        undone.lineage!.records.find((r) => r.id === firstRecord.id)!
          .references,
      ).toEqual(
        second.lineage!.records.find((r) => r.id === firstRecord.id)!
          .references,
      );
      expect(() => validateProject(undone)).not.toThrow();
    },
  );

  it("keeps a merged descendant that is also evidence for the other root", async () => {
    const { project, roots, evidenceId } = await twoRootFixture();
    const first = splitUtterance(project, roots[0].id, {
      offset: 7,
      reason: "first root",
    });
    const a = first.lineage!.records.at(-1)!;
    const second = splitUtterance(first, roots[1].id, {
      offset: 8,
      reason: "second root",
    });
    const b = second.lineage!.records.at(-1)!;
    const merged = mergeUtterances(
      second,
      [a.newIds[1], b.newIds[0]],
      "shared descendant",
    );
    const mergedId = merged.lineage!.records.at(-1)!.newIds[0];
    const resolved = resolveLineageTransfer(merged, a.id, evidenceId, [
      a.newIds[0],
    ]);
    expect(resolved.reasoning!.evidence[0].utteranceIds).toEqual([
      a.newIds[0],
      mergedId,
      b.newIds[1],
    ]);
    expect(resolved.reasoning!.responses[0].fulfillment).toBe("unassessed");
    expect(() => validateProject(resolved)).not.toThrow();
  });
});
