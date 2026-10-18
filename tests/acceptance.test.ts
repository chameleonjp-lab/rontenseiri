import { describe, expect, it } from "vitest";
import { sampleProject } from "../src/analysis/sample";
import {
  createProject,
  mergeAgenda,
  reviseProject,
  reviseSource,
  splitAgenda,
  validateProject,
} from "../src/domain/project";
import { moveUtterance, undoLastRevision } from "../src/domain/revisions";
import { layoutProject } from "../src/domain/layout";
import { parseInputs } from "../src/input/parse";
import { exportProject, importProject } from "../src/export/project";

describe("review acceptance contracts", () => {
  it("U08 classification changes no source, order, membership or U09 and Undo restores original semantics", () => {
    const original = sampleProject();
    const changed = reviseProject(
      original,
      "U08",
      { classification: "derived" },
      "U08を原文から訂正",
    );
    expect(changed.sources).toEqual(original.sources);
    expect(changed.utterances.find((u) => u.id === "U09")).toEqual(
      original.utterances.find((u) => u.id === "U09"),
    );
    expect(changed.agendas.map((a) => a.utteranceIds)).toEqual(
      original.agendas.map((a) => a.utteranceIds),
    );
    const before = original.utterances.find((u) => u.id === "U08")!;
    const after = changed.utterances.find((u) => u.id === "U08")!;
    expect(after).toEqual({ ...before, classification: "derived" });
    expect(changed.agendas[0].needsReview).toBe(true);
    expect(changed.agendas[1].needsReview).toBe(false);
    const p0 = layoutProject(original).nodes.find((n) => n.id === "U09");
    const p1 = layoutProject(changed).nodes.find((n) => n.id === "U09");
    expect(p1).toEqual(p0);
    const undone = undoLastRevision(changed);
    expect(undone.utterances).toEqual(original.utterances);
    expect(undone.agendas).toEqual(original.agendas);
    expect(undone.relations).toEqual(original.relations);
    expect(undone.revisions.at(-1)?.kind).toBe("undo");
    expect(() => undoLastRevision(undone)).toThrow();
  });
  it("A → B → A keeps one canonical agenda ID, separate contiguous spans and original order", async () => {
    const p = createProject(
      await parseInputs([
        {
          name: "t.txt",
          format: "txt",
          role: "conversation",
          text: "一つ目\n別の話\n最初の議題へ戻る",
        },
      ]),
      "A",
      "full",
    );
    p.utterances = p.utterances.map((u) => ({ ...u, classification: "main" }));
    const a = { ...p.agendas[0], id: "A", utteranceIds: ["U01", "U03"] };
    const b = { ...a, id: "B", title: "B", utteranceIds: ["U02"] };
    p.agendas = [a, b];
    p.selectedAgendaId = "A";
    p.relations = [
      {
        id: "return",
        from: "U02",
        to: "U03",
        kind: "return",
        evidenceIds: ["U02", "U03"],
      },
    ];
    expect(() => validateProject(p)).not.toThrow();
    const l = layoutProject(p);
    expect(l.blocks.map((block) => block.agendaId)).toEqual(["A", "B", "A"]);
    expect(new Set(l.blocks.map((block) => block.id)).size).toBe(3);
    expect(l.blocks[2].occurrence).toBe(2);
    expect(l.nodes.map((n) => n.id)).toEqual(["U01", "U02", "U03"]);
    for (let i = 1; i < l.blocks.length; i++)
      expect(l.blocks[i - 1].x + l.blocks[i - 1].width).toBeLessThan(
        l.blocks[i].x,
      );
    expect(l.nodes[0].x).toBeLessThan(l.nodes[1].x);
    expect(l.nodes[1].x).toBeLessThan(l.nodes[2].x);
    const moved = moveUtterance(p, "U02", "A", "議題所属だけ訂正");
    expect(moved.utterances).toEqual(p.utterances);
    expect(moved.agendas[0].utteranceIds).toEqual(["U01", "U02", "U03"]);
    expect(undoLastRevision(moved).agendas).toEqual(p.agendas);
  });
  it("none and undetermined return states remain distinct and do not fabricate an edge", () => {
    const p = sampleProject();
    const none = reviseProject(
      p,
      "U08",
      { returnStatus: "none" },
      "復帰なしを確認",
    );
    const unknown = reviseProject(
      p,
      "U08",
      { returnStatus: "unknown" },
      "まだ分からない",
    );
    expect(none.utterances.find((u) => u.id === "U08")?.returnStatus).toBe(
      "none",
    );
    expect(unknown.utterances.find((u) => u.id === "U08")?.returnStatus).toBe(
      "unknown",
    );
    expect(none.relations).toEqual(p.relations);
    expect(unknown.relations).toEqual(p.relations);
    const invalid = structuredClone(p);
    (invalid.utterances[0] as any).returnStatus = "definite";
    expect(() => validateProject(invalid)).toThrow();
  });
  it("source revision retains old versions, shifts evidence offsets and restores review state on Undo", () => {
    const p = sampleProject();
    const result = reviseSource(
      p,
      "U08",
      "採用制度についての確認です。\n発言の続き。",
      "転記を訂正",
    );
    expect(result.sources[0]).toEqual(p.sources[0]);
    expect(result.sources).toHaveLength(2);
    for (const u of result.utterances) {
      const source = result.sources.find(
        (s) => s.versionId === u.sourceVersionId,
      )!;
      expect(source.text.slice(u.start, u.end)).toBe(u.quote);
    }
    const undone = undoLastRevision(result);
    expect(undone.utterances).toEqual(p.utterances);
    expect(undone.agendas).toEqual(p.agendas);
    expect(undone.sources).toHaveLength(2);
  });
  it("agenda splitting is not source/body splitting and preserves every utterance", () => {
    const p = sampleProject();
    const divided = splitAgenda(p, "U07");
    expect(divided.sources).toEqual(p.sources);
    expect(divided.utterances).toEqual(p.utterances);
    expect(divided.agendas).toHaveLength(3);
    const restored = undoLastRevision(divided);
    expect(restored.agendas).toEqual(p.agendas);
    expect(restored.utterances).toEqual(p.utterances);
    const joined = mergeAgenda(divided, divided.agendas[1].id);
    expect(joined.agendas[0].utteranceIds).toEqual(p.agendas[0].utteranceIds);
  });
  it("input counts all files together and rejects malformed subtitle times", async () => {
    await expect(
      parseInputs([
        {
          name: "a",
          format: "txt",
          role: "conversation",
          text: "あ".repeat(30_000),
        },
        {
          name: "b.txt",
          format: "txt",
          role: "conversation",
          text: "い".repeat(20_001),
        },
      ]),
    ).rejects.toThrow("文字数");
    await expect(
      parseInputs([
        {
          name: "bad.srt",
          format: "srt",
          role: "conversation",
          text: "1\n00:61:00,000 --> 00:61:01,000\n本文",
        },
      ]),
    ).rejects.toThrow("時刻");
    const parsed = await parseInputs([
      { name: "貼り付け", format: "txt", role: "conversation", text: "A\r\nB" },
    ]);
    expect(parsed.utterances.map((u) => u.quote)).toEqual(["A", "B"]);
  });
  it("an empty or reference-only input cannot manufacture a conversation agenda", async () => {
    const empty = await parseInputs([
      {
        name: "blank.txt",
        format: "txt",
        role: "conversation",
        text: "\n  \n",
      },
    ]);
    expect(() => createProject(empty, "x", "unknown")).toThrow("会話本文");
    const reference = await parseInputs([
      {
        name: "reference.txt",
        format: "txt",
        role: "reference",
        text: "参考だけ",
      },
    ]);
    expect(() => createProject(reference, "x", "unknown")).toThrow("会話本文");
  });
  it("limited selection is sorted by original order and rejects a forged manifest", () => {
    const p = sampleProject();
    const text = exportProject(p, "json", "議題01", false, ["U07", "U01"]);
    expect(importProject(text).utterances.map((u) => u.id)).toEqual([
      "U01",
      "U07",
    ]);
    const forged = JSON.parse(text);
    forged.manifest.allowedUtteranceIds = ["U01"];
    expect(() => importProject(JSON.stringify(forged))).toThrow("manifest");
  });
});
