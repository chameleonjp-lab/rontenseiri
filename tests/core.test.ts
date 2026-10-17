import { describe, expect, it } from "vitest";
import { parseInputs } from "../src/input/parse";
import {
  createProject,
  reviseProject,
  validateProject,
} from "../src/domain/project";
import { exportProject, importProject } from "../src/export/project";

describe("core", () => {
  it("keeps exact source quotes and restores JSON with a new id", async () => {
    const r = await parseInputs([
      { name: "a.txt", text: "A\nB", format: "txt", role: "conversation" },
    ]);
    const p = createProject(r, "x", "full");
    expect(p.utterances[0].quote).toBe("A");
    expect(validateProject(p).id).toBe(p.id);
    const q = importProject(exportProject(p, "json"));
    expect(q.id).not.toBe(p.id);
    expect(q.utterances[1].quote).toBe("B");
  });
  it("records user revisions without changing source text", async () => {
    const r = await parseInputs([
      { name: "a.txt", text: "A", format: "txt", role: "conversation" },
    ]);
    const p = createProject(r, "x", "full");
    const q = reviseProject(
      p,
      p.utterances[0].id,
      { speaker: "Alice", important: true },
      "確認",
    );
    expect(q.utterances[0].speaker).toBe("Alice");
    expect(q.revisions).toHaveLength(1);
    expect(q.sources[0].text).toBe("A");
  });
});
