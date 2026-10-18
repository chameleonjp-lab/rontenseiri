import { afterEach, expect, it, vi } from "vitest";
import { createInventoryWorker } from "../src/analysis/inventory-run";
import {
  makeAnalysisChunks,
  type AnalysisCheckpoint,
} from "../src/analysis/session";
import { sampleProject } from "../src/analysis/sample";
afterEach(() => vi.unstubAllGlobals());
it("ignores responses belonging to an older owner/request and terminates pending work on cancel", async () => {
  let worker!: FakeWorker;
  class FakeWorker {
    onmessage?: (event: MessageEvent) => void;
    onerror?: (event: ErrorEvent) => void;
    terminate = vi.fn();
    postMessage = vi.fn();
    constructor() {
      worker = this;
    }
    reply(data: unknown) {
      this.onmessage?.({ data } as MessageEvent);
    }
  }
  vi.stubGlobal("Worker", FakeWorker);
  const ac = new AbortController();
  const transport = createInventoryWorker("run-B", "current-owner", ac.signal);
  const project = sampleProject();
  const chunk = makeAnalysisChunks(project, project.sources[0].id)[0];
  const settled = vi.fn();
  const pending = transport.adapter
    .analyzeChunk({ chunk, prior: {} as AnalysisCheckpoint }, ac.signal)
    .then(settled);
  worker.reply({
    runId: "run-A",
    generationId: "old-owner",
    requestId: 1,
    value: { stale: true },
  });
  worker.reply({
    runId: "run-B",
    generationId: "current-owner",
    requestId: 999,
    value: { stale: true },
  });
  await Promise.resolve();
  expect(settled).not.toHaveBeenCalled();
  worker.reply({
    runId: "run-B",
    generationId: "current-owner",
    requestId: 1,
    value: { current: true },
  });
  await pending;
  expect(settled).toHaveBeenCalledExactlyOnceWith({ current: true });
  const second = transport.adapter.analyzeChunk(
    { chunk, prior: {} as AnalysisCheckpoint },
    ac.signal,
  );
  ac.abort();
  await expect(second).rejects.toMatchObject({ name: "AbortError" });
  expect(worker.terminate).toHaveBeenCalledOnce();
  worker.reply({
    runId: "run-B",
    generationId: "current-owner",
    requestId: 2,
    value: { late: true },
  });
  transport.dispose();
});

it("A cancel → B start → A late message cannot settle or mutate B", async () => {
  const instances: FakeWorker[] = [];
  class FakeWorker {
    onmessage?: (event: MessageEvent) => void;
    onerror?: (event: ErrorEvent) => void;
    terminate = vi.fn();
    postMessage = vi.fn();
    constructor() {
      instances.push(this);
    }
    reply(data: unknown) {
      this.onmessage?.({ data } as MessageEvent);
    }
  }
  vi.stubGlobal("Worker", FakeWorker);
  const project = sampleProject();
  const chunk = makeAnalysisChunks(project, project.sources[0].id)[0];
  const input = { chunk, prior: {} as AnalysisCheckpoint };
  const acA = new AbortController();
  const a = createInventoryWorker("run-A", "generation-A", acA.signal);
  const pendingA = a.adapter.analyzeChunk(input, acA.signal);
  acA.abort();
  await expect(pendingA).rejects.toMatchObject({ name: "AbortError" });
  const acB = new AbortController();
  const b = createInventoryWorker("run-B", "generation-B", acB.signal);
  const settledB = vi.fn();
  const pendingB = b.adapter.analyzeChunk(input, acB.signal).then(settledB);
  const lateA = {
    runId: "run-A",
    generationId: "generation-A",
    requestId: 1,
    value: { stale: true },
  };
  instances[0].reply(lateA);
  instances[1].reply(lateA);
  await Promise.resolve();
  expect(settledB).not.toHaveBeenCalled();
  instances[1].reply({
    runId: "run-B",
    generationId: "generation-B",
    requestId: 1,
    value: { current: true },
  });
  await pendingB;
  expect(settledB).toHaveBeenCalledExactlyOnceWith({ current: true });
  a.dispose();
  b.dispose();
});

it.each(
  ["candidate", "reconcile"].flatMap((phase) =>
    ["runId", "generationId", "requestId"].map((field) => ({ phase, field })),
  ),
)(
  "ignores only-stale $field in $phase without settling the active request",
  async ({ phase, field }) => {
    let worker!: FakeWorker;
    class FakeWorker {
      onmessage?: (event: MessageEvent) => void;
      onerror?: (event: ErrorEvent) => void;
      terminate = vi.fn();
      postMessage = vi.fn();
      constructor() {
        worker = this;
      }
    }
    vi.stubGlobal("Worker", FakeWorker);
    const ac = new AbortController();
    const transport = createInventoryWorker(
      "run-current",
      "generation-current",
      ac.signal,
    );
    const project = sampleProject();
    const chunk = makeAnalysisChunks(project, project.sources[0].id)[0];
    const settled = vi.fn();
    const work =
      phase === "candidate"
        ? transport.adapter.analyzeChunk(
            { chunk, prior: {} as AnalysisCheckpoint },
            ac.signal,
          )
        : transport.adapter.reconcile(
            {
              candidates: [],
              sourceId: chunk.sourceId,
              sourceVersionId: chunk.sourceVersionId,
              prior: {} as AnalysisCheckpoint,
            },
            ac.signal,
          );
    const pending = work.then(settled);
    const valid = {
      runId: "run-current",
      generationId: "generation-current",
      requestId: 1,
      value: { valid: true },
    };
    worker.onmessage?.({
      data: {
        ...valid,
        [field]: field === "requestId" ? 999 : "stale-only-this-field",
      },
    } as MessageEvent);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    worker.onmessage?.({ data: valid } as MessageEvent);
    await pending;
    expect(settled).toHaveBeenCalledExactlyOnceWith(valid.value);
    transport.dispose();
  },
);
