import { describe, expect, it } from "vitest";
import {
  BOUNDED_RECONCILIATION_LIMITS,
  parseBoundedResult,
  reconcileFixtureCandidates,
  type FixtureCandidate,
} from "../src/analysis/bounded-reconcile";
import type { Project } from "../src/domain/types";
import {
  createAnalysisSession,
  type AnalysisAdapter,
  type AnalysisCheckpoint,
} from "../src/analysis/session";

const makeProject = (): Project => ({
  schemaVersion: 1,
  id: "partial-fixture",
  title: "partial fixture",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  extent: "full",
  sources: [
    {
      id: "conversation",
      versionId: "conversation-v1",
      name: "conversation",
      text: "一二三四五六七八九十",
      role: "conversation",
      format: "txt",
      createdAt: "2026-01-01T00:00:00.000Z",
      warnings: [],
      hash: "partial-hash",
    },
  ],
  utterances: [
    {
      id: "u1",
      sourceId: "conversation",
      sourceVersionId: "conversation-v1",
      start: 0,
      end: 10,
      quote: "一二三四五六七八九十",
      speaker: "A",
      order: 0,
      line: 1,
      classification: "unknown",
      coverage: "unorganized",
      important: false,
    },
  ],
  agendas: [],
  relations: [],
  revisions: [],
  runs: [],
  selectedAgendaId: "",
  saved: false,
});

class Store {
  saved: AnalysisCheckpoint[] = [];
  async load(id: string) {
    return [...this.saved].reverse().find((item) => item.sessionId === id);
  }
  async save(value: AnalysisCheckpoint) {
    this.saved.push(structuredClone(value));
  }
}

const adapterFor = (
  reconcile: AnalysisAdapter["reconcile"],
  calls: string[] = [],
): AnalysisAdapter => ({
  async analyzeChunk({ chunk }) {
    return { chunkId: chunk.id };
  },
  async reconcile(input, signal) {
    calls.push(JSON.stringify(input.prior.reconciled ?? null));
    return reconcile(input, signal);
  },
});
const fixtureCandidates: FixtureCandidate[] = ["a", "b"].map((id, i) => ({
  id,
  disposition: "relation",
  evidence: [
    {
      sourceId: "conversation",
      sourceVersionId: "conversation-v1",
      start: i,
      end: i + 1,
    },
  ],
}));
const explicit = (status: "complete" | "partial") =>
  reconcileFixtureCandidates(
    fixtureCandidates,
    {
      ...BOUNDED_RECONCILIATION_LIMITS,
      maxComparisons: status === "partial" ? 0 : 99,
    },
    { elapsedMs: () => 0 },
  );

const options = (store: Store, adapter: AnalysisAdapter) => ({
  sessionId: "partial-session",
  project: makeProject(),
  maxChars: 5,
  overlapChars: 0,
  adapter,
  checkpointStore: store,
  validateReconciled: (value: unknown) =>
    parseBoundedResult(value, fixtureCandidates),
});

describe("analysis session explicit partial reconciliation", () => {
  it("returns partial and persists the explicit result", async () => {
    const store = new Store();
    const result = await createAnalysisSession(
      options(
        store,
        adapterFor(async () => explicit("partial")),
      ),
    ).run();
    expect(result.status).toBe("partial");
    expect(result.checkpoint.reconciled).toMatchObject({ status: "partial" });
  });

  it("resumes a persisted partial through prior without duplicating candidates", async () => {
    const store = new Store();
    let attempt = 0;
    const first = createAnalysisSession(
      options(
        store,
        adapterFor(async () => explicit("partial")),
      ),
    );
    await first.run();
    const candidateSaveCount = store.saved.filter(
      (item) => item.nextChunk > 0,
    ).length;
    const calls: string[] = [];
    const resumed = createAnalysisSession(
      options(
        store,
        adapterFor(async (input) => {
          expect(input.prior.reconciled).toMatchObject({ status: "partial" });
          attempt++;
          return explicit("complete");
        }, calls),
      ),
    );
    const result = await resumed.resume();
    expect(result.status).toBe("complete");
    expect(result.candidates).toHaveLength(resumed.chunks.length);
    expect(result.candidates.map((item) => item.chunkId)).toEqual([
      ...new Set(result.candidates.map((item) => item.chunkId)),
    ]);
    expect(candidateSaveCount).toBeGreaterThan(0);
    expect(calls).toHaveLength(1);
  });

  it("rejects malformed persisted explicit results before saving", async () => {
    const store = new Store();
    const session = createAnalysisSession(
      options(
        store,
        adapterFor(async () => explicit("complete")),
      ),
    );
    await session.run();
    const valid = structuredClone(store.saved.at(-1)!);
    valid.reconciled = {
      kind: "fixture-bounded-reconciliation",
      version: 1,
      status: "unknown",
    };
    store.saved = [];
    const bad = createAnalysisSession({
      ...options(
        store,
        adapterFor(async () => explicit("complete")),
      ),
      initialCheckpoint: valid,
    });
    await expect(bad.run()).rejects.toThrow(/status/);
    expect(store.saved).toHaveLength(0);
  });

  it("keeps generic status fields backward-compatible as complete", async () => {
    const result = await createAnalysisSession({
      ...options(
        new Store(),
        adapterFor(async () => ({ count: 1, value: 1 })),
      ),
      validateReconciled: undefined,
    }).run();
    expect(result.status).toBe("complete");
  });

  it("rejects an unmarked generic partial result", async () => {
    await expect(
      createAnalysisSession({
        ...options(
          new Store(),
          adapterFor(async () => ({ status: "partial", value: 1 })),
        ),
      }).run(),
    ).rejects.toThrow(/generic.*partial/);
  });

  it("requires a validator for the bounded marker", async () => {
    const { validateReconciled: _ignored, ...withoutValidator } = options(
      new Store(),
      adapterFor(async () => explicit("complete")),
    );
    await expect(createAnalysisSession(withoutValidator).run()).rejects.toThrow(
      /requires validateReconciled/,
    );
  });

  it("rejects a validator that strips the bounded status", async () => {
    await expect(
      createAnalysisSession({
        ...options(
          new Store(),
          adapterFor(async () => explicit("partial")),
        ),
        validateReconciled: () => ({ payload: "fixture" }),
      }).run(),
    ).rejects.toThrow(/changed fixture result discriminant/);
  });
});
