import type { Project, Revision } from "./types";
import { semanticSnapshot } from "./snapshot";
import { validateReasoning } from "./reasoning-validation";
import {
  invalidateDependents,
  invalidateReasoningDependents,
} from "./invalidation";
import type {
  ReasoningGraph,
  QuestionOrigin,
  ResponseKind,
  Fulfillment,
  ClaimKind,
  Certainty,
  ReasoningActor,
  ReasoningTime,
} from "./reasoning-types";

export type ReasoningProject = Project & { reasoning?: ReasoningGraph };
const clone = <T>(v: T): T => structuredClone(v);
const now = () => new Date().toISOString();
const id = (p: string) =>
  `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const emptyGraph = (): ReasoningGraph => ({
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
});
const graph = (p: ReasoningProject): ReasoningGraph =>
  p.reasoning ? clone(p.reasoning) : emptyGraph();
const requireText = (x: string, name: string) => {
  if (typeof x !== "string" || !x.trim()) throw new Error(`${name} required`);
  return x.trim();
};
const stamp = (asOf?: string): ReasoningTime => ({
  asOf: asOf ?? now(),
  recordedAt: now(),
});

/** Record one bounded, shared undo unit. Graph events never contain graph snapshots. */
function commit(
  p: ReasoningProject,
  before: ReasoningGraph,
  after: ReasoningGraph,
  targetId: string,
  kind: string,
  reason: string,
  changedQuestionVersionIds: readonly string[] = [],
  changedResponseUtteranceIds: readonly string[] = [],
): ReasoningProject {
  requireText(reason, "reason");
  let out = clone(p);
  out.reasoning = after;
  if (changedResponseUtteranceIds.length)
    out = invalidateDependents(out, changedResponseUtteranceIds);
  if (changedQuestionVersionIds.length)
    out = invalidateReasoningDependents(
      out,
      changedQuestionVersionIds,
    ) as ReasoningProject;
  const revision: Revision = {
    id: id("revision"),
    at: now(),
    targetId,
    kind: `reasoning:${kind}`,
    before: semanticSnapshot({ ...p, reasoning: before }),
    after: semanticSnapshot(out),
    reason: reason.trim(),
  };
  out.revisions = [...out.revisions, revision];
  out.reasoning!.revisions.push({
    id: id("reasoning-revision"),
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
function checked(p: ReasoningProject) {
  validateReasoning(p);
  return clone(p);
}

export function createReasoningGraph(): ReasoningGraph {
  return emptyGraph();
}
export function addQuestion(
  project: ReasoningProject,
  text: string,
  origin: QuestionOrigin,
  sourceUtteranceIds: string[] = [],
  actor: ReasoningActor = "manual",
  asOf?: string,
  reason = "問いを登録",
): ReasoningProject {
  const p = checked(project),
    before = graph(p),
    g = graph(p),
    qid = id("question"),
    vid = id("question-version");
  g.questions.push({
    id: qid,
    origin,
    versionIds: [vid],
    currentVersionId: vid,
  });
  g.questionVersions.push({
    id: vid,
    questionId: qid,
    text: requireText(text, "question"),
    status: "active",
    actor,
    time: stamp(asOf),
    sourceUtteranceIds: clone(sourceUtteranceIds),
  });
  return commit(p, before, g, qid, "question-created", reason);
}
export function reviseQuestion(
  project: ReasoningProject,
  questionId: string,
  text: string,
  reason: string,
  sourceUtteranceIds: string[] = [],
  actor: ReasoningActor = "manual",
  asOf?: string,
): ReasoningProject {
  const p = checked(project),
    before = graph(p),
    g = graph(p),
    q = g.questions.find((x) => x.id === questionId);
  if (!q) throw new Error("question not found");
  const old = g.questionVersions.find((x) => x.id === q.currentVersionId);
  if (!old) throw new Error("question version missing");
  const vid = id("question-version");
  old.status = "superseded";
  q.versionIds.push(vid);
  q.currentVersionId = vid;
  g.questionVersions.push({
    id: vid,
    questionId,
    text: requireText(text, "question"),
    status: "active",
    actor,
    time: stamp(asOf),
    sourceUtteranceIds: clone(sourceUtteranceIds),
    supersedesId: old.id,
    reason: requireText(reason, "reason"),
  });
  return commit(p, before, g, questionId, "question-revised", reason, [old.id]);
}
export function retractQuestion(
  project: ReasoningProject,
  questionId: string,
  reason: string,
): ReasoningProject {
  const p = checked(project),
    before = graph(p),
    g = graph(p),
    q = g.questions.find((x) => x.id === questionId);
  if (!q) throw new Error("question not found");
  const v = g.questionVersions.find((x) => x.id === q.currentVersionId);
  if (!v) throw new Error("question version missing");
  v.status = "retracted";
  return commit(p, before, g, questionId, "question-retracted", reason, [v.id]);
}
export function addEvidence(
  project: ReasoningProject,
  value: Omit<ReasoningGraph["evidence"][number], "id">,
  reason = "根拠を登録",
): ReasoningProject {
  const p = checked(project),
    b = graph(p),
    g = graph(p),
    x = { ...clone(value), id: id("evidence") };
  g.evidence.push(x);
  return commit(p, b, g, x.id, "evidence-created", reason);
}
export function addSemanticItem(
  project: ReasoningProject,
  value: Omit<ReasoningGraph["items"][number], "id">,
  reason = "意味項目を登録",
): ReasoningProject {
  const p = checked(project),
    b = graph(p),
    g = graph(p),
    x = { ...clone(value), id: id("item") };
  g.items.push(x);
  return commit(p, b, g, x.id, "semantic-item-created", reason);
}
export function linkResponse(
  project: ReasoningProject,
  value: Omit<ReasoningGraph["responses"][number], "id">,
  reason = "応答を問いに関連付け",
): ReasoningProject {
  const p = checked(project),
    b = graph(p),
    g = graph(p),
    x = { ...clone(value), id: id("response") };
  g.responses.push(x);
  return commit(p, b, g, x.id, "response-linked", reason, [], x.utteranceIds);
}

/** A patch never follows currentVersionId or derives fulfillment from kind. */
export function updateResponse(
  project: ReasoningProject,
  responseId: string,
  patch: Partial<
    Pick<
      ReasoningGraph["responses"][number],
      | "questionVersionId"
      | "utteranceIds"
      | "kind"
      | "fulfillment"
      | "counterargumentToClaimIds"
      | "evidenceIds"
      | "note"
    >
  >,
  reason: string,
): ReasoningProject {
  const p = checked(project),
    before = graph(p),
    after = graph(p);
  const response = after.responses.find((r) => r.id === responseId);
  if (!response) throw new Error("response not found");
  const oldIds = [...response.utteranceIds];
  // Copy only editable fields, including at runtime; identity/provenance stay fixed.
  for (const key of [
    "questionVersionId",
    "utteranceIds",
    "kind",
    "fulfillment",
    "counterargumentToClaimIds",
    "evidenceIds",
    "note",
  ] as const) {
    if (Object.prototype.hasOwnProperty.call(patch, key))
      Object.assign(response, { [key]: clone(patch[key]) });
  }
  if (!response.utteranceIds?.length)
    throw new Error("response utterance required");
  return commit(
    p,
    before,
    after,
    responseId,
    "response-updated",
    reason,
    [],
    [...new Set([...oldIds, ...response.utteranceIds])],
  );
}

/** Removal records absence of a link, not an unanswered/no-rebuttal conclusion. */
export function removeResponse(
  project: ReasoningProject,
  responseId: string,
  reason: string,
): ReasoningProject {
  const p = checked(project),
    before = graph(p),
    after = graph(p);
  const response = after.responses.find((r) => r.id === responseId);
  if (!response) throw new Error("response not found");
  after.responses = after.responses.filter((r) => r.id !== responseId);
  return commit(
    p,
    before,
    after,
    responseId,
    "response-removed",
    reason,
    [],
    response.utteranceIds,
  );
}
export function addPositionChange(
  project: ReasoningProject,
  value: Omit<ReasoningGraph["positionChanges"][number], "id">,
  reason = "立場変化を登録",
): ReasoningProject {
  const p = checked(project),
    b = graph(p),
    g = graph(p),
    x = { ...clone(value), id: id("position-change") };
  g.positionChanges.push(x);
  return commit(p, b, g, x.id, "position-change-created", reason);
}
export function addInterpretation(
  project: ReasoningProject,
  value: Omit<ReasoningGraph["interpretations"][number], "id">,
  reason = "解釈候補を登録",
): ReasoningProject {
  const p = checked(project),
    b = graph(p),
    g = graph(p),
    x = { ...clone(value), id: id("interpretation") };
  g.interpretations.push(x);
  return commit(p, b, g, x.id, "interpretation-created", reason);
}
export function addUncertaintyPropagation(
  project: ReasoningProject,
  value: Omit<ReasoningGraph["uncertaintyPropagation"][number], "id">,
  reason = "不確定性の伝播を登録",
): ReasoningProject {
  const p = checked(project),
    b = graph(p),
    g = graph(p),
    x = { ...clone(value), id: id("uncertainty") };
  g.uncertaintyPropagation.push(x);
  return commit(p, b, g, x.id, "uncertainty-propagation", reason);
}

/** Undo reasoning changes in reverse order, retaining every event and every project revision. */
export function undoReasoning(project: ReasoningProject): ReasoningProject {
  const p = checked(project);
  const undone = new Set<string>();
  for (const r of p.revisions)
    if (r.kind === "undo") {
      const target = (r.after as { targetRevisionId?: unknown })
        ?.targetRevisionId;
      if (typeof target === "string") undone.add(target);
    }
  const target = [...p.revisions]
    .reverse()
    .find((r) => r.kind.startsWith("reasoning:") && !undone.has(r.id));
  if (!target) throw new Error("no reasoning revision to undo");
  const raw = target.before as {
    reasoning?: ReasoningGraph;
    agendas?: Project["agendas"];
  };
  if (!raw?.reasoning) throw new Error("revision cannot be undone");
  const out = clone(p);
  const before = semanticSnapshot(p);
  out.reasoning = clone(raw.reasoning);
  if (raw.agendas) out.agendas = clone(raw.agendas);
  // Undo restores semantic state, not the audit trail. Keep every prior event.
  out.reasoning.revisions = clone(p.reasoning?.revisions ?? []);
  const undo: Revision = {
    id: id("revision"),
    at: now(),
    targetId: target.targetId,
    kind: "undo",
    before,
    after: { ...semanticSnapshot(out), targetRevisionId: target.id },
    reason: `Undo: ${target.reason}`,
  };
  out.revisions.push(undo);
  out.reasoning.revisions.push({
    id: id("reasoning-revision"),
    at: undo.at,
    targetId: target.targetId,
    kind: "undo",
    before: { revisionId: target.id },
    after: { targetRevisionId: target.id },
    reason: undo.reason,
  });
  out.updatedAt = now();
  return validateReasoning(out);
}

export type {
  QuestionOrigin,
  ResponseKind,
  Fulfillment,
  ClaimKind,
  Certainty,
  ReasoningActor,
  ReasoningTime,
};
