import { afterEach, expect, it, vi } from "vitest";
import { createWorkerAdapter } from "../src/analysis/local-run";
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
  const transport = createWorkerAdapter("current-owner", "normal", ac.signal);
  const project = sampleProject();
  const chunk = makeAnalysisChunks(project, project.sources[0].id)[0];
  const settled = vi.fn();
  const pending = transport.adapter
    .analyzeChunk({ chunk, prior: {} as AnalysisCheckpoint }, ac.signal)
    .then(settled);
  worker.reply({ owner: "old-owner", requestId: 1, value: { stale: true } });
  worker.reply({
    owner: "current-owner",
    requestId: 999,
    value: { stale: true },
  });
  await Promise.resolve();
  expect(settled).not.toHaveBeenCalled();
  worker.reply({
    owner: "current-owner",
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
  worker.reply({ owner: "current-owner", requestId: 2, value: { late: true } });
  transport.dispose();
});
