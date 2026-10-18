import type { Project, Utterance } from "./types";
import type { LineageLedger } from "./lineage-types";
import { validateUtteranceQuote, validateSourceCues } from "./cue-provenance";

type ProjectWithLineage = Project & { lineage?: LineageLedger };
const statuses = new Set(["applied", "conflict", "pending", "unresolved"]);
const transferKinds = new Set([
  "classification",
  "important",
  "agenda",
  "relation",
  "summary",
  "evidence",
  "revision",
  "other",
]);
const string = (v: unknown): v is string => typeof v === "string";
const unique = (xs: string[]) => new Set(xs).size === xs.length;

/** Validate lineage metadata without requiring historical targets to remain active. */
export function validateLineage(project: Project): Project {
  const p = project as ProjectWithLineage;
  if (p.lineage === undefined) return project;
  const ledger = p.lineage;
  if (!ledger || !Array.isArray(ledger.records))
    throw new Error("invalid lineage ledger");
  const active = new Map((p.utterances ?? []).map((u) => [u.id, u]));
  const recordIds = new Set<string>();
  const historical = new Set<string>();
  const states: Utterance[] = [...p.utterances];
  const collect = (raw: unknown) => {
    if (!raw || typeof raw !== "object") return;
    const v = raw as Record<string, unknown>;
    if (Array.isArray(v.utterances))
      states.push(
        ...(v.utterances.filter(
          (u) => u && typeof u === "object",
        ) as Utterance[]),
      );
    const nested = v.__projectSnapshot as
      { utterances?: Utterance[] } | undefined;
    if (Array.isArray(nested?.utterances)) states.push(...nested.utterances);
  };
  for (const revision of p.revisions) {
    collect(revision.before);
    collect(revision.after);
  }
  for (const record of ledger.records) {
    if (Array.isArray(record?.undoSnapshot?.retiredUtterances))
      states.push(...record.undoSnapshot.retiredUtterances);
    collect(record?.undoSnapshot);
  }

  for (const r of ledger.records) {
    if (
      !r ||
      !string(r.id) ||
      recordIds.has(r.id) ||
      !["split", "merge"].includes(r.operation) ||
      !Array.isArray(r.oldIds) ||
      !Array.isArray(r.newIds) ||
      !r.oldIds.length ||
      !r.newIds.length ||
      !r.oldIds.every(string) ||
      !r.newIds.every(string) ||
      !unique(r.oldIds) ||
      !unique(r.newIds) ||
      r.oldIds.some((id) => r.newIds.includes(id)) ||
      !statuses.has(r.status) ||
      !string(r.sourceVersionId) ||
      !Number.isInteger(r.start) ||
      !Number.isInteger(r.end) ||
      r.start < 0 ||
      r.end < r.start ||
      !string(r.reason) ||
      !r.reason.trim() ||
      !string(r.createdAt) ||
      !Array.isArray(r.references)
    )
      throw new Error("invalid lineage record");
    recordIds.add(r.id);
    r.oldIds.forEach((id) => historical.add(id));
    r.newIds.forEach((id) => historical.add(id));
    const originalSource = p.sources.find(
      (source) => source.versionId === r.sourceVersionId,
    );
    if (!originalSource || r.end > originalSource.text.length)
      throw new Error("lineage original source missing");
    validateSourceCues(originalSource);
    for (const id of r.newIds) {
      if (
        !states.some(
          (u) =>
            u.id === id &&
            u.sourceVersionId === r.sourceVersionId &&
            Number.isInteger(u.start) &&
            Number.isInteger(u.end) &&
            u.start >= r.start &&
            u.end <= r.end &&
            u.end > u.start &&
            typeof u.quote === "string" &&
            (() => {
              try {
                validateUtteranceQuote(originalSource, u);
                return true;
              } catch {
                return false;
              }
            })(),
        )
      )
        throw new Error("lineage target range mismatch");
    }

    for (const ref of r.references) {
      if (
        !ref ||
        !transferKinds.has(ref.kind) ||
        !string(ref.referenceId) ||
        !ref.referenceId ||
        !Array.isArray(ref.targetIds) ||
        !ref.targetIds.length ||
        !ref.targetIds.every(string) ||
        !unique(ref.targetIds) ||
        !ref.targetIds.every((id) => reachable(ledger.records, r.newIds, id)) ||
        !statuses.has(ref.status) ||
        (ref.note !== undefined && !string(ref.note))
      )
        throw new Error("invalid lineage reference transfer");
    }
    const snap = r.undoSnapshot;
    if (snap !== undefined) {
      const full = snap.__projectSnapshot;
      const compact =
        snap.retiredUtterances !== undefined ||
        snap.originalRelations !== undefined;
      if (
        full &&
        (!Array.isArray(full.utterances) ||
          !Array.isArray(full.agendas) ||
          !Array.isArray(full.relations) ||
          !string(full.selectedAgendaId))
      )
        throw new Error("lineage undo snapshot missing");
      if (!full && !compact) throw new Error("lineage undo payload missing");
      if (
        snap.retiredUtterances !== undefined &&
        !Array.isArray(snap.retiredUtterances)
      )
        throw new Error("invalid retired utterance payload");
      if (
        snap.originalRelations !== undefined &&
        !Array.isArray(snap.originalRelations)
      )
        throw new Error("invalid original relation payload");
    }
    if (r.undoRevisionId !== undefined && !string(r.undoRevisionId))
      throw new Error("invalid undo revision link");
  }
  // Every historical target is either active or explained by a lineage chain.
  for (const r of ledger.records)
    for (const id of r.oldIds)
      if (!active.has(id) && !historical.has(id))
        throw new Error("lineage history gap");
  const orders = new Set<number>();
  for (const u of p.utterances ?? []) {
    if (!Number.isInteger(u.order) || orders.has(u.order))
      throw new Error("lineage utterance order conflict");
    orders.add(u.order);
  }
  for (const agenda of p.agendas ?? []) {
    let previous = -1;
    for (const id of agenda.utteranceIds) {
      const u = active.get(id);
      if (u && u.order <= previous)
        throw new Error("lineage agenda chronology conflict");
      if (u) previous = u.order;
    }
  }
  return project;
}

function reachable(
  records: LineageLedger["records"],
  roots: string[],
  target: string,
): boolean {
  const seen = new Set(roots);
  let size = -1;
  while (size !== seen.size) {
    size = seen.size;
    for (const r of records)
      if (
        Array.isArray(r?.oldIds) &&
        Array.isArray(r?.newIds) &&
        r.oldIds.some((id) => seen.has(id))
      )
        for (const id of r.newIds) seen.add(id);
  }
  return seen.has(target);
}
