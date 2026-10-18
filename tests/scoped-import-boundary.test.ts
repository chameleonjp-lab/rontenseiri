import { describe, expect, it } from "vitest";
import { parseInputs } from "../src/input/parse";
import { createProject, validateProject } from "../src/domain/project";
import { exportProject, importProject } from "../src/export/project";

async function scopedJson() {
  const parsed = await parseInputs([
    {
      name: "source.txt",
      format: "txt",
      role: "conversation",
      text: "first\nsecond",
    },
  ]);
  const project = validateProject(createProject(parsed, "secret", "excerpt"));
  return JSON.parse(
    exportProject(project, "json", project.agendas[0].id, false, ["U01"]),
  ) as {
    manifest: Record<string, unknown>;
    project: Record<string, any>;
  };
}

describe("scoped import boundary", () => {
  it.each([
    ["text", "first\nOUT_OF_SCOPE"],
    ["name", "OUT_OF_SCOPE_FILENAME"],
    ["warnings", ["OUT_OF_SCOPE_WARNING"]],
    ["hash", "OUT_OF_SCOPE_HASH"],
  ])("rejects known source field contamination: %s", async (field, value) => {
    const wrapper = await scopedJson();
    wrapper.project.sources[0][field as string] = value;
    expect(() => importProject(JSON.stringify(wrapper))).toThrow();
  });

  it.each([
    ["arrival", "OUT_OF_SCOPE_SUMMARY"],
    ["nextAction", "OUT_OF_SCOPE_ACTION"],
    ["unresolved", ["OUT_OF_SCOPE_QUESTION"]],
    ["decision", "decided"],
    ["answer", "present"],
    ["agreement", "explicit"],
    ["verification", "user-recorded"],
    ["needsReview", true],
  ])("rejects known agenda field contamination: %s", async (field, value) => {
    const wrapper = await scopedJson();
    wrapper.project.agendas[0][field as string] = value;
    expect(() => importProject(JSON.stringify(wrapper))).toThrow();
  });

  it.each([
    "fullBackup",
    "historyIncluded",
    "sourceCoverageComplete",
    "organizationComplete",
  ])("rejects contradictory limited manifest: %s", async (field) => {
    const wrapper = await scopedJson();
    wrapper.manifest[field] = true;
    expect(() => importProject(JSON.stringify(wrapper))).toThrow();
  });

  it.each([[], ["U01", "U01"], ["U02"], ["U01", "U02"]])(
    "rejects mismatched allowed IDs: %j",
    async (...ids: string[]) => {
      const wrapper = await scopedJson();
      wrapper.manifest.allowedUtteranceIds = ids;
      expect(() => importProject(JSON.stringify(wrapper))).toThrow();
    },
  );

  it("keeps a legitimate scoped export/import roundtrip and strips unknown fields", async () => {
    const wrapper = await scopedJson();
    wrapper.project.extra = "OUT_OF_SCOPE_UNKNOWN";
    wrapper.project.agendas[0].extra = "OUT_OF_SCOPE_UNKNOWN";
    const restored = importProject(JSON.stringify(wrapper));
    expect(restored.sources[0].text).toBe("first");
    expect(restored.agendas[0].arrival).toContain("限定出力");
    expect(JSON.stringify(restored)).not.toContain("OUT_OF_SCOPE_UNKNOWN");
  });

  it("roundtrips a noncontiguous, pseudonymized selection across sources", async () => {
    const parsed = await parseInputs([
      {
        name: "one.txt",
        format: "txt",
        role: "conversation",
        text: "A: one\nA: excluded",
      },
      {
        name: "two.txt",
        format: "txt",
        role: "conversation",
        text: "B: three\nB: four",
      },
    ]);
    const project = createProject(parsed, "multi", "full");
    const restored = importProject(
      exportProject(project, "json", project.agendas[0].id, true, [
        "U04",
        "U01",
        "U03",
      ]),
    );
    expect(restored.utterances.map((u) => u.id)).toEqual(["U01", "U03", "U04"]);
    expect(restored.sources.map((s) => s.text)).toEqual([
      "A: one",
      "B: three\nB: four",
    ]);
    expect(restored.utterances.map((u) => u.speaker)).toEqual([
      "話者1",
      "話者2",
      "話者2",
    ]);
    expect(JSON.stringify(restored)).not.toContain("excluded");
  });
});
