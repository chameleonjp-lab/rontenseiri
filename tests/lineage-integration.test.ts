import { it, expect } from "vitest";
import { sampleProject } from "../src/analysis/sample";
import {
  splitUtterance,
  mergeUtterances,
  resolveLineageTransfer,
} from "../src/domain/utterance-editing";
import { reviseSource, validateProject } from "../src/domain/project";
import { undoLastRevision } from "../src/domain/revisions";
import { exportProject, importProject } from "../src/export/project";
import { addQuestion, linkResponse } from "../src/domain/reasoning";
it("関係線付きサンプルを分割し、関係を一意な移し先へ適用してUndoできる", () => {
  const p = sampleProject();
  const edge = p.relations.find((r) => r.from === "U01")!;
  const split = splitUtterance(p, "U01", 2, "誤った発言区切り");
  const record = split.lineage!.records[0];
  expect(split.relations.some((r) => r.from === "U01" || r.to === "U01")).toBe(
    false,
  );
  const restored = resolveLineageTransfer(
    split,
    record.id,
    edge.id,
    [record.newIds[0]],
    "applied",
    "原文に照合",
  );
  expect(restored.relations.find((r) => r.id === edge.id)?.from).toBe(
    record.newIds[0],
  );
  const undone = undoLastRevision(restored);
  expect(undone.relations).toEqual(split.relations);
  expect(
    undone.lineage?.records[0].references.find((r) => r.referenceId === edge.id)
      ?.status,
  ).toBe("pending");
  expect(
    importProject(exportProject(restored, "json", undefined, true)).relations,
  ).toEqual(restored.relations);
});
it("30回の分割統合で退役IDを履歴として保持し、スナップショットを指数再帰にしない", () => {
  let p = sampleProject();
  const original = p.utterances[0].quote;
  let id = "U01";
  for (let n = 0; n < 15; n++) {
    p = splitUtterance(p, id, 2, "連続編集");
    const ids = p.lineage!.records.at(-1)!.newIds;
    p = mergeUtterances(p, ids, "分割の見直し");
    id = p.lineage!.records.at(-1)!.newIds[0];
  }
  expect(p.utterances.find((u) => u.id === id)!.quote).toBe(original);
  expect(p.lineage!.records).toHaveLength(30);
  expect(JSON.stringify(p).length).toBeLessThan(5 * 1024 * 1024);
  expect(() => validateProject(p)).not.toThrow();
});
it("分割後に原文を訂正しても旧版を参照する移送履歴を壊さない", () => {
  const p = splitUtterance(sampleProject(), "U01", 2, "切り分け");
  const id = p.lineage!.records[0].newIds[0];
  const before = p.sources.length;
  const revised = reviseSource(p, id, "訂正後の表記", "聞き間違いの訂正");
  expect(revised.sources.length).toBe(before + 1);
  expect(revised.lineage!.records[0].sourceVersionId).toBe(
    p.lineage!.records[0].sourceVersionId,
  );
  expect(() => validateProject(revised)).not.toThrow();
  expect(undoLastRevision(revised).utterances).toEqual(p.utterances);
});
it("問い→別議題の応答→さらに別議題の依存が混在しても影響を伝える", () => {
  let p = sampleProject();
  const ids = p.utterances.map((u) => u.id);
  const base = p.agendas[0];
  p.agendas = ["A", "B", "C", "D"].map((id, i) => ({
    ...base,
    id,
    title: id,
    needsReview: false,
    utteranceIds: i < 3 ? [ids[i]] : ids.slice(3),
  }));
  p.selectedAgendaId = "A";
  p.relations = [
    {
      id: "BC",
      from: ids[1],
      to: ids[2],
      kind: "main",
      dependency: true,
      evidenceIds: [ids[1]],
    },
  ];
  p = addQuestion(p, "起点の問い", "original", [ids[0]]);
  p = linkResponse(p, {
    questionVersionId: p.reasoning!.questionVersions[0].id,
    utteranceIds: [ids[1]],
    kind: "answer",
    fulfillment: "unassessed",
    actor: "manual",
    evidenceIds: [],
    counterargumentToClaimIds: [],
    time: { asOf: "2026-10-17", recordedAt: "2026-10-17" },
  });
  const revised = reviseSource(
    p,
    ids[0],
    p.utterances[0].quote + "訂正",
    "訂正理由",
  );
  expect(revised.agendas.map((a) => a.needsReview)).toEqual([
    true,
    true,
    true,
    false,
  ]);
});
