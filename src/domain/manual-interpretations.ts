import type { Project, Revision } from "./types";
import { semanticSnapshot } from "./snapshot";
import { validateReasoning } from "./reasoning-validation";
import type {
  Certainty,
  ExclusiveInterpretationGroup,
  Interpretation,
  ReasoningGraph,
  SemanticItem,
} from "./reasoning-types";

/** UI-ready input for one side of a manual, mutually-exclusive pair. */
export interface ManualExclusiveCandidateInput {
  id?: string;
  name: string;
  premiseText: string;
  conclusionText: string;
  evidenceIds: string[];
  /** Existing semantic conclusions affected by this candidate. */
  dependentConclusionIds?: string[];
  /** Optional labels for the referenced dependent conclusions. */
  dependentConclusionNames?: Record<string, string>;
  /** The API is deliberately manual-only; a confirmation is never accepted. */
  certainty?: Certainty;
  confirmed?: boolean;
}

export interface ManualDependentConclusion {
  id: string;
  name: string;
}

export interface ManualExclusiveCandidate {
  interpretationId: string;
  name: string;
  premiseItemId: string;
  conclusionItemId: string;
  dependentConclusions: ManualDependentConclusion[];
}

export interface ManualExclusivePairResult {
  groupId: string;
  questionVersionId: string;
  candidates: [ManualExclusiveCandidate, ManualExclusiveCandidate];
}

