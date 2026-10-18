import { describe, expect, it } from "vitest";
import { parseInputs } from "../src/input/parse";
import {
  createProject,
  reviseProject,
  reviseSource,
  validateProject,
} from "../src/domain/project";
import { createReasoningGraph } from "../src/domain/reasoning";
import { canUndo, undoLastRevision } from "../src/domain/revisions";
import type { Project } from "../src/domain/types";
import { exportProject, importProject } from "../src/export/project";

async function fixture() {
  const p = createProject(
    await parseInputs([
      {
        name: "repeated-corrections.txt",
        format: "txt",
        role: "conversation",
        text: "採用する\n別件も採用する\n第一の問い\n第一の回答\n別件の結論\n共有まとめの所属本文\n無関係な発言\n既に確認待ち",
      },
    ]),
    "repeated corrections and multi-level Undo",
    "full",
  );
  const template = structuredClone(p.agendas[0]);
  p.agendas = p.utterances.map((u, index) => ({
    ...structuredClone(template),
    id: `agenda-${index}`,
    title: `議題 ${index}`,
    utteranceIds: [u.id],
    summaryDependencies: [u.id],
    boundary: "user-confirmed" as const,
    decision: "conditional" as const,
    answer: "partial" as const,
    agreement: "explicit" as const,
    verification: "user-recorded" as const,
    arrival: `保持する到達点 ${index}`,
    unresolved: [`保持する未回答 ${index}`],
    nextAction: `保持する次の確認 ${index}`,
    needsReview: index === 7,
  }));
  p.selectedAgendaId = p.agendas[5].id;
  const [a, b, question, response, bConclusion] = p.utterances;
  p.agendas[5].summaryDependencies = [response.id, bConclusion.id];
  p.relations = [
    {
      id: "a-to-question",
      from: a.id,
      to: question.id,
      kind: "derived",
      dependency: true,
      evidenceIds: [],
    },
    {
      id: "b-to-conclusion",
      from: b.id,
      to: bConclusion.id,
      kind: "derived",
      dependency: true,
      evidenceIds: [],
    },
    {
      id: "disabled-to-unrelated",
      from: a.id,
      to: p.utterances[6].id,
      kind: "derived",
      dependency: false,
      evidenceIds: [],
    },
  ];
  const g = createReasoningGraph();
  const time = {
    asOf: "2026-10-17T00:00:00.000Z",
    recordedAt: "2026-10-18T00:00:00.000Z",
  };
  g.questions.push({
    id: "question-a",
    origin: "original",
    versionIds: ["version-a"],
    currentVersionId: "version-a",
  });
  g.questionVersions.push({
    id: "version-a",
    questionId: "question-a",
    text: question.quote,
    status: "active",
    actor: "manual",
    time,
    sourceUtteranceIds: [question.id],
  });
  g.responses.push({
    id: "response-a",
    questionVersionId: "version-a",
    utteranceIds: [response.id],
    kind: "answer",
    fulfillment: "partially-fulfilled",
    actor: "manual",
    time,
    counterargumentToClaimIds: [],
    evidenceIds: [],
  });
  p.reasoning = g;
  return validateProject(p);
}

// Compare fields directly, without sharing the product snapshot implementation.
function expectMeaning(actual: Project, expected: Project) {
  expect(actual.utterances).toEqual(expected.utterances);
  expect(actual.agendas).toEqual(expected.agendas);
  expect(actual.relations).toEqual(expected.relations);
  expect(actual.reasoning).toEqual(expected.reasoning);
  expect(actual.lineage).toEqual(expected.lineage);
  expect(actual.selectedAgendaId).toBe(expected.selectedAgendaId);
}

function expectReferences(p: Project) {
  for (const u of p.utterances) {
    const source = p.sources.find((s) => s.versionId === u.sourceVersionId);
    expect(source).toBeDefined();
    expect(source!.id).toBe(u.sourceId);
    expect(source!.text.slice(u.start, u.end)).toBe(u.quote);
  }
}

function roundTrip(p: Project) {
  const before = structuredClone(p);
  const restored = importProject(exportProject(p, "json", undefined, false));
  expectMeaning(restored, before);
  expect(restored.sources).toEqual(before.sources);
  expect(restored.revisions).toEqual(before.revisions);
  expect(p).toEqual(before);
  expectReferences(restored);
  return restored;
}

// Undo recomputes coverage for the active version, but must retain immutable
// source-version identity, content, provenance, and the complete audit prefix.
function sourceCatalog(p: Project) {
  return p.sources.map(({ coverage: _coverage, ...source }) => source);
}

const initialFlags = [false, false, false, false, false, false, false, true];
const aOnlyFlags = [true, false, true, true, false, true, false, true];
const bothFlags = [true, true, true, true, true, true, false, true];

