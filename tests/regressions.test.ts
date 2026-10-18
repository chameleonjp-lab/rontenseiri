import { describe, expect, it } from "vitest";
import { parseInputs } from "../src/input/parse";
import {
  createProject,
  reviseSource,
  reviseProject,
  validateProject,
} from "../src/domain/project";
import { exportProject, importProject } from "../src/export/project";

describe("regressions", () => {
  it("allows multiple versions for one source and shifts using the captured old end", async () => {
    const r = await parseInputs([
      {
        name: "a.txt",
        format: "txt",
        role: "conversation",
        text: "one\ntwo\nthree",
      },
    ]);
    let p = createProject(r, "x", "full");
    p = reviseSource(p, p.utterances[0].id, "ONE LONG", "fix");
    expect(
      p.sources.filter((s) => s.id === p.utterances[0].sourceId),
    ).toHaveLength(2);
    expect(p.utterances[1].start).toBe("ONE LONG\ntwo".length - 3);
  });
  it("accepts unresolved string arrays", async () => {
    const p = createProject(
      await parseInputs([
        { name: "a.txt", format: "txt", role: "conversation", text: "x" },
      ]),
      "x",
      "full",
    );
    expect(() =>
      reviseProject(p, p.agendas[0].id, { unresolved: ["question"] }, "reason"),
    ).not.toThrow();
  });
  it("uses global order and permits a shared agenda across conversation files", async () => {
    const p = createProject(
      await parseInputs([
        { name: "a.txt", format: "txt", role: "conversation", text: "a" },
        { name: "b.txt", format: "txt", role: "conversation", text: "b" },
      ]),
      "x",
      "full",
    );
    expect(p.utterances.map((u) => u.order)).toEqual([0, 1]);
    expect(validateProject(p)).toBeTruthy();
  });
  it("limits JSON agenda export to rebased source excerpts", async () => {
    const p = createProject(
      await parseInputs([
        {
          name: "a.txt",
          format: "txt",
          role: "conversation",
          text: "secret\nkeep",
        },
      ]),
      "x",
      "full",
    );
    const out = JSON.parse(
      exportProject(
        p,
        "json",
        p.agendas[0].id,
        false,
        p.agendas[0].utteranceIds,
      ),
    );
    expect(out.manifest.limited).toBe(true);
    expect(out.project.sources[0].text).toBe("secret\nkeep");
    expect(importProject(JSON.stringify(out)).agendas[0].id).toBe(
      p.agendas[0].id,
    );
  });
});
