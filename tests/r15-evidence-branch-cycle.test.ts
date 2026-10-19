import { describe, expect, it } from "vitest";
import { parseInputs } from "../src/input/parse";
import {
  createProject,
  reviseProject,
  reviseSource,
  validateProject,
} from "../src/domain/project";
import type { Relation } from "../src/domain/types";
import { undoLastRevision } from "../src/domain/revisions";
import { semanticSnapshot } from "../src/domain/snapshot";
import { exportProject, importProject } from "../src/export/project";

async function fixture(reverse: boolean) {
  const p = createProject(
    await parseInputs([
      {
        name: "evidence-branch.txt",
        format: "txt",
        role: "conversation",
        text: "無関係な先行発言\n採用する\n根拠から導く主張\n第一の分岐\n第二の分岐\n分岐後の結論\n要約の所属本文\n依存しない後続発言\n既に確認待ち",
      },
    ]),
    "evidence-origin branch and join",
    "full",
  );
  const template = structuredClone(p.agendas[0]);
  p.agendas = p.utterances.map((u, index) => ({
    ...structuredClone(template),
    id: `agenda-${index}`,
    title: `議題 ${index}`,
    utteranceIds: [u.id],
    summaryDependencies: [u.id],
    boundary: "user-confirmed" as const,
    decision: "conditional" as const,
    answer: "partial" as const,
    agreement: "explicit" as const,
    verification: "user-recorded" as const,
    arrival: `保持する到達点 ${index}`,
    unresolved: [`保持する未回答 ${index}`],
    nextAction: `保持する次の確認 ${index}`,
    needsReview: index === 8,
  }));
  p.selectedAgendaId = p.agendas[0].id;
  const [unrelated, root, entry, left, right, joined, , blocked] = p.utterances;
  p.agendas[6].summaryDependencies = [left.id, joined.id];
  const dependencies: Relation[] = [
    {
      id: "evidence-only-entry",
      from: unrelated.id,
      to: entry.id,
      kind: "derived",
      dependency: true,
      evidenceIds: [root.id],
    },
    {
      id: "left-branch",
      from: entry.id,
      to: left.id,
      kind: "derived",
      dependency: true,
      evidenceIds: [],
    },
    {
      id: "right-branch",
      from: entry.id,
      to: right.id,
      kind: "derived",
      dependency: true,
      evidenceIds: [],
    },
    {
      id: "multiple-evidence-join",
      from: unrelated.id,
      to: joined.id,
      kind: "derived",
      dependency: true,
      evidenceIds: [left.id, right.id],
    },
  ];
  p.relations = [
    ...(reverse ? dependencies.reverse() : dependencies),
    {
      id: "disabled-evidence",
      from: root.id,
      to: blocked.id,
      kind: "derived",
      dependency: false,
      evidenceIds: [root.id],
    },
    {
      id: "undeclared-evidence",
      from: root.id,
      to: blocked.id,
      kind: "derived",
      evidenceIds: [root.id],
    },
  ];
  return validateProject(p);
}

describe.each([false, true])(
  "R15 evidence branch/join, reverse=%s",
  (reverse) => {
    it.each(["source", "speaker"] as const)(
      "%s correction follows evidence forward without invalidating unrelated endpoints",
      async (operation) => {
        const p = await fixture(reverse);
        const before = structuredClone(p);
        const root = p.utterances[1];
        const reason = `根拠分岐の${operation}訂正`;
        const entry = p.relations.find((r) => r.id === "evidence-only-entry")!;
        expect(entry.from).toBe(p.utterances[0].id);
        expect(entry.to).toBe(p.utterances[2].id);
        expect(entry.evidenceIds).toEqual([root.id]);
        expect(
          p.relations.filter((r) => r.dependency && r.from === root.id),
        ).toEqual([]);
        expect(p.agendas[6].utteranceIds).toEqual([p.utterances[6].id]);
        expect(p.agendas[6].summaryDependencies).toEqual([
          p.utterances[3].id,
          p.utterances[5].id,
        ]);
        expect(p.relations.slice(0, 4).map((r) => r.id)).toEqual(
          reverse
            ? [
                "multiple-evidence-join",
                "right-branch",
                "left-branch",
                "evidence-only-entry",
              ]
            : [
                "evidence-only-entry",
                "left-branch",
                "right-branch",
                "multiple-evidence-join",
              ],
        );
        const out =
          operation === "source"
            ? reviseSource(p, root.id, "採用しない", reason)
            : reviseProject(p, root.id, { speaker: "訂正後の話者" }, reason);
        expect(validateProject(out)).toBeDefined();
        expect(p).toEqual(before);
        // Literal oracle: no product dependency traversal in expected state.
        expect(out.agendas.map((a) => a.needsReview)).toEqual([
          false,
          true,
          true,
          true,
          true,
          true,
          true,
          false,
          true,
        ]);
        expect(out.agendas).toEqual(
          before.agendas.map((a, index) => ({
            ...a,
            needsReview: index !== 0 && index !== 7,
          })),
        );
        expect(out.relations).toEqual(before.relations);
        expect(out.reasoning).toEqual(before.reasoning);
        expect(out.revisions).toHaveLength(before.revisions.length + 1);
        const revision = out.revisions.at(-1)!;
        expect(revision).toMatchObject({
          targetId: root.id,
          kind: operation === "source" ? "source-revision" : "user-revision",
          reason,
        });
        if (operation === "source") {
          expect(out.utterances[1].quote).toBe("採用しない");
          expect(out.utterances[1].sourceVersionId).not.toBe(
            root.sourceVersionId,
          );
          expect(out.sources).toHaveLength(before.sources.length + 1);
          expect(out.sources.slice(0, before.sources.length)).toEqual(
            before.sources,
          );
        } else {
          expect(out.utterances[1].speaker).toBe("訂正後の話者");
          expect(out.utterances.filter((_, i) => i !== 1)).toEqual(
            before.utterances.filter((_, i) => i !== 1),
          );
          expect(out.sources).toEqual(before.sources);
        }
        const restored = importProject(
          exportProject(out, "json", undefined, false),
        );
        expect(semanticSnapshot(restored)).toEqual(semanticSnapshot(out));
        expect(restored.sources).toEqual(out.sources);
        expect(restored.revisions).toEqual(out.revisions);
        const undone = undoLastRevision(restored);
        expect(validateProject(undone)).toBeDefined();
        expect(semanticSnapshot(undone)).toEqual(semanticSnapshot(before));
        expect(undone.sources).toEqual(restored.sources);
        expect(undone.revisions.slice(0, -1)).toEqual(restored.revisions);
        expect(undone.revisions.at(-1)).toMatchObject({
          kind: "undo",
          after: { targetRevisionId: revision.id },
        });
      },
    );

    it("rejects a relation cycle before applying a correction, without mutating input", async () => {
      const p = await fixture(reverse);
      p.relations.push({
        id: "invalid-cycle",
        from: p.utterances[3].id,
        to: p.utterances[2].id,
        kind: "derived",
        dependency: true,
        evidenceIds: [],
      });
      const before = structuredClone(p);
      expect(() => validateProject(p)).toThrow(
        "relation cycle or reversed chronology rejected",
      );
      expect(() =>
        reviseProject(
          p,
          p.utterances[1].id,
          { speaker: "訂正後の話者" },
          "循環は適用不可",
        ),
      ).toThrow("relation cycle or reversed chronology rejected");
      expect(p).toEqual(before);
    });
  },
);
