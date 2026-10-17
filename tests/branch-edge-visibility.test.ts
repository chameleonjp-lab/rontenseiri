import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { observeBranchEdgeVisibility } from "../src/components/branch-edge-visibility";

class FakeElement {
  attributes = new Map<string, string>();
  tokens = new Set(["react-flow__edge", "branch-edge"]);
  classList = { contains: (token: string) => this.tokens.has(token) };
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
}
class FakeRoot {
  edges: FakeElement[] = [];
  contains(edge: FakeElement) {
    return this.edges.includes(edge);
  }
  querySelectorAll() {
    return this.edges.filter((edge) => edge.tokens.has("branch-edge"));
  }
}
let notify: (records: unknown[]) => void;
beforeEach(() => {
  vi.stubGlobal("Element", FakeElement);
  vi.stubGlobal(
    "MutationObserver",
    class {
      constructor(callback: (records: unknown[]) => void) {
        notify = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());
const setup = (edge: FakeElement) => {
  const root = new FakeRoot();
  root.edges = [edge];
  const stop = observeBranchEdgeVisibility(
    root as unknown as HTMLElement,
    true,
  );
  return { root, stop };
};
it("restores original ARIA when an edge ceases to be a branch, then follows class/ARIA changes", () => {
  const edge = new FakeElement();
  edge.setAttribute("aria-hidden", "false");
  const { stop } = setup(edge);
  expect(edge.getAttribute("aria-hidden")).toBe("true");
  edge.tokens.delete("branch-edge");
  notify([{ type: "attributes", target: edge }]);
  expect(edge.getAttribute("aria-hidden")).toBe("false");
  edge.tokens.add("branch-edge");
  notify([{ type: "attributes", target: edge }]);
  expect(edge.getAttribute("aria-hidden")).toBe("true");
  edge.setAttribute("aria-hidden", "false");
  notify([{ type: "attributes", target: edge }]);
  expect(edge.getAttribute("aria-hidden")).toBe("true");
  stop();
  expect(edge.getAttribute("aria-hidden")).toBe("false");
});
it("does not overwrite a different writer's value during cleanup", () => {
  const edge = new FakeElement();
  const { stop } = setup(edge);
  edge.setAttribute("aria-hidden", "false");
  stop();
  expect(edge.getAttribute("aria-hidden")).toBe("false");
});
it("restores a removed edge and releases its ownership", () => {
  const edge = new FakeElement();
  const { root, stop } = setup(edge);
  root.edges = [];
  notify([{ type: "childList", target: root }]);
  expect(edge.getAttribute("aria-hidden")).toBeNull();
  edge.setAttribute("aria-hidden", "false");
  stop();
  expect(edge.getAttribute("aria-hidden")).toBe("false");
});