export type ManualInterpretationProject = Project;
const clone = <T>(x: T): T => structuredClone(x);
const now = () => new Date().toISOString();
const newId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
const text = (value: unknown, label: string) => {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${label} required`);
  return value.trim();
};
const unique = (xs: string[]) => new Set(xs).size === xs.length;
const graphOf = (p: Project): ReasoningGraph =>
  p.reasoning
    ? clone(p.reasoning)
    : {
        questions: [],
        questionVersions: [],
        responses: [],
        evidence: [],
        items: [],
        positionChanges: [],
        interpretations: [],
        exclusiveGroups: [],
        uncertaintyPropagation: [],
        revisions: [],
      };
const stamp = () => ({ asOf: now(), recordedAt: now() });

function checked(project: Project): Project {
  validateReasoning(project);
  return clone(project);
}
function evidenceCheck(g: ReasoningGraph, ids: unknown) {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.some((x) => typeof x !== "string") ||
    !unique(ids)
  )
    throw new Error("manual candidate requires nonempty unique evidenceIds");
  const existing = new Set(g.evidence.map((x) => x.id));
  if (ids.some((x) => !existing.has(x)))
    throw new Error("manual candidate has unknown evidence ID");
  if (
    ids.some((id) => {
      const e = g.evidence.find((x) => x.id === id);
      return !e?.utteranceIds.length || !e.sourceIds.length;
    })
  )
    throw new Error("manual candidate evidence must link to source text");
  return [...ids];
}
function candidateCheck(
  g: ReasoningGraph,
  input: ManualExclusiveCandidateInput,
) {
  text(input.name, "candidate name");
  text(input.premiseText, "premiseText");
  text(input.conclusionText, "conclusionText");
  evidenceCheck(g, input.evidenceIds);
  if (input.certainty !== undefined && input.certainty !== "uncertain")
    throw new Error("manual exclusive candidates must be uncertain");
  if (input.confirmed === true)
    throw new Error("confirmed manual candidate contradicts uncertainty");
  const deps = input.dependentConclusionIds ?? [];
  if (!Array.isArray(deps) || !unique(deps))
    throw new Error("invalid dependent conclusions");
  const itemIds = new Set(g.items.map((x) => x.id));
  if (deps.some((x) => typeof x !== "string" || !itemIds.has(x)))
    throw new Error("unknown dependent conclusion ID");
  if (
    deps.some((id) =>
      g.interpretations.some((i) =>
        [...i.premiseItemIds, ...i.conclusionItemIds].includes(id),
      ),
    )
  )
    throw new Error(
      "dependent conclusion cannot be another interpretation item",
    );
  for (const id of deps)
    text(
      input.dependentConclusionNames?.[id] ??
        g.items.find((x) => x.id === id)?.text,
      "dependent conclusion name",
    );
}
function item(
  value: Pick<SemanticItem, "kind" | "text" | "evidenceIds">,
): SemanticItem {
  return {
    id: newId("item"),
    kind: value.kind,
    text: value.text,
    utteranceIds: [],
    evidenceIds: [...value.evidenceIds],
    actor: "manual",
    certainty: "uncertain",
    time: stamp(),
  };
}
function metadata(
  i: Interpretation,
  input: ManualExclusiveCandidateInput,
  deps: ManualDependentConclusion[],
) {
  Object.assign(i, {
    manualExclusive: true,
    candidateName: input.name.trim(),
    dependentConclusions: clone(deps),
  });
}

/** Commit one complete semantic snapshot. Validation is deliberately last, so failures cannot mutate the input. */
function commit(
  original: Project,
  before: ReasoningGraph,
  after: ReasoningGraph,
  targetId: string,
  kind: string,
  reason: string,
  affectedItemIds: readonly string[] = [],
): Project {
  text(reason, "reason");
  const out = clone(original);
  out.reasoning = after;
  const affectedUtterances = new Set(
    [...before.items, ...after.items]
      .filter((item) => affectedItemIds.includes(item.id))
      .flatMap((item) => item.utteranceIds),
  );
  if (affectedUtterances.size)
    for (const agenda of out.agendas) {
      if (
        (agenda.summaryDependencies ?? []).some((id) =>
          affectedUtterances.has(id),
        )
      )
        agenda.needsReview = true;
    }
  const revision: Revision = {
    id: newId("revision"),
    at: now(),
    targetId,
    kind: `reasoning:${kind}`,
    before: semanticSnapshot({ ...original, reasoning: before }),
    after: semanticSnapshot(out),
    reason: reason.trim(),
  };
  out.revisions = [...out.revisions, revision];
  out.reasoning.revisions.push({
    id: newId("reasoning-revision"),
    at: revision.at,
    targetId,
    kind,
    before: { revisionId: revision.id },
    after: { revisionId: revision.id },
    reason: reason.trim(),
  });
  out.updatedAt = now();
  return validateReasoning(out);
}

function addCandidate(
  g: ReasoningGraph,
  qv: string,
  input: ManualExclusiveCandidateInput,
  groupId: string,
): ManualExclusiveCandidate {
  candidateCheck(g, input);
  const ids = evidenceCheck(g, input.evidenceIds);
  const utteranceIds = [
    ...new Set(
      g.evidence
        .filter((e) => ids.includes(e.id))
        .flatMap((e) => e.utteranceIds),
    ),
  ];
  const premise = item({
    kind: "condition",
    text: text(input.premiseText, "premiseText"),
    evidenceIds: ids,
  });
  const conclusion = item({
    kind: "claim",
    text: text(input.conclusionText, "conclusionText"),
    evidenceIds: ids,
  });
  premise.utteranceIds = [...utteranceIds];
  conclusion.utteranceIds = [...utteranceIds];
  g.items.push(premise, conclusion);
  const deps = (input.dependentConclusionIds ?? []).map((id) => ({
    id,
    name: text(
      input.dependentConclusionNames?.[id] ??
        g.items.find((x) => x.id === id)?.text,
      "dependent conclusion name",
    ),
  }));
  g.uncertaintyPropagation.push({
    id: newId("uncertainty"),
    fromItemId: premise.id,
    toItemId: conclusion.id,
    reason: `manual exclusive candidate: ${input.name.trim()}`,
    status: "unresolved",
  });
  for (const dep of deps) {
    g.uncertaintyPropagation.push({
      id: newId("uncertainty"),
      fromItemId: conclusion.id,
      toItemId: dep.id,
      reason: `manual exclusive candidate: ${input.name.trim()}`,
      status: "unresolved",
    });
    const target = g.items.find((x) => x.id === dep.id)!;
    if (target.certainty !== "retracted") target.certainty = "uncertain";
  }
  const interpretation: Interpretation = {
    id: newId("interpretation"),
    questionVersionId: qv,
    premiseItemIds: [premise.id],
    conclusionItemIds: [conclusion.id],
    certainty: "uncertain",
    exclusiveGroupId: groupId,
    actor: "manual",
    time: stamp(),
  };
  metadata(interpretation, input, deps);
  g.interpretations.push(interpretation);
  return {
    interpretationId: interpretation.id,
    name: input.name.trim(),
    premiseItemId: premise.id,
    conclusionItemId: conclusion.id,
    dependentConclusions: deps,
  };
}

export function createManualExclusivePair(
  project: ManualInterpretationProject,
  questionVersionId: string,
  candidates: [ManualExclusiveCandidateInput, ManualExclusiveCandidateInput],
  reason: string,
): ManualInterpretationProject {
  const p = checked(project),
    before = graphOf(p),
    after = graphOf(p);
  if (!after.questionVersions.some((x) => x.id === questionVersionId))
    throw new Error("question version not found");
  if (!Array.isArray(candidates) || candidates.length !== 2)
    throw new Error("exactly two manual interpretations required");
  if (candidates.some((candidate) => candidate.id !== undefined))
    throw new Error("new candidates must not supply existing IDs");
  const groupId = newId("exclusive-group");
  const created = [
    addCandidate(after, questionVersionId, candidates[0], groupId),
    addCandidate(after, questionVersionId, candidates[1], groupId),
  ] as [ManualExclusiveCandidate, ManualExclusiveCandidate];
  const group: ExclusiveInterpretationGroup = {
    id: groupId,
    interpretationIds: created.map((x) => x.interpretationId),
    mutuallyExclusive: true,
  };
  after.exclusiveGroups.push(group);
  const out = commit(
    p,
    before,
    after,
    groupId,
    "manual-exclusive-pair-created",
    reason,
    created.flatMap((x) => [
      x.premiseItemId,
      x.conclusionItemId,
      ...x.dependentConclusions.map((d) => d.id),
    ]),
  );
  return out;
}

export function getManualExclusivePair(
  project: Project,
  groupId: string,
): ManualExclusivePairResult {
  const p = checked(project),
    g = p.reasoning;
  if (!g) throw new Error("manual exclusive group not found");
  const group = g.exclusiveGroups.find((x) => x.id === groupId);
  if (!group || group.interpretationIds.length !== 2)
    throw new Error(
      "manual exclusive group must contain exactly two interpretations",
    );
  const interpretations = group.interpretationIds.map((id) =>
    g.interpretations.find((x) => x.id === id),
  );
  if (interpretations.some((x) => !x))
    throw new Error("manual exclusive interpretation missing");
  if (
    interpretations.some(
      (x) =>
        (x as Interpretation & { manualExclusive?: boolean })
          .manualExclusive !== true ||
        x!.actor !== "manual" ||
        !["uncertain", "retracted"].includes(x!.certainty) ||
        x!.questionVersionId !== interpretations[0]!.questionVersionId ||
        x!.premiseItemIds.length !== 1 ||
        x!.conclusionItemIds.length !== 1,
    )
  )
    throw new Error("group is not a manual exclusive pair");
  const candidates = interpretations.map((i) => {
    const metadataValue = i as Interpretation & {
      candidateName?: string;
      dependentConclusions?: ManualDependentConclusion[];
    };
    return {
      interpretationId: i!.id,
      name: metadataValue.candidateName ?? i!.id,
      premiseItemId: i!.premiseItemIds[0],
      conclusionItemId: i!.conclusionItemIds[0],
      dependentConclusions: clone(metadataValue.dependentConclusions ?? []),
    };
  }) as [ManualExclusiveCandidate, ManualExclusiveCandidate];
  return {
    groupId,
    questionVersionId: interpretations[0]!.questionVersionId,
    candidates,
  };
}

export function updateManualExclusivePair(
  project: Project,
  groupId: string,
  candidates: [ManualExclusiveCandidateInput, ManualExclusiveCandidateInput],
  reason: string,
): ManualInterpretationProject {
  const p = checked(project),
    before = graphOf(p),
    after = graphOf(p),
    current = getManualExclusivePair(p, groupId);
  if (!Array.isArray(candidates) || candidates.length !== 2)
    throw new Error("exactly two manual interpretations required");
  const ids = new Set(current.candidates.map((x) => x.interpretationId));
  if (
    candidates.some((c) => !c.id || !ids.has(c.id)) ||
    new Set(candidates.map((c) => c.id)).size !== 2
  )
    throw new Error("update must address both distinct existing candidates");
  const oldById = new Map(
    current.candidates.map((x) => [x.interpretationId, x]),
  );
  const affected = new Set<string>();
  let changedAny = false;
  for (const input of candidates) {
    candidateCheck(after, input);
    const interpretation = after.interpretations.find(
      (x) => x.id === input.id,
    )!;
    const old = oldById.get(input.id!)!;
    const premise = after.items.find((x) => x.id === old.premiseItemId)!;
    const conclusion = after.items.find((x) => x.id === old.conclusionItemId)!;
    const oldDeps = old.dependentConclusions.map((x) => x.id);
    const nextDeps = input.dependentConclusionIds ?? [];
    const deps = nextDeps.map((id) => ({
      id,
      name: text(
        input.dependentConclusionNames?.[id] ??
          after.items.find((x) => x.id === id)?.text,
        "dependent conclusion name",
      ),
    }));
    const changed =
      premise.text !== input.premiseText.trim() ||
      conclusion.text !== input.conclusionText.trim() ||
      JSON.stringify(premise.evidenceIds) !==
        JSON.stringify(input.evidenceIds) ||
      JSON.stringify(old.dependentConclusions) !== JSON.stringify(deps) ||
      old.name !== input.name.trim();
    if (!changed) continue;
    changedAny = true;
    affected.add(premise.id);
    affected.add(conclusion.id);
    const evidenceIds = evidenceCheck(after, input.evidenceIds);
    const utteranceIds = [
      ...new Set(
        after.evidence
          .filter((e) => evidenceIds.includes(e.id))
          .flatMap((e) => e.utteranceIds),
      ),
    ];
    const certainty =
      interpretation.certainty === "retracted" ? "retracted" : "uncertain";
    premise.text = text(input.premiseText, "premiseText");
    premise.evidenceIds = [...evidenceIds];
    premise.utteranceIds = [...utteranceIds];
    premise.certainty = certainty;
    conclusion.text = text(input.conclusionText, "conclusionText");
    conclusion.evidenceIds = [...evidenceIds];
    conclusion.utteranceIds = [...utteranceIds];
    conclusion.certainty = certainty;
    premise.time.recordedAt = now();
    conclusion.time.recordedAt = now();
    interpretation.time.recordedAt = now();
    after.uncertaintyPropagation = after.uncertaintyPropagation.filter(
      (x) => x.fromItemId !== premise.id && x.fromItemId !== conclusion.id,
    );
    after.uncertaintyPropagation.push({
      id: newId("uncertainty"),
      fromItemId: premise.id,
      toItemId: conclusion.id,
      reason: `manual exclusive candidate: ${input.name.trim()}`,
      status: "unresolved",
    });
    for (const dep of deps)
      after.uncertaintyPropagation.push({
        id: newId("uncertainty"),
        fromItemId: conclusion.id,
        toItemId: dep.id,
        reason: `manual exclusive candidate: ${input.name.trim()}`,
        status: "unresolved",
      });
    for (const id of [...oldDeps, ...nextDeps]) {
      affected.add(id);
      const target = after.items.find((x) => x.id === id)!;
      if (target.certainty !== "retracted") target.certainty = "uncertain";
    }
    metadata(interpretation, input, deps);
  }
  if (!changedAny) throw new Error("候補ペアに変更がありません");
  return commit(
    p,
    before,
    after,
    groupId,
    "manual-exclusive-pair-updated",
    reason,
    [...affected],
  );
}

/** Retracts one candidate without deleting it: the group remains an exact pair and references remain inspectable. */
export function removeManualExclusiveCandidate(
  project: Project,
  groupId: string,
  interpretationId: string,
  reason: string,
): ManualInterpretationProject {
  const p = checked(project),
    before = graphOf(p),
    after = graphOf(p),
    pair = getManualExclusivePair(p, groupId);
  if (!pair.candidates.some((x) => x.interpretationId === interpretationId))
    throw new Error("interpretation is not in group");
  const interpretation = after.interpretations.find(
    (x) => x.id === interpretationId,
  )!;
  if (interpretation.certainty === "retracted")
    throw new Error("候補はすでに撤回されています");
  interpretation.certainty = "retracted";
  const candidate = pair.candidates.find(
    (x) => x.interpretationId === interpretationId,
  )!;
  for (const id of [candidate.premiseItemId, candidate.conclusionItemId])
    after.items.find((x) => x.id === id)!.certainty = "retracted";
  for (const propagation of after.uncertaintyPropagation)
    if (propagation.fromItemId === candidate.conclusionItemId) {
      propagation.status = "unresolved";
      const target = after.items.find((x) => x.id === propagation.toItemId)!;
      if (target.certainty !== "retracted") target.certainty = "uncertain";
    }
  return commit(
    p,
    before,
    after,
    interpretationId,
    "manual-exclusive-candidate-retracted",
    reason,
    [
      candidate.premiseItemId,
      candidate.conclusionItemId,
      ...candidate.dependentConclusions.map((d) => d.id),
    ],
  );
}

export interface ManualInterpretationPairForm {
  groupId?: string;
  questionVersionId: string;
  reason: string;
  alternatives: [
    {
      id?: string;
      premise: string;
      conclusion: string;
      evidenceIds: string[];
      dependentConclusionIds: string[];
      certainty?: Certainty;
      confirmed?: boolean;
    },
    {
      id?: string;
      premise: string;
      conclusion: string;
      evidenceIds: string[];
      dependentConclusionIds: string[];
      certainty?: Certainty;
      confirmed?: boolean;
    },
  ];
}

/** Single atomic entry point suitable for a form save: create when groupId is absent, otherwise update both sides. */
export function saveManualInterpretationPair(
  project: ManualInterpretationProject,
  form: ManualInterpretationPairForm,
): ManualInterpretationProject {
  if (
    !form ||
    !Array.isArray(form.alternatives) ||
    form.alternatives.length !== 2
  )
    throw new Error("exactly two manual interpretations required");
  const existing =
    form.groupId !== undefined
      ? getManualExclusivePair(project, form.groupId)
      : undefined;
  if (existing && existing.questionVersionId !== form.questionVersionId)
    throw new Error("question version cannot change while updating a pair");
  if (!existing && form.alternatives.some((x) => x.id !== undefined))
    throw new Error("new pair candidates must not have IDs");
  if (
    existing &&
    form.alternatives.some(
      (x, index) => x.id !== existing.candidates[index].interpretationId,
    )
  )
    throw new Error("update must preserve explicit A/B candidate IDs");
  const candidates = form.alternatives.map((x, index) => ({
    id: x.id,
    name: index === 0 ? "A" : "B",
    premiseText: x.premise,
    conclusionText: x.conclusion,
    evidenceIds: x.evidenceIds,
    dependentConclusionIds: x.dependentConclusionIds,
    certainty: x.certainty,
    confirmed: x.confirmed,
  })) as [ManualExclusiveCandidateInput, ManualExclusiveCandidateInput];
  if (form.groupId)
    return updateManualExclusivePair(
      project,
      form.groupId,
      candidates,
      form.reason,
    );
  return createManualExclusivePair(
    project,
    form.questionVersionId,
    candidates,
    form.reason,
  );
}

export function retractManualInterpretationCandidate(
  project: ManualInterpretationProject,
  groupId: string,
  interpretationId: string,
  reason: string,
): ManualInterpretationProject;
export function retractManualInterpretationCandidate(
  project: ManualInterpretationProject,
  interpretationId: string,
  reason: string,
): ManualInterpretationProject;
export function retractManualInterpretationCandidate(
  project: ManualInterpretationProject,
  groupOrInterpretationId: string,
  interpretationOrReason: string,
  maybeReason?: string,
): ManualInterpretationProject {
  if (maybeReason !== undefined)
    return removeManualExclusiveCandidate(
      project,
      groupOrInterpretationId,
      interpretationOrReason,
      maybeReason,
    );
  const group = project.reasoning?.exclusiveGroups.find((candidate) =>
    candidate.interpretationIds.includes(groupOrInterpretationId),
  );
  if (!group) throw new Error("interpretation is not in an exclusive group");
  return removeManualExclusiveCandidate(
    project,
    group.id,
    groupOrInterpretationId,
    interpretationOrReason,
  );
}
