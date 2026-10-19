import { describe, expect, it } from "vitest";
import { parseInputs } from "../src/input/parse";
import {
  createProject,
  reviseProject,
  reviseSource,
  validateProject,
} from "../src/domain/project";
import { createReasoningGraph } from "../src/domain/reasoning";
import { undoLastRevision } from "../src/domain/revisions";
import { semanticSnapshot } from "../src/domain/snapshot";
import { exportProject, importProject } from "../src/export/project";

async function fixture(reverse: boolean) {
  const p = createProject(
    await parseInputs([
      {
        name: "alternating-dependencies.txt",
        format: "txt",
        role: "conversation",
        text: "採用する\n第一の問い\n第一の応答\n第二の問い\n第二の応答\n要約の所属本文\n無関係な話題\n既に確認待ち",
      },
    ]),
    "alternating relation and reasoning dependencies",
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
    needsReview: index === 7,
  }));
  p.selectedAgendaId = p.agendas[0].id;
  const [root, q1, r1, q2, r2, , unrelated] = p.utterances;
  p.agendas[5].summaryDependencies = [r2.id];
  const hops = [
    {
      id: "relation-entry",
      from: root.id,
      to: q1.id,
      kind: "derived" as const,
      dependency: true,
      evidenceIds: [],
    },
    {
      id: "relation-bridge",
      from: r1.id,
      to: q2.id,
      kind: "derived" as const,
      dependency: true,
      evidenceIds: [],
    },
  ];
  p.relations = [
    ...(reverse ? hops.reverse() : hops),
    {
      id: "explicitly-disabled",
      from: r2.id,
      to: unrelated.id,
      kind: "derived",
      dependency: false,
      evidenceIds: [],
    },
    {
      id: "not-declared-dependent",
      from: root.id,
      to: unrelated.id,
      kind: "derived",
      evidenceIds: [],
    },
  ];
  const g = createReasoningGraph();
  const time = {
    asOf: "2026-10-17T00:00:00.000Z",
    recordedAt: "2026-10-18T00:00:00.000Z",
  };
  for (const [index, questionUtterance, responseUtterance] of [
    [1, q1, r1],
    [2, q2, r2],
  ] as const) {
    const questionId = `question-${index}`;
    const versionId = `question-version-${index}`;
    g.questions.push({
      id: questionId,
      origin: "original",
      versionIds: [versionId],
      currentVersionId: versionId,
    });
    g.questionVersions.push({
      id: versionId,
      questionId,
      text: questionUtterance.quote,
      status: "active",
      actor: "manual",
      time,
      sourceUtteranceIds: [questionUtterance.id],
    });
    g.responses.push({
      id: `response-${index}`,
      questionVersionId: versionId,
      utteranceIds: [responseUtterance.id],
      kind: "answer",
      fulfillment: "partially-fulfilled",
      actor: "manual",
      time,
      counterargumentToClaimIds: [],
      evidenceIds: [],
    });
  }
  if (reverse) {
    g.questions.reverse();
    g.questionVersions.reverse();
    g.responses.reverse();
  }
  p.reasoning = g;
  return validateProject(p);
}

describe.each([false, true])(
  "R15 alternating dependencies, reverse=%s",
  (reverse) => {
    it.each(["source", "classification"] as const)(
      "%s correction crosses both relation/reasoning bridges and survives JSON plus Undo",
      async (operation) => {
        const p = await fixture(reverse);
        const before = structuredClone(p);
        const root = p.utterances[0];
        const reason = `交互依存の${operation}訂正`;
        // The final summary owner is not itself in the dependency path.
        expect(p.agendas[5].utteranceIds).toEqual([p.utterances[5].id]);
        expect(p.agendas[5].summaryDependencies).toEqual([p.utterances[4].id]);
        expect(p.relations.slice(0, 2).map((r) => r.id)).toEqual(
          reverse
            ? ["relation-bridge", "relation-entry"]
            : ["relation-entry", "relation-bridge"],
        );
        expect(p.reasoning!.responses.map((r) => r.id)).toEqual(
          reverse ? ["response-2", "response-1"] : ["response-1", "response-2"],
        );
        const out =
          operation === "source"
            ? reviseSource(p, root.id, "採用しない", reason)
            : reviseProject(p, root.id, { classification: "drift" }, reason);
        expect(validateProject(out)).toBeDefined();
        expect(p).toEqual(before);
        // Literal reachability oracle, independent of product traversal helpers.
        expect(out.agendas.map((a) => a.needsReview)).toEqual([
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
            needsReview: index !== 6,
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
          expect(out.utterances[0].quote).toBe("採用しない");
          expect(out.utterances[0].sourceVersionId).not.toBe(
            root.sourceVersionId,
          );
          expect(out.sources.slice(0, before.sources.length)).toEqual(
            before.sources,
          );
          expect(out.sources).toHaveLength(before.sources.length + 1);
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
        expect(undone.sources).toEqual(restored.sources);
        expect(undone.revisions.slice(0, -1)).toEqual(restored.revisions);
        expect(undone.revisions.at(-1)).toMatchObject({
          kind: "undo",
          after: { targetRevisionId: revision.id },
        });
      },
    );
  },
);
