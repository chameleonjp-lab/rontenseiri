import type { Project, Utterance } from "./types";
export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  agendaId: string;
}
export interface LayoutBlock {
  id: string;
  agendaId: string;
  occurrence: number;
  x: number;
  y: number;
  width: number;
  height: number;
  utteranceIds: string[];
}
const X_STEP = 260;
const MAIN_Y = 64;
const ROW_STEP = 92;
const CARD_HEIGHT = 96;
const BLOCK_PADDING = 24;
function order(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(3_000_000, value)) : 0;
}
function jitter(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++)
    h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 17) - 8;
}

/** Meaning and view state never share storage. All occurrences of an agenda keep its canonical ID. */
export function layoutProject(project: Project): {
  nodes: LayoutNode[];
  blocks: LayoutBlock[];
} {
  const membership = new Map<string, string>();
  project.agendas.forEach((a) =>
    a.utteranceIds.forEach((id) => membership.set(id, a.id)),
  );
  const speeches = [...project.utterances]
    .filter((u) => membership.has(u.id))
    .sort(
      (a, b) => order(a.order) - order(b.order) || a.id.localeCompare(b.id),
    );
  const incoming = new Map<string, string[]>();
  project.relations
    .filter((r) => r.kind === "drift")
    .forEach((r) =>
      incoming.set(r.to, [...(incoming.get(r.to) || []), r.from]),
    );
  const depth = (
    id: string,
    visited = new Set<string>(),
    steps = 0,
  ): number => {
    if (steps >= 2 || visited.has(id)) return 1;
    const parents = incoming.get(id) || [];
    if (!parents.length) return 1;
    const next = new Set(visited).add(id);
    return Math.min(
      3,
      1 + Math.max(...parents.map((parent) => depth(parent, next, steps + 1))),
    );
  };
  const point = (u: Utterance): LayoutNode => ({
    id: u.id,
    agendaId: membership.get(u.id)!,
    x: 35 + order(u.order) * X_STEP,
    // The main/unknown band stays compact. Only a real branch relation adds
    // another row; classification alone must not manufacture vertical space.
    y:
      MAIN_Y +
      (u.classification === "derived"
        ? ROW_STEP
        : u.classification === "drift"
          ? depth(u.id) * ROW_STEP
          : 0) +
      (u.classification === "main" ? jitter(u.id) : 0),
  });
  const nodes = speeches.map(point);
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const segments: Array<{ agendaId: string; utterances: Utterance[] }> = [];
  for (const u of speeches) {
    const agendaId = membership.get(u.id)!;
    const current = segments.at(-1);
    if (current?.agendaId === agendaId) current.utterances.push(u);
    else segments.push({ agendaId, utterances: [u] });
  }
  const occurrences = new Map<string, number>();
  const blocks = segments.map(({ agendaId, utterances }): LayoutBlock => {
    const occurrence = (occurrences.get(agendaId) || 0) + 1;
    occurrences.set(agendaId, occurrence);
    const points = utterances.map((u) => nodeMap.get(u.id)!);
    const first = points[0].x;
    const last = points.at(-1)!.x;
    return {
      id: occurrence === 1 ? agendaId : `${agendaId}@${utterances[0].id}`,
      agendaId,
      occurrence,
      x: first - 25,
      y: 30,
      width: Math.max(255, last - first + 255),
      height: Math.max(
        MAIN_Y + CARD_HEIGHT + BLOCK_PADDING,
        ...points.map((p) => p.y + CARD_HEIGHT + BLOCK_PADDING),
      ),
      utteranceIds: utterances.map((u) => u.id),
    };
  });
  // Empty agendas remain editable from the list but do not create spurious time spans on the map.
  return { nodes, blocks };
}
