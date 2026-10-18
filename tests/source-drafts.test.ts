import { describe, expect, it } from "vitest";
import {
  changeSourceDraft,
  sourceDraftKey,
  type SourceDraftContext,
  type SourceEditDraft,
} from "../src/components/source-drafts";
const original: SourceDraftContext = {
  projectId: "p1",
  utteranceId: "u1",
  sourceId: "s1",
  bodyId: "cue-1:0",
  originalQuote: "元の字幕😀",
};
describe("unapplied source draft contexts", () => {
  it("isolates projects, utterances and cue fragments and rejects changed original-body context", () => {
    const cache = new Map<string, SourceEditDraft>();
    changeSourceDraft(cache, original, { quote: "未適用本文", reason: "理由" });
    expect(cache.get(sourceDraftKey(original))).toEqual({
      quote: "未適用本文",
      reason: "理由",
    });
    for (const other of [
      { ...original, projectId: "p2" },
      { ...original, utteranceId: "u2" },
      { ...original, bodyId: "cue-2:1" },
      { ...original, originalQuote: "外部で本文を訂正済み" },
    ])
      expect(cache.has(sourceDraftKey(other))).toBe(false);
  });
  it("preserves the same body draft through unrelated position/source-version rebase without claiming it was applied", () => {
    const cache = new Map<string, SourceEditDraft>();
    changeSourceDraft(cache, original, { quote: "draft" });
    const rebased = {
      ...original,
      sourceVersionId: "new-version",
      start: 500,
      end: 510,
    };
    expect(cache.get(sourceDraftKey(rebased))).toEqual({
      quote: "draft",
      reason: "",
    });
    expect(original.originalQuote).toBe("元の字幕😀");
  });
  it("updates only the current draft and removes it when both text and reason are reset", () => {
    const cache = new Map<string, SourceEditDraft>();
    const other = { ...original, bodyId: "cue-2:1", originalQuote: "次の字幕" };
    changeSourceDraft(cache, other, { quote: "別draft", reason: "別理由" });
    changeSourceDraft(cache, original, { quote: "draft" });
    changeSourceDraft(cache, original, { reason: "理由" });
    changeSourceDraft(cache, original, {
      quote: original.originalQuote,
      reason: "",
    });
    expect(cache.has(sourceDraftKey(original))).toBe(false);
    expect(cache.get(sourceDraftKey(other))).toEqual({
      quote: "別draft",
      reason: "別理由",
    });
  });
});
