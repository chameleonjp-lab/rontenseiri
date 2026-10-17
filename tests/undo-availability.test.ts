import { describe, expect, it } from "vitest";
import { sampleProject } from "../src/analysis/sample";
import { reviseProject } from "../src/domain/project";
import { canUndo, undoLastRevision } from "../src/domain/revisions";

describe("undo availability", () => {
  it("becomes unavailable after every revision has been undone", () => {
    const original = sampleProject();
    const revised = reviseProject(
      original,
      original.utterances[0].id,
      { classification: "derived" },
      "テスト訂正",
    );
    expect(canUndo(revised)).toBe(true);

    const undone = undoLastRevision(revised);
    expect(canUndo(undone)).toBe(false);
  });
});
