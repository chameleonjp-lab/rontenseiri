import { it, expect } from "vitest";
import { parseInputs } from "../src/input/parse";
import {
  auditSourceCoverage,
  classifySourceRange,
} from "../src/domain/coverage";
import { createProject } from "../src/domain/project";
import { undoLastRevision } from "../src/domain/revisions";
it("話者なし段落・短い訂正を切出し前に落とすと全範囲検査が失敗する", async () => {
  const r = await parseInputs([
    {
      name: "x.txt",
      format: "txt",
      role: "conversation",
      text: "最初\r\n\r\n短い訂正\n続き🙂",
    },
  ]);
  const s = r.sources[0];
  expect(auditSourceCoverage(s, r.utterances).complete).toBe(true);
  const dropped = r.utterances.filter((u) => u.quote !== "短い訂正");
  expect(auditSourceCoverage(s, dropped).complete).toBe(false);
  expect(auditSourceCoverage(s, dropped).issues.length).toBeGreaterThan(0);
  expect(
    auditSourceCoverage(s, r.utterances)
      .spans.map((x) => s.text.slice(x.start, x.end))
      .join(""),
  ).toBe(s.text);
});
it("合法な同時刻・重複字幕を保持し、不正な終了時刻だけ拒否する", async () => {
  const text =
    "WEBVTT\n\n00:00.000 --> 00:02.000\nできるとは\n\n00:00.000 --> 00:03.000\n言っていません\n";
  const r = await parseInputs([
    { name: "x.vtt", format: "vtt", role: "conversation", text },
  ]);
  expect(r.utterances).toHaveLength(2);
  expect(r.utterances[1].quote).toBe("言っていません");
  expect(auditSourceCoverage(r.sources[0], r.utterances).complete).toBe(true);
  await expect(
    parseInputs([
      {
        name: "bad.vtt",
        format: "vtt",
        role: "conversation",
        text: text
          .replace("00:03.000", "00:00.000")
          .replace("00:00.000 --> 00:00.000", "00:01.000 --> 00:00.000"),
      },
    ]),
  ).rejects.toThrow();
});
it("非発言にしきれない字幕前の段落を未確定で残し、理由付き対象外とUndoを保持する", async () => {
  const r = await parseInputs([
    {
      name: "x.vtt",
      format: "vtt",
      role: "conversation",
      text: "WEBVTT\n\n未整理の補記\n\n00:00.000 --> 00:01.000\n発言\n",
    },
  ]);
  const p = createProject(r, "x", "excerpt");
  const a = auditSourceCoverage(p.sources[0], p.utterances);
  expect(a.complete).toBe(false);
  const range = a.pending[0];
  expect(() =>
    classifySourceRange(
      p,
      p.sources[0].versionId,
      range.start,
      range.end,
      "excluded",
      "",
    ),
  ).toThrow();
  const out = classifySourceRange(
    p,
    p.sources[0].versionId,
    range.start,
    range.end,
    "excluded",
    "会話外の作成者メモ",
  );
  expect(out.sources[0].text).toBe(p.sources[0].text);
  expect(auditSourceCoverage(out.sources[0], out.utterances).complete).toBe(
    true,
  );
  expect(
    auditSourceCoverage(undoLastRevision(out).sources[0], out.utterances)
      .complete,
  ).toBe(false);
});
