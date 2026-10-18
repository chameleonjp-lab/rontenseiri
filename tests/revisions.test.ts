import { describe, expect, it } from "vitest";
import { parseInputs } from "../src/input/parse";
import {
  createProject,
  reviseProject,
  validateProject,
} from "../src/domain/project";
import { moveUtterance, undoLastRevision } from "../src/domain/revisions";

async function fixture() {
  const project = createProject(
    await parseInputs([
      {
        name: "a.txt",
        format: "txt",
        role: "conversation",
        text: "A\nU1\nU2\nB",
      },
    ]),
    "x",
    "full",
  );
  const first = project.agendas[0];
  const second = {
    ...first,
    id: "B",
    title: "B",
    utteranceIds: [project.utterances[3].id],
    boundary: "candidate" as const,
    needsReview: false,
  };
  first.utteranceIds = project.utterances.slice(0, 3).map((u) => u.id);
  project.agendas.push(second);
  return validateProject(project);
}

describe("revisions", () => {
  it("moves membership without changing utterance semantic fields and keeps global order", async () => {
    const p = await fixture();
    const moved = p.utterances[1];
    const q = moveUtterance(p, moved.id, "B", "境界を確認");
    expect(q.utterances.find((u) => u.id === moved.id)).toEqual(moved);
    expect(
      q.agendas.find((a) => a.id === p.agendas[0].id)?.utteranceIds,
    ).toEqual([p.utterances[0].id, p.utterances[2].id]);
    expect(q.agendas.find((a) => a.id === "B")?.utteranceIds).toEqual([
      p.utterances[1].id,
      p.utterances[3].id,
    ]);
    expect(q.revisions[0].kind).toBe("agenda-membership");
    expect(validateProject(q)).toBeTruthy();
  });

  it("undoes a classification revision and restores needsReview", async () => {
    const p = await fixture();
    const agenda = p.agendas[0];
    const q = reviseProject(
      p,
      p.utterances[0].id,
      { classification: "drift" },
      "分類訂正",
    );
    expect(q.agendas[0].needsReview).toBe(true);
    const r = undoLastRevision(q);
    expect(r.utterances[0].classification).toBe(p.utterances[0].classification);
    expect(r.agendas.find((a) => a.id === agenda.id)?.needsReview).toBe(false);
    expect(r.revisions.at(-1)?.kind).toBe("undo");
    expect(validateProject(r)).toBeTruthy();
  });
});
