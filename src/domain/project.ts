import { validateOmissions } from "./completeness";
import {
  validateSourceCues,
  validateUtteranceQuote,
  withCueSpans,
} from "./cue-provenance";
import { invalidateDependents } from "./invalidation";
import { projectCapacity, MAX_BACKUP_BYTES, activeSources } from "./capacity";
import { semanticSnapshot } from "./snapshot";
import { auditSourceCoverage, buildSourceCoverage } from "./coverage";
import { validateReasoning } from "./reasoning-validation";
import { validateLineage } from "./lineage-validation";
import type {
  Agenda,
  Extent,
  ParseResult,
  Project,
  Source,
  Utterance,
} from "./types";

const now = () => new Date().toISOString();
const id = (p: string) =>
  `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const clone = <T>(v: T): T => structuredClone(v);
const snapshot = semanticSnapshot;
const isString = (v: unknown): v is string => typeof v === "string";
const enumOf = (v: unknown, xs: readonly string[]) =>
  isString(v) && xs.includes(v);
const unique = (xs: string[]) => new Set(xs).size === xs.length;
const sourceRoles = ["conversation", "reference", "later-explanation"] as const;
const classifications = ["main", "derived", "drift", "unknown"] as const;
const coverages = ["unorganized", "mapped", "collapsed", "failed"] as const;
const relationKinds = ["main", "derived", "drift", "return"] as const;

function check(p: Project): Project {
  if (
    !p ||
    typeof p !== "object" ||
    p.schemaVersion !== 1 ||
    !isString(p.id) ||
    !isString(p.title) ||
    !isString(p.createdAt) ||
    !isString(p.updatedAt) ||
    !enumOf(p.extent, ["full", "excerpt", "unknown"]) ||
    !Array.isArray(p.sources) ||
    !Array.isArray(p.utterances) ||
    !Array.isArray(p.agendas) ||
    !Array.isArray(p.relations) ||
    !Array.isArray(p.revisions) ||
    !Array.isArray(p.runs) ||
    typeof p.saved !== "boolean"
  ) {
    throw new Error("Project schema is invalid");
  }
  if (projectCapacity(p).backupBytes > MAX_BACKUP_BYTES)
    throw new Error(
      "完全バックアップが50MiBを超えます。編集中の内容をテキストで退避してください",
    );
  if (
    p.sources.length > 100 ||
    p.revisions.length > 1000 ||
    p.utterances.length > 5000
  )
    throw new Error("project history or utterance limit exceeded");

  validateOmissions(p.omissions);
  const sourceIds = new Set<string>();
  const versionIds = new Set<string>();
  const sourceByVersion = new Map<string, Source>();
  for (const s of p.sources) {
    if (
      !s ||
      !isString(s.id) ||
      !isString(s.versionId) ||
      !isString(s.name) ||
      !isString(s.text) ||
      !isString(s.format) ||
      !isString(s.createdAt) ||
      !isString(s.hash) ||
      !Array.isArray(s.warnings) ||
      !s.warnings.every(isString) ||
      !enumOf(s.role, sourceRoles) ||
      versionIds.has(s.versionId)
    )
      throw new Error("invalid or duplicate source");
    validateSourceCues(s);
    sourceIds.add(s.id);
    versionIds.add(s.versionId);
    sourceByVersion.set(s.versionId, s);
  }
  const capacity = projectCapacity(p);
  if (capacity.activeFiles > 10 || capacity.activeCodePoints > 50000)
    throw new Error("active source limit exceeded");

  const uttIds = new Set<string>();
  const orders = new Set<number>();
  const uttById = new Map<string, Utterance>();
  for (const u of p.utterances) {
    if (
      !u ||
      !isString(u.id) ||
      !isString(u.sourceId) ||
      !isString(u.sourceVersionId) ||
      !isString(u.quote) ||
      !isString(u.speaker) ||
      !Number.isInteger(u.start) ||
      !Number.isInteger(u.end) ||
      !Number.isInteger(u.order) ||
      !Number.isInteger(u.line) ||
      (u.time !== undefined && !isString(u.time)) ||
      u.start < 0 ||
      u.end < u.start ||
      u.order < 0 ||
      u.line < 0 ||
      (u.returnStatus !== undefined &&
        !enumOf(u.returnStatus, ["unknown", "none"])) ||
      !enumOf(u.classification, classifications) ||
      !enumOf(u.coverage, coverages) ||
      typeof u.important !== "boolean" ||
      uttIds.has(u.id) ||
      orders.has(u.order)
    )
      throw new Error("invalid or duplicate utterance");
    const s = sourceByVersion.get(u.sourceVersionId);
    if (!s || s.id !== u.sourceId || u.end > s.text.length)
      throw new Error(`quote mismatch: ${u.id}`);
    validateUtteranceQuote(s, u);
    uttIds.add(u.id);
    orders.add(u.order);
    uttById.set(u.id, u);
  }

  const agendaIds = new Set<string>();
  const membership = new Map<string, string>();
  for (const a of p.agendas) {
    if (
      !a ||
      !isString(a.id) ||
      !isString(a.title) ||
      !Array.isArray(a.utteranceIds) ||
      !enumOf(a.boundary, ["candidate", "user-confirmed"]) ||
      !enumOf(a.decision, ["undecided", "conditional", "decided"]) ||
      !enumOf(a.answer, ["none", "partial", "present"]) ||
      !enumOf(a.agreement, ["unknown", "partial", "explicit"]) ||
      !enumOf(a.verification, ["unverified", "user-recorded"]) ||
      !isString(a.arrival) ||
      !Array.isArray(a.unresolved) ||
      !a.unresolved.every(isString) ||
      !isString(a.nextAction) ||
      typeof a.needsReview !== "boolean" ||
      agendaIds.has(a.id) ||
      !unique(a.utteranceIds)
    )
      throw new Error("invalid agenda");
    agendaIds.add(a.id);
    let previous: Utterance | undefined;
    for (const uid of a.utteranceIds) {
      const u = uttById.get(uid);
      const role = u && p.sources.find((s) => s.id === u.sourceId)?.role;
      if (!u || role !== "conversation" || membership.has(uid))
        throw new Error("agenda membership invalid");
      if (previous && previous.order >= u.order)
        throw new Error("agenda is not chronological");
      previous = u;
      membership.set(uid, a.id);
    }
  }
  for (const u of p.utterances) {
    const role = p.sources.find((s) => s.id === u.sourceId)?.role;
    if (role === "conversation" && !membership.has(u.id))
      throw new Error("conversation utterance is not assigned");
    if (role !== "conversation" && membership.has(u.id))
      throw new Error("non-conversation utterance assigned");
  }
  if (!isString(p.selectedAgendaId) || !agendaIds.has(p.selectedAgendaId))
    throw new Error("selected agenda missing");

  for (const a of p.agendas)
    if (
      a.summaryDependencies !== undefined &&
      (!Array.isArray(a.summaryDependencies) ||
        !unique(a.summaryDependencies) ||
        !a.summaryDependencies.every((id) => uttIds.has(id)))
    )
      throw new Error("invalid summary dependencies");
  if (
    p.storageRevision !== undefined &&
    (!Number.isSafeInteger(p.storageRevision) || p.storageRevision < 0)
  )
    throw new Error("invalid storage revision");
  const relationIds = new Set<string>();
  const nodes = new Set([...uttIds, ...agendaIds]);
  for (const r of p.relations) {
    if (
      !r ||
      !isString(r.id) ||
      relationIds.has(r.id) ||
      !isString(r.from) ||
      !isString(r.to) ||
      !enumOf(r.kind, relationKinds) ||
      (r.dependency !== undefined && typeof r.dependency !== "boolean") ||
      !Array.isArray(r.evidenceIds) ||
      !r.evidenceIds.every(isString) ||
      !unique(r.evidenceIds) ||
      !nodes.has(r.from) ||
      !nodes.has(r.to) ||
      r.from === r.to ||
      r.evidenceIds.some((e) => !uttIds.has(e))
    )
      throw new Error("invalid relation");
    relationIds.add(r.id);
  }
  // `none` is an explicit assertion that the utterance has no return.
  // Omitted returnStatus remains legacy-compatible (older persisted projects
  // used the relation itself as the source of truth).
  for (const u of p.utterances) {
    if (
      u.returnStatus === "none" &&
      p.relations.some((r) => r.kind === "return" && r.from === u.id)
    )
      throw new Error("returnStatus none cannot have a return relation");
  }
  // Every visible edge follows original utterance order, including A → B → A.
  // Chronology makes cycles impossible without recursive graph traversal.
  for (const r of p.relations) {
    const from = uttById.get(r.from),
      to = uttById.get(r.to);
    if (!from || !to) throw new Error("relation endpoints must be utterances");
    if (from.order >= to.order)
      throw new Error("relation cycle or reversed chronology rejected");
  }
  const revisionIds = new Set<string>();
  for (const r of p.revisions) {
    if (
      !r ||
      !isString(r.id) ||
      revisionIds.has(r.id) ||
      !isString(r.at) ||
      !isString(r.targetId) ||
      !isString(r.kind) ||
      !isString(r.reason) ||
      !("before" in r) ||
      !("after" in r)
    )
      throw new Error("invalid revision");
    revisionIds.add(r.id);
  }
  const runIds = new Set<string>();
  for (const run of p.runs) {
    if (
      !run ||
      !isString(run.id) ||
      runIds.has(run.id) ||
      !isString(run.at) ||
      !isString(run.engine) ||
      !isString(run.model) ||
      !enumOf(run.status, ["complete", "partial", "failed"]) ||
      !isString(run.note)
    )
      throw new Error("invalid analysis run");
    runIds.add(run.id);
  }
  for (const source of activeSources(p)) {
    if (
      source.coverage &&
      auditSourceCoverage(source, p.utterances).issues.length
    )
      throw new Error("原文の全範囲対応が不正です");
  }
  validateReasoning(p);
  validateLineage(p);
  return clone(p);
}

export function createProject(
  result: ParseResult,
  title: string,
  extent: Extent,
): Project {
  if (
    !result ||
    !Array.isArray(result.sources) ||
    !Array.isArray(result.utterances)
  )
    throw new Error("ParseResult is invalid");
  const ids = result.utterances
    .filter(
      (u) =>
        result.sources.find((s) => s.id === u.sourceId)?.role ===
        "conversation",
    )
    .map((u) => u.id);
  if (!ids.length)
    throw new Error(
      "会話本文の発言がありません。参考資料だけでは議題を作りません。",
    );
  const agenda: Agenda = {
    id: "議題01",
    title: title || "未整理の議題",
    utteranceIds: ids,
    boundary: "candidate",
    decision: "undecided",
    answer: "none",
    agreement: "unknown",
    verification: "unverified",
    arrival: "",
    unresolved: [],
    nextAction: "",
    needsReview: false,
  };
  const t = now();
  return check({
    schemaVersion: 1,
    id: id("project"),
    title: title || "無題",
    createdAt: t,
    updatedAt: t,
    extent,
    sources: clone(result.sources),
    utterances: clone(result.utterances),
    agendas: [agenda],
    relations: [],
    revisions: [],
    runs: [],
    selectedAgendaId: agenda.id,
    saved: false,
  });
}
export function validateProject(value: unknown): Project {
  return check(clone(value as Project));
}
const allowedUt = new Set([
  "classification",
  "speaker",
  "important",
  "returnStatus",
]);
const allowedAg = new Set([
  "title",
  "decision",
  "answer",
  "agreement",
  "verification",
  "arrival",
  "summaryDependencies",
  "unresolved",
  "nextAction",
  "needsReview",
]);
export function reviseProject(
  project: Project,
  targetId: string,
  patch: Record<string, unknown>,
  reason: string,
): Project {
  const p = check(project);
  if (!isString(reason) || !reason.trim()) throw new Error("reason required");
  const u = p.utterances.find((x) => x.id === targetId),
    a = p.agendas.find((x) => x.id === targetId);
  if (!u && !a) throw new Error("target not found");
  const target = (u ?? a)!;
  const before = {
    ...clone(target),
    __projectSnapshot: semanticSnapshot(p),
  };
  const allowed = u ? allowedUt : allowedAg;
  for (const [key, value] of Object.entries(patch)) {
    if (!allowed.has(key)) throw new Error(`field not editable: ${key}`);
    let valid = false;
    switch (key) {
      case "classification":
        valid = enumOf(value, classifications);
        break;
      case "returnStatus":
        valid = enumOf(value, ["unknown", "none"]);
        break;
      case "important":
      case "needsReview":
        valid = typeof value === "boolean";
        break;
      case "summaryDependencies": {
        const ids = new Set(p.utterances.map((u) => u.id));
        valid =
          Array.isArray(value) &&
          value.every((v) => typeof v === "string" && ids.has(v));
        break;
      }
      case "unresolved":
        valid = Array.isArray(value) && value.every(isString);
        break;
      default:
        valid = isString(value);
    }
    if (!valid) throw new Error(`invalid field type: ${key}`);
  }
  Object.assign(target, clone(patch));

  // Keep generic revisions as safe as the dedicated return editor: an
  // explicit `none` removes only return edges originating at this utterance.
  // The target utterance, its classification, and unrelated edges remain.
  if (u && patch.returnStatus === "none") {
    p.relations = p.relations.filter(
      (r) => !(r.kind === "return" && r.from === u.id),
    );
  }

  p.revisions.push({
    id: id("revision"),
    at: now(),
    targetId,
    kind: "user-revision",
    before,
    after: clone(target),
    reason,
  });
  p.updatedAt = now();
  return check(u ? invalidateDependents(p, [u.id]) : p);
}
export function reviseSource(
  project: Project,
  utteranceId: string,
  newQuote: string,
  reason: string,
  cueSpanIndex?: number,
): Project {
  const p = check(project),
    u = p.utterances.find((x) => x.id === utteranceId);
  if (!u || !reason.trim() || !newQuote)
    throw new Error("utterance/reason required");
  const snapshot = semanticSnapshot(p);
  const old = p.sources.find((s) => s.versionId === u.sourceVersionId)!;
  if (
    u.cueSpans &&
    (cueSpanIndex !== undefined || u.cueSpans.length > 1) &&
    (!Number.isInteger(cueSpanIndex) ||
      cueSpanIndex! < 0 ||
      cueSpanIndex! >= u.cueSpans.length)
  )
    throw new Error("複数キューの原文は訂正するキューを明示してください");
  const editedSpan = u.cueSpans?.[cueSpanIndex ?? 0] ?? u;
  const at = editedSpan.start;
  const oldEnd = editedSpan.end;
  const revisedText = old.text.slice(0, at) + newQuote + old.text.slice(oldEnd);
  const ns: Source = {
    ...clone(old),
    versionId: id(`${old.id}-v`),
    text: revisedText,
    createdAt: now(),
    hash: `fnv1a-${hash(revisedText)}`,
    warnings: [...old.warnings, "原文訂正版"],
  };
  p.sources.push(ns);
  const delta = newQuote.length - (oldEnd - at);
  const rebase = <T extends { start: number; end: number }>(span: T): T => {
    if (span.end <= at) return { ...span };
    if (span.start >= oldEnd)
      return { ...span, start: span.start + delta, end: span.end + delta };
    if (span.start <= at && span.end >= oldEnd)
      return { ...span, end: span.end + delta };
    throw new Error("訂正範囲がキュー本文の途中で交差しています");
  };
  if (ns.cueLedger)
    ns.cueLedger = ns.cueLedger.map((cue) => {
      const next = rebase(cue);
      return {
        ...next,
        line:
          (ns.text.slice(0, next.start).match(/\r\n|\n|\r/g) || []).length + 1,
      };
    });
  const before = p.utterances
    .filter((x) => x.sourceVersionId === old.versionId)
    .map(clone);
  for (const x of p.utterances.filter(
    (x) => x.sourceVersionId === old.versionId,
  )) {
    if (x.cueSpans) {
      Object.assign(
        x,
        withCueSpans(
          { ...x, sourceVersionId: ns.versionId },
          ns,
          x.cueSpans.map(rebase),
        ),
      );
      if (x.id === u.id) x.coverage = "failed";
    } else if (x.id === u.id) {
      x.sourceVersionId = ns.versionId;
      x.start = at;
      x.end = at + newQuote.length;
      x.quote = newQuote;
      x.coverage = "failed";
    } else {
      x.sourceVersionId = ns.versionId;
      if (x.start >= oldEnd) {
        x.start += delta;
        x.end += delta;
      } else if (x.start >= at) x.coverage = "failed";
    }
  }
  for (const x of p.utterances.filter(
    (x) => x.sourceVersionId === ns.versionId,
  ))
    x.line = (ns.text.slice(0, x.start).match(/\r\n|\n|\r/g) || []).length + 1;
  if (old.coverage)
    ns.coverage = old.coverage
      .filter((s) => s.end <= at || s.start >= oldEnd)
      .map((s) =>
        s.start >= oldEnd
          ? { ...s, start: s.start + delta, end: s.end + delta }
          : { ...s },
      );
  ns.coverage = buildSourceCoverage(ns, p.utterances);

  p.revisions.push({
    id: id("revision"),
    at: now(),
    targetId: utteranceId,
    kind: "source-revision",
    before: { ...snapshot, changedUtterances: before },
    after: p.utterances
      .filter((x) => x.sourceVersionId === ns.versionId)
      .map(clone),
    reason,
  });
  p.updatedAt = now();
  return check(invalidateDependents(p, [utteranceId]));
}
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
export function splitAgenda(
  project: Project,
  utteranceId: string,
  reason = "利用者による議題分割",
): Project {
  const p = check(project),
    a = p.agendas.find((x) => x.utteranceIds.includes(utteranceId));
  if (!a) throw new Error("utterance not in agenda");
  const i = a.utteranceIds.indexOf(utteranceId);
  if (i <= 0 || i >= a.utteranceIds.length)
    throw new Error("cannot split at boundary");
  const before = { ...clone(a), __projectSnapshot: snapshot(p) };
  const b: Agenda = {
    ...clone(a),
    id: id("agenda"),
    title: `${a.title}（分割）`,
    utteranceIds: a.utteranceIds.splice(i),
    boundary: "user-confirmed",
    decision: "undecided",
    answer: "none",
    agreement: "unknown",
    verification: "unverified",
    arrival: "",
    unresolved: [],
    nextAction: "",
    needsReview: true,
  };
  a.needsReview = true;
  a.boundary = "user-confirmed";
  p.agendas.splice(p.agendas.indexOf(a) + 1, 0, b);
  p.revisions.push({
    id: id("revision"),
    at: now(),
    targetId: a.id,
    kind: "agenda-split",
    before,
    after: { original: clone(a), newAgenda: clone(b) },
    reason,
  });
  p.updatedAt = now();
  return check(p);
}
export function mergeAgenda(
  project: Project,
  agendaId: string,
  reason = "利用者による議題統合",
): Project {
  const p = check(project),
    i = p.agendas.findIndex((a) => a.id === agendaId);
  if (i <= 0 || p.agendas.length < 2)
    throw new Error("agenda not found or first agenda cannot merge");
  const a = p.agendas[i],
    target = p.agendas[i - 1],
    before = {
      target: clone(target),
      removed: clone(a),
      __projectSnapshot: snapshot(p),
    };
  target.utteranceIds = [...target.utteranceIds, ...a.utteranceIds].sort(
    (x, y) =>
      p.utterances.find((u) => u.id === x)!.order -
      p.utterances.find((u) => u.id === y)!.order,
  );
  target.needsReview = true;
  target.boundary = "user-confirmed";
  p.agendas.splice(i, 1);
  p.selectedAgendaId = target.id;
  p.revisions.push({
    id: id("revision"),
    at: now(),
    targetId: target.id,
    kind: "agenda-merge",
    before,
    after: clone(target),
    reason,
  });
  p.updatedAt = now();
  return check(p);
}
