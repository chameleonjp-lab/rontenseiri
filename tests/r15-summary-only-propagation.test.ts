import { describe, expect, it } from "vitest";
import { parseInputs } from "../src/input/parse";
import {
  createProject,
  reviseProject,
  reviseSource,
  validateProject,
} from "../src/domain/project";
import { undoLastRevision } from "../src/domain/revisions";
import { semanticSnapshot } from "../src/domain/snapshot";
import { exportProject, importProject } from "../src/export/project";

async function fixture(reverse: boolean) {
  const p = createProject(
    await parseInputs([
      {
        name: "summary-dependencies.txt",
        format: "txt",
        role: "conversation",
        text: "採用する\n一段目の前提\n二段目の前提\n別の議題本文\n無関係な話題\n既に確認待ち",
      },
    ]),
    "summary-only dependency",
    "full",
  );
  const template = structuredClone(p.agendas[0]);
  p.agendas = p.utterances.map((u, index) => ({
    ...structuredClone(template),
    id: `agenda-${index}`,
    title: `議題 ${index}`,
    utteranceIds: [u.id],
    arrival: `保持する到達点 ${index}`,
    unresolved: [`保持する未回答 ${index}`],
    nextAction: `保持する次の確認 ${index}`,
    needsReview: index === 5,
  }));
  p.selectedAgendaId = p.agendas[0].id;
  const [root, firstHop, secondHop, , unrelated] = p.utterances;
  p.agendas[0].summaryDependencies = [root.id];
  // An explicit empty list suppresses membership fallback, even for a reached node.
  p.agendas[1].summaryDependencies = [];
  // Agenda 2 deliberately omits summaryDependencies: legacy membership fallback.
  delete p.agendas[2].summaryDependencies;
  // Agenda 3 owns U04, but its summary depends ONLY on U03, owned by agenda 2.
  p.agendas[3].summaryDependencies = [secondHop.id];
  p.agendas[4].summaryDependencies = [unrelated.id];
  p.agendas[5].summaryDependencies = [p.utterances[5].id];
  const hops = [
    {
      id: "first-hop",
      from: root.id,
      to: firstHop.id,
      kind: "derived" as const,
      dependency: true,
      evidenceIds: [],
    },
    {
      id: "second-hop",
      from: firstHop.id,
      to: secondHop.id,
      kind: "derived" as const,
      dependency: true,
      evidenceIds: [],
    },
  ];
  p.relations = [
    ...(reverse ? hops.reverse() : hops),
    {
      id: "not-a-dependency",
      from: root.id,
      to: unrelated.id,
      kind: "derived",
      dependency: false,
      evidenceIds: [],
    },
    {
      id: "legacy-non-dependency",
      from: secondHop.id,
      to: unrelated.id,
      kind: "derived",
      evidenceIds: [],
    },
  ];
  return validateProject(p);
}

describe.each([false, true])("R15 summary-only path, reverse=%s", (reverse) => {
  it.each(["source", "classification"] as const)(
    "%s correction respects explicit summaries, preserves unrelated state, round-trips and undoes",
    async (operation) => {
      const p = await fixture(reverse);
      const before = structuredClone(p);
      const root = p.utterances[0];
      const reason = `確認済みの${operation}訂正`;
      // Protect the fixture against silently becoming a membership-only test.
      expect(p.agendas[3].utteranceIds).toEqual([p.utterances[3].id]);
      expect(p.agendas[3].summaryDependencies).toEqual([p.utterances[2].id]);
      expect(p.agendas[3].utteranceIds).not.toContain(p.utterances[2].id);
      expect(p.relations.slice(0, 2).map((r) => r.id)).toEqual(
        reverse ? ["second-hop", "first-hop"] : ["first-hop", "second-hop"],
      );
      const out =
        operation === "source"
          ? reviseSource(p, root.id, "採用しない", reason)
          : reviseProject(p, root.id, { classification: "drift" }, reason);
      expect(validateProject(out)).toBeDefined();
      expect(p).toEqual(before);
      // Literal oracle: no product traversal/helper computes expected reachability.
      expect(out.agendas.map((a) => a.needsReview)).toEqual([
        true,
        false,
        true,
        true,
        false,
        true,
      ]);
      expect(out.agendas).toEqual(
        before.agendas.map((a, index) => ({
          ...a,
          needsReview: [0, 2, 3, 5].includes(index),
        })),
      );
      expect(out.relations).toEqual(before.relations);
      expect(out.revisions).toHaveLength(before.revisions.length + 1);
      const revision = out.revisions.at(-1)!;
      expect(revision).toMatchObject({
        targetId: root.id,
        kind: operation === "source" ? "source-revision" : "user-revision",
        reason,
      });
      if (operation === "source") {
        expect(out.utterances[0].quote).toBe("採用しない");
        expect(out.utterances[0].sourceVersionId).not.toBe(
          root.sourceVersionId,
        );
        expect(out.sources).toHaveLength(before.sources.length + 1);
        expect(out.sources.slice(0, before.sources.length)).toEqual(
          before.sources,
        );
      } else {
        expect(out.utterances[0].classification).toBe("drift");
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
      // Undo restores active semantics, not an erased source catalog/audit history.
      expect(undone.sources).toEqual(restored.sources);
      expect(undone.revisions.slice(0, -1)).toEqual(restored.revisions);
      expect(undone.revisions.at(-1)).toMatchObject({
        kind: "undo",
        after: { targetRevisionId: revision.id },
      });
    },
  );
});
