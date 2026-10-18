import { expect, it } from "vitest";
import { createProject } from "../src/domain/project";
import { parseInputs } from "../src/input/parse";
import {
  addQuestion,
  addEvidence,
  linkResponse,
} from "../src/domain/reasoning";
import { splitUtterance } from "../src/domain/utterance-editing";

it("does not change a response or evidence outside the split dependency", async () => {
  let project = createProject(
    await parseInputs([
      {
        name: "locality.txt",
        text: "first split\nother response",
        format: "txt",
        role: "conversation",
      },
    ]),
    "locality",
    "full",
  );
  const [original, other] = project.utterances;
  project = addQuestion(project, "independent", "original", [other.id]);
  project = addEvidence(project, {
    utteranceIds: [other.id],
    sourceIds: [other.sourceId],
    actor: "manual",
    certainty: "confirmed",
    time: {
      asOf: "2020-01-01T00:00:00.000Z",
      recordedAt: "2020-01-01T00:00:00.000Z",
    },
  });
  project = linkResponse(project, {
    questionVersionId: project.reasoning!.questionVersions[0].id,
    utteranceIds: [other.id],
    evidenceIds: [project.reasoning!.evidence[0].id],
    kind: "answer",
    fulfillment: "fulfilled",
    actor: "manual",
    time: {
      asOf: "2020-01-01T00:00:00.000Z",
      recordedAt: "2020-01-01T00:00:00.000Z",
    },
    counterargumentToClaimIds: [],
  });
  const before = structuredClone(project.reasoning);
  const split = splitUtterance(project, original.id, 5, "separate boundary");
  expect(split.reasoning).toEqual(before);
});
