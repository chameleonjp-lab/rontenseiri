import { readSubtitleCueLedger } from "../input/parse";
import type { Project, Relation, Utterance } from "./types";
import type { ReasoningGraph } from "./reasoning-types";
import type {
  LineageLedger,
  LineageRecord,
  LineageReferenceTransfer,
  TransferStatus,
} from "./lineage-types";
import { validateProject } from "./project";
import { buildSourceCoverage } from "./coverage";
import { semanticSnapshot } from "./snapshot";
import { invalidateDependents } from "./invalidation";
import {
  validateUtteranceQuote,
  withCueSpans,
  splitCueSpans,
} from "./cue-provenance";

type ProjectWithLineage = Project & { lineage?: LineageLedger };
const clone = <T>(v: T): T => structuredClone(v);
const id = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const now = () => new Date().toISOString();
type Snapshot = { __projectSnapshot: ReturnType<typeof semanticSnapshot> };
function snapshot(p: ProjectWithLineage): Snapshot {
  return { __projectSnapshot: clone(semanticSnapshot(p)) };
}
function checked(project: Project): ProjectWithLineage {
  return validateProject(project) as ProjectWithLineage;
}
function reasonOf(reason: string | undefined, fallback: string) {
  if (reason !== undefined && !reason.trim())
    throw new Error("reason required");
  return reason?.trim() || fallback;
}
function ensureLedger(p: ProjectWithLineage): LineageLedger {
  if (!p.lineage) p.lineage = { records: [] };
  return p.lineage;
}
function unique(xs: string[]) {
  return new Set(xs).size === xs.length;
}

function referencesFor(
  oldIds: string[],
  newIds: string[],
  relations: Relation[],
): LineageReferenceTransfer[] {
  const refs = relations.map((r) => ({
    kind: "relation" as const,
    referenceId: r.id,
    targetIds: [...newIds],
    status: "pending" as const,
    note: "旧関係を台帳へ退避。移し先は利用者が明示確認する",
  }));
  if (!refs.length)
    refs.push({
      kind: "relation",
      referenceId: oldIds.join(","),
      targetIds: [...newIds],
      status: "pending",
      note: "発言分割・統合後の関係の移し先は自動確定しない",
    });
  return refs;
}
function shiftOrders(p: ProjectWithLineage, from: number) {
  for (const u of p.utterances) if (u.order >= from) u.order += 1;
}
function agendaReplace(
  p: ProjectWithLineage,
  oldIds: string[],
  newIds: string[],
) {
  for (const a of p.agendas) {
    const at = a.utteranceIds.findIndex((x) => oldIds.includes(x));
    if (at < 0) continue;
    const next = a.utteranceIds.filter((x) => !oldIds.includes(x));
    next.splice(at, 0, ...newIds);
    a.utteranceIds = next;
    a.needsReview = true;
  }
}
function rebuildCoverage(p: ProjectWithLineage, versionId: string) {
  const source = p.sources.find((s) => s.versionId === versionId);
  if (source) source.coverage = buildSourceCoverage(source, p.utterances);
}

/**
 * Preserve reasoning references across a split without silently choosing the
 * left fragment.  The graph has no character-offset information for an
 * evidence record, so an old utterance reference is conservatively represented
 * as spanning both fragments.  Fulfillment that depended on that unresolved
 * boundary cannot remain a confirmed assertion.
 */
export type SplitReferenceDestination =
  "left" | "right" | "both" | "unresolved";
export interface SplitUtteranceOptions {
  at?: number;
  offset?: number;
  reason?: string;
  reasoningDestinations?: Record<string, SplitReferenceDestination>;
}

