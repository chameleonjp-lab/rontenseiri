import type { Project, Relation, Utterance } from "./types";
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

/** Keep one provisional source, never duplicate a confirmed claim onto every split target. */
function transferReasoningReferences(
  p: ProjectWithLineage,
  oldIds: string[],
  newIds: string[],
) {
  const graph = p.reasoning as Record<string, unknown> | undefined;
  if (!graph) return;
  for (const value of Object.values(graph))
    if (Array.isArray(value))
      for (const entry of value) {
        if (!entry || typeof entry !== "object") continue;
        const e = entry as Record<string, unknown>;
        let changed = false;
        for (const key of ["utteranceIds", "sourceUtteranceIds"]) {
          const ids = e[key];
          if (
            !Array.isArray(ids) ||
            !ids.some((x) => oldIds.includes(String(x)))
          )
            continue;
          e[key] = ids.flatMap((x) =>
            oldIds.includes(String(x)) ? [newIds[0]] : [x],
          );
          changed = true;
        }
        if (changed && e.certainty === "confirmed") {
          e.certainty = "uncertain";
          if (typeof e.note === "string")
            e.note = `${e.note} 発言編集後の暫定参照。要再確認`;
          else e.note = "発言編集後の暫定参照。要再確認";
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
  transferReasoningReferences(p, oldIds, record.newIds);
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
  offset: number | { at?: number; offset?: number; reason?: string },
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
  if (!source || source.text.slice(u.start, u.end) !== u.quote)
    throw new Error("quote mismatch");
  const left: Utterance = {
    ...clone(u),
    id: id("utterance"),
    end: u.start + n,
    quote: u.quote.slice(0, n),
  };
  const right: Utterance = {
    ...clone(u),
    id: id("utterance"),
    start: u.start + n,
    quote: u.quote.slice(n),
    order: u.order + 1,
  };
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
  return finalize(p, before, record, [u.id], dependencyRoots);
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
  const before = snapshot(p),
    merged: Utterance = {
      ...clone(first),
      id: id("utterance"),
      start: first.start,
      end: last.end,
      quote: source.text.slice(first.start, last.end),
      order: Math.min(...us.map((u) => u.order)),
      important: us.some((u) => u.important),
      coverage: us.some((u) => u.coverage === "failed")
        ? "failed"
        : first.coverage,
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
  status: Exclude<TransferStatus, "pending" | "unresolved"> = "applied",
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
    : "conflict";
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
export const resolveLineageReference = resolveLineageTransfer;

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