describe.each(["source", "speaker"] as const)(
  "R15 repeated %s corrections with interleaved independent correction",
  (repeated) => {
    it.each([false, true])(
      "restores every intermediate state after full JSON; re-import between Undos=%s",
      async (reimportBetweenUndos) => {
        const initial = await fixture();
        const states = [structuredClone(initial)];
        const editKinds =
          repeated === "source"
            ? (["source", "speaker", "source"] as const)
            : (["speaker", "source", "speaker"] as const);
        const targets = [0, 1, 0];
        const sourceTexts = [
          "採用しない",
          "別件は採用しない",
          "条件付きで採用する",
        ];
        const speakers = ["訂正話者A", "訂正話者B", "再訂正話者A"];
        const expectedFlags = [aOnlyFlags, bothFlags, bothFlags];
        let current = initial;
        expect(current.agendas.map((a) => a.needsReview)).toEqual(initialFlags);
        expect(current.revisions).toEqual([]);
        expect(canUndo(current)).toBe(false);
        expect(current.agendas[5].utteranceIds).toEqual([
          current.utterances[5].id,
        ]);
        expect(current.agendas[5].summaryDependencies).toEqual([
          current.utterances[3].id,
          current.utterances[4].id,
        ]);

        for (let step = 0; step < editKinds.length; step++) {
          const before = structuredClone(current);
          const target = current.utterances[targets[step]];
          const reason = `繰返し訂正 ${step + 1}: ${editKinds[step]}`;
          const edited =
            editKinds[step] === "source"
              ? reviseSource(current, target.id, sourceTexts[step], reason)
              : reviseProject(
                  current,
                  target.id,
                  { speaker: speakers[step] },
                  reason,
                );
          expect(current).toEqual(before);
          expect(validateProject(edited)).toBeDefined();
          expect(edited.agendas).toEqual(
            initial.agendas.map((a, index) => ({
              ...a,
              needsReview: expectedFlags[step][index],
            })),
          );
          expect(edited.relations).toEqual(initial.relations);
          expect(edited.reasoning).toEqual(initial.reasoning);
          expect(edited.revisions.slice(0, -1)).toEqual(before.revisions);
          expect(edited.revisions.at(-1)).toMatchObject({
            targetId: target.id,
            kind:
              editKinds[step] === "source"
                ? "source-revision"
                : "user-revision",
            reason,
          });
          if (editKinds[step] === "source") {
            expect(edited.utterances[targets[step]].quote).toBe(
              sourceTexts[step],
            );
            expect(edited.utterances[targets[step]].sourceVersionId).not.toBe(
              target.sourceVersionId,
            );
            expect(edited.sources.slice(0, -1)).toEqual(before.sources);
            expect(edited.sources).toHaveLength(before.sources.length + 1);
            // This fixture uses one shared TXT source and newline-free edits.
            // Derive offsets from the known utterance order, not product helpers.
            const delta = sourceTexts[step].length - target.quote.length;
            const newVersion = edited.sources.at(-1)!.versionId;
            expect(edited.utterances).toEqual(
              before.utterances.map((u, index) => ({
                ...u,
                sourceVersionId: newVersion,
                start: u.start + (index > targets[step] ? delta : 0),
                end: u.end + (index >= targets[step] ? delta : 0),
                ...(index === targets[step]
                  ? { quote: sourceTexts[step], coverage: "failed" }
                  : {}),
              })),
            );
          } else {
            expect(edited.utterances).toEqual(
              before.utterances.map((u) =>
                u.id === target.id ? { ...u, speaker: speakers[step] } : u,
              ),
            );
            expect(edited.sources).toEqual(before.sources);
          }
          expectReferences(edited);
          current = roundTrip(edited);
          expect(canUndo(current)).toBe(true);
          states.push(structuredClone(current));
        }

        const revisions = structuredClone(current.revisions);
        const retainedCatalog = structuredClone(sourceCatalog(current));
        expect(new Set(revisions.map((r) => r.id)).size).toBe(3);
        expect(current.sources).toHaveLength(repeated === "source" ? 3 : 2);
        for (let step = 2; step >= 0; step--) {
          const before = structuredClone(current);
          const undone = undoLastRevision(current);
          expect(current).toEqual(before);
          expect(validateProject(undone)).toBeDefined();
          expectMeaning(undone, states[step]);
          expect(undone.agendas.map((a) => a.needsReview)).toEqual(
            step === 2 ? bothFlags : step === 1 ? aOnlyFlags : initialFlags,
          );
          expect(sourceCatalog(undone)).toEqual(retainedCatalog);
          expectReferences(undone);
          expect(undone.revisions.slice(0, -1)).toEqual(before.revisions);
          expect(undone.revisions).toHaveLength(6 - step);
          expect(undone.revisions.at(-1)).toMatchObject({
            kind: "undo",
            targetId: revisions[step].targetId,
            after: { targetRevisionId: revisions[step].id },
          });
          expect(canUndo(undone)).toBe(step > 0);
          current = reimportBetweenUndos ? roundTrip(undone) : undone;
        }
        expect(current.revisions.slice(0, 3)).toEqual(revisions);
        expect(
          current.revisions
            .slice(3)
            .map(
              (r) => (r.after as { targetRevisionId: string }).targetRevisionId,
            ),
        ).toEqual(revisions.map((r) => r.id).reverse());
        expectMeaning(roundTrip(current), initial);
        const exhausted = structuredClone(current);
        expect(() => undoLastRevision(current)).toThrow("no revision to undo");
        expect(current).toEqual(exhausted);
      },
    );
  },
);