function transferReasoningReferences(
  p: ProjectWithLineage,
  oldIds: string[],
  newIds: string[],
  destinations: Record<string, SplitReferenceDestination> = {},
  record?: LineageRecord,
) {
  const graph = p.reasoning as
    (ReasoningGraph & Record<string, unknown>) | undefined;
  if (!graph) return;
  const old = new Set(oldIds);
  const targetsFor = (
    recordId: string,
  ): { ids: string[]; unresolved: boolean } => {
    if (record?.operation === "merge")
      return { ids: [...newIds], unresolved: false };
    const destination = destinations[recordId] ?? "unresolved";
    if (destination === "left") return { ids: [newIds[0]], unresolved: false };
    if (destination === "right") return { ids: [newIds[1]], unresolved: false };
    if (destination === "both") return { ids: [...newIds], unresolved: false };
    return { ids: [...newIds], unresolved: true };
  };
  const replace = (
    value: unknown,
    recordId: string,
  ): { value: unknown[]; unresolved: boolean } | undefined => {
    if (!Array.isArray(value) || !value.some((x) => old.has(String(x))))
      return undefined;
    const target = targetsFor(recordId);
    return {
      value: [
        ...new Set(
          value.flatMap((x) => (old.has(String(x)) ? target.ids : [x])),
        ),
      ],
      unresolved: target.unresolved,
    };
  };
  const addRef = (
    kind: "evidence" | "other",
    referenceId: string,
    unresolved: boolean,
  ) => {
    if (!record || record.references.some((r) => r.referenceId === referenceId))
      return;
    record.references.push({
      kind,
      referenceId,
      targetIds: targetsFor(referenceId).ids,
      status: unresolved ? "unresolved" : "applied",
      note: unresolved
        ? "分割後の根拠範囲は未確定。両片を原根拠として保持"
        : record.operation === "merge"
          ? "統合後の発言へ根拠参照を移送。成立判定は別途確認"
          : "分割後の根拠移し先を利用者が確認。成立判定は別途確認",
    });
  };
  const evidence = graph.evidence;
  const changedEvidenceIds = new Set<string>();
  const unresolvedEvidenceIds = new Set<string>();
  if (Array.isArray(evidence))
    for (const entry of evidence) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as unknown as Record<string, unknown>;
      const next = replace(e.utteranceIds, String(e.id));
      if (!next) continue;
      e.utteranceIds = next.value;
      changedEvidenceIds.add(String(e.id));
      if (next.unresolved) {
        unresolvedEvidenceIds.add(String(e.id));
        if (e.certainty === "confirmed") e.certainty = "uncertain";
        e.note =
          typeof e.note === "string"
            ? `${e.note} 分割境界上の根拠範囲は未確定（両片を保持）`
            : "分割境界上の根拠範囲は未確定（両片を保持）";
      }
      addRef("evidence", String(e.id), next.unresolved);
    }
  for (const [key, value] of Object.entries(graph)) {
    if (!Array.isArray(value) || key === "evidence") continue;
    for (const entry of value) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as unknown as Record<string, unknown>;
      const refId = String(e.id ?? "");
      let changed = false,
        unresolved = false;
      for (const field of ["utteranceIds", "sourceUtteranceIds"]) {
        const next = replace(e[field], refId);
        if (next) {
          e[field] = next.value;
          changed = true;
          unresolved ||= next.unresolved;
        }
      }
      const directlyChanged = changed;
      const directUnresolved = unresolved;
      const referencedEvidenceIds = Array.isArray(e.evidenceIds)
        ? e.evidenceIds.map(String)
        : [];
      const affectedEvidenceIds = referencedEvidenceIds.filter((id) =>
        changedEvidenceIds.has(id),
      );
      if (affectedEvidenceIds.length) {
        changed = true;
        unresolved ||= affectedEvidenceIds.some((id) =>
          unresolvedEvidenceIds.has(id),
        );
      }
      if (changed) {
        // A changed response boundary is never silently retained as fulfilled,
        // including responses with evidenceIds: [].
        if (e.fulfillment === "fulfilled") e.fulfillment = "unassessed";
        if (unresolved && e.certainty === "confirmed")
          e.certainty = "uncertain";
        if (unresolved)
          e.note =
            typeof e.note === "string"
              ? `${e.note} 分割後の参照範囲は未確定`
              : "分割後の参照範囲は未確定";
        if (refId && directlyChanged) addRef("other", refId, directUnresolved);
      }
    }
  }
}

