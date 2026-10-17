import { undoLastRevision } from "../src/domain/revisions";
import { describe, it, expect } from "vitest";
import { sampleProject } from "../src/analysis/sample";
import { exportProject, importProject } from "../src/export/project";
import {
  reviseSource,
  reviseProject,
  validateProject,
} from "../src/domain/project";
import { createReasoningGraph } from "../src/domain/reasoning";
import type { Project } from "../src/domain/types";
function inject(value: object, key: string, secret: string) {
  Object.assign(value, { [key]: { secret } });
}
describe("独立レビューの受入ブロッカー", () => {
  it("限定DTOは全階層の未知キーと対象外の情報を除き、選択本文だけ残す", () => {
    const p = sampleProject();
    const agenda = p.agendas[0];
    const selected = agenda.utteranceIds.slice(0, 2);
    const expected = selected.map(
      (id) => p.utterances.find((u) => u.id === id)!.quote,
    );
    const secrets = [
      "ROOT_PRIVATE",
      "SOURCE_PRIVATE",
      "UTTERANCE_PRIVATE",
      "AGENDA_PRIVATE",
      "RELATION_PRIVATE",
      "REASONING_PRIVATE",
      "LINEAGE_PRIVATE",
      "OLD_VERSION_PRIVATE",
      "HISTORY_PRIVATE",
    ];
    inject(p, "unknownRoot", secrets[0]);
    inject(p.sources[0], "unknownSource", secrets[1]);
    inject(p.utterances[0], "unknownUtterance", secrets[2]);
    inject(agenda, "unknownAgenda", secrets[3]);
    p.relations = [
      {
        id: "safe-link",
        from: selected[0],
        to: selected[1],
        kind: "main",
        dependency: true,
        evidenceIds: selected,
      },
    ];
    inject(p.relations[0], "unknownRelation", secrets[4]);
    p.reasoning = createReasoningGraph();
    inject(p.reasoning, "unknownReasoning", secrets[5]);
    p.lineage = { records: [] };
    inject(p.lineage, "unknownLineage", secrets[6]);
    p.sources.push({
      ...structuredClone(p.sources[0]),
      versionId: "old-private-v0",
      text: "OLD_VERSION_PRIVATE",
    });
    p.revisions.push({
      id: "private-history",
      at: new Date().toISOString(),
      targetId: selected[0],
      kind: "historic",
      reason: "履歴のみ",
      before: { note: "HISTORY_PRIVATE" },
      after: {},
    });
    const before = structuredClone(p);
    const text = exportProject(p, "json", agenda.id, false, selected);
    const body = JSON.parse(text);
    for (const quote of expected) expect(text).toContain(quote);
    for (const secret of secrets) expect(text).not.toContain(secret);
    expect(text).not.toMatch(
      /unknown(?:Root|Source|Utterance|Agenda|Relation|Reasoning|Lineage)/,
    );
    for (const u of p.utterances.filter((u) => !selected.includes(u.id)))
      expect(text).not.toContain(u.quote);
    expect(body.project.reasoning).toBeUndefined();
    expect(body.project.lineage).toBeUndefined();
    expect(body.project.sources[0].coverage).toBeUndefined();
    expect(body.project.extent).toBe("excerpt");
    expect(p).toEqual(before);
    expect(importProject(text).utterances.map((u) => u.id)).toEqual(selected);
  });
  it("限定importの未知キーも復元後に残さない", () => {
    const p = sampleProject();
    const a = p.agendas[0];
    const body = JSON.parse(
      exportProject(p, "json", a.id, false, a.utteranceIds.slice(0, 1)),
    );
    inject(body.project, "unknownRoot", "IMPORT_PRIVATE");
    inject(body.project.sources[0], "unknownSource", "IMPORT_PRIVATE_SOURCE");
    inject(
      body.project.utterances[0],
      "unknownUtterance",
      "IMPORT_PRIVATE_UTTERANCE",
    );
    const restored = importProject(JSON.stringify(body));
    expect(JSON.stringify(restored)).not.toContain("IMPORT_PRIVATE");
  });
  it.each(["source", "classification"])(
    "実際の%s訂正から別議題A→B→Cへ伝播し無関係Dを変更しない",
    (mode) => {
      const p = sampleProject();
      const base = p.agendas[0];
      const ids = p.utterances.map((u) => u.id);
      p.agendas = ["A", "B", "C", "D"].map((id, i) => ({
        ...base,
        id,
        title: id,
        utteranceIds: i < 3 ? [ids[i]] : ids.slice(3),
        needsReview: false,
      }));
      p.selectedAgendaId = "A";
      p.relations = [
        {
          id: "AB",
          from: ids[0],
          to: ids[1],
          kind: "main",
          dependency: true,
          evidenceIds: [ids[0]],
        },
        {
          id: "BC",
          from: ids[1],
          to: ids[2],
          kind: "main",
          dependency: true,
          evidenceIds: [ids[1]],
        },
      ];
      const valid: Project = validateProject(p);
      const out =
        mode === "source"
          ? reviseSource(
              valid,
              ids[0],
              valid.utterances[0].quote + "（訂正）",
              "根拠の訂正",
            )
          : reviseProject(
              valid,
              ids[0],
              { important: true },
              "重要な根拠を指定",
            );
      expect(out.agendas.map((a) => a.needsReview)).toEqual([
        true,
        true,
        true,
        false,
      ]);
      expect(valid.agendas.every((a) => !a.needsReview)).toBe(true);
      expect(undoLastRevision(out).agendas).toEqual(valid.agendas);
    },
  );
});

it("APIは循環した明示依存を拒否し入力を変更しない", () => {
  const p = sampleProject();
  p.relations = [
    {
      id: "ab",
      from: "U01",
      to: "U03",
      kind: "main",
      dependency: true,
      evidenceIds: ["U01"],
    },
    {
      id: "ba",
      from: "U03",
      to: "U01",
      kind: "main",
      dependency: true,
      evidenceIds: ["U03"],
    },
  ];
  const before = structuredClone(p);
  expect(() => reviseSource(p, "U01", "訂正", "循環入力の検査")).toThrow(
    /cycle|chronology/,
  );
  expect(p).toEqual(before);
});
