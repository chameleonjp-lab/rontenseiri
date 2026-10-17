import { describe, expect, it } from "vitest";
import { createProject } from "../src/domain/project";
import { parseInputs } from "../src/input/parse";
import {
  mergeUtterances,
  resolveLineageTransfer,
  splitUtterance,
} from "../src/domain/utterance-editing";
import { validateLineage } from "../src/domain/lineage-validation";

async function fixture(text = "A: hello world\nB: reply") {
  return createProject(
    await parseInputs([
      { name: "a.txt", format: "txt", role: "conversation", text },
    ]),
    "x",
    "full",
  );
}

describe("utterance lineage editing", () => {
  it("splits exact source text, keeps order/membership, and records pending transfers", async () => {
    const p = await fixture();
    const old = p.utterances[0];
    const q = splitUtterance(p, old.id, 7, "本文境界を確認");
    expect(q.utterances.map((u) => u.quote)).toEqual([
      "A: hell",
      "o world",
      "B: reply",
    ]);
    expect(q.utterances[0].sourceVersionId).toBe(old.sourceVersionId);
    expect(q.utterances[0].quote).toBe(
      q.sources[0].text.slice(q.utterances[0].start, q.utterances[0].end),
    );
    expect(q.agendas[0].utteranceIds.slice(0, 2)).toEqual(
      q.utterances.slice(0, 2).map((u) => u.id),
    );
    expect(q.lineage?.records[0].status).toBe("pending");
    expect(q.lineage?.records[0].references[0].status).toBe("pending");
    expect(() => validateLineage(q)).not.toThrow();
  });

  it("merges same-speaker ranges without dropping the source gap", async () => {
    const p = await fixture("A: one\nA: two\nB: end");
    const q = mergeUtterances(p, [p.utterances[0].id, p.utterances[1].id]);
    expect(q.utterances[0].quote).toBe("A: one\nA: two");
    expect(q.utterances[0].quote).toBe(
      q.sources[0].text.slice(q.utterances[0].start, q.utterances[0].end),
    );
    expect(q.lineage?.records[0].operation).toBe("merge");
  });

  it("resolves an ambiguous transfer only through an explicit target", async () => {
    const p = await fixture();
    const q = splitUtterance(p, p.utterances[0].id, 7);
    const record = q.lineage!.records[0];
    const resolved = resolveLineageTransfer(
      q,
      record.id,
      record.references[0].referenceId,
      [record.newIds[0]],
    );
    expect(resolved.lineage!.records[0].references[0].status).toBe("applied");
    expect(resolved.lineage!.records[0].status).toBe("applied");
  });

  it("rejects merging different speakers", async () => {
    const p = await fixture();
    p.utterances[1].speaker = "別話者";
    expect(() =>
      mergeUtterances(p, [p.utterances[0].id, p.utterances[1].id]),
    ).toThrow();
  });
});
