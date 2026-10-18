import { describe, expect, it } from "vitest";
import { parseInputs } from "../src/input/parse";
import {
  createProject,
  reviseSource,
  validateProject,
} from "../src/domain/project";
import { auditSourceCoverage } from "../src/domain/coverage";
import { undoLastRevision } from "../src/domain/revisions";

async function fixture() {
  const parsed = await parseInputs([
    {
      name: "same-source.txt",
      format: "txt",
      role: "conversation",
      text: "前発言\n後発言",
    },
  ]);
  return createProject(parsed, "同一原文offset", "full");
}

describe("same source revision rebases following utterances", () => {
  it.each([
    ["文字数増加", "前発言を拡張", 3],
    ["文字数減少", "前", -2],
  ])(
    "%sなら後方U02の引用とoffsetを保持し、undoで旧版へ戻す",
    async (_label, replacement, delta) => {
      const before = await fixture();
      const oldSource = before.sources[0];
      const oldU01 = before.utterances.find((u) => u.id === "U01")!;
      const oldU02 = before.utterances.find((u) => u.id === "U02")!;

      const revised = reviseSource(
        before,
        "U01",
        replacement,
        `U01の${_label}`,
      );
      const currentSource = revised.sources.at(-1)!;
      const currentU01 = revised.utterances.find((u) => u.id === "U01")!;
      const currentU02 = revised.utterances.find((u) => u.id === "U02")!;

      expect(currentSource.id).toBe(oldSource.id);
      expect(currentSource.versionId).not.toBe(oldSource.versionId);
      expect(currentU01.sourceVersionId).toBe(currentSource.versionId);
      expect(currentU02.sourceVersionId).toBe(currentSource.versionId);
      expect(currentU01.quote).toBe(replacement);
      expect(currentU02.quote).toBe(oldU02.quote);
      expect(currentU02.start).toBe(oldU02.start + delta);
      expect(currentU02.end).toBe(oldU02.end + delta);
      expect(currentSource.text.slice(currentU01.start, currentU01.end)).toBe(
        currentU01.quote,
      );
      expect(currentSource.text.slice(currentU02.start, currentU02.end)).toBe(
        currentU02.quote,
      );
      expect(
        auditSourceCoverage(currentSource, revised.utterances).complete,
      ).toBe(true);
      expect(validateProject(revised)).toBeTruthy();

      const undone = undoLastRevision(revised);
      const undoneU01 = undone.utterances.find((u) => u.id === "U01")!;
      const undoneU02 = undone.utterances.find((u) => u.id === "U02")!;
      expect(undoneU01.sourceVersionId).toBe(oldU01.sourceVersionId);
      expect(undoneU01.start).toBe(oldU01.start);
      expect(undoneU01.end).toBe(oldU01.end);
      expect(undoneU01.quote).toBe(oldU01.quote);
      expect(undoneU02.sourceVersionId).toBe(oldU02.sourceVersionId);
      expect(undoneU02.start).toBe(oldU02.start);
      expect(undoneU02.end).toBe(oldU02.end);
      expect(undoneU02.quote).toBe(oldU02.quote);
      expect(auditSourceCoverage(oldSource, undone.utterances).complete).toBe(
        true,
      );
      expect(validateProject(undone)).toBeTruthy();
    },
  );
});
