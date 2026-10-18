import { describe, expect, it } from "vitest";
import { parseInputs } from "../src/input/parse";
import {
  createProject,
  reviseSource,
  validateProject,
} from "../src/domain/project";
import {
  mergeUtterances,
  splitUtterance,
} from "../src/domain/utterance-editing";
import { undoLastRevision } from "../src/domain/revisions";
import { exportProject, importProject } from "../src/export/project";
import { auditSourceCoverage } from "../src/domain/coverage";
import type { Project } from "../src/domain/types";

const body1 = "最初😀\r\n複数行́";
const body2 = "次の👩‍💻本文";
const input = `\ufeffWEBVTT\r\n\r\nraw-dup\r\n00:00:01.000 --> 00:00:03.000 align:start\r\n${body1}\r\n\r\nNOTE 引用に含めない注記\r\n\r\nraw-dup\r\n00:00:02.000 --> 00:00:04.000\r\n${body2}\r\n\r\n00:00:02.000 --> 00:00:05.000\r\n三番目\r\n`;
async function fixture() {
  return createProject(
    await parseInputs([
      { name: "cues.vtt", format: "vtt", role: "conversation", text: input },
    ]),
    "cue provenance",
    "excerpt",
  );
}
function integrity(project: Project) {
  expect(() => validateProject(project)).not.toThrow();
  for (const u of project.utterances) {
    const s = project.sources.find(
      (source) => source.versionId === u.sourceVersionId,
    )!;
    if (u.cueSpans) {
      expect(u.quote).toBe(
        u.cueSpans.map((span) => s.text.slice(span.start, span.end)).join("\n"),
      );
      for (const span of u.cueSpans) {
        const cue = s.cueLedger!.find((c) => c.id === span.cueId)!;
        expect(cue).toBeDefined();
        expect(span.start).toBeGreaterThanOrEqual(cue.start);
        expect(span.end).toBeLessThanOrEqual(cue.end);
        expect(span.end).toBeGreaterThan(span.start);
      }
    } else expect(s.text.slice(u.start, u.end)).toBe(u.quote);
    expect(u.line).toBe(s.text.slice(0, u.start).split(/\r\n|\n|\r/).length);
  }
}

