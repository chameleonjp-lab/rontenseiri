import { describe, expect, it } from "vitest";
import { sampleProject } from "../src/analysis/sample";
import { layoutProject } from "../src/domain/layout";
import {
  buildCanvasGraph,
  projectCanvasState,
} from "../src/components/canvas-model";
const noop = () => {};
describe("canvas geometry and UI state separation", () => {
  it("selection reuses all nonselected speech node/data and every edge", () => {
    const p = sampleProject();
    const base = buildCanvasGraph(p, noop, noop);
    const result = projectCanvasState(base, "U01", p.selectedAgendaId, false);
    expect(result.edges).toBe(base.edges);
    for (const node of base.nodes.filter((n) => n.type === "speech")) {
      const rendered = result.nodes.find((n) => n.id === node.id)!;
      expect(rendered.position).toBe(node.position);
      if (node.id === "U01") {
        expect(rendered.data.selected).toBe(true);
        expect(rendered).not.toBe(node);
      } else {
        expect(rendered).toBe(node);
        expect(rendered.data).toBe(node.data);
      }
      expect(node.data.selected).toBe(false);
    }
  });
  it("folding changes only branch visibility, retaining data and coordinates", () => {
    const p = sampleProject();
    const base = buildCanvasGraph(p, noop, noop);
    const folded = projectCanvasState(base, null, p.selectedAgendaId, true);
    for (const node of base.nodes.filter((n) => n.type === "speech")) {
      const rendered = folded.nodes.find((n) => n.id === node.id)!;
      const branch =
        node.data.classification === "derived" ||
        node.data.classification === "drift";
      expect(rendered.className === "view-collapsed").toBe(branch);
      expect(rendered.hidden).toBe(false);
      if (branch) {
        expect(rendered.domAttributes?.["aria-hidden"]).toBe(true);
        expect(rendered.domAttributes?.inert).toBe(true);
      }
      expect(rendered.data).toBe(node.data);
      expect(rendered.position).toBe(node.position);
      if (!branch) expect(rendered).toBe(node);
      expect(node.hidden).toBe(false);
    }
    for (const edge of base.edges) {
      const rendered = folded.edges.find((e) => e.id === edge.id)!;
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
      const hidden =
        edge.data?.kind !== "main" ||
        hiddenIds.has(edge.source) ||
        hiddenIds.has(edge.target);
      expect(rendered.className === "view-collapsed").toBe(hidden);
      if (!hidden) expect(rendered).toBe(edge);
    }
    const expanded = projectCanvasState(base, null, p.selectedAgendaId, false);
    expect(expanded.edges).toBe(base.edges);
    expect(expanded.nodes.filter((n) => n.type === "speech")).toEqual(
      base.nodes.filter((n) => n.type === "speech"),
    );
  });
  it("geometry stays identical to canonical chronological layout and content edits rebuild data", () => {
    const p = sampleProject();
    const base = buildCanvasGraph(p, noop, noop);
    for (const position of layoutProject(p).nodes) {
      const node = base.nodes.find((n) => n.id === position.id)!;
      expect(node.position).toEqual({ x: position.x, y: position.y });
      expect([node.initialWidth, node.initialHeight]).toEqual([225, 96]);
    }
    const edited = structuredClone(p);
    edited.utterances[0].quote = "訂正された表示";
    const next = buildCanvasGraph(edited, noop, noop);
    expect(
      next.nodes.find((n) => n.id === edited.utterances[0].id)!.data.quote,
    ).toBe("訂正された表示");
    expect(
      base.nodes.find((n) => n.id === edited.utterances[0].id)!.data.quote,
    ).toBe(p.utterances[0].quote);
  });
});

it("folded edge/node identities survive unrelated selection and repeated folding", () => {
  const p = sampleProject();
  const base = buildCanvasGraph(p, noop, noop);
  const folded = projectCanvasState(base, null, p.selectedAgendaId, true);
  const selected = projectCanvasState(base, "U01", p.selectedAgendaId, true);
  const again = projectCanvasState(base, null, p.selectedAgendaId, true);
  expect(selected.edges).toBe(folded.edges);
  expect(again.edges).toBe(folded.edges);
  for (const node of folded.nodes) {
    if (node.type === "speech" && node.id !== "U01")
      expect(selected.nodes.find((n) => n.id === node.id)).toBe(node);
    expect(again.nodes.find((n) => n.id === node.id)).toBe(node);
  }
  const reselected = projectCanvasState(base, "U01", p.selectedAgendaId, true);
  expect(reselected.nodes.find((n) => n.id === "U01")).toBe(
    selected.nodes.find((n) => n.id === "U01"),
  );
});