function retireRelations(p: ProjectWithLineage, oldIds: string[]) {
  const affected = p.relations.filter(
    (r) =>
      oldIds.includes(r.from) ||
      oldIds.includes(r.to) ||
      r.evidenceIds.some((x) => oldIds.includes(x)),
  );
  p.relations = p.relations.filter((r) => !affected.includes(r));
  // invalidation follows only dependency=true; chronology/navigation edges are not semantic invalidations.
  const dependencyRoots = affected
    .filter((r) => r.dependency === true)
    .flatMap((r) => [r.from, r.to, ...r.evidenceIds]);
  return { affected, dependencyRoots };
}
function append(
  p: ProjectWithLineage,
  record: LineageRecord,
  before: Snapshot,
) {
  ensureLedger(p).records.push(record);
  p.revisions.push({
    id: record.undoRevisionId!,
    at: record.createdAt,
    targetId: record.oldIds[0],
    kind: `utterance-${record.operation}`,
    before,
    after: { lineage: clone(record), newIds: record.newIds },
    reason: record.reason,
  });
  p.updatedAt = now();
}
function compactUndo(
  retired: Utterance[],
  relations: Relation[],
  agendas: Project["agendas"],
  reasoning: Project["reasoning"],
): LineageRecord["undoSnapshot"] {
  return {
    retiredUtterances: clone(retired),
    originalRelations: clone(relations),
    originalAgendas: clone(agendas),
    originalReasoning: clone(reasoning),
  };
}
function finalize(
  p: ProjectWithLineage,
  before: Snapshot,
  record: LineageRecord,
  oldIds: string[],
  dependencyRoots: string[],
  reasoningDestinations: Record<string, SplitReferenceDestination> = {},
) {
  for (const agenda of p.agendas) {
    if (agenda.summaryDependencies?.some((id) => oldIds.includes(id))) {
      record.references.push({
        kind: "summary",
        referenceId: `summary:${agenda.id}`,
        targetIds: [...record.newIds],
        status: "pending",
        note: "要約の根拠の移し先を確認してください",
      });
      agenda.summaryDependencies = agenda.summaryDependencies.filter(
        (id) => !oldIds.includes(id),
      );
      agenda.needsReview = true;
    }
  }
  transferReasoningReferences(
    p,
    oldIds,
    record.newIds,
    reasoningDestinations,
    record,
  );
  const invalidated = invalidateDependents(p, [
    ...oldIds,
    ...record.newIds,
    ...dependencyRoots,
  ]) as ProjectWithLineage;
  p.utterances = invalidated.utterances;
  p.agendas = invalidated.agendas;
  p.relations = invalidated.relations;
  if (invalidated.reasoning) p.reasoning = invalidated.reasoning;
  append(p, record, before);
  rebuildCoverage(p, record.sourceVersionId);
  return checked(p);
}

/** Split the body of one utterance; offset is relative to its quote (or use {at}). */
export function splitUtterance(
  project: Project,
  utteranceId: string,
  offset: number | SplitUtteranceOptions,
  reason?: string,
): Project {
  const p = checked(project),
    u = p.utterances.find((x) => x.id === utteranceId);
  if (!u) throw new Error("utterance not found");
  const n = typeof offset === "number" ? offset : (offset.offset ?? offset.at);
  const why = reasonOf(
    typeof offset === "object" ? (offset.reason ?? reason) : reason,
    "利用者による発言分割",
  );
  if (n === undefined || !Number.isInteger(n) || n <= 0 || n >= u.quote.length)
    throw new Error("split offset must be inside utterance");
  if (
    (u.quote.charCodeAt(n - 1) >= 0xd800 &&
      u.quote.charCodeAt(n - 1) <= 0xdbff) ||
    (u.quote.charCodeAt(n) >= 0xdc00 && u.quote.charCodeAt(n) <= 0xdfff)
  )
    throw new Error("surrogate pair cannot be split");
  const before = snapshot(p),
    source = p.sources.find((s) => s.versionId === u.sourceVersionId);
  if (!source) throw new Error("source missing");
  validateUtteranceQuote(source, u);
  const leftBase: Utterance = { ...clone(u), id: id("utterance") };
  const rightBase: Utterance = {
    ...clone(u),
    id: id("utterance"),
    order: u.order + 1,
  };
  let left: Utterance, right: Utterance;
  if (u.cueSpans) {
    const [leftSpans, rightSpans] = splitCueSpans(source, u.cueSpans, n);
    if (!leftSpans.length || !rightSpans.length)
      throw new Error("split cannot create empty cue span");
    left = withCueSpans(leftBase, source, leftSpans);
    right = withCueSpans(rightBase, source, rightSpans);
  } else {
    left = { ...leftBase, end: u.start + n, quote: u.quote.slice(0, n) };
    right = { ...rightBase, start: u.start + n, quote: u.quote.slice(n) };
  }
  const index = p.utterances.findIndex((x) => x.id === u.id);
  shiftOrders(p, u.order + 1);
  p.utterances.splice(index, 1, left, right);
  agendaReplace(p, [u.id], [left.id, right.id]);
  const { affected, dependencyRoots } = retireRelations(p, [u.id]);
  const record: LineageRecord = {
    id: id("lineage"),
    operation: "split",
    oldIds: [u.id],
    newIds: [left.id, right.id],
    status: "pending",
    sourceVersionId: u.sourceVersionId,
    start: u.start,
    end: u.end,
    reason: why,
    createdAt: now(),
    references: referencesFor([u.id], [left.id, right.id], affected),
    undoRevisionId: id("revision"),
    undoSnapshot: compactUndo(
      [u],
      affected,
      before.__projectSnapshot.agendas,
      before.__projectSnapshot.reasoning,
    ),
  };
  return finalize(
    p,
    before,
    record,
    [u.id],
    dependencyRoots,
    typeof offset === "object" ? (offset.reasoningDestinations ?? {}) : {},
  );
}

