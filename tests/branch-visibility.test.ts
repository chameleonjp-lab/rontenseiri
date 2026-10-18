import { describe, it, expect, vi } from "vitest";
import { createBranchVisibilityStore } from "../src/components/BranchVisibility";

describe("branch visibility external store", () => {
  it("has isolated snapshots for independent canvases", () => {
    const a = createBranchVisibilityStore();
    const b = createBranchVisibilityStore(true);
    expect(a.getSnapshot()).toBe(false);
    expect(b.getSnapshot()).toBe(true);
    a.set(true);
    b.set(false);
    expect(a.getSnapshot()).toBe(true);
    expect(b.getSnapshot()).toBe(false);
  });
  it("notifies only actual changes and exposes updated state synchronously", () => {
    const s = createBranchVisibilityStore();
    const values: boolean[] = [];
    s.subscribe(() => values.push(s.getSnapshot()));
    s.set(false);
    s.set(true);
    s.set(true);
    s.set(false);
    s.set(false);
    expect(values).toEqual([true, false]);
  });
  it("unsubscribes without affecting remaining listeners", () => {
    const s = createBranchVisibilityStore();
    const a = vi.fn();
    const b = vi.fn();
    const remove = s.subscribe(a);
    s.subscribe(b);
    s.set(true);
    remove();
    s.set(false);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });
});
