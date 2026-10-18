import { describe, expect, it } from "vitest";
import { manualRepairFixture, repairResponse } from "./fixtures/manual-repair";
import {
  linkResponse,
  updateResponse,
  removeResponse,
} from "../src/domain/reasoning";
import { undoLastRevision } from "../src/domain/revisions";
import { exportProject, importProject } from "../src/export/project";
import type { Project } from "../src/domain/types";

const active = (p: Project) => ({
  responses: p.reasoning!.responses,
  evidence: p.reasoning!.evidence,
  items: p.reasoning!.items,
  versions: p.reasoning!.questionVersions,
  questions: p.reasoning!.questions,
  agendas: p.agendas,
  utterances: p.utterances,
  relations: p.relations,
  selectedAgendaId: p.selectedAgendaId,
});

describe("P3 bounded manual response relation repair", () => {
  it("uses a fixed two-question three-utterance fixture with nonempty evidence and history", async () => {
    const p = await manualRepairFixture();
    expect(p.utterances.map((u) => u.id)).toEqual(["U01", "U02", "U03"]);
    expect(p.reasoning!.questions.map((q) => q.id)).toEqual(["Q1", "Q2"]);
    expect(repairResponse(p).questionVersionId).toBe("Q1-v1");
    expect(p.revisions).toHaveLength(1);
    expect(p.reasoning!.evidence.map((e) => e.id)).toEqual(["E1", "E2", "E3"]);
  });
  it("edits multiple targets in explicit order, with independent type/fulfillment and old-version identity", async () => {
    const before = await manualRepairFixture(),
      r = repairResponse(before);
    const frozen = structuredClone(before);
    let p = updateResponse(
      before,
      r.id,
      {
        kind: "counterargument",
        evidenceIds: ["E3", "E1"],
        counterargumentToClaimIds: ["I3", "I1"],
      },
      "根拠と反論先を照合して修正",
    );
    expect(before).toEqual(frozen);
    expect(repairResponse(p)).toEqual({
      ...r,
      kind: "counterargument",
      evidenceIds: ["E3", "E1"],
      counterargumentToClaimIds: ["I3", "I1"],
    });
    expect(p.agendas[0].needsReview).toBe(true);
    expect(p.agendas[1]).toEqual(before.agendas[1]);
    expect(p.reasoning!.responses[0]).toEqual(before.reasoning!.responses[0]);
    expect(p.revisions).toHaveLength(before.revisions.length + 1);
    const event = p.revisions.at(-1)!;
    expect(event.reason).toBe("根拠と反論先を照合して修正");
    expect(
      (event.before as { reasoning: Project["reasoning"] }).reasoning!
        .responses,
    ).toEqual(before.reasoning!.responses);
    expect(
      (event.after as { reasoning: Project["reasoning"] }).reasoning!.responses,
    ).toEqual(p.reasoning!.responses);
    const undone = undoLastRevision(p);
    expect(active(undone)).toEqual(active(before));
    expect(undone.revisions.slice(0, -1)).toEqual(p.revisions);
    expect(
      (undone.revisions.at(-1)!.after as { targetRevisionId: string })
        .targetRevisionId,
    ).toBe(event.id);
    const typed = repairResponse(p);
    p = updateResponse(
      p,
      r.id,
      { fulfillment: "not-fulfilled" },
      "充足だけを修正",
    );
    expect(repairResponse(p)).toEqual({
      ...typed,
      fulfillment: "not-fulfilled",
    });
    p = updateResponse(
      p,
      r.id,
      { evidenceIds: [], counterargumentToClaimIds: [] },
      "関連先だけを全解除",
    );
    expect(repairResponse(p).kind).toBe("counterargument");
    expect(repairResponse(p).fulfillment).toBe("not-fulfilled");
    expect(repairResponse(p).questionVersionId).toBe("Q1-v1");
  });
  it("explicitly changes question version/response utterances and invalidates both old and new dependents", async () => {
    const p = await manualRepairFixture(),
      r = repairResponse(p);
    const out = updateResponse(
      p,
      r.id,
      { questionVersionId: "Q2-v1", utteranceIds: ["U03", "U01"] },
      "利用者が対象を明示変更",
    );
    expect(repairResponse(out).questionVersionId).toBe("Q2-v1");
    expect(repairResponse(out).utteranceIds).toEqual(["U03", "U01"]);
    expect(out.agendas.every((a) => a.needsReview)).toBe(true);
    expect(active(undoLastRevision(out))).toEqual(active(p));
  });
  it("removes only the relation, records reason, and restores IDs/order in one shared Undo", async () => {
    const p = await manualRepairFixture(),
      r = repairResponse(p);
    const out = removeResponse(p, r.id, "関係の根拠が不適切なので解除");
    expect(out.reasoning!.responses).toEqual([p.reasoning!.responses[0]]);
    expect(out.reasoning!.evidence).toEqual(p.reasoning!.evidence);
    expect(out.reasoning!.items).toEqual(p.reasoning!.items);
    expect(out.agendas[0]).toEqual({ ...p.agendas[0], needsReview: true });
    expect(out.agendas[1]).toEqual(p.agendas[1]);
    expect(out.revisions).toHaveLength(p.revisions.length + 1);
    expect(active(undoLastRevision(out))).toEqual(active(p));
  });
  it("rejects unknown/invalid IDs, duplicates, empty utterances and reasons without mutating Project", async () => {
    const p = await manualRepairFixture(),
      r = repairResponse(p),
      frozen = structuredClone(p);
    const patches = [
      { questionVersionId: "missing" },
      { utteranceIds: ["missing"] },
      { utteranceIds: [] },
      { utteranceIds: ["U02", "U02"] },
      { evidenceIds: ["missing"] },
      { evidenceIds: ["E1", "E1"] },
      { counterargumentToClaimIds: ["missing"] },
      { counterargumentToClaimIds: ["I1", "I1"] },
      { kind: "invalid" },
      { fulfillment: "invalid" },
    ];
    for (const patch of patches) {
      expect(() =>
        updateResponse(
          p,
          r.id,
          patch as Parameters<typeof updateResponse>[2],
          "拒否テスト",
        ),
      ).toThrow();
      expect(p).toEqual(frozen);
    }
    for (const action of [
      () => updateResponse(p, "missing", { kind: "answer" }, "不明な応答"),
      () => removeResponse(p, "missing", "不明な応答"),
      () => updateResponse(p, r.id, { kind: "partial" }, " "),
      () => removeResponse(p, r.id, " "),
      () => linkResponse(p, { ...r, questionVersionId: "missing" }, "不明な版"),
    ]) {
      expect(action).toThrow();
      expect(p).toEqual(frozen);
    }
  });
  it("roundtrips full nonempty graph/history, including removal active state and Undo; limited export leaks none", async () => {
    const p = await manualRepairFixture(),
      r = repairResponse(p);
    const changed = updateResponse(
      p,
      r.id,
      { evidenceIds: ["E3", "E2"], counterargumentToClaimIds: ["I2", "I3"] },
      "JSON照合前の修正",
    );
    const restored = importProject(
      exportProject(changed, "json", undefined, false),
    );
    expect(active(restored)).toEqual(active(changed));
    expect(restored.revisions).toEqual(changed.revisions);
    expect(restored.reasoning!.revisions).toEqual(changed.reasoning!.revisions);
    const removed = removeResponse(restored, r.id, "JSON照合前の解除");
    const restoredRemoval = importProject(
      exportProject(removed, "json", undefined, false),
    );
    expect(active(restoredRemoval)).toEqual(active(removed));
    expect(restoredRemoval.revisions).toEqual(removed.revisions);
    expect(active(undoLastRevision(restoredRemoval))).toEqual(active(restored));
    const limited = exportProject(
      removed,
      "json",
      removed.agendas[0].id,
      false,
      ["U02"],
    );
    const dto = JSON.parse(limited).project;
    expect(dto.reasoning).toBeUndefined();
    expect(dto.revisions).toEqual([]);
    expect(limited).not.toContain("秘密マーカー");
    expect(limited).not.toContain(r.id);
    expect(limited).not.toContain("JSON照合前の解除");
    const scoped = importProject(limited);
    expect(scoped.utterances.map((u) => u.id)).toEqual(["U02"]);
    expect(scoped.reasoning).toBeUndefined();
    expect(scoped.revisions).toEqual([]);
  });
});
