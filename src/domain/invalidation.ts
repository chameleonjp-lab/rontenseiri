import type { Project } from "./types";

/**
 * Marks agendas affected by an explicit dependency on a changed utterance.
 *
 * This function is deliberately pure: it returns a structured clone and does
 * not modify `project`.  There is no implicit text/similarity matching; only
 * relation endpoints, relation evidenceIds, and the explicit references in a
 * reasoning graph are followed.  Cycles are harmless because all worklists
 * are sets.
 */
export function invalidateDependents(
  project: Project,
  changedUtteranceIds: readonly string[],
  changedSemanticItemIds: readonly string[] = [],
): Project {
  const out = structuredClone(project);
  const changed = new Set(changedUtteranceIds);
  if (!changed.size && !changedSemanticItemIds.length) return out;

  const affectedUtterances = new Set(changed);
  let previousSize = -1;
  while (previousSize !== affectedUtterances.size) {
    previousSize = affectedUtterances.size;
    for (const relation of out.relations) {
      if (
        relation.dependency === true &&
        (affectedUtterances.has(relation.from) ||
          relation.evidenceIds.some((id) => affectedUtterances.has(id)))
      )
        affectedUtterances.add(relation.to);
    }
    // Keep semantic-edit mode in every pass: an utterance edge can reach a
    // new item whose explicit rebuttal has no other shared-source path.
    propagateReasoning(
      out,
      affectedUtterances,
      new Set(),
      new Set(changedSemanticItemIds),
    );
  }

  for (const agenda of out.agendas) {
    if (
      (agenda.summaryDependencies ?? agenda.utteranceIds).some((id) =>
        affectedUtterances.has(id),
      )
    )
      agenda.needsReview = true;
  }
  return out;
}

/** Follow explicit reasoning edges from changed question versions to summaries. */
export function invalidateReasoningDependents(
  project: Project,
  changedQuestionVersionIds: readonly string[],
): Project {
  const out = structuredClone(project);
  if (!changedQuestionVersionIds.length || !out.reasoning) return out;
  const affectedUtterances = new Set<string>();
  propagateReasoning(
    out,
    affectedUtterances,
    new Set(changedQuestionVersionIds),
  );
  // Reuse the utterance/reasoning fixed point so response-derived dependencies
  // also cross agenda boundaries through explicit relation.dependency edges.
  return invalidateDependents(out, [...affectedUtterances]);
}

/** A semantic edit also affects explicit rebuttals, even without a shared source. */
export function invalidateSemanticItemDependents(
  project: Project,
  changedItemIds: readonly string[],
): Project {
  const out = structuredClone(project);
  if (!changedItemIds.length || !out.reasoning) return out;
  return invalidateDependents(out, [], changedItemIds);
}

function propagateReasoning(
  project: Project,
  affectedUtterances: Set<string>,
  initialVersions: Set<string> = new Set(),
  initialItems: Set<string> = new Set(),
): void {
  const reasoning = project.reasoning;
  if (!reasoning) return;

  const evidenceById = new Map(reasoning.evidence.map((x) => [x.id, x]));
  const changedEvidence = new Set(
    reasoning.evidence
      .filter((x) => x.utteranceIds.some((id) => affectedUtterances.has(id)))
      .map((x) => x.id),
  );
  const affectedQuestions = new Set<string>();
  const affectedVersions = new Set(initialVersions);
  const affectedResponses = new Set<string>();
  const affectedItems = new Set(initialItems);
  const affectedInterpretations = new Set<string>();

  const addUtterances = (ids: readonly string[]) => {
    let changed = false;
    for (const id of ids) {
      if (!affectedUtterances.has(id)) {
        affectedUtterances.add(id);
        changed = true;
      }
    }
    return changed;
  };
  const addEvidence = (ids: readonly string[]) => {
    let changed = false;
    for (const id of ids) {
      if (!changedEvidence.has(id) && evidenceById.has(id)) {
        changedEvidence.add(id);
        changed = true;
      }
    }
    return changed;
  };

  // Repeat to a fixed point so question -> response -> item -> interpretation
  // -> uncertainty chains work in either declaration order and in cycles.
  let changed = true;
  while (changed) {
    changed = false;
    for (const version of reasoning.questionVersions) {
      if (
        version.sourceUtteranceIds.some((id) => affectedUtterances.has(id)) ||
        affectedVersions.has(version.id)
      ) {
        if (!affectedVersions.has(version.id)) {
          affectedVersions.add(version.id);
          changed = true;
        }
        if (addUtterances(version.sourceUtteranceIds)) changed = true;
        const question = reasoning.questions.find((q) =>
          q.versionIds.includes(version.id),
        );
        if (question && !affectedQuestions.has(question.id)) {
          affectedQuestions.add(question.id);
          changed = true;
        }
      }
    }
    for (const response of reasoning.responses) {
      if (
        affectedVersions.has(response.questionVersionId) ||
        response.utteranceIds.some((id) => affectedUtterances.has(id)) ||
        response.evidenceIds.some((id) => changedEvidence.has(id)) ||
        (initialItems.size > 0 &&
          response.counterargumentToClaimIds.some((id) =>
            affectedItems.has(id),
          ))
      ) {
        if (!affectedResponses.has(response.id)) {
          affectedResponses.add(response.id);
          changed = true;
        }
        if (addUtterances(response.utteranceIds)) changed = true;
        if (addEvidence(response.evidenceIds)) changed = true;
      }
    }
    for (const item of reasoning.items) {
      if (
        affectedItems.has(item.id) ||
        item.utteranceIds.some((id) => affectedUtterances.has(id)) ||
        item.evidenceIds.some((id) => changedEvidence.has(id)) ||
        (item.counterargumentToId !== undefined &&
          affectedItems.has(item.counterargumentToId))
      ) {
        if (!affectedItems.has(item.id)) {
          affectedItems.add(item.id);
          changed = true;
        }
        if (addUtterances(item.utteranceIds)) changed = true;
        if (addEvidence(item.evidenceIds)) changed = true;
      }
    }
    for (const interpretation of reasoning.interpretations) {
      if (
        affectedVersions.has(interpretation.questionVersionId) ||
        interpretation.premiseItemIds.some((id) => affectedItems.has(id)) ||
        interpretation.conclusionItemIds.some((id) => affectedItems.has(id))
      ) {
        if (!affectedInterpretations.has(interpretation.id)) {
          affectedInterpretations.add(interpretation.id);
          changed = true;
        }
        // An interpretation is explicitly tied to its question version.
        if (!affectedVersions.has(interpretation.questionVersionId)) {
          affectedVersions.add(interpretation.questionVersionId);
          changed = true;
        }
        for (const itemId of [
          ...interpretation.premiseItemIds,
          ...interpretation.conclusionItemIds,
        ]) {
          if (!affectedItems.has(itemId)) {
            affectedItems.add(itemId);
            changed = true;
          }
        }
      }
    }
    for (const uncertainty of reasoning.uncertaintyPropagation) {
      if (
        affectedItems.has(uncertainty.fromItemId) ||
        affectedItems.has(uncertainty.toItemId)
      ) {
        if (!affectedItems.has(uncertainty.toItemId)) {
          affectedItems.add(uncertainty.toItemId);
          changed = true;
        }
        if (!affectedItems.has(uncertainty.fromItemId)) {
          affectedItems.add(uncertainty.fromItemId);
          changed = true;
        }
      }
    }
  }
}

export default invalidateDependents;
