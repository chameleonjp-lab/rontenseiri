import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleProject } from "../src/analysis/sample";
import {
  AnalysisSession,
  type AnalysisCheckpoint,
  type AnalysisChunk,
} from "../src/analysis/session";
import {
  reconcileFixtureCandidates,
  parseBoundedResult,
} from "../src/analysis/bounded-reconcile";
import { createInventoryWorker } from "../src/analysis/inventory-run";
import {
  inventoryManifest,
  INVENTORY_CHARS,
  INVENTORY_LIMITS,
  spanCandidate,
  validateSpanCandidate,
  parseInventoryResult,
  parseInventoryPage,
} from "../src/analysis/span-inventory";

afterEach(() => vi.unstubAllGlobals());
function replyingWorker(value: unknown) {
  class WorkerFixture {
    onmessage?: (e: MessageEvent) => void;
    onerror?: (e: ErrorEvent) => void;
    terminate = vi.fn();
    postMessage(message: {
      runId: string;
      generationId: string;
      requestId: number;
    }) {
      queueMicrotask(() =>
        this.onmessage?.({
          data: {
            runId: message.runId,
            generationId: message.generationId,
            requestId: message.requestId,
            value,
          },
        } as MessageEvent),
      );
    }
  }
  vi.stubGlobal("Worker", WorkerFixture);
}
const nineLimits = {
  ...INVENTORY_LIMITS,
  maxComparisons: 9,
  maxRetainedResults: 9,
};

describe("incoming inventory page cap, distinct from cumulative aggregate", () => {
  it("rejects a generic-valid 9-item first page before any downstream save/record mutation", async () => {
    const project = sampleProject();
    const { candidates } = inventoryManifest(project);
    const page = reconcileFixtureCandidates(candidates, nineLimits, {
      elapsedMs: 0,
    });
    expect(page.results).toHaveLength(9);
    expect(parseBoundedResult(page, candidates)).toEqual(page); // generic bounds accept this malicious page
    replyingWorker(page);
    const controller = new AbortController();
    const worker = createInventoryWorker(
      "run",
      "generation",
      controller.signal,
    );
    const record = {
      state: "running",
      checkpoint: { reconciled: undefined as unknown },
    };
    const before = structuredClone(record);
    const save = vi.fn((value: unknown) => {
      record.checkpoint.reconciled = value;
    });
    await expect(
      worker.adapter
        .reconcile(
          {
            candidates: candidates.map((value) => ({
              chunkId: value.id,
              value,
            })),
            sourceId: project.sources[0].id,
            sourceVersionId: project.sources[0].versionId,
            prior: { reconciled: undefined } as AnalysisCheckpoint,
          },
          controller.signal,
        )
        .then(save),
    ).rejects.toThrow(/8ペア/);
    expect(save).not.toHaveBeenCalled();
    expect(record).toEqual(before);
    worker.dispose();
  });
  it("rejects a 9-item resumed suffix with valid identity/counters/bytes/range before Session checkpoint save", async () => {
    const project = sampleProject();
    const { candidates } = inventoryManifest(project);
    const projectBefore = structuredClone(project);
    const record: { checkpoint?: AnalysisCheckpoint } = {};
    const save = vi.fn(async (checkpoint: AnalysisCheckpoint) => {
      record.checkpoint = structuredClone(checkpoint);
    });
    const options = {
      sessionId: "page-cap-run",
      project,
      maxChars: INVENTORY_CHARS,
      overlapChars: 0,
      configId: "page-cap-regression-v1",
      checkpointStore: {
        load: async () => structuredClone(record.checkpoint),
        save,
      },
      validateCandidate: validateSpanCandidate,
      validateReconciled: (value: unknown) =>
        parseInventoryResult(value, candidates),
      adapter: {
        analyzeChunk: async ({ chunk }: { chunk: AnalysisChunk }) =>
          spanCandidate(chunk),
        reconcile: async () =>
          reconcileFixtureCandidates(candidates, INVENTORY_LIMITS, {
            elapsedMs: 0,
          }),
      },
    };
    await new AnalysisSession(options).run();
    const prefix = parseInventoryResult(
      record.checkpoint!.reconciled,
      candidates,
    );
    expect(prefix.results).toHaveLength(8);
    const bad = reconcileFixtureCandidates(candidates, nineLimits, {
      cursor: prefix.cursor,
      elapsedMs: 0,
    });
    expect(bad.pageStartPairIndex).toBe(8);
    expect(bad.cursor.nextPairIndex).toBe(17);
    expect(bad.results).toHaveLength(9);
    expect(parseBoundedResult(bad, candidates)).toEqual(bad);
    replyingWorker(bad);
    const controller = new AbortController();
    const worker = createInventoryWorker(
      "page-cap-run",
      "fresh-generation",
      controller.signal,
    );
    const before = structuredClone(record);
    save.mockClear();
    const session = new AnalysisSession({
      ...options,
      generationId: "fresh-generation",
      adapter: { ...options.adapter, reconcile: worker.adapter.reconcile },
    });
    await expect(session.run()).rejects.toThrow(/8ペア/);
    expect(save).not.toHaveBeenCalled();
    expect(record).toEqual(before);
    expect(record.checkpoint!.reconciled).toEqual(prefix);
    expect(project).toEqual(projectBefore);
    worker.dispose();
  });
  it("accepts each valid 8-item page and a retained aggregate exceeding 8 without truncation", () => {
    const { candidates } = inventoryManifest(sampleProject());
    const first = reconcileFixtureCandidates(candidates, INVENTORY_LIMITS, {
      elapsedMs: 0,
    });
    const second = reconcileFixtureCandidates(candidates, INVENTORY_LIMITS, {
      cursor: first.cursor,
      elapsedMs: 0,
    });
    expect(parseInventoryPage(first, candidates)).toEqual(first);
    expect(parseInventoryPage(second, candidates)).toEqual(second);
    const aggregate = {
      ...second,
      pageStartPairIndex: 0,
      results: [...first.results, ...second.results],
    };
    expect(aggregate.results).toHaveLength(16);
    expect(parseInventoryResult(aggregate, candidates)).toEqual(aggregate);
  });
});
