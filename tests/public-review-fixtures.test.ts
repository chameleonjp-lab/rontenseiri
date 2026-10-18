import {
  splitUtterance,
  resolveLineageTransfer,
} from "../src/domain/utterance-editing";
import { relationLabel } from "../src/domain/relation-label";
import { it, expect } from "vitest";
import { sampleProject } from "../src/analysis/sample";
import {
  reviseProject,
  reviseSource,
  validateProject,
} from "../src/domain/project";
import { undoLastRevision, correctReturn } from "../src/domain/revisions";
import { exportProject, importProject } from "../src/export/project";
import {
  auditSourceCoverage,
  buildSourceCoverage,
} from "../src/domain/coverage";
function fixture() {
  const p = sampleProject();
  p.utterances = p.utterances.filter((u) =>
    ["U01", "U08", "U10"].includes(u.id),
  );
  p.utterances.forEach(
    (u) => (u.classification = u.id === "U08" ? "drift" : "main"),
  );
  p.agendas = [
    {
      ...p.agendas[0],
      id: "A",
      utteranceIds: ["U01", "U08", "U10"],
      needsReview: false,
    },
  ];
  p.selectedAgendaId = "A";
  p.relations = [
    {
      id: "return-U08-U10",
      from: "U08",
      to: "U10",
      kind: "return",
      evidenceIds: ["U08", "U10"],
    },
  ];
  return validateProject(p);
}
it("fixture1: 復帰線のあるU08を復帰なしとして保存復元し、U10の原文分類所属を変えない", () => {
  const p = fixture(),
    target = p.utterances.find((u) => u.id === "U10");
  const out = correctReturn(p, "U08", "", "旧復帰関係を原文に照合");
  const restored = importProject(exportProject(out, "json", undefined, false));
  expect(restored.relations.some((r) => r.kind === "return")).toBe(false);
  expect(restored.utterances.find((u) => u.id === "U08")!.returnStatus).toBe(
    "none",
  );
  expect(restored.utterances.find((u) => u.id === "U10")).toEqual(target);
  expect(restored.agendas[0].utteranceIds).toEqual(p.agendas[0].utteranceIds);
  expect(undoLastRevision(out).relations).toEqual(p.relations);
});
it("fixture2: 復帰先の分類を訂正でき、復帰関係を黙って消さず保存する", () => {
  let p = fixture();
  p = reviseProject(
    p,
    "U10",
    { classification: "derived" },
    "原文を読み直したため",
  );
  expect(p.relations[0].kind).toBe("return");
  expect(p.utterances.find((u) => u.id === "U10")!.classification).toBe(
    "derived",
  );
  const out = reviseProject(
    p,
    "U10",
    { classification: "main" },
    "本筋であると確認",
  );
  const restored = importProject(exportProject(out, "json", undefined, false));
  expect(restored.relations.map((r) => r.id)).toEqual(["return-U08-U10"]);
  expect(restored.utterances.find((u) => u.id === "U10")!.classification).toBe(
    "main",
  );
});
it("fixture3: Aの無関係な要約とCは不変、U08依存のBだけ再確認しUndoで戻す", () => {
  const p = sampleProject();
  const first = p.agendas[0];
  p.agendas = [
    {
      ...first,
      id: "A",
      utteranceIds: ["U01", "U08"],
      needsReview: false,
      summaryDependencies: ["U01"],
    },
    {
      ...first,
      id: "B",
      utteranceIds: ["U10"],
      arrival: "U08に依存する要約",
      summaryDependencies: ["U08"],
      needsReview: false,
    },
    {
      ...first,
      id: "C",
      utteranceIds: p.utterances
        .filter((u) => !["U01", "U08", "U10"].includes(u.id))
        .map((u) => u.id),
      summaryDependencies: [],
      needsReview: false,
    },
  ];
  p.selectedAgendaId = "A";
  p.relations = [];
  const before = validateProject(p);
  const out = reviseSource(
    before,
    "U08",
    before.utterances.find((u) => u.id === "U08")!.quote + "（訂正）",
    "原文解釈の訂正",
  );
  expect(out.agendas.map((a) => a.needsReview)).toEqual([false, true, false]);
  expect(out.agendas[0]).toEqual(before.agendas[0]);
  expect(out.agendas[2]).toEqual(before.agendas[2]);
  expect(undoLastRevision(out).agendas).toEqual(before.agendas);
});
it("fixture4: ノードのない未割当範囲を位置付きで未整理表示し、原文を書き換えない", () => {
  const p = sampleProject();
  const source = p.sources[0];
  const removed = p.utterances[1];
  p.utterances = p.utterances.filter((u) => u.id !== removed.id);
  const original = source.text;
  source.coverage = buildSourceCoverage(source, p.utterances);
  const audit = auditSourceCoverage(source, p.utterances);
  expect(audit.complete).toBe(false);
  expect(
    audit.pending.some(
      (span) => span.start <= removed.start && span.end >= removed.end,
    ),
  ).toBe(true);
  expect(source.text).toBe(original);
  expect(p.utterances.some((u) => u.id === removed.id)).toBe(false);
  const body = JSON.parse(
    exportProject(
      {
        ...p,
        agendas: p.agendas.map((a) => ({
          ...a,
          utteranceIds: a.utteranceIds.filter((id) => id !== removed.id),
        })),
        relations: p.relations.filter(
          (r) =>
            r.from !== removed.id &&
            r.to !== removed.id &&
            !r.evidenceIds.includes(removed.id),
        ),
      },
      "json",
      undefined,
      true,
    ),
  );
  expect(body.manifest.sourceCoverageComplete).toBe(false);
});

