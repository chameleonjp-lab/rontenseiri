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
    const result = projectCanvasState(base, "U01", p.selectedAgendaId);
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
  it("static branch classes cover node and edge membership without changing semantic data", () => {
    const p = sampleProject();
    const base = buildCanvasGraph(p, noop, noop);
    const branchIds = new Set(
      p.utterances
        .filter(
          (u) => u.classification === "derived" || u.classification === "drift",
        )
        .map((u) => u.id),
    );
    for (const node of base.nodes.filter((n) => n.type === "speech")) {
      expect(node.className === "branch-node").toBe(branchIds.has(node.id));
      expect(node.hidden).toBe(false);
      expect(node.data.classification).toBe(
        p.utterances.find((u) => u.id === node.id)!.classification,
      );
    }
    for (const edge of base.edges) {
      expect(edge.className === "branch-edge").toBe(
        edge.data?.kind !== "main" ||
          branchIds.has(edge.source) ||
          branchIds.has(edge.target),
      );
      expect(edge.hidden).toBe(false);
    }
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

it("node and edge identities survive repeated selection projection; folding has no graph input", () => {
  const p = sampleProject();
  const base = buildCanvasGraph(p, noop, noop);
  const folded = projectCanvasState(base, null, p.selectedAgendaId);
  const selected = projectCanvasState(base, "U01", p.selectedAgendaId);
  const again = projectCanvasState(base, null, p.selectedAgendaId);
  expect(selected.edges).toBe(folded.edges);
  expect(again.edges).toBe(folded.edges);
  for (const node of folded.nodes) {
    if (node.type === "speech" && node.id !== "U01")
      expect(selected.nodes.find((n) => n.id === node.id)).toBe(node);
    expect(again.nodes.find((n) => n.id === node.id)).toBe(node);
  }
  const reselected = projectCanvasState(base, "U01", p.selectedAgendaId);
  expect(reselected.nodes.find((n) => n.id === "U01")).toBe(
    selected.nodes.find((n) => n.id === "U01"),
  );
});
