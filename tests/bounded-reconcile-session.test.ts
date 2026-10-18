import { describe, expect, it, vi } from "vitest";
import { sampleProject } from "../src/analysis/sample";
import {
  AnalysisSession,
  makeAnalysisChunks,
  type AnalysisCheckpoint,
} from "../src/analysis/session";
import {
  parseBoundedResult,
  reconcileFixtureCandidates,
  type FixtureCandidate,
} from "../src/analysis/bounded-reconcile";

function fixture(elapsedMs = 0) {
  const project = sampleProject();
  const source = {
    ...project.sources[0],
    text: "あいうえおか",
    hash: "fixture-source",
  };
  project.sources = [source];
  project.utterances = [];
  const chunks = makeAnalysisChunks(project, source.id, 2, 0);
  const candidates: FixtureCandidate[] = chunks.map((chunk, i) => ({
    id: chunk.id,
    evidence: chunk.spans.map(({ sourceId, sourceVersionId, start, end }) => ({
      sourceId,
      sourceVersionId,
      start,
      end,
    })),
    disposition: i === 2 ? "hold" : "relation",
  }));
  let saved: AnalysisCheckpoint | undefined;
  let reconcileResponse: unknown;
  const save = vi.fn(async (checkpoint: AnalysisCheckpoint) => {
    saved = structuredClone(checkpoint);
  });
  const compared: string[] = [];
  const analyzeChunk = vi.fn(async ({ chunk }: { chunk: { id: string } }) =>
    candidates.find((c) => c.id === chunk.id)!,
  );
  const options = {
    sessionId: "bounded-session-integration",
    project,
    sourceId: source.id,
    maxChars: 2,
    overlapChars: 0,
    configId: "bounded-fixture-session-v1",
    checkpointStore: { load: async () => structuredClone(saved), save },
    validateCandidate(value: unknown, chunk: { id: string }) {
      const expected = candidates.find((c) => c.id === chunk.id);
      if (JSON.stringify(value) !== JSON.stringify(expected))
        throw new Error("invalid fixture evidence candidate");
      return value;
    },
    validateReconciled: (value: unknown) =>
      value &&
      typeof value === "object" &&
      (value as Record<string, unknown>).kind !==
        "fixture-bounded-reconciliation"
        ? value
        : parseBoundedResult(value, candidates),
    adapter: {
      analyzeChunk,
      async reconcile({ prior }: { prior: AnalysisCheckpoint }) {
        if (reconcileResponse !== undefined) return reconcileResponse;
        const previous =
          prior.reconciled === undefined
            ? undefined
            : parseBoundedResult(prior.reconciled, candidates);
        return reconcileFixtureCandidates(
          candidates,
          {
            maxCandidates: 10,
            maxComparisons: 1,
            maxRetainedResults: 1,
            maxInputBytes: 100_000,
            maxOutputBytes: 100_000,
            maxElapsedMs: 10,
          },
          {
            cursor: previous?.cursor,
            elapsedMs: () => elapsedMs,
            onCompare: (a, b) => compared.push(`${a.id}|${b.id}`),
          },
        );
      },
    },
  };
  return {
    project,
    candidates,
    options,
    compared,
    analyzeChunk,
    save,
    get: () => saved!,
    set: (value: AnalysisCheckpoint) => {
      saved = value;
    },
    setReconcileResponse: (value: unknown) => {
      reconcileResponse = value;
    },
  };
}