it("分割後の要約依存は保留台帳で明示確認し、Undoで元に戻る", () => {
  const p = sampleProject();
  p.agendas[0].summaryDependencies = ["U01"];
  const split = splitUtterance(p, "U01", 5, "原文の区切り");
  const record = split.lineage!.records[0];
  const ref = record.references.find((r) => r.kind === "summary")!;
  expect(ref.status).toBe("pending");
  expect(split.agendas[0].summaryDependencies).toEqual([]);
  const checked = resolveLineageTransfer(
    split,
    record.id,
    ref.referenceId,
    [record.newIds[0]],
    "applied",
    "移送先を確認",
  );
  expect(checked.agendas[0].summaryDependencies).toEqual([record.newIds[0]]);
  const restored = undoLastRevision(undoLastRevision(checked));
  expect(restored.agendas[0].summaryDependencies).toEqual(["U01"]);
  expect(restored.utterances).toEqual(p.utterances);
});
it("A→B→Aの復帰ラベルは議題境界より優先しSVGとJSONで意味を保つ", () => {
  const p = sampleProject();
  p.utterances = p.utterances.filter((u) =>
    ["U01", "U08", "U10"].includes(u.id),
  );
  p.agendas = [
    { ...p.agendas[0], id: "A", utteranceIds: ["U01", "U10"] },
    { ...p.agendas[0], id: "B", utteranceIds: ["U08"] },
  ];
  p.selectedAgendaId = "A";
  p.relations = [
    {
      id: "switch",
      from: "U01",
      to: "U08",
      kind: "main",
      evidenceIds: ["U01", "U08"],
    },
    {
      id: "return",
      from: "U08",
      to: "U10",
      kind: "return",
      evidenceIds: ["U08", "U10"],
    },
  ];
  expect(relationLabel(p.relations[1], "B", "A")).toBe("本筋へ復帰");
  expect(exportProject(p, "svg")).toContain("本筋へ復帰");
  const restored = importProject(exportProject(p, "json"));
  expect(restored.relations[1].kind).toBe("return");
  expect(restored.agendas.map((a) => a.id)).toEqual(["A", "B"]);
});
