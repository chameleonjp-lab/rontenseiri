import type { Project } from "./types";
import type { ReasoningGraph } from "./reasoning-types";

const strings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");
const unique = (v: string[]) => new Set(v).size === v.length;
const ids = (xs: string[], set: Set<string>, label: string) => {
  if (!strings(xs) || !unique(xs) || xs.some((x) => !set.has(x)))
    throw new Error(`invalid ${label} reference`);
};
const time = (v: unknown) => {
  if (!v || typeof v !== "object") return false;
  const x = v as { asOf?: unknown; recordedAt?: unknown };
  return (
    typeof x.asOf === "string" &&
    typeof x.recordedAt === "string" &&
    !Number.isNaN(Date.parse(x.asOf)) &&
    !Number.isNaN(Date.parse(x.recordedAt)) &&
    Date.parse(x.recordedAt) >= Date.parse(x.asOf)
  );
};
const actor = (v: unknown) => v === "user-recorded" || v === "manual";
const certainty = (v: unknown) =>
  ["confirmed", "inferred", "uncertain", "retracted"].includes(String(v));

/** Validate only the optional meaning model; projects without reasoning remain compatible. */
export function validateReasoning(project: Project): Project {
  const graph = (project as Project & { reasoning?: ReasoningGraph }).reasoning;
  if (graph === undefined) return project;
  if (!graph || typeof graph !== "object")
    throw new Error("reasoning graph is invalid");
  for (const key of [
    "questions",
    "questionVersions",
    "responses",
    "evidence",
    "items",
    "positionChanges",
    "interpretations",
    "exclusiveGroups",
    "uncertaintyPropagation",
    "revisions",
  ])
    if (!Array.isArray((graph as unknown as Record<string, unknown>)[key]))
      throw new Error(`reasoning.${key} must be an array`);
  const utteranceIds = new Set(project.utterances.map((x) => x.id));
  const sourceIds = new Set(project.sources.map((x) => x.id));
  const qIds = new Set<string>();
  const qvIds = new Set<string>();
  const eIds = new Set<string>();
  const itemIds = new Set<string>();
  const responseIds = new Set<string>();
  const interpretationIds = new Set<string>();
  const groupIds = new Set<string>();
  const revisionIds = new Set<string>();
  const checkId = (set: Set<string>, id: unknown, label: string) => {
    if (typeof id !== "string" || !id || set.has(id))
      throw new Error(`invalid or duplicate ${label}`);
    set.add(id);
  };
  for (const q of graph.questions) {
    checkId(qIds, q?.id, "question");
    if (
      !["original", "inferred", "analysis"].includes(q.origin) ||
      !strings(q.versionIds) ||
      !unique(q.versionIds) ||
      typeof q.currentVersionId !== "string"
    )
      throw new Error("invalid question");
  }
  for (const qv of graph.questionVersions) {
    checkId(qvIds, qv?.id, "question version");
    if (
      !qIds.has(qv.questionId) ||
      typeof qv.text !== "string" ||
      !qv.text.trim() ||
      !["active", "superseded", "retracted"].includes(qv.status) ||
      !actor(qv.actor) ||
      !time(qv.time) ||
      !strings(qv.sourceUtteranceIds) ||
      !unique(qv.sourceUtteranceIds)
    )
      throw new Error("invalid question version");
    ids(qv.sourceUtteranceIds, utteranceIds, "question utterance");
    if (qv.supersedesId !== undefined) {
      const prior = graph.questionVersions.find(
        (v) => v.id === qv.supersedesId,
      );
      if (
        !prior ||
        prior.questionId !== qv.questionId ||
        Date.parse(prior.time.recordedAt) > Date.parse(qv.time.recordedAt)
      )
        throw new Error("question version supersedes invalid version");
    }
    if (qv.reason !== undefined && typeof qv.reason !== "string")
      throw new Error("invalid question revision reason");
  }
  for (const q of graph.questions) {
    if (
      !q.versionIds.length ||
      q.versionIds.some((id) => !qvIds.has(id)) ||
      !q.versionIds.includes(q.currentVersionId)
    )
      throw new Error("question version history is invalid");
    for (const id of q.versionIds)
      if (graph.questionVersions.find((v) => v.id === id)!.questionId !== q.id)
        throw new Error("question version belongs to another question");
  }
  for (const e of graph.evidence) {
    checkId(eIds, e?.id, "evidence");
    if (
      !strings(e.utteranceIds) ||
      !unique(e.utteranceIds) ||
      !strings(e.sourceIds) ||
      !unique(e.sourceIds) ||
      !actor(e.actor) ||
      !certainty(e.certainty) ||
      !time(e.time)
    )
      throw new Error("invalid evidence");
    ids(e.utteranceIds, utteranceIds, "evidence utterance");
    ids(e.sourceIds, sourceIds, "evidence source");
  }
  for (const item of graph.items) {
    checkId(itemIds, item?.id, "semantic item");
    if (
      ![
        "claim",
        "position",
        "reason",
        "condition",
        "exception",
        "scope",
        "term",
        "objection",
        "unverified",
      ].includes(item.kind) ||
      typeof item.text !== "string" ||
      !item.text.trim() ||
      !strings(item.utteranceIds) ||
      !strings(item.evidenceIds) ||
      !actor(item.actor) ||
      !certainty(item.certainty) ||
      !time(item.time)
    )
      throw new Error("invalid semantic item");
    ids(item.utteranceIds, utteranceIds, "item utterance");
    ids(item.evidenceIds, eIds, "item evidence");
    if (item.certainty === "confirmed" && !item.evidenceIds.length)
      throw new Error("confirmed item requires evidence");
    if (
      item.counterargumentToId !== undefined &&
      !itemIds.has(item.counterargumentToId)
    )
      throw new Error("unknown counterargument target");
  }
  for (const r of graph.responses) {
    checkId(responseIds, r?.id, "response");
    if (
      !qvIds.has(r.questionVersionId) ||
      !strings(r.utteranceIds) ||
      !strings(r.counterargumentToClaimIds) ||
      !strings(r.evidenceIds) ||
      !unique(r.utteranceIds) ||
      !unique(r.counterargumentToClaimIds) ||
      !unique(r.evidenceIds) ||
      ![
        "answer",
        "clarification",
        "counterargument",
        "objection",
        "refusal",
        "partial",
        "unknown",
      ].includes(r.kind) ||
      ![
        "unassessed",
        "fulfilled",
        "partially-fulfilled",
        "not-fulfilled",
        "not-applicable",
      ].includes(r.fulfillment) ||
      !actor(r.actor) ||
      !time(r.time)
    )
      throw new Error("invalid response");
    ids(r.utteranceIds, utteranceIds, "response utterance");
    ids(r.counterargumentToClaimIds, itemIds, "counterargument");
    ids(r.evidenceIds, eIds, "response evidence");
  }
  const positionChangeIds = new Set<string>();
  for (const c of graph.positionChanges) {
    checkId(positionChangeIds, c?.id, "position change");
    if (
      !itemIds.has(c.beforeItemId) ||
      !itemIds.has(c.afterItemId) ||
      !strings(c.triggerEvidenceIds) ||
      !strings(c.candidateReasonIds) ||
      !actor(c.actor) ||
      !time(c.time)
    )
      throw new Error("invalid position change");
    ids(c.triggerEvidenceIds, eIds, "position evidence");
    ids(c.candidateReasonIds, itemIds, "position reason");
  }
  for (const i of graph.interpretations) {
    checkId(interpretationIds, i?.id, "interpretation");
    if (
      !qvIds.has(i.questionVersionId) ||
      !strings(i.premiseItemIds) ||
      !strings(i.conclusionItemIds) ||
      !actor(i.actor) ||
      !certainty(i.certainty) ||
      !time(i.time)
    )
      throw new Error("invalid interpretation");
    ids(i.premiseItemIds, itemIds, "interpretation premise");
    ids(i.conclusionItemIds, itemIds, "interpretation conclusion");
    if (
      i.exclusiveGroupId !== undefined &&
      typeof i.exclusiveGroupId !== "string"
    )
      throw new Error("invalid interpretation group");
  }
  for (const i of graph.interpretations)
    if (
      i.exclusiveGroupId !== undefined &&
      !graph.exclusiveGroups.some(
        (g) =>
          g.id === i.exclusiveGroupId && g.interpretationIds.includes(i.id),
      )
    )
      throw new Error("interpretation group membership is invalid");
  for (const g of graph.exclusiveGroups) {
    checkId(groupIds, g?.id, "exclusive group");
    if (
      g.mutuallyExclusive !== true ||
      !strings(g.interpretationIds) ||
      g.interpretationIds.length < 2 ||
      !unique(g.interpretationIds)
    )
      throw new Error("invalid exclusive interpretation group");
    ids(g.interpretationIds, interpretationIds, "exclusive interpretation");
  }
  const unresolved = new Set(
    graph.items.filter((x) => x.certainty === "uncertain").map((x) => x.id),
  );
  const propagationIds = new Set<string>();
  for (const p of graph.uncertaintyPropagation) {
    checkId(propagationIds, p?.id, "uncertainty propagation");
    if (
      !itemIds.has(p.fromItemId) ||
      !itemIds.has(p.toItemId) ||
      typeof p.reason !== "string" ||
      !p.reason.trim() ||
      !["unresolved", "resolved"].includes(p.status)
    )
      throw new Error("invalid uncertainty propagation");
    if (p.status === "unresolved") unresolved.add(p.toItemId);
  }
  for (const id of unresolved) {
    const item = graph.items.find((x) => x.id === id);
    if (
      item?.certainty === "confirmed" &&
      !graph.uncertaintyPropagation.some(
        (p) => p.toItemId === id && p.status === "resolved",
      )
    )
      throw new Error("uncertainty cannot produce confirmed conclusion");
  }
  for (const r of graph.revisions) {
    checkId(revisionIds, r?.id, "reasoning revision");
    if (
      typeof r.at !== "string" ||
      Number.isNaN(Date.parse(r.at)) ||
      typeof r.targetId !== "string" ||
      typeof r.kind !== "string" ||
      typeof r.reason !== "string" ||
      !r.reason.trim() ||
      !("before" in r) ||
      !("after" in r)
    )
      throw new Error("invalid reasoning revision");
  }
  return project;
}