describe("bounded reconciliation through AnalysisSession", () => {
  it("persists partial and resumes exact pair suffix without re-extracting chunks", async () => {
    const f = fixture();
    const original = structuredClone(f.project);
    const pages = [];
    for (let i = 0; i < 3; i++) {
      const session = new AnalysisSession(f.options);
      const result = await session.run();
      pages.push(parseBoundedResult(result.reconciled, f.candidates));
      expect(result.status).toBe(i === 2 ? "complete" : "partial");
      expect(session.status).toBe(result.status);
      expect(f.get().reconciled).toEqual(result.reconciled);
    }
    const ids = f.candidates.map((c) => c.id);
    expect(f.compared).toEqual([
      `${ids[0]}|${ids[1]}`,
      `${ids[0]}|${ids[2]}`,
      `${ids[1]}|${ids[2]}`,
    ]);
    expect(new Set(f.compared).size).toBe(3);
    expect(pages[2].results.map((r) => r.disposition)).toEqual([
      "relation",
      "hold",
      "hold",
    ]);
    expect(pages[0].unexaminedRanges).toEqual([{ start: 1, end: 3 }]);
    expect(pages[2].unexaminedRanges).toEqual([]);
    expect(f.analyzeChunk).toHaveBeenCalledTimes(3);
    await new AnalysisSession(f.options).run();
    expect(f.compared).toHaveLength(3);
    expect(f.project).toEqual(original);
  });

  it.each([
    "unknown-result-id",
    "unknown-cursor-id",
    "invalid-evidence-span",
    "duplicate-results",
    "old-output-schema",
    "invalid-evidence-source-version",
    "out-of-range-evidence-span",
  ])(
    "rejects %s before saving or invoking any adapter and leaves persisted state unchanged",
    async (fault) => {
      const f = fixture();
      await new AnalysisSession(f.options).run();
      const checkpoint = structuredClone(f.get());
      const result = checkpoint.reconciled as Record<string, any>;
      if (fault === "unknown-result-id") result.results[0].leftId = "unknown";
      if (fault === "unknown-cursor-id")
        result.cursor.candidateIds[0] = "unknown";
      if (fault === "invalid-evidence-span")
        (
          checkpoint.candidates[0].value as { evidence: unknown[] }
        ).evidence[0] = {
          sourceId: "unknown",
          sourceVersionId: "old",
          start: -1,
          end: 9999,
        };
      if (fault === "duplicate-results")
        result.results.push(structuredClone(result.results[0]));
      if (fault === "old-output-schema") result.version = 0;
      if (fault === "invalid-evidence-source-version")
        (
          checkpoint.candidates[0].value as { evidence: unknown[] }
        ).evidence[0] = {
          sourceId: f.project.sources[0].id,
          sourceVersionId: "old-version",
          start: 0,
          end: 1,
        };
      if (fault === "out-of-range-evidence-span")
        (
          checkpoint.candidates[0].value as { evidence: unknown[] }
        ).evidence[0] = {
          sourceId: f.project.sources[0].id,
          sourceVersionId: f.project.sources[0].versionId,
          start: 0,
          end: 999,
        };
      f.set(checkpoint);
      const before = structuredClone(f.get());
      const projectBefore = structuredClone(f.project);
      f.save.mockClear();
      f.analyzeChunk.mockClear();
      const comparisonsBefore = [...f.compared];
      await expect(new AnalysisSession(f.options).run()).rejects.toThrow();
      expect(f.save).not.toHaveBeenCalled();
      expect(f.analyzeChunk).not.toHaveBeenCalled();
      expect(f.compared).toEqual(comparisonsBefore);
      expect(f.get()).toEqual(before);
      expect(f.project).toEqual(projectBefore);
    },
  );
});

