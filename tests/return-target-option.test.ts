import { expect, it } from "vitest";
import { sampleProject } from "../src/analysis/sample";
import { returnTargetOption } from "../src/components/return-target-option";

it("reuses only immutable utterance identity, retaining id and exact excerpt", () => {
  const target = sampleProject().utterances[0];
  const a = returnTargetOption(target);
  expect(returnTargetOption(target)).toBe(a);
  expect(a.type).toBe("option");
  expect(a.props).toMatchObject({
    value: target.id,
    children: [target.id, " · ", target.quote.slice(0, 25)],
  });
});
it("same id with corrected or restored quote never reuses a stale option", () => {
  const original = sampleProject().utterances[0];
  const old = returnTargetOption(original);
  const revised = {
    ...original,
    quote: "訂正後の根拠原文をそのまま候補にも表示します。",
  };
  const current = returnTargetOption(revised);
  expect(current).not.toBe(old);
  expect(current.props).toMatchObject({
    value: original.id,
    children: [original.id, " · ", revised.quote.slice(0, 25)],
  });
  const restored = { ...original };
  const undo = returnTargetOption(restored);
  expect(undo).not.toBe(current);
  expect(undo.props).toMatchObject({
    value: original.id,
    children: [original.id, " · ", original.quote.slice(0, 25)],
  });
});
