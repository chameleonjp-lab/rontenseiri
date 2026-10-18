import { sampleProject } from "../../src/analysis/sample";
import { validateProject } from "../../src/domain/project";
import type { Project } from "../../src/domain/types";

/**
 * Full sample project with a deliberately noisy relation list for incoming
 * return clearing. U10 has exactly two incoming returns (U03 and U08); U03
 * also returns to U09, while U07 → U10 is an unrelated non-return edge.
 */
export function incomingReturnsFixture(): Project {
  const project = sampleProject();
  project.relations = [
    {
      id: "incoming-fixture-main-01",
      from: "U01",
      to: "U07",
      kind: "main",
      evidenceIds: ["U07", "U01"],
    },
    {
      id: "incoming-fixture-return-u03-u10",
      from: "U03",
      to: "U10",
      kind: "return",
      evidenceIds: ["U10", "U03"],
    },
    {
      id: "incoming-fixture-main-u07-u10",
      from: "U07",
      to: "U10",
      kind: "main",
      evidenceIds: ["U07", "U10"],
    },
    {
      id: "incoming-fixture-derived-01",
      from: "U01",
      to: "U03",
      kind: "derived",
      evidenceIds: ["U03", "U01"],
    },
    {
      id: "incoming-fixture-return-u03-u09",
      from: "U03",
      to: "U09",
      kind: "return",
      evidenceIds: ["U09", "U03"],
    },
    {
      id: "incoming-fixture-derived-03-u03-u07",
      from: "U03",
      to: "U07",
      kind: "derived",
      evidenceIds: ["U07", "U03"],
    },
    {
      id: "incoming-fixture-drift-01",
      from: "U07",
      to: "U08",
      kind: "drift",
      evidenceIds: ["U08", "U07"],
    },
    {
      id: "incoming-fixture-return-u08-u10",
      from: "U08",
      to: "U10",
      kind: "return",
      evidenceIds: ["U08", "U10"],
    },
    {
      id: "incoming-fixture-drift-02",
      from: "U08",
      to: "U09",
      kind: "drift",
      evidenceIds: ["U09", "U08"],
    },
    {
      id: "incoming-fixture-unrelated-return",
      from: "U09",
      to: "U13",
      kind: "return",
      evidenceIds: ["U13", "U09"],
    },
    {
      id: "incoming-fixture-main-10-13",
      from: "U10",
      to: "U13",
      kind: "main",
      evidenceIds: ["U10", "U13"],
    },
    {
      id: "incoming-fixture-main-13-16",
      from: "U13",
      to: "U16",
      kind: "main",
      evidenceIds: ["U16", "U13"],
    },
  ];
  for (const id of ["U03", "U08", "U09"]) {
    project.utterances.find((utterance) => utterance.id === id)!.returnStatus =
      "unknown";
  }
  return validateProject(project);
}
