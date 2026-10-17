import { describe, expect, it } from "vitest";
import { parseInputs } from "../src/input/parse";
import { createProject, validateProject } from "../src/domain/project";
import { exportProject, importProject } from "../src/export/project";

async function fixture() {
  const parsed = await parseInputs([
    {
      name: "UNSHOWN_SECRET_FILE.txt",
      format: "txt",
      role: "conversation",
      text: "UNSHOWN_SECRET\nKEEP_ME_EXACT\nHIDDEN_ME_FOLDED\nOTHER_ME_AGENDA",
    },
  ]);
  const p = createProject(parsed, "FULL_PROJECT_SECRET", "excerpt");
  const a = {
    ...p.agendas[0],
    id: "A",
    title: "選択議題",
    utteranceIds: ["U01", "U02", "U03"],
    arrival: "OUTSIDE_SUMMARY",
    unresolved: ["SUMMARY_SECRET"],
    nextAction: "ACTION_SECRET",
  };
  p.agendas = [
    a,
    { ...a, id: "B", title: "OTHER_TITLE_SECRET", utteranceIds: ["U04"] },
  ];
  p.selectedAgendaId = "A";
  p.revisions = [
    {
      id: "r1",
      at: p.createdAt,
      targetId: "U02",
      kind: "user-revision",
      before: "HISTORY_SECRET",
      after: "AFTER_SECRET",
      reason: "REASON_SECRET",
    },
  ];
  p.runs = [
    {
      id: "run1",
      at: p.createdAt,
      engine: "test",
      model: "test",
      status: "complete",
      note: "PROMPT_SECRET",
    },
  ];
  return validateProject(p);
}
const excluded = [
  "UNSHOWN_SECRET",
  "HIDDEN_ME_FOLDED",
  "OTHER_ME_AGENDA",
  "OTHER_TITLE_SECRET",
  "FULL_PROJECT_SECRET",
  "OUTSIDE_SUMMARY",
  "SUMMARY_SECRET",
  "ACTION_SECRET",
  "HISTORY_SECRET",
  "AFTER_SECRET",
  "REASON_SECRET",
  "PROMPT_SECRET",
];

describe("explicit allowlisted export", () => {
  for (const format of ["json", "md", "svg"] as const) {
    it(`${format}: includes the chosen evidence and excludes all unchosen and historical text`, async () => {
      const p = await fixture();
      const result = exportProject(p, format, "A", false, ["U02"]);
      expect(result).toContain("KEEP_ME_EXACT");
      expect(result.length).toBeGreaterThan(20);
      excluded.forEach((secret) => expect(result).not.toContain(secret));
      if (format === "json") {
        const wrapper = JSON.parse(result);
        expect(wrapper.manifest.allowedUtteranceIds).toEqual(["U02"]);
        expect(
          wrapper.project.utterances.map((u: { id: string }) => u.id),
        ).toEqual(["U02"]);
        expect(wrapper.project.sources).toHaveLength(1);
        expect(wrapper.project.sources[0].text).toBe("KEEP_ME_EXACT");
        expect(wrapper.project.revisions).toEqual([]);
        expect(wrapper.project.runs).toEqual([]);
        const restored = importProject(result);
        expect(restored.utterances[0].quote).toBe("KEEP_ME_EXACT");
        expect(restored.selectedAgendaId).toBe("A");
        expect(restored.id).not.toBe(p.id);
        expect(validateProject(restored)).toEqual(restored);
      }
    });
  }
  it("rejects absent, empty, duplicate and out-of-agenda allowlists", async () => {
    const p = await fixture();
    expect(() => exportProject(p, "json", "A")).toThrow();
    expect(() => exportProject(p, "json", "A", false, [])).toThrow();
    expect(() =>
      exportProject(p, "json", "A", false, ["U02", "U02"]),
    ).toThrow();
    expect(() => exportProject(p, "json", "A", false, ["U04"])).toThrow();
    expect(() => exportProject(p, "json", undefined, false, ["U02"])).toThrow();
  });
  it("can include more than one chosen utterance, in original order, and no others", async () => {
    const p = await fixture();
    const result = exportProject(p, "json", "A", false, ["U02", "U03"]);
    expect(result).toContain("KEEP_ME_EXACT");
    expect(result).toContain("HIDDEN_ME_FOLDED");
    expect(result).not.toContain("OTHER_ME_AGENDA");
    expect(importProject(result).utterances.map((u) => u.id)).toEqual([
      "U02",
      "U03",
    ]);
  });
  it("full backup retains every original version and history for restoration", async () => {
    const p = await fixture();
    const result = exportProject(p, "json");
    excluded.forEach((secret) => expect(result).toContain(secret));
    const restored = importProject(result);
    expect(restored.sources).toEqual(p.sources);
    expect(restored.revisions).toEqual(p.revisions);
    expect(restored.agendas).toEqual(p.agendas);
  });
  it("pseudonymization is consistent by speaker but deliberately does not rewrite evidence", async () => {
    const p = await fixture();
    p.utterances[1].speaker = "同じ人";
    p.utterances[2].speaker = "同じ人";
    const restored = importProject(
      exportProject(p, "json", "A", true, ["U02", "U03"]),
    );
    expect(restored.utterances.map((u) => u.speaker)).toEqual([
      "話者1",
      "話者1",
    ]);
    expect(restored.utterances[0].quote).toBe("KEEP_ME_EXACT");
    const md = exportProject(p, "md", "A", true, ["U02", "U03"]);
    expect(md.match(/\*\*話者1\*\*/g)).toHaveLength(2);
    const svg = exportProject(p, "svg", "A", true, ["U02", "U03"]);
    expect(svg).toContain("話者1");
    expect(svg).not.toContain("同じ人");
  });
});
