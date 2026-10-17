import { MarkerType } from "@xyflow/react";
import type { Node, Edge } from "@xyflow/react";
import type { Project, Classification } from "../domain/types";
import { labels } from "../domain/types";
import { layoutProject } from "../domain/layout";
import { relationLabel } from "../domain/relation-label";
export type SpeechData = {
  utteranceId: string;
  speaker: string;
  quote: string;
  classification: Classification;
  selected: boolean;
  important: boolean;
  onSelect: (id: string) => void;
  time?: string;
  returning: boolean;
};
export type AgendaData = {
  title: string;
  id: string;
  decision: string;
  count: number;
  candidate: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
  arrival: string;
  needsReview: boolean;
};
const colors = {
  main: "#148489",
  derived: "#8b78d9",
  drift: "#d5a032",
  return: "#148489",
};

export interface CanvasGraph {
  nodes: Node[];
  edges: Edge[];
}
/** Geometry/content only: UI selection and folding must not rebuild this graph. */
export function buildCanvasGraph(
  project: Project,
  onSelect: (id: string) => void,
  onSelectAgenda: (id: string) => void,
): CanvasGraph {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const layout = layoutProject(project);
  const positions = new Map(layout.nodes.map((n) => [n.id, n]));
  const utterances = new Map(project.utterances.map((u) => [u.id, u]));
  const agendas = new Map(project.agendas.map((a) => [a.id, a]));
  const returningIds = new Set(
    project.relations.filter((r) => r.kind === "return").map((r) => r.to),
  );
  for (const block of layout.blocks) {
    const agenda = agendas.get(block.agendaId)!;
    nodes.push({
      id: `agenda-${block.id}`,
      type: "agenda",
      position: { x: block.x, y: block.y },
      data: {
        id: agenda.id,
        title: `${agenda.title}${block.occurrence > 1 ? "（再登場）" : ""}`,
        decision: labels.decision[agenda.decision],
        count: block.utteranceIds.length,
        candidate: agenda.boundary === "candidate",
        selected: false,
        onSelect: onSelectAgenda,
        arrival: agenda.arrival,
        needsReview: agenda.needsReview,
      },
      style: { width: block.width, height: block.height },
      initialWidth: block.width,
      initialHeight: block.height,
      hidden: false,
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: -1,
    });
  }
  for (const position of layout.nodes) {
    const u = utterances.get(position.id)!;
    const returning = returningIds.has(u.id);
    nodes.push({
      id: u.id,
      type: "speech",
      position: { x: position.x, y: position.y },
      hidden: false,
      initialWidth: 225,
      initialHeight: 96,
      data: {
        utteranceId: u.id,
        speaker: u.speaker,
        quote: u.quote,
        classification: u.classification,
        selected: false,
        important: u.important,
        time: u.time,
        onSelect,
        returning,
      },
      draggable: false,
      selectable: false,
      focusable: false,
    });
  }
  for (const relation of project.relations) {
    const color = colors[relation.kind];
    edges.push({
      id: relation.id,
      source: relation.from,
      target: relation.to,
      type: "default",
      animated: false,
      label: relationLabel(
        relation,
        positions.get(relation.from)?.agendaId,
        positions.get(relation.to)?.agendaId,
      ),
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color,
        width: 18,
        height: 18,
      },
      style: {
        stroke: color,
        strokeWidth: relation.kind === "main" ? 3 : 2,
        strokeDasharray: relation.kind === "drift" ? "6 5" : undefined,
      },
      labelStyle: { fill: color, fontSize: 12 },
      labelBgStyle: { fill: "#f6fafb", fillOpacity: 0.95 },
      hidden: false,
      data: { kind: relation.kind },
      focusable: false,
      selectable: false,
    });
  }
  return { nodes, edges };
}
export function isCanvasHidden(item: { className?: string }): boolean {
  return item.className?.split(/\s+/).includes("view-collapsed") ?? false;
}
const foldedGraphs = new WeakMap<CanvasGraph, CanvasGraph>();
const selectedNodes = new WeakMap<Node, Node>();
function foldedGraph(base: CanvasGraph): CanvasGraph {
  let cached = foldedGraphs.get(base);
  if (!cached) {
    const hiddenIds = new Set(
      base.nodes
        .filter(
          (n) =>
            n.type === "speech" &&
            (n.data.classification === "derived" ||
              n.data.classification === "drift"),
        )
        .map((n) => n.id),
    );
    cached = {
      nodes: base.nodes.map((node) =>
        node.type === "speech" &&
        (node.data.classification === "derived" ||
          node.data.classification === "drift")
          ? {
              ...node,
              className: [node.className, "view-collapsed"]
                .filter(Boolean)
                .join(" "),
              style: {
                ...node.style,
                visibility: "hidden",
                pointerEvents: "none",
              },
              domAttributes: {
                ...node.domAttributes,
                "aria-hidden": true,
                inert: true,
              },
            }
          : node,
      ),
      edges: base.edges.map((edge) =>
        edge.data?.kind !== "main" ||
        hiddenIds.has(edge.source) ||
        hiddenIds.has(edge.target)
          ? {
              ...edge,
              className: [edge.className, "view-collapsed"]
                .filter(Boolean)
                .join(" "),
              domAttributes: { ...edge.domAttributes, "aria-hidden": true },
            }
          : edge,
      ),
    };
    foldedGraphs.set(base, cached);
  }
  return cached;
}
/** Cache immutable folded and selected variants; unrelated selection never replaces hidden edges. */
export function projectCanvasState(
  base: CanvasGraph,
  selectedId: string | null,
  selectedAgendaId: string,
  collapsed: boolean,
): CanvasGraph {
  const state = collapsed ? foldedGraph(base) : base;
  return {
    nodes: state.nodes.map((node) => {
      const selected =
        node.type === "speech"
          ? node.id === selectedId
          : node.data.id === selectedAgendaId;
      if (!selected) return node;
      let cached = selectedNodes.get(node);
      if (!cached) {
        cached = { ...node, data: { ...node.data, selected: true } };
        selectedNodes.set(node, cached);
      }
      return cached;
    }),
    edges: state.edges,
  };
}
