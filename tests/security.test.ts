import { describe, expect, it } from "vitest";
import { parseInputs } from "../src/input/parse";
import { createProject, validateProject } from "../src/domain/project";

describe("security boundaries", () => {
  it("rejects aggregate input bytes before parsing", async () => {
    await expect(
      parseInputs([
        {
          name: "a.txt",
          format: "txt",
          role: "conversation",
          text: "x".repeat(50_000),
        },
        {
          name: "b.txt",
          format: "txt",
          role: "conversation",
          text: "x".repeat(30 * 1024 * 1024),
        },
      ]),
    ).rejects.toThrow("30MiB");
  });

  it("does not turn subtitle headers and blank lines into utterances", async () => {
    const r = await parseInputs([
      {
        name: "x.vtt",
        format: "vtt",
        role: "conversation",
        text: "WEBVTT\n\n00:00.000 --> 00:01.000\nhello\n\nNOTE metadata\n\n00:02.000 --> 00:03.000\nworld",
      },
    ]);
    expect(r.utterances.map((u) => u.quote)).toEqual(["hello", "world"]);
  });

  it("rejects duplicate IDs and invalid runtime field types", async () => {
    const r = await parseInputs([
      { name: "x.txt", format: "txt", role: "conversation", text: "hello" },
    ]);
    const p = createProject(r, "x", "full");
    const bad = structuredClone(p);
    (bad.utterances[0] as unknown as { order: unknown }).order = "0";
    expect(() => validateProject(bad)).toThrow();
  });
});
