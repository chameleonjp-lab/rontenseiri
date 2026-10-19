import { describe, expect, it } from "vitest";
import * as reasoning from "../src/domain/reasoning";
import { undoLastRevision } from "../src/domain/revisions";
import { semanticSnapshot } from "../src/domain/snapshot";
import { exportProject, importProject } from "../src/export/project";
import { createManualExclusivePair } from "../src/domain/manual-interpretations";
import type { Project } from "../src/domain/types";
import {
  ITEM_PATCH,
  ITEM_EDIT_REASON,
  reviewedSemanticItemFixture,
} from "./fixtures/semantic-item-correction";

const item = (p: Project) => p.reasoning!.items.find((x) => x.id === "I1")!;

describe("R17 bounded semantic-item correction", () => {
  it("edits only explicit fields, invalidates old/new/downstream summaries and keeps unrelated data and provenance", async () => {
    const before = await reviewedSemanticItemFixture();
    const frozen = structuredClone(before);
    expect(before.agendas.every((a) => !a.needsReview)).toBe(true);
    expect(before.revisions).toHaveLength(5);
    const out = reasoning.updateSemanticItem(
      before,
      "I1",
      ITEM_PATCH,
      ITEM_EDIT_REASON,
    );
    expect(before).toEqual(frozen);
    expect(item(out)).toEqual({ ...item(before), ...ITEM_PATCH });
    const { items: _items, revisions: _events, ...graph } = out.reasoning!;
    const {
      items: _oldItems,
      revisions: _oldEvents,
      ...oldGraph
    } = before.reasoning!;
    expect(graph).toEqual(oldGraph);
    expect(out.reasoning!.items.filter((x) => x.id !== "I1")).toEqual(
      before.reasoning!.items.filter((x) => x.id !== "I1"),
    );
    expect(out.sources).toEqual(before.sources);
    expect(out.utterances).toEqual(before.utterances);
    expect(out.relations).toEqual(before.relations);
    expect(out.agendas).toEqual(
      before.agendas.map((a) =>
        ["A", "N", "C"].includes(a.id) ? { ...a, needsReview: true } : a,
      ),
    );
    expect(out.revisions.slice(0, -1)).toEqual(before.revisions);
    const event = out.revisions.at(-1)!;
    expect(event).toMatchObject({
      targetId: "I1",
      kind: "reasoning:semantic-item-updated",
      reason: ITEM_EDIT_REASON,
    });
    expect(event.before).toEqual(semanticSnapshot(before));
    expect(event.after).toEqual(
      semanticSnapshot({
        ...out,
        reasoning: {
          ...out.reasoning!,
          revisions: before.reasoning!.revisions,
        },
      }),
    );
    expect(out.reasoning!.revisions.slice(0, -1)).toEqual(
      before.reasoning!.revisions,
    );
    expect(out.reasoning!.revisions.at(-1)).toMatchObject({
      targetId: "I1",
      kind: "semantic-item-updated",
      reason: ITEM_EDIT_REASON,
      before: { revisionId: event.id },
      after: { revisionId: event.id },
    });
    const undone = undoLastRevision(out);
    expect(semanticSnapshot(undone)).toEqual(semanticSnapshot(before));
    expect(undone.revisions.slice(0, -1)).toEqual(out.revisions);
    expect(undone.revisions.at(-1)!.after).toMatchObject({
      targetRevisionId: event.id,
    });
  });

  it("invalidates an explicit rebuttal target on a text-only edit, without marking the new-source-only summary", async () => {
    const before = await reviewedSemanticItemFixture();
    const out = reasoning.updateSemanticItem(
      before,
      "I1",
      { text: "費用には条件がある" },
      "内容だけの訂正",
    );
    expect(out.agendas).toEqual(
      before.agendas.map((a) =>
        ["A", "C"].includes(a.id) ? { ...a, needsReview: true } : a,
      ),
    );
    expect(out.reasoning!.responses).toEqual(before.reasoning!.responses);
    expect(item(out).utteranceIds).toEqual(["U02"]);
  });

  it("preserves identity, certainty, registration time, origin and optional metadata even against runtime patch injection", async () => {
    const before = await reviewedSemanticItemFixture();
    const hostile = {
      text: " 内容だけ訂正 ",
      id: "spoof",
      actor: "manual",
      certainty: "confirmed",
      time: { asOf: "2099-01-01", recordedAt: "2099-01-01" },
      scope: "spoof",
      termDefinition: "spoof",
      counterargumentToId: "I-B",
    };
    const out = reasoning.updateSemanticItem(
      before,
      "I1",
      hostile,
      "内容だけ照合",
    );
    expect(item(out)).toEqual({ ...item(before), text: "内容だけ訂正" });
    expect(out.reasoning!.responses).toEqual(before.reasoning!.responses);
    const noEvidence = reasoning.updateSemanticItem(
      before,
      "I1",
      { evidenceIds: [] },
      "関連根拠のみ解除",
    );
    expect(item(noEvidence)).toEqual({ ...item(before), evidenceIds: [] });
    expect(item(noEvidence).certainty).toBe("inferred");
  });

  it("rejects invalid/unknown/duplicate/empty references, empty text/reason and confirmed-without-evidence without mutating input", async () => {
    const before = await reviewedSemanticItemFixture(),
      frozen = structuredClone(before);
    for (const patch of [
      { text: " " },
      { text: null },
      { kind: "invalid" },
      { utteranceIds: [] },
      { utteranceIds: ["missing"] },
      { utteranceIds: ["U02", "U02"] },
      { evidenceIds: ["missing"] },
      { evidenceIds: ["E1", "E1"] },
      { evidenceIds: null },
    ]) {
      expect(() =>
        reasoning.updateSemanticItem(
          before,
          "I1",
          patch as Parameters<typeof reasoning.updateSemanticItem>[2],
          "拒否テスト",
        ),
      ).toThrow();
      expect(before).toEqual(frozen);
    }
    expect(() =>
      reasoning.updateSemanticItem(before, "missing", ITEM_PATCH, "不明項目"),
    ).toThrow();
    expect(() =>
      reasoning.updateSemanticItem(before, "I1", ITEM_PATCH, " "),
    ).toThrow();
    expect(before).toEqual(frozen);
    const confirmed = structuredClone(before);
    item(confirmed).certainty = "confirmed";
    expect(() =>
      reasoning.updateSemanticItem(
        confirmed,
        "I1",
        { evidenceIds: [] },
        "根拠なしへの昇格は不可",
      ),
    ).toThrow();
    expect(item(confirmed).evidenceIds).toEqual(["E1"]);
  });

  it("keeps exclusive-pair managed items on their dedicated atomic editor", async () => {
    const before = createManualExclusivePair(
      await reviewedSemanticItemFixture(),
      "Q1-v1",
      [
        {
          name: "A",
          premiseText: "税込",
          conclusionText: "条件付き",
          evidenceIds: ["E1"],
        },
        {
          name: "B",
          premiseText: "税別",
          conclusionText: "未確定",
          evidenceIds: ["E2"],
        },
      ],
      "排他的候補の登録",
    );
    const frozen = structuredClone(before);
    for (const i of before.reasoning!.interpretations)
      for (const id of [...i.premiseItemIds, ...i.conclusionItemIds]) {
        expect(reasoning.isExclusiveInterpretationItem(before, id)).toBe(true);
        expect(() =>
          reasoning.updateSemanticItem(
            before,
            id,
            { text: "片側だけ上書き" },
            "専用編集を経ない変更",
          ),
        ).toThrow(/解釈候補/);
      }
    expect(reasoning.isExclusiveInterpretationItem(before, "I1")).toBe(false);
    expect(before).toEqual(frozen);
  });

  it("roundtrips the full active state and audit before/after Undo while restricted output excludes graph/history", async () => {
    const before = await reviewedSemanticItemFixture();
    const changed = reasoning.updateSemanticItem(
      before,
      "I1",
      ITEM_PATCH,
      ITEM_EDIT_REASON,
    );
    for (const p of [changed, undoLastRevision(changed)]) {
      const restored = importProject(
        exportProject(p, "json", undefined, false),
      );
      expect(semanticSnapshot(restored)).toEqual(semanticSnapshot(p));
      expect(restored.revisions).toEqual(p.revisions);
    }
    const limited = exportProject(changed, "json", "S", false, ["U03"]);
    const dto = JSON.parse(limited).project;
    expect(dto.reasoning).toBeUndefined();
    expect(dto.revisions).toEqual([]);
    expect(limited).not.toContain("非公開マーカー");
    expect(limited).not.toContain(ITEM_EDIT_REASON);
    expect(limited).not.toContain(ITEM_PATCH.text);
  });
});