describe("P1 subtitle cue provenance", () => {
  it("keeps missing/duplicate input cue IDs separate from unique local IDs, input order, times and raw multiline ranges", async () => {
    const p = await fixture();
    expect(p.sources[0].text).toBe(input);
    const ledger = p.sources[0].cueLedger!;
    expect(ledger.map((c) => c.rawId)).toEqual([
      "raw-dup",
      "raw-dup",
      undefined,
    ]);
    expect(new Set(ledger.map((c) => c.id)).size).toBe(3);
    expect(ledger.map((c) => c.order)).toEqual([0, 1, 2]);
    expect(ledger.map((c) => [c.startTime, c.endTime])).toEqual([
      [1000, 3000],
      [2000, 4000],
      [2000, 5000],
    ]);
    expect(p.utterances.map((u) => u.quote)).toEqual([body1, body2, "三番目"]);
    for (const u of p.utterances)
      expect(p.sources[0].text.slice(u.start, u.end)).toBe(u.quote);
    for (const c of ledger)
      expect(c.line).toBe(input.slice(0, c.start).split(/\r\n|\n|\r/).length);
    integrity(p);
  });

  it("manual two-cue merge quotes only body spans, keeps both cue times and raw input, and survives full JSON and Undo", async () => {
    const p = await fixture();
    const merged = mergeUtterances(p, ["U01", "U02"], "利用者が同じ話者と確認");
    const u = merged.utterances[0];
    expect(u.quote).toBe(body1 + "\n" + body2);
    expect(u.quote).not.toContain("-->");
    expect(u.quote).not.toContain("NOTE");
    expect(u.quote).not.toContain("raw-dup");
    expect(u.time).toBeUndefined();
    expect(u.cueSpans!.map((span) => span.cueId)).toEqual(
      p.sources[0].cueLedger!.slice(0, 2).map((c) => c.id),
    );
    expect(merged.sources[0].text).toBe(input);
    expect(merged.sources[0].cueLedger).toEqual(p.sources[0].cueLedger);
    integrity(merged);
    const audit = auditSourceCoverage(merged.sources[0], merged.utterances);
    expect(audit.issues).toEqual([]);
    expect(
      audit.spans
        .filter((span) => span.utteranceId === u.id)
        .map((span) => [span.start, span.end]),
    ).toEqual(u.cueSpans!.map((span) => [span.start, span.end]));
    const restored = importProject(
      exportProject(merged, "json", undefined, false),
    );
    expect(restored.utterances).toEqual(merged.utterances);
    expect(restored.sources).toEqual(merged.sources);
    integrity(restored);
    const undone = undoLastRevision(restored);
    expect(undone.utterances).toEqual(p.utterances);
    expect(undone.sources[0]).toEqual(p.sources[0]);
    integrity(undone);
  });

  it("maps display splits to cue body spans and coalesces adjacent fragments when merged back", async () => {
    const p = await fixture();
    const m = mergeUtterances(p, ["U01", "U02"], "統合");
    const composite = m.utterances[0];
    for (const offset of [
      2,
      body1.length,
      body1.length + 1,
      body1.length + 3,
    ]) {
      const split = splitUtterance(
        m,
        composite.id,
        offset,
        "表示位置から本文spanへ分割",
      );
      integrity(split);
      const rem = mergeUtterances(
        split,
        split.utterances.slice(0, 2).map((u) => u.id),
        "境界を戻す",
      );
      integrity(rem);
      expect(rem.utterances[0].quote).toBe(composite.quote);
      expect(rem.utterances[0].cueSpans).toEqual(composite.cueSpans);
      expect(undoLastRevision(split).utterances).toEqual(m.utterances);
    }
    const split = splitUtterance(p, "U01", 2, "一cue内の分割");
    const rem = mergeUtterances(
      split,
      split.utterances.slice(0, 2).map((u) => u.id),
      "一cueの再統合",
    );
    expect(rem.utterances[0].quote).toBe(body1);
    expect(rem.utterances[0].cueSpans).toHaveLength(1);
    integrity(rem);
  });

  it("requires explicit cue selection for source correction, rebases later cues, and preserves old source/time/Undo/JSON", async () => {
    const p = await fixture();
    const m = mergeUtterances(p, ["U01", "U02"], "統合");
    const u = m.utterances[0];
    expect(() => reviseSource(m, u.id, "全体置換不可", "理由")).toThrow(
      /キュー/,
    );
    expect(() => reviseSource(m, u.id, "不可", "理由", 10)).toThrow(/キュー/);
    const replacement = "改訂👨‍👩‍👧‍👦\r\n本文́";
    const revised = reviseSource(m, u.id, replacement, "第1cueのみ訂正", 0);
    const current = revised.utterances[0];
    const active = revised.sources.find(
      (s) => s.versionId === current.sourceVersionId,
    )!;
    expect(
      revised.sources.find((s) => s.versionId === m.sources[0].versionId),
    ).toEqual(m.sources[0]);
    expect(active.text).toBe(input.replace(body1, replacement));
    expect(current.quote).toBe(replacement + "\n" + body2);
    const delta = replacement.length - body1.length;
    expect(active.cueLedger![1].start).toBe(
      m.sources[0].cueLedger![1].start + delta,
    );
    expect(
      active.cueLedger!.map((c) => [c.time, c.rawId, c.startTime, c.endTime]),
    ).toEqual(
      m.sources[0].cueLedger!.map((c) => [
        c.time,
        c.rawId,
        c.startTime,
        c.endTime,
      ]),
    );
    expect(current.coverage).toBe("failed");
    expect(revised.agendas[0].needsReview).toBe(true);
    integrity(revised);
    const restored = importProject(
      exportProject(revised, "json", undefined, false),
    );
    integrity(restored);
    expect(restored.utterances).toEqual(revised.utterances);
    const undone = undoLastRevision(restored);
    expect(undone.utterances).toEqual(m.utterances);
    integrity(undone);
  });

  it("accepts legacy single-time JSON unchanged, recovering raw cue provenance only for an explicit merge", async () => {
    const legacy = await fixture();
    delete legacy.sources[0].cueLedger;
    for (const u of legacy.utterances) delete u.cueSpans;
    const restored = importProject(
      exportProject(legacy, "json", undefined, false),
    );
    expect(restored.schemaVersion).toBe(1);
    expect(restored.sources[0].cueLedger).toBeUndefined();
    expect(restored.utterances).toEqual(legacy.utterances);
    expect(restored.utterances[0].time).toBe("00:00:01.000 --> 00:00:03.000");
    const merged = mergeUtterances(
      restored,
      ["U01", "U02"],
      "旧形式も明示統合",
    );
    expect(merged.utterances[0].quote).toBe(body1 + "\n" + body2);
    expect(merged.utterances[0].time).toBeUndefined();
    expect(merged.sources[0].text).toBe(input);
    expect(undoLastRevision(merged).utterances).toEqual(restored.utterances);
    integrity(merged);
    integrity(restored);
  });

  it("rejects unknown cue IDs, metadata/out-of-order spans, wrong body quotes and misleading composite time", async () => {
    const p = mergeUtterances(await fixture(), ["U01", "U02"], "統合");
    const bad = (fn: (copy: Project) => void) => {
      const copy = structuredClone(p);
      fn(copy);
      expect(() => validateProject(copy)).toThrow();
    };
    bad((c) => {
      c.utterances[0].cueSpans![0].cueId = "missing";
    });
    bad((c) => {
      c.utterances[0].cueSpans![0].start = 0;
    });
    bad((c) => {
      c.utterances[0].cueSpans!.reverse();
    });
    bad((c) => {
      c.utterances[0].quote += "改変";
    });
    bad((c) => {
      c.utterances[0].time = c.sources[0].cueLedger![0].time;
    });
    bad((c) => {
      c.sources[0].cueLedger![1].id = c.sources[0].cueLedger![0].id;
    });
    bad((c) => {
      c.sources[0].cueLedger![1].startTime = -1;
    });
  });

  it("limited JSON contains only selected quotes, not project omission descriptions, cue ledger or unrelated body/timing", async () => {
    const p = await fixture();
    p.omissions = [
      {
        id: "gap1",
        description: "PROJECT_PRIVATE_GAP",
        reason: "PRIVATE_REASON",
      },
    ];
    const json = exportProject(p, "json", p.agendas[0].id, false, ["U01"]);
    expect(json).not.toContain("PROJECT_PRIVATE_GAP");
    expect(json).not.toContain("PRIVATE_REASON");
    expect(json).not.toContain("cueLedger");
    expect(json).not.toContain("cueSpans");
    expect(json).not.toContain("次の👩‍💻本文");
    expect(json).not.toContain("00:00:02.000");
    expect(json).not.toContain("raw-dup");
    const limited = importProject(json);
    expect(limited.omissions).toBeUndefined();
    expect(limited.utterances).toHaveLength(1);
    expect(limited.utterances[0].quote).toBe(body1);
    expect(limited.sources[0].text).toBe(body1);
  });
});