export interface MergeUtteranceOptions {
  reason?: string;
  allowCrossAgenda?: boolean;
}
/** Merge same-speaker ranges; crossing agendas requires an explicit agenda-change option. */
export function mergeUtterances(
  project: Project,
  utteranceIds: string[],
  reasonOrOptions: string | MergeUtteranceOptions = "利用者による発言統合",
): Project {
  const options =
    typeof reasonOrOptions === "string"
      ? { reason: reasonOrOptions }
      : reasonOrOptions;
  const reason = options.reason ?? "利用者による発言統合";
  const p = checked(project);
  if (
    !Array.isArray(utteranceIds) ||
    utteranceIds.length < 2 ||
    !unique(utteranceIds) ||
    !reason.trim()
  )
    throw new Error("utterances and reason required");
  const selected = utteranceIds.map((x) =>
    p.utterances.find((u) => u.id === x),
  );
  if (selected.some((u): u is undefined => !u))
    throw new Error("utterance not found");
  const us = selected as Utterance[];
  us.sort((a, b) => a.start - b.start);
  const agendas = new Set(
    p.agendas
      .filter((a) => us.some((u) => a.utteranceIds.includes(u.id)))
      .map((a) => a.id),
  );
  if (agendas.size > 1 && !options.allowCrossAgenda)
    throw new Error(
      "merge across agendas requires explicit agenda-change option",
    );
  const first = us[0],
    last = us[us.length - 1],
    source = p.sources.find((s) => s.versionId === first.sourceVersionId);
  if (
    !source ||
    us.some(
      (u) =>
        u.sourceVersionId !== first.sourceVersionId ||
        u.speaker !== first.speaker,
    ) ||
    us.some((u, i) => i > 0 && u.start < us[i - 1].end)
  )
    throw new Error(
      "merge requires same source version/speaker and ordered ranges",
    );
  const selectedSet = new Set(us.map((u) => u.id));
  if (
    p.utterances.some(
      (u) =>
        u.sourceVersionId === first.sourceVersionId &&
        u.start >= first.start &&
        u.end <= last.end &&
        !selectedSet.has(u.id),
    )
  )
    throw new Error("merge range contains an unselected utterance");
  const before = snapshot(p);
  // Legacy schemaVersion 1 retains its scalar quote/time on import. Recover body
  // spans only for this explicit merge, from the unchanged raw subtitle source.
  if (["vtt", "srt"].includes(source.format) && us.some((u) => !u.cueSpans)) {
    source.cueLedger ??= readSubtitleCueLedger(source.text, source.format);
    for (const u of us)
      if (!u.cueSpans) {
        const spans = source.cueLedger
          .filter((cue) => cue.start < u.end && cue.end > u.start)
          .map((cue) => ({
            cueId: cue.id,
            start: Math.max(cue.start, u.start),
            end: Math.min(cue.end, u.end),
          }));
        if (!spans.length)
          throw new Error(
            "旧字幕の本文をcueへ対応できません。字幕入力を再確認してください",
          );
        // Selection is explicit; any former metadata gap is not a body span.
        const recovered = withCueSpans(u, source, spans);
        if (recovered.time === undefined) delete u.time;
        Object.assign(u, recovered);
      }
  }
  if (us.some((u) => u.cueSpans) && !us.every((u) => u.cueSpans))
    throw new Error("cue対応のある本文とない本文は混在して統合できません");
  us.forEach((u) => validateUtteranceQuote(source, u));
  const mergedBase: Utterance = {
    ...clone(first),
    id: id("utterance"),
    order: Math.min(...us.map((u) => u.order)),
    important: us.some((u) => u.important),
    coverage: us.some((u) => u.coverage === "failed")
      ? "failed"
      : first.coverage,
  };
  const merged: Utterance = first.cueSpans
    ? withCueSpans(
        mergedBase,
        source,
        us.flatMap((u) => u.cueSpans ?? []),
      )
    : {
        ...mergedBase,
        start: first.start,
        end: last.end,
        quote: source.text.slice(first.start, last.end),
      };
  p.utterances = p.utterances.filter((u) => !selectedSet.has(u.id));
  const insertAt = p.utterances.findIndex((u) => u.order > merged.order);
  if (insertAt < 0) p.utterances.push(merged);
  else p.utterances.splice(insertAt, 0, merged);
  const removed = us.length - 1;
  for (const u of p.utterances)
    if (u.order > merged.order + removed) u.order -= removed;
  agendaReplace(
    p,
    us.map((u) => u.id),
    [merged.id],
  );
  const oldIds = us.map((u) => u.id);
  const { affected, dependencyRoots } = retireRelations(p, oldIds);
  const record: LineageRecord = {
    id: id("lineage"),
    operation: "merge",
    oldIds,
    newIds: [merged.id],
    status: "pending",
    sourceVersionId: first.sourceVersionId,
    start: first.start,
    end: last.end,
    reason: reason.trim(),
    createdAt: now(),
    references: referencesFor(oldIds, [merged.id], affected),
    undoRevisionId: id("revision"),
    undoSnapshot: compactUndo(
      us,
      affected,
      before.__projectSnapshot.agendas,
      before.__projectSnapshot.reasoning,
    ),
  };
  return finalize(p, before, record, oldIds, dependencyRoots);
}

