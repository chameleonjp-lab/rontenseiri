import { describe, expect, it } from "vitest";
import { createProject, validateProject } from "../src/domain/project";
import {
  splitUtterance,
  mergeUtterances,
} from "../src/domain/utterance-editing";
import { undoLastRevision } from "../src/domain/revisions";
import { semanticSnapshot } from "../src/domain/snapshot";
import { parseInputs } from "../src/input/parse";
import { exportProject, importProject } from "../src/export/project";
import type { Project } from "../src/domain/types";

async function original() {
  return createProject(
    await parseInputs([
      {
        name: "history.vtt",
        format: "vtt",
        role: "conversation",
        text: "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nabcdef\n\n00:00:02.000 --> 00:00:03.000\nghijkl\n",
      },
    ]),
    "lineage root",
    "unknown",
  );
}
async function chain() {
  const base = await original();
  const split = splitUtterance(base, base.utterances[0].id, 3, "正規split");
  const merged = mergeUtterances(
    split,
    split.utterances.map((u) => u.id),
    "同じ話者と確認して複数cueを統合",
  );
  const again = splitUtterance(
    merged,
    merged.utterances[0].id,
    2,
    "正規resplit",
  );
  const undone = undoLastRevision(again);
  expect(undone.utterances).toEqual(merged.utterances);
  return undone;
}
function ghost(project: Project) {
  const malformed = structuredClone(project);
  malformed.lineage!.records[0].oldIds = ["ghost-old-id"];
  return malformed;
}
function stripCueFields(value: unknown): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach(stripCueFields);
    return;
  }
  const object = value as Record<string, unknown>;
  delete object.cueSpans;
  delete object.cueLedger;
  Object.values(object).forEach(stripCueFields);
}

describe("lineage old IDs need independent persisted states", () => {
  it("preserves legal split/merge/resplit/Undo and complete JSON cue ranges", async () => {
    const p = await chain();
    expect(p.lineage!.records.length).toBeGreaterThan(1);
    expect(() => validateProject(p)).not.toThrow();
    const copy = importProject(exportProject(p, "json", undefined, false));
    expect(copy.utterances).toEqual(p.utterances);
    expect(copy.sources).toEqual(p.sources);
    expect(copy.lineage).toEqual(p.lineage);
  });
  it("rejects a self-justified ghost old ID without mutating the input", async () => {
    const p = await chain();
    const malformed = ghost(p);
    const before = JSON.stringify(malformed);
    expect(malformed.sources).toEqual(p.sources);
    expect(malformed.utterances).toEqual(p.utterances);
    expect(malformed.lineage!.records[0].undoSnapshot).toEqual(
      p.lineage!.records[0].undoSnapshot,
    );
    expect(() => validateProject(malformed)).toThrow("lineage history gap");
    expect(JSON.stringify(malformed)).toBe(before);
  });
  it("rejects the same unexplained ID at the complete JSON import boundary", async () => {
    const data = JSON.parse(
      exportProject(await chain(), "json", undefined, false),
    ) as { project: Project };
    data.project.lineage!.records[0].oldIds = ["ghost-old-id"];
    expect(() => importProject(JSON.stringify(data))).toThrow(
      "lineage history gap",
    );
  });
  for (const mismatch of ["quote", "source-version", "range"] as const) {
    it(`does not anchor a ghost with a persisted state having a wrong ${mismatch}`, async () => {
      const malformed = ghost(await chain());
      const r = malformed.lineage!.records[0];
      const retired = structuredClone(r.undoSnapshot!.retiredUtterances![0]);
      retired.id = "ghost-old-id";
      if (mismatch === "quote") retired.quote = "not the source quote";
      if (mismatch === "source-version")
        retired.sourceVersionId = "undefined-source-version";
      if (mismatch === "range") {
        const cue = malformed.sources.find(
          (s) => s.versionId === r.sourceVersionId,
        )!.cueLedger![1];
        retired.start = cue.start;
        retired.end = cue.end;
        retired.quote = "ghijkl";
        retired.cueSpans = [{ cueId: cue.id, start: cue.start, end: cue.end }];
      }
      r.undoSnapshot!.retiredUtterances!.push(retired);
      expect(() => validateProject(malformed)).toThrow("lineage history gap");
    });
  }
  for (const snapshot of ["compact", "full"] as const) {
    it(`keeps schemaVersion 1 single-time legacy JSON with a legal ${snapshot} retired snapshot`, async () => {
      const base = await original();
      const p = splitUtterance(
        base,
        base.utterances[0].id,
        3,
        "旧形式の正規split",
      );
      if (snapshot === "full")
        p.lineage!.records[0].undoSnapshot = {
          __projectSnapshot: semanticSnapshot(base),
        };
      stripCueFields(p);
      expect(p.schemaVersion).toBe(1);
      expect(p.sources.every((s) => s.cueLedger === undefined)).toBe(true);
      expect(() => validateProject(p)).not.toThrow();
      const restored = importProject(
        exportProject(p, "json", undefined, false),
      );
      expect(restored.utterances).toEqual(p.utterances);
      expect(restored.lineage).toEqual(p.lineage);
    });
  }
});