describe("session page continuity and persisted aggregate", () => {
  it.each(["duplicate-page", "missing-page"])(
    "rejects %s without overwriting the prior aggregate",
    async (fault) => {
      const f = fixture();
      await new AnalysisSession(f.options).run();
      const before = structuredClone(f.get().reconciled);
      const budgets = {
        maxCandidates: 10,
        maxComparisons: 2,
        maxRetainedResults: 10,
        maxInputBytes: 100_000,
        maxOutputBytes: 100_000,
        maxElapsedMs: 10,
      };
      const prefix = reconcileFixtureCandidates(f.candidates, budgets, {
        elapsedMs: () => 0,
      });
      const response =
        fault === "duplicate-page"
          ? prefix
          : reconcileFixtureCandidates(f.candidates, budgets, {
              cursor: prefix.cursor,
              elapsedMs: () => 0,
            });
      const resumed = new AnalysisSession({
        ...f.options,
        adapter: { ...f.options.adapter, reconcile: async () => response },
      });
      await expect(resumed.run()).rejects.toThrow(/gap|start|mismatch/);
      expect(f.get().reconciled).toEqual(before);
    },
  );

  it("rejects a valid suffix page used as a persisted checkpoint before any save", async () => {
    const f = fixture();
    await new AnalysisSession(f.options).run();
    const first = parseBoundedResult(f.get().reconciled, f.candidates);
    const suffix = reconcileFixtureCandidates(
      f.candidates,
      {
        maxCandidates: 10,
        maxComparisons: 1,
        maxRetainedResults: 10,
        maxInputBytes: 100_000,
        maxOutputBytes: 100_000,
        maxElapsedMs: 10,
      },
      { cursor: first.cursor, elapsedMs: () => 0 },
    );
    f.set({ ...f.get(), reconciled: suffix });
    const before = structuredClone(f.get());
    f.save.mockClear();
    await expect(new AnalysisSession(f.options).run()).rejects.toThrow(
      /full aggregate/,
    );
    expect(f.save).not.toHaveBeenCalled();
    expect(f.get()).toEqual(before);
  });

  it("rejects a generic resume page without losing the bounded prefix", async () => {
    const f = fixture(1);
    const session = new AnalysisSession(f.options);
    await session.run();
    const before = structuredClone(f.get());
    const projectBefore = structuredClone(f.project);
    f.setReconcileResponse({ value: "generic-complete" });
    f.save.mockClear();
    await expect(session.resume()).rejects.toThrow(/bounded.*generic/);
    expect(session.status).toBe("failed");
    expect(f.save).not.toHaveBeenCalled();
    expect(f.get()).toEqual(before);
    expect(session).toHaveProperty("checkpoint", before);
    expect(f.project).toEqual(projectBefore);
  });

  it.each(["cursor", "counters", "both"] as const)(
    "rejects %s elapsed rollback while preserving the exact committed state",
    async (which) => {
      const f = fixture(1);
      // Individual-block faults deliberately bypass page self-consistency in
      // the test validator to isolate Session's two independent guards. The
      // both-block exploit keeps the strict parser: this is a valid standalone
      // page which must still be rejected relative to the committed cursor.
      const session = new AnalysisSession({
        ...f.options,
        ...(which === "both"
          ? {}
          : { validateReconciled: (value: unknown) => value }),
      });
      await session.run();
      const first = parseBoundedResult(f.get().reconciled, f.candidates);
      expect(first.cursor.elapsedMs).toBeGreaterThan(0);
      const page = reconcileFixtureCandidates(
        f.candidates,
        {
          maxCandidates: 10,
          maxComparisons: 1,
          maxRetainedResults: 10,
          maxInputBytes: 100_000,
          maxOutputBytes: 100_000,
          maxElapsedMs: 10,
        },
        { cursor: first.cursor, elapsedMs: () => 1 },
      );
      const bad = structuredClone(page) as Record<string, any>;
      if (which !== "counters") bad.cursor.elapsedMs = 0;
      if (which !== "cursor") bad.counters.elapsedMs = 0;
      if (which === "both")
        expect(parseBoundedResult(bad, f.candidates)).toEqual(bad);
      f.setReconcileResponse(bad);
      const before = structuredClone(f.get());
      const projectBefore = structuredClone(f.project);
      f.save.mockClear();
      await expect(session.resume()).rejects.toThrow(/must not regress/);
      expect(session.status).toBe("failed");
      expect(f.save).not.toHaveBeenCalled();
      expect(f.get()).toEqual(before);
      expect(session).toHaveProperty("checkpoint", before);
      expect(f.project).toEqual(projectBefore);
    },
  );

  it.each(
    (
      [
        "candidates",
        "comparisons",
        "retainedResults",
        "inputBytes",
        "outputBytes",
      ] as const
    ).flatMap((field) =>
      (["cursor", "counters"] as const).map((which) => ({ field, which })),
    ),
  )(
    "rejects independently decreased $which.$field before any checkpoint save",
    async ({ which, field }) => {
      const f = fixture(1);
      const session = new AnalysisSession({
        ...f.options,
        validateReconciled: (value: unknown) => value,
      });
      await session.run();
      const first = parseBoundedResult(f.get().reconciled, f.candidates);
      expect(first[which][field]).toBeGreaterThan(0);
      const page = reconcileFixtureCandidates(
        f.candidates,
        {
          maxCandidates: 10,
          maxComparisons: 1,
          maxRetainedResults: 10,
          maxInputBytes: 100_000,
          maxOutputBytes: 100_000,
          maxElapsedMs: 10,
        },
        { cursor: first.cursor, elapsedMs: () => 1 },
      );
      const bad = structuredClone(page) as Record<string, any>;
      bad[which][field] = 0;
      f.setReconcileResponse(bad);
      const before = structuredClone(f.get());
      const projectBefore = structuredClone(f.project);
      f.save.mockClear();
      await expect(session.resume()).rejects.toThrow(/must not regress/);
      expect(session.status).toBe("failed");
      expect(f.save).not.toHaveBeenCalled();
      expect(f.get()).toEqual(before);
      expect(session).toHaveProperty("checkpoint", before);
      expect(f.project).toEqual(projectBefore);
    },
  );
});