/** Resolve a historical transfer explicitly; targets remain valid even after later lineage operations retire them. */
export function resolveLineageTransfer(
  project: Project,
  lineageId: string,
  referenceId: string,
  targetIds: string[],
  status: Exclude<TransferStatus, "pending"> = "applied",
  note = "利用者が移し先を確認",
): Project {
  const p = checked(project);
  if (
    !Array.isArray(targetIds) ||
    !targetIds.length ||
    !unique(targetIds) ||
    !note.trim()
  )
    throw new Error("targetIds and note required");
  const record = p.lineage?.records.find((x) => x.id === lineageId);
  if (!record) throw new Error("lineage record not found");
  const ref = record.references.find((x) => x.referenceId === referenceId);
  if (!ref) throw new Error("lineage reference not found");
  if (!targetIds.every((x) => lineageTargetIds(p, record.id).includes(x)))
    throw new Error("target is not a new utterance");
  if (status === "unresolved") targetIds = lineageTargetIds(p, record.id);
  const before = snapshot(p);
  const priorTargets = [...ref.targetIds];
  const original = record.undoSnapshot?.originalRelations?.find(
    (r) => r.id === referenceId,
  );
  if (status === "applied" && original) {
    const endpointChanged =
      record.oldIds.includes(original.from) ||
      record.oldIds.includes(original.to);
    if (endpointChanged && targetIds.length !== 1)
      throw new Error("関係の端点は1つを明示選択してください");
    const from = record.oldIds.includes(original.from)
      ? targetIds[0]
      : original.from;
    const to = record.oldIds.includes(original.to) ? targetIds[0] : original.to;
    const evidenceIds = [
      ...new Set(
        original.evidenceIds.flatMap((id) =>
          record.oldIds.includes(id) ? targetIds : [id],
        ),
      ),
    ];
    if (from !== to) {
      if (
        !p.utterances.some((u) => u.id === from) ||
        !p.utterances.some((u) => u.id === to)
      )
        throw new Error(
          "端点が後続操作で退役しています。次の移送を先に確認してください",
        );
      if (p.relations.some((r) => r.id === original.id))
        throw new Error("同じ関係が既に変更されています。上書きしません");
      p.relations.push({ ...original, from, to, evidenceIds });
    }
  }
  if (
    (ref.kind === "evidence" || ref.kind === "other") &&
    status !== "conflict"
  ) {
    const reasoning = p.reasoning as
      (ReasoningGraph & Record<string, unknown>) | undefined;
    const originalGraph = record.undoSnapshot?.originalReasoning as
      ReasoningGraph | undefined;
    const original =
      originalGraph &&
      (Object.values(originalGraph)
        .flatMap((value) => (Array.isArray(value) ? value : []))
        .find((value) => (value as { id?: unknown }).id === referenceId) as
        Record<string, unknown> | undefined);
    const current =
      reasoning &&
      (Object.values(reasoning)
        .flatMap((x) => (Array.isArray(x) ? x : []))
        .find((x) => (x as { id?: unknown }).id === referenceId) as
        Record<string, unknown> | undefined);
    if (current) {
      // Historical snapshots identify the reference, but live graph fields
      // are authoritative for unrelated roots edited in the meantime.
      const rootIds = new Set([
        ...record.oldIds,
        ...lineageTargetIds(p, record.id),
      ]);
      for (const field of ["utteranceIds", "sourceUtteranceIds"])
        if (Array.isArray(current[field])) {
          const originalIds = Array.isArray(original?.[field])
            ? (original[field] as unknown[])
            : [];
          const protectedIds = new Set(
            originalIds.flatMap((value) => {
              const id = String(value);
              if (record.oldIds.includes(id)) return [];
              if (p.utterances.some((utterance) => utterance.id === id))
                return [id];
              const later = p.lineage?.records.find((item) =>
                item.oldIds.includes(id),
              );
              return later ? lineageTargetIds(p, later.id) : [];
            }),
          );
          current[field] = [
            ...new Set(
              (current[field] as unknown[]).flatMap((x) =>
                rootIds.has(String(x))
                  ? protectedIds.has(String(x))
                    ? [...targetIds, x]
                    : targetIds
                  : [x],
              ),
            ),
          ];
        }
    }
    if (current && status === "unresolved")
      current.note =
        typeof current.note === "string"
          ? `${current.note} 分割境界は未確定（両片を保持）`
          : "分割境界は未確定（両片を保持）";
    if (current && status === "unresolved" && current.certainty === "confirmed")
      current.certainty = "uncertain";
    if (current?.fulfillment === "fulfilled")
      current.fulfillment = "unassessed";
    if (reasoning && ref.kind === "evidence")
      for (const response of reasoning.responses)
        if (
          response.evidenceIds.includes(referenceId) &&
          response.fulfillment === "fulfilled"
        )
          response.fulfillment = "unassessed";
  }
  if (ref.kind === "summary" && status === "applied") {
    const agenda = p.agendas.find((a) => `summary:${a.id}` === referenceId);
    if (!agenda) throw new Error("要約が見つかりません");
    agenda.summaryDependencies = [
      ...new Set([...(agenda.summaryDependencies ?? []), ...targetIds]),
    ];
    agenda.needsReview = true;
  }
  ref.targetIds = [...targetIds];
  ref.status = status;
  ref.note = note.trim();
  record.status = record.references.every((x) => x.status === "applied")
    ? "applied"
    : record.references.some((x) => x.status === "conflict")
      ? "conflict"
      : record.references.some((x) => x.status === "unresolved")
        ? "unresolved"
        : "pending";
  const revisionId = id("revision");
  p.revisions.push({
    id: revisionId,
    at: now(),
    targetId: referenceId,
    kind: "lineage-transfer",
    before,
    after: snapshot(p),
    reason: `${note.trim()}（${priorTargets.join(",")}→${targetIds.join(",")}）`,
  });
  record.undoRevisionId ??= revisionId;
  p.updatedAt = now();
  return checked(p);
}

export function lineageTargetIds(project: Project, recordId: string): string[] {
  const record = project.lineage?.records.find((r) => r.id === recordId);
  if (!record) return [];
  const reached = new Set(record.newIds);
  let size = -1;
  while (size !== reached.size) {
    size = reached.size;
    for (const next of project.lineage?.records ?? [])
      if (next.oldIds.some((id) => reached.has(id)))
        for (const id of next.newIds) reached.add(id);
  }
  return project.utterances.filter((u) => reached.has(u.id)).map((u) => u.id);
}
