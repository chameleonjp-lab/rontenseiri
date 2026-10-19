import { describe, expect, it } from "vitest";
import * as reasoning from "../src/domain/reasoning";
import { undoLastRevision } from "../src/domain/revisions";
import { semanticSnapshot } from "../src/domain/snapshot";
import { invalidateDependents } from "../src/domain/invalidation";
import { reviseProject } from "../src/domain/project";
import { exportProject, importProject } from "../src/export/project";
import {
  EVIDENCE_EDIT_REASON,
  evidenceCorrectionFixture,
  evidenceCorrectionPatch,
} from "./fixtures/evidence-correction";

const evidence = (p: Awaited<ReturnType<typeof evidenceCorrectionFixture>>) =>
  p.reasoning!.evidence.find((x) => x.id === "E1")!;

describe("R17 bounded evidence correction", () => {
  it("updates selected utterances and note, derives sources, and invalidates old/new consumers and downstream", async () => {
    const before = await evidenceCorrectionFixture();
    const frozen = structuredClone(before);
    const out = reasoning.updateEvidence(
      before,
      "E1",
      evidenceCorrectionPatch,
      EVIDENCE_EDIT_REASON,
    );
    expect(before).toEqual(frozen);
    expect(evidence(out)).toEqual({
      ...evidence(before),
      ...evidenceCorrectionPatch,
      sourceIds: [before.sources[0].id],
    });
    expect(out.agendas.map((a) => [a.id, a.needsReview])).toEqual([
      ["S", false],
      ["A", true],
      ["C", true],
      ["B", false],
    ]);
    expect(out.reasoning!.items.find((x) => x.id === "I1")).toEqual(
      before.reasoning!.items.find((x) => x.id === "I1"),
    );
    expect(out.reasoning!.responses).toEqual(before.reasoning!.responses);
    expect(out.reasoning!.positionChanges).toEqual(
      before.reasoning!.positionChanges,
    );
    expect(out.revisions.at(-1)).toMatchObject({
      targetId: "E1",
      kind: "reasoning:evidence-updated",
      reason: EVIDENCE_EDIT_REASON,
    });
    expect(out.reasoning!.revisions.at(-1)).toMatchObject({
      targetId: "E1",
      kind: "evidence-updated",
    });
  });

  it("keeps explicit evidence dependencies on a note-only edit", async () => {
    const before = await evidenceCorrectionFixture();
    const out = reasoning.updateEvidence(
      before,
      "E1",
      { note: "注記だけを訂正" },
      "注記の訂正",
    );
    expect(evidence(out).utteranceIds).toEqual(["U02"]);
    expect(out.agendas.find((a) => a.id === "A")!.needsReview).toBe(true);
    expect(out.agendas.find((a) => a.id === "C")!.needsReview).toBe(true);
    expect(out.agendas.find((a) => a.id === "B")!.needsReview).toBe(false);
  });

  it("preserves identity, actor, certainty, time, and ignores runtime extra fields", async () => {
    const before = await evidenceCorrectionFixture();
    const original = evidence(before);
    const out = reasoning.updateEvidence(
      before,
      "E1",
      {
        utteranceIds: ["U03"],
        note: "新注記",
        id: "spoof",
        actor: "manual",
        certainty: "uncertain",
        time: { asOf: "2099", recordedAt: "2099" },
        sourceIds: ["spoof"],
      } as never,
      "保持確認",
    );
    expect(evidence(out)).toMatchObject({
      id: original.id,
      actor: original.actor,
      certainty: original.certainty,
      time: original.time,
      utteranceIds: ["U03"],
      note: "新注記",
      sourceIds: [before.sources[0].id],
    });
  });

  it("rejects empty, unknown, duplicate, and malformed inputs without mutating input", async () => {
    const before = await evidenceCorrectionFixture();
    const frozen = structuredClone(before);
    for (const patch of [
      { utteranceIds: [] },
      { utteranceIds: ["missing"] },
      { utteranceIds: ["U02", "U02"] },
      { utteranceIds: null },
      { note: 42 },
    ]) {
      expect(() =>
        reasoning.updateEvidence(before, "E1", patch as never, "拒否確認"),
      ).toThrow();
      expect(before).toEqual(frozen);
    }
    expect(() =>
      reasoning.updateEvidence(before, "E1", { note: "x" }, " "),
    ).toThrow();
    expect(() =>
      reasoning.updateEvidence(
        before,
        "missing",
        evidenceCorrectionPatch,
        "不明根拠",
      ),
    ).toThrow();
    expect(before).toEqual(frozen);
  });

  it("supports shared undo and full JSON roundtrip while restricted export omits reasoning and correction details", async () => {
    const before = await evidenceCorrectionFixture();
    const changed = reasoning.updateEvidence(
      before,
      "E1",
      evidenceCorrectionPatch,
      EVIDENCE_EDIT_REASON,
    );
    const restored = importProject(
      exportProject(changed, "json", undefined, false),
    );
    expect(semanticSnapshot(restored)).toEqual(semanticSnapshot(changed));
    expect(restored.revisions).toEqual(changed.revisions);
    const undone = undoLastRevision(restored);
    expect(semanticSnapshot(undone)).toEqual(semanticSnapshot(before));
    const limited = exportProject(changed, "json", "S", false, ["U03"]);
    const dto = JSON.parse(limited).project;
    expect(dto.reasoning).toBeUndefined();
    expect(dto.revisions).toEqual([]);
    expect(limited).not.toContain(EVIDENCE_EDIT_REASON);
    expect(limited).not.toContain("訂正後の注記");
  });
  it("does not let an ordinary utterance edit activate evidence-only graph edges", async () => {
    const before = await evidenceCorrectionFixture();
    const out = invalidateDependents(before, ["U02"]);
    expect(out.agendas.find((a) => a.id === "A")!.needsReview).toBe(true);
    expect(out.agendas.find((a) => a.id === "C")!.needsReview).toBe(false);
    expect(out.reasoning!.positionChanges).toEqual(
      before.reasoning!.positionChanges,
    );
    expect(out.reasoning!.responses).toEqual(before.reasoning!.responses);
    expect(out.agendas.find((a) => a.id === "B")!.needsReview).toBe(false);
  });

  it("follows evidence edit mode through item, relation, counterargument, and summary", async () => {
    const before = await evidenceCorrectionFixture();
    expect(before.reasoning!.responses[0].evidenceIds).toEqual([]);
    expect(before.reasoning!.responses[0].counterargumentToClaimIds).toEqual([
      "I3",
    ]);
    expect(before.agendas.find((a) => a.id === "C")!.needsReview).toBe(false);
    const out = reasoning.updateEvidence(
      before,
      "E1",
      evidenceCorrectionPatch,
      EVIDENCE_EDIT_REASON,
    );
    expect(out.agendas.find((a) => a.id === "C")!.needsReview).toBe(true);
    expect(out.agendas.find((a) => a.id === "B")!.needsReview).toBe(false);
    expect(out.reasoning!.items).toEqual(before.reasoning!.items);
    expect(out.reasoning!.responses).toEqual(before.reasoning!.responses);
    expect(out.reasoning!.positionChanges).toEqual(
      before.reasoning!.positionChanges,
    );
    expect(out.relations).toEqual(before.relations);
    expect(out.utterances).toEqual(before.utterances);
    expect(out.revisions.length).toBeGreaterThan(before.revisions.length);
  });

  it("invalidates distinct position-change items from trigger evidence alone, without a shared source path", async () => {
    let before = await evidenceCorrectionFixture();
    before.reasoning!.responses = [];
    before.reasoning!.interpretations = [];
    before.relations = [];
    const first = before.reasoning!.items.find((x) => x.id === "I1")!;
    first.utteranceIds = ["U06"];
    first.evidenceIds = [];
    first.certainty = "inferred";
    before.reasoning!.items.find((x) => x.id === "I3")!.utteranceIds = ["U08"];
    before.agendas.find((x) => x.id === "A")!.summaryDependencies = ["U06"];
    before.agendas.find((x) => x.id === "C")!.summaryDependencies = ["U08"];
    for (const id of ["A", "C", "B"])
      before = reviseProject(before, id, { needsReview: false }, "基準を確認");
    expect(before.agendas.every((a) => !a.needsReview)).toBe(true);
    const ordinary = invalidateDependents(before, ["U02"]);
    expect(ordinary.agendas.every((a) => !a.needsReview)).toBe(true);
    const out = reasoning.updateEvidence(
      before,
      "E1",
      { note: "立場変化の根拠だけを訂正" },
      "きっかけとして登録した根拠を照合",
    );
    expect(out.agendas).toEqual(
      before.agendas.map((a) =>
        ["A", "C"].includes(a.id) ? { ...a, needsReview: true } : a,
      ),
    );
    expect(out.reasoning!.items).toEqual(before.reasoning!.items);
    expect(out.reasoning!.positionChanges).toEqual(
      before.reasoning!.positionChanges,
    );
  });

  it("retains evidence-edit mode along the detached old-source chain after retargeting", async () => {
    const before = await evidenceCorrectionFixture();
    const first = before.reasoning!.items.find((x) => x.id === "I1")!;
    first.evidenceIds = [];
    first.certainty = "inferred";
    before.reasoning!.positionChanges = [];
    before.reasoning!.interpretations = [];
    expect(before.agendas.every((a) => !a.needsReview)).toBe(true);
    const frozen = structuredClone(before);
    const out = reasoning.updateEvidence(
      before,
      "E1",
      { utteranceIds: ["U09"], note: "別資料へ訂正" },
      "旧根拠からの明示依存も再確認",
    );
    expect(out.agendas).toEqual(
      before.agendas.map((a) =>
        ["A", "C"].includes(a.id) ? { ...a, needsReview: true } : a,
      ),
    );
    expect(out.reasoning!.responses).toEqual(before.reasoning!.responses);
    expect(out.reasoning!.items).toEqual(before.reasoning!.items);
    expect(before).toEqual(frozen);
  });

  it("derives all sourceIds when corrected evidence crosses sources", async () => {
    const before = await evidenceCorrectionFixture();
    const out = reasoning.updateEvidence(
      before,
      "E1",
      { utteranceIds: ["U02", "U09"] },
      "別資料との照合で根拠を訂正",
    );
    expect(
      out.reasoning!.evidence.find((x) => x.id === "E1")!.sourceIds,
    ).toEqual([before.sources[0].id, before.sources[1].id]);
    expect(
      out.reasoning!.evidence.find((x) => x.id === "E1")!.utteranceIds,
    ).toEqual(["U02", "U09"]);
    expect(out.reasoning!.items.find((x) => x.id === "I2")).toEqual(
      before.reasoning!.items.find((x) => x.id === "I2"),
    );
    expect(out.agendas.map((a) => [a.id, a.needsReview])).toEqual([
      ["S", false],
      ["A", true],
      ["C", true],
      ["B", false],
    ]);
  });
});
