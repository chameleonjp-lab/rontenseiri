import { describe, expect, it } from "vitest";
import {
  linkValue,
  manualResponseLinkFixture,
} from "./fixtures/manual-response-link";
import { linkResponse } from "../src/domain/reasoning";
import { undoLastRevision } from "../src/domain/revisions";
import { semanticSnapshot } from "../src/domain/snapshot";
import { reviseProject } from "../src/domain/project";

async function reviewedFixture(route: "direct" | "evidence") {
  let p = await manualResponseLinkFixture(route);
  expect(p.agendas.find((a) => a.id === "B")!.needsReview).toBe(true);
  for (const id of ["A", "C", "B"]) {
    const agenda = p.agendas.find((a) => a.id === id)!;
    p = reviseProject(
      p,
      id,
      {
        needsReview: false,
        summaryDependencies: agenda.summaryDependencies ?? agenda.utteranceIds,
      },
      `追加前に${id}の整理内容を確認`,
    );
  }
  expect(p.agendas.every((a) => !a.needsReview)).toBe(true);
  return p;
}

describe("missing manual response link invalidation", () => {
  it.each(["direct", "evidence"] as const)(
    "%s route invalidates A and downstream C without touching S/B",
    async (route) => {
      const before = await reviewedFixture(route);
      const frozen = structuredClone(before);
      const value = linkValue(before);
      expect(before.revisions).toHaveLength(4);
      expect(before.reasoning!.revisions).toHaveLength(1);
      expect(before.reasoning!.evidence.map((e) => e.id)).toEqual(["E1", "E2"]);
      expect(
        before.agendas.map((a) => ({
          id: a.id,
          ids: a.utteranceIds,
          deps: a.summaryDependencies,
          review: a.needsReview,
        })),
      ).toEqual([
        { id: "S", ids: ["U01", "U02", "U04"], deps: [], review: false },
        { id: "A", ids: ["U03"], deps: ["U02"], review: false },
        { id: "C", ids: ["U06"], deps: ["U04"], review: false },
        { id: "B", ids: ["U05"], deps: ["U05"], review: false },
      ]);
      expect(before.reasoning!.items[0].evidenceIds).toEqual(
        route === "evidence" ? ["E1"] : [],
      );
      expect(before.relations.map((r) => [r.from, r.to, r.dependency])).toEqual(
        route === "direct"
          ? [
              ["U02", "U03", true],
              ["U03", "U04", true],
            ]
          : [["U03", "U04", true]],
      );
      expect(
        before.reasoning!.responses.some(
          (r) => r.questionVersionId === value.questionVersionId,
        ),
      ).toBe(false);
      expect(
        before.reasoning!.questionVersions.find(
          (v) => v.id === value.questionVersionId,
        )?.status,
      ).toBe("superseded");
      const reason = "missing responseを原文根拠へ通常登録";
      const linked = linkResponse(before, value, reason);
      expect(before).toEqual(frozen);
      expect(linked.reasoning!.responses).toEqual([
        ...before.reasoning!.responses,
        { ...value, id: expect.stringMatching(/^response-/) },
      ]);
      const {
        responses: _responses,
        revisions: _events,
        ...graph
      } = linked.reasoning!;
      const {
        responses: _oldResponses,
        revisions: _oldEvents,
        ...oldGraph
      } = before.reasoning!;
      expect(graph).toEqual(oldGraph);
      expect(linked.sources).toEqual(before.sources);
      expect(linked.utterances).toEqual(before.utterances);
      expect(linked.relations).toEqual(before.relations);
      expect(linked.agendas).toEqual(
        before.agendas.map((a) =>
          ["A", "C"].includes(a.id) ? { ...a, needsReview: true } : a,
        ),
      );
      expect(JSON.stringify(linked.agendas.find((a) => a.id === "B"))).toBe(
        JSON.stringify(before.agendas.find((a) => a.id === "B")),
      );
      expect(linked.revisions.slice(0, -1)).toEqual(before.revisions);
      const event = linked.revisions.at(-1)!;
      expect(event).toMatchObject({
        kind: "reasoning:response-linked",
        targetId: linked.reasoning!.responses.at(-1)!.id,
        reason,
        before: semanticSnapshot(before),
      });
      const { revisions: _newEvents, ...eventGraph } = (
        event.after as { reasoning: typeof before.reasoning }
      ).reasoning!;
      const { revisions: _linkedEvents, ...linkedGraph } = linked.reasoning!;
      expect(eventGraph).toEqual(linkedGraph);
      expect((event.after as { agendas: unknown }).agendas).toEqual(
        linked.agendas,
      );
      expect(linked.reasoning!.revisions.slice(0, -1)).toEqual(
        before.reasoning!.revisions,
      );
      const undone = undoLastRevision(linked);
      expect(semanticSnapshot(undone)).toEqual(semanticSnapshot(before));
      expect(undone.revisions.slice(0, -1)).toEqual(linked.revisions);
      expect(undone.reasoning!.revisions).toEqual(before.reasoning!.revisions);
      expect(undone.revisions.at(-1)).toMatchObject({
        kind: "undo",
        targetId: event.targetId,
        reason: `Undo: ${reason}`,
        before: semanticSnapshot(linked),
        after: { ...semanticSnapshot(before), targetRevisionId: event.id },
      });
    },
  );
  it.each(["direct", "evidence"] as const)(
    "%s route stops before C when the final explicit dependency is absent",
    async (route) => {
      const before = await reviewedFixture(route);
      before.relations = before.relations.filter((r) => r.to !== "U04");
      const linked = linkResponse(
        before,
        linkValue(before),
        "下流の依存がない対照",
      );
      expect(linked.agendas).toEqual(
        before.agendas.map((a) =>
          a.id === "A" ? { ...a, needsReview: true } : a,
        ),
      );
    },
  );
});
