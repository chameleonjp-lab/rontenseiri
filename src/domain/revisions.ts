import type { Agenda, Project, Revision, Utterance } from "./types";
import { validateProject } from "./project";

const clone = <T>(value: T): T => structuredClone(value);
const now = () => new Date().toISOString();
const makeId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

type SemanticSnapshot = {
  utterances: Utterance[];
  agendas: Agenda[];
  relations: Project["relations"];
  selectedAgendaId: string;
};

function snapshot(project: Project): SemanticSnapshot {
  return clone({
    utterances: project.utterances,
    agendas: project.agendas,
    relations: project.relations,
    selectedAgendaId: project.selectedAgendaId,
  });
}

function restore(project: Project, value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const raw = value as Partial<SemanticSnapshot> & {
    __projectSnapshot?: Partial<SemanticSnapshot>;
  };
  const v = raw.__projectSnapshot ?? raw;
  if (
    !Array.isArray(v.utterances) ||
    !Array.isArray(v.agendas) ||
    !Array.isArray(v.relations) ||
    typeof v.selectedAgendaId !== "string"
  )
    return false;
  project.utterances = clone(v.utterances);
  project.agendas = clone(v.agendas);
  project.relations = clone(v.relations);
  project.selectedAgendaId = v.selectedAgendaId;
  return true;
}

function fullSnapshot(revision: Revision): SemanticSnapshot | undefined {
  const raw = revision.before as
    | (Partial<SemanticSnapshot> & {
        __projectSnapshot?: Partial<SemanticSnapshot>;
      })
    | undefined;
  const before = raw?.__projectSnapshot ?? raw;
  return before &&
    Array.isArray(before.utterances) &&
    Array.isArray(before.agendas) &&
    Array.isArray(before.relations) &&
    typeof before.selectedAgendaId === "string"
    ? clone(before as SemanticSnapshot)
    : undefined;
}

function effectiveRevision(project: Project): Revision | undefined {
  const undone = new Set<string>();
  for (const revision of project.revisions) {
    if (revision.kind === "undo") {
      const target = (
        revision.after as { targetRevisionId?: unknown } | undefined
      )?.targetRevisionId;
      if (typeof target === "string") undone.add(target);
    }
  }
  for (let i = project.revisions.length - 1; i >= 0; i -= 1) {
    const revision = project.revisions[i];
    if (revision.kind !== "undo" && !undone.has(revision.id)) return revision;
  }
  return undefined;
}

function agendaOf(project: Project, utteranceId: string): Agenda | undefined {
  return project.agendas.find((agenda) =>
    agenda.utteranceIds.includes(utteranceId),
  );
}

/** Move only an utterance's agenda membership; its global order and identity remain untouched. */
export function moveUtterance(
  project: Project,
  utteranceId: string,
  targetAgendaId: string,
  reason: string,
): Project {
  const p = validateProject(project);
  if (!reason || !reason.trim()) throw new Error("reason required");
  const utterance = p.utterances.find((item) => item.id === utteranceId);
  const source = agendaOf(p, utteranceId);
  const target = p.agendas.find((agenda) => agenda.id === targetAgendaId);
  if (!utterance || !source || !target)
    throw new Error("utterance or agenda not found");
  if (source.id === target.id)
    throw new Error("utterance is already in target agenda");

  const before = snapshot(p);
  source.utteranceIds = source.utteranceIds.filter((id) => id !== utteranceId);
  target.utteranceIds = [...target.utteranceIds, utteranceId].sort(
    (a, b) =>
      p.utterances.find((item) => item.id === a)!.order -
      p.utterances.find((item) => item.id === b)!.order,
  );
  // A deliberate user move resolves uncertainty at the involved boundary only.
  if (source.boundary === "candidate") source.boundary = "user-confirmed";
  if (target.boundary === "candidate") target.boundary = "user-confirmed";
  source.needsReview = true;
  target.needsReview = true;
  const after = snapshot(p);
  const revision: Revision = {
    id: makeId("revision"),
    at: now(),
    targetId: utteranceId,
    kind: "agenda-membership",
    before,
    after,
    reason: reason.trim(),
  };
  p.revisions.push(revision);
  p.updatedAt = now();
  return validateProject(p);
}

function restoreLegacy(project: Project, revision: Revision): boolean {
  const before = revision.before as any;
  if (
    (revision.kind === "復帰先の訂正" ||
      revision.kind === "return-correction") &&
    before &&
    Array.isArray(before.relations)
  ) {
    project.relations = clone(before.relations);
    const utterance = project.utterances.find(
      (item) => item.id === revision.targetId,
    ) as (Utterance & { returnStatus?: "unknown" | "none" }) | undefined;
    if (
      utterance &&
      (before.returnStatus === "unknown" || before.returnStatus === "none")
    )
      utterance.returnStatus = before.returnStatus;
    if (Array.isArray(before.agendas)) {
      for (const oldAgenda of before.agendas) {
        const agenda = project.agendas.find((item) => item.id === oldAgenda.id);
        if (agenda) Object.assign(agenda, clone(oldAgenda));
      }
    }
    return true;
  }
  if (
    revision.kind === "user-revision" &&
    before &&
    typeof before.id === "string"
  ) {
    const utterance = project.utterances.find((item) => item.id === before.id);
    if (utterance) Object.assign(utterance, clone(before));
    else {
      const agenda = project.agendas.find((item) => item.id === before.id);
      if (!agenda) return false;
      Object.assign(agenda, clone(before));
    }
    return true;
  }
  if (revision.kind === "source-revision" && Array.isArray(before)) {
    for (const old of before) {
      const index = project.utterances.findIndex((item) => item.id === old.id);
      if (index >= 0) project.utterances[index] = clone(old);
    }
    return true;
  }
  if (revision.kind === "agenda-split" && before?.id) {
    const original = project.agendas.find((agenda) => agenda.id === before.id);
    if (!original) return false;
    Object.assign(original, clone(before));
    const newId = (revision.after as any)?.newAgenda?.id;
    if (newId)
      project.agendas = project.agendas.filter((agenda) => agenda.id !== newId);
    return true;
  }
  if (revision.kind === "agenda-merge" && before?.target && before?.removed) {
    const target = project.agendas.find(
      (agenda) => agenda.id === before.target.id,
    );
    if (!target) return false;
    Object.assign(target, clone(before.target));
    const index = project.agendas.findIndex(
      (agenda) => agenda.id === target.id,
    );
    if (!project.agendas.some((agenda) => agenda.id === before.removed.id))
      project.agendas.splice(index + 1, 0, clone(before.removed));
    return true;
  }
  return false;
}

/** Undo the latest revision that has not itself already been undone. */
export function undoLastRevision(project: Project): Project {
  const p = validateProject(project);
  const target = effectiveRevision(p);
  if (!target) throw new Error("no revision to undo");
  const beforeUndo = snapshot(p);
  const restored = fullSnapshot(target)
    ? restore(p, target.before)
    : restoreLegacy(p, target);
  if (!restored) throw new Error(`revision cannot be undone: ${target.kind}`);
  const afterUndo = snapshot(p);
  p.revisions.push({
    id: makeId("revision"),
    at: now(),
    targetId: target.targetId,
    kind: "undo",
    before: beforeUndo,
    after: { ...afterUndo, targetRevisionId: target.id },
    reason: `Undo: ${target.reason}`,
  });
  p.updatedAt = now();
  return validateProject(p);
}
