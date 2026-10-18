import { describe, expect, it } from "vitest";
import {
  createProject,
  reviseSource,
  validateProject,
} from "../src/domain/project";
import { undoLastRevision } from "../src/domain/revisions";
import { exportProject, importProject } from "../src/export/project";
import { parseInputs, readInputFile } from "../src/input/parse";

const role = "conversation" as const;

function assertSourceSlices(project: ReturnType<typeof createProject>) {
  for (const utterance of project.utterances) {
    const source = project.sources.find(
      (item) => item.versionId === utterance.sourceVersionId,
    );
    expect(source).toBeDefined();
    expect(source!.text.slice(utterance.start, utterance.end)).toBe(
      utterance.quote,
    );
    expect(Number.isInteger(utterance.start)).toBe(true);
    expect(Number.isInteger(utterance.end)).toBe(true);
    expect(utterance.start).toBeGreaterThanOrEqual(0);
    expect(utterance.end).toBeGreaterThanOrEqual(utterance.start);
  }
}

describe("P1 input provenance position contracts", () => {
  it("keeps UTF-16 half-open offsets for BOM, mixed line endings, and Unicode graphemes", async () => {
    const text = "\ufeffA😀́\r\n家族👩‍💻\n孤独なCR\r最後";
    const parsed = await parseInputs([
      { name: "unicode.txt", format: "txt", role, text },
    ]);
    const project = createProject(parsed, "位置", "full");

    expect(project.sources[0].text).toBe(text);
    expect(project.utterances.map((u) => u.quote)).toEqual([
      "\ufeffA😀́",
      "家族👩‍💻",
      "孤独なCR",
      "最後",
    ]);
    assertSourceSlices(project);
    expect(project.utterances.map((u) => u.line)).toEqual([1, 2, 3, 4]);
    expect(project.utterances.map((u) => [u.start, u.end])).toEqual([
      [0, "\ufeffA😀́".length],
      ["\ufeffA😀́\r\n".length, "\ufeffA😀́\r\n家族👩‍💻".length],
      ["\ufeffA😀́\r\n家族👩‍💻\n".length, "\ufeffA😀́\r\n家族👩‍💻\n孤独なCR".length],
      [text.length - 2, text.length],
    ]);
  });

  it("preserves a UTF-8 BOM and its raw UTF-16 offsets at file input", async () => {
    const text = "A😀\r\n結合́\r最後";
    const bytes = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...new TextEncoder().encode(text),
    ]);
    const item = await readInputFile(new File([bytes], "bom.txt"), role);
    const parsed = await parseInputs([item]);
    const project = createProject(parsed, "BOM", "full");

    expect(project.sources[0].text).toBe("\ufeff" + text);
    expect(project.utterances[1].start).toBe("\ufeffA😀\r\n".length);
    assertSourceSlices(project);
  });

  it("rebases UTF-16 offsets after correction, then preserves them through Undo and full JSON", async () => {
    const text = "前😀\n対象́\r\n後ろ👨‍👩‍👧‍👦";
    const project = createProject(
      await parseInputs([{ name: "rebase.txt", format: "txt", role, text }]),
      "訂正",
      "full",
    );
    const target = project.utterances[1];
    const replacement = "訂正👩‍🔬\n結合́";
    const oldTargetLength = target.end - target.start;
    const corrected = reviseSource(project, target.id, replacement, "位置契約");
    const correctedSource = corrected.sources.find(
      (source) => source.versionId === corrected.utterances[0].sourceVersionId,
    )!;
    const correctedTarget = corrected.utterances.find(
      (u) => u.id === target.id,
    )!;
    const following = corrected.utterances[2];
    const delta = replacement.length - oldTargetLength;

    expect(correctedTarget.start).toBe(target.start);
    expect(correctedTarget.end).toBe(target.start + replacement.length);
    expect(following.start).toBe(project.utterances[2].start + delta);
    expect(
      correctedSource.text.slice(correctedTarget.start, correctedTarget.end),
    ).toBe(replacement);
    assertSourceSlices(corrected);
    const correctedRoundTrip = importProject(exportProject(corrected, "json"));
    assertSourceSlices(correctedRoundTrip);
    expect(correctedRoundTrip.utterances).toEqual(corrected.utterances);

    const undone = undoLastRevision(corrected);
    assertSourceSlices(undone);
    expect(undone.utterances.find((u) => u.id === target.id)).toEqual(target);

    const roundTripped = importProject(exportProject(undone, "json"));
    assertSourceSlices(roundTripped);
    expect(
      roundTripped.sources.find(
        (source) => source.versionId === target.sourceVersionId,
      )?.text,
    ).toBe(text);
    expect(() => validateProject(roundTripped)).not.toThrow();
  });
});
