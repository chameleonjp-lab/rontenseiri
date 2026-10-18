import { describe, expect, it } from "vitest";
import { parseInputs } from "../src/input/parse";
import { createProject, validateProject } from "../src/domain/project";
import {
  addInterpretation,
  addQuestion,
  addSemanticItem,
} from "../src/domain/reasoning";
import { exportProject } from "../src/export/project";

const at = "2020-01-01T00:00:00.000Z";

async function exclusiveProject() {
  const parsed = await parseInputs([
    {
      name: "discussion.txt",
      format: "txt",
      role: "conversation",
      text: "問いです\n前提です\n結論です",
    },
  ]);
  let project = createProject(parsed, "test", "full");
  project = addQuestion(project, "問いです", "original", ["U01"], "manual", at);
  const versionId = project.reasoning!.questionVersions[0].id;
  project = addSemanticItem(project, {
    kind: "claim",
    text: "前提",
    utteranceIds: ["U02"],
    evidenceIds: [],
    actor: "manual",
    certainty: "inferred",
    time: { asOf: at, recordedAt: at },
  });
  project = addSemanticItem(project, {
    kind: "claim",
    text: "結論",
    utteranceIds: ["U03"],
    evidenceIds: [],
    actor: "manual",
    certainty: "inferred",
    time: { asOf: at, recordedAt: at },
  });
  const [premise, conclusion] = project.reasoning!.items;
  project = addInterpretation(project, {
    questionVersionId: versionId,
    premiseItemIds: [premise.id],
    conclusionItemIds: [conclusion.id],
    certainty: "uncertain",
    actor: "manual",
    time: { asOf: at, recordedAt: at },
  });
  project = addInterpretation(project, {
    questionVersionId: versionId,
    premiseItemIds: [premise.id],
    conclusionItemIds: [conclusion.id],
    certainty: "uncertain",
    actor: "manual",
    time: { asOf: at, recordedAt: at },
  });
  const interpretations = project.reasoning!.interpretations;
  project.reasoning!.exclusiveGroups.push({
    id: "exclusive-1",
    interpretationIds: interpretations.map((item) => item.id),
    mutuallyExclusive: true,
  });
  for (const interpretation of interpretations)
    interpretation.exclusiveGroupId = "exclusive-1";
  return validateProject(project);
}

describe("exclusive interpretation export safety", () => {
  it("retains exclusive groups in full JSON and rejects lossy formats", async () => {
    const project = await exclusiveProject();
    const full = JSON.parse(exportProject(project, "json")) as {
      project: typeof project;
    };
    expect(full.project.reasoning?.exclusiveGroups).toHaveLength(1);
    expect(() =>
      exportProject(project, "json", project.agendas[0].id, false, ["U01"]),
    ).toThrow("全体JSON出力を使用してください");
    expect(() => exportProject(project, "md")).toThrow("排他的な解釈候補");
    expect(() => exportProject(project, "svg")).toThrow("排他的な解釈候補");
  });
});
