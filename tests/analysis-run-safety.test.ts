import { describe, expect, it, vi } from "vitest";
import {
  AnalysisSession,
  type AnalysisAdapter,
  type AnalysisCheckpoint,
  type AnalysisCheckpointStore,
} from "../src/analysis/session";
import { sampleProject } from "../src/analysis/sample";
import {
  fixtureCandidate,
  validateFixtureCandidate,
} from "../src/analysis/fixture-protocol";
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
function setup() {
  let stored: AnalysisCheckpoint | undefined;
  const writes: AnalysisCheckpoint[] = [];
  const store: AnalysisCheckpointStore = {
    load: async () => structuredClone(stored),
    save: async (checkpoint, signal) => {
      if (signal?.aborted) throw new DOMException("aborted", "AbortError");
      stored = structuredClone(checkpoint);
      writes.push(structuredClone(checkpoint));
    },
  };
  const adapter: AnalysisAdapter = {
    analyzeChunk: async ({ chunk }) => fixtureCandidate(chunk),
    reconcile: async ({ candidates }) => ({
      chunkIds: candidates.map((c) => c.chunkId),
    }),
  };
  const opts = {
    sessionId: "owned-run",
    project: sampleProject(),
    maxChars: 160,
    overlapChars: 0,
    configId: "fixture-v1",
    adapter,
    checkpointStore: store,
    validateCandidate: validateFixtureCandidate,
  };
  return {
    opts,
    store,
    writes,
    get: () => structuredClone(stored)!,
    set: (value: AnalysisCheckpoint) => {
      stored = structuredClone(value);
    },
  };
}
describe("P2 scoped run safety (deterministic, not model quality)", () => {
  it("freezes input/configuration at construction, before caller mutations", async () => {
    const f = setup();
    const session = new AnalysisSession(f.opts);
    const original = await session.inputId;
    f.opts.project.sources[0].text = "changed";
    f.opts.project.utterances[0].speaker = "mutated";
    f.opts.maxChars = 999;
    f.opts.configId = "changed";
    const result = await session.run();
    expect(result.checkpoint.inputId).toBe(original);
    expect(result.checkpoint.configId).toContain("fixture-v1");
    expect(result.checkpoint.configId).toContain("160");
  });
  it("resumes exactly k+1 with strict prefix equality and zero duplicated chunks", async () => {
    const f = setup();
    let calls = 0;
    const first = new AnalysisSession({
      ...f.opts,
      adapter: {
        ...f.opts.adapter,
        analyzeChunk: async (input, signal) => {
          if (++calls === 3) throw new Error("stop after k=2");
          return f.opts.adapter.analyzeChunk(input, signal);
        },
      },
    });
    await expect(first.run()).rejects.toThrow("k=2");
    const prefix = f.get().candidates;
    expect(prefix).toHaveLength(2);
    const processed: string[] = [];
    const resumed = new AnalysisSession({
      ...f.opts,
      adapter: {
        ...f.opts.adapter,
        analyzeChunk: async (input, signal) => {
          processed.push(input.chunk.id);
          return f.opts.adapter.analyzeChunk(input, signal);
        },
      },
    });
    const result = await resumed.run();
    expect(processed).toEqual(resumed.chunks.slice(2).map((c) => c.id));
    expect(result.candidates.slice(0, 2)).toEqual(prefix);
    expect(result.candidates.map((c) => c.chunkId)).toEqual(
      resumed.chunks.map((c) => c.id),
    );
    expect(new Set(result.candidates.map((c) => c.chunkId)).size).toBe(
      result.candidates.length,
    );
  });
  it.each([
    "config",
    "input",
    "session",
    "prefix",
    "order",
    "duplicate",
    "value",
    "false-completion",
    "schema-version",
  ])(
    "rejects a nonmatching/corrupt checkpoint (%s) before any adapter call",
    async (kind) => {
      const f = setup();
      await new AnalysisSession(f.opts).run();
      const checkpoint = f.get();
      if (kind === "config") checkpoint.configId = "other";
      if (kind === "schema-version") checkpoint.version = 1;
      if (kind === "input") checkpoint.inputId = "other";
      if (kind === "session") checkpoint.sessionId = "other";
      if (kind === "prefix") checkpoint.nextChunk--;
      if (kind === "order") checkpoint.candidates.reverse();
      if (kind === "duplicate")
        checkpoint.candidates[1].chunkId = checkpoint.candidates[0].chunkId;
      if (kind === "value")
        checkpoint.candidates[0].value = { malicious: true };
      if (kind === "false-completion") {
        checkpoint.phase = "candidates";
      }
      f.set(checkpoint);
      const analyzeChunk = vi.fn(f.opts.adapter.analyzeChunk);
      const session = new AnalysisSession({
        ...f.opts,
        adapter: { ...f.opts.adapter, analyzeChunk },
      });
      await expect(session.run()).rejects.toThrow();
      expect(session.status).toBe("failed");
      expect(analyzeChunk).not.toHaveBeenCalled();
    },
  );
  it("rejects segmentation changes even when source id/version/hash are unchanged", async () => {
    const f = setup();
    await new AnalysisSession(f.opts).run();
    f.opts.project.utterances[0].speaker = "different speaker";
    await expect(new AnalysisSession(f.opts).run()).rejects.toThrow(
      "input/configuration mismatch",
    );
  });
  it("settles cancellation within 3 seconds for an uncooperative adapter and discards its late result after a newer run", async () => {
    const f = setup();
    const started = deferred<void>();
    const late = deferred<unknown>();
    const first = new AnalysisSession({
      ...f.opts,
      adapter: {
        ...f.opts.adapter,
        analyzeChunk: async () => {
          started.resolve();
          return late.promise;
        },
      },
    });
    const pending = first.run();
    await started.promise;
    const began = performance.now();
    first.cancel();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(performance.now() - began).toBeLessThan(3000);
    expect(first.status).toBe("cancelled");
    expect(f.get().nextChunk).toBe(0);
    const next = await new AnalysisSession(f.opts).run();
    const saved = f.get();
    const count = f.writes.length;
    late.resolve({ old: "must not save" });
    await new Promise((r) => setTimeout(r, 0));
    expect(f.writes).toHaveLength(count);
    expect(f.get()).toEqual(saved);
    expect(saved.candidates).toEqual(next.candidates);
  });
  it("a cancelled older invocation cannot overwrite a resumed generation of the same session", async () => {
    const f = setup();
    const started = deferred<void>();
    const late = deferred<unknown>();
    let calls = 0;
    const session = new AnalysisSession({
      ...f.opts,
      adapter: {
        ...f.opts.adapter,
        analyzeChunk: async (input, signal) => {
          if (++calls === 1) {
            started.resolve();
            return late.promise;
          }
          return f.opts.adapter.analyzeChunk(input, signal);
        },
      },
    });
    const first = session.run();
    await started.promise;
    session.cancel();
    const rejected = expect(first).rejects.toMatchObject({
      name: "AbortError",
    });
    const resumed = session.resume();
    await rejected;
    await resumed;
    const saved = f.get();
    late.resolve({ stale: true });
    await new Promise((r) => setTimeout(r, 0));
    expect(session.status).toBe("complete");
    expect(f.get()).toEqual(saved);
  });
  it("cancellation during async checkpoint load cannot be reset by a late load", async () => {
    const f = setup();
    const load = deferred<AnalysisCheckpoint | undefined>();
    const analyzeChunk = vi.fn(f.opts.adapter.analyzeChunk);
    const session = new AnalysisSession({
      ...f.opts,
      adapter: { ...f.opts.adapter, analyzeChunk },
      checkpointStore: { ...f.store, load: () => load.promise },
    });
    const pending = session.run();
    await expect(session.run()).rejects.toThrow("already running");
    session.cancel();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    load.resolve(undefined);
    await new Promise((r) => setTimeout(r, 0));
    expect(analyzeChunk).not.toHaveBeenCalled();
    expect(f.writes).toHaveLength(0);
  });
  it("does not checkpoint an invalid chunk or falsely complete failed reconciliation", async () => {
    const f = setup();
    const invalid = new AnalysisSession({
      ...f.opts,
      adapter: {
        ...f.opts.adapter,
        analyzeChunk: async () => ({ invalid: true }),
      },
    });
    await expect(invalid.run()).rejects.toThrow("検証");
    expect(f.get().candidates).toEqual([]);
    expect(f.get().nextChunk).toBe(0);
    const failed = new AnalysisSession({
      ...f.opts,
      adapter: {
        ...f.opts.adapter,
        reconcile: async () => {
          throw new Error("reconcile failed");
        },
      },
    });
    await expect(failed.run()).rejects.toThrow("reconcile failed");
    expect(failed.status).toBe("failed");
    expect(f.get().reconciled).toBeUndefined();
    const analyzeChunk = vi.fn(f.opts.adapter.analyzeChunk);
    await new AnalysisSession({
      ...f.opts,
      adapter: { ...f.opts.adapter, analyzeChunk },
    }).run();
    expect(analyzeChunk).not.toHaveBeenCalled();
  });
  it("a failed durable write does not advance the in-memory prefix for resume", async () => {
    const f = setup();
    let failOnce = true;
    const processed: string[] = [];
    const session = new AnalysisSession({
      ...f.opts,
      adapter: {
        ...f.opts.adapter,
        analyzeChunk: async (input, signal) => {
          processed.push(input.chunk.id);
          return f.opts.adapter.analyzeChunk(input, signal);
        },
      },
      checkpointStore: {
        ...f.store,
        save: async (checkpoint, signal) => {
          if (failOnce && checkpoint.nextChunk === 1) {
            failOnce = false;
            throw new Error("disk failure");
          }
          await f.store.save(checkpoint, signal);
        },
      },
    });
    await expect(session.run()).rejects.toThrow("disk failure");
    expect(f.get().nextChunk).toBe(0);
    await session.resume();
    expect(processed.slice(0, 2)).toEqual([
      session.chunks[0].id,
      session.chunks[0].id,
    ]);
    expect(f.get().candidates).toHaveLength(session.chunks.length);
  });
  it.each([
    "source-bytes",
    "setting",
    "parser",
    "implementation",
    "output-schema",
  ])(
    "rejects isolated fingerprint change (%s), leaving stored data unchanged",
    async (kind) => {
      const f = setup();
      await new AnalysisSession(f.opts).run();
      const saved = f.get();
      const writes = f.writes.length;
      const next = { ...f.opts, project: structuredClone(f.opts.project) };
      if (kind === "source-bytes")
        next.project.sources[0].text += "原文bytesのみ変更";
      if (kind === "setting") next.maxChars++;
      const versions =
        kind === "parser"
          ? { parserVersion: "parser-next" }
          : kind === "implementation"
            ? { analysisVersion: "implementation-next" }
            : kind === "output-schema"
              ? { outputSchemaVersion: "schema-next" }
              : {};
      await expect(
        new AnalysisSession({ ...next, ...versions }).run(),
      ).rejects.toThrow("mismatch");
      expect(f.get()).toEqual(saved);
      expect(f.writes).toHaveLength(writes);
    },
  );
  it("normalizes all nested run-setting keys while preserving changed values", async () => {
    const f = setup();
    const first = await new AnalysisSession({
      ...f.opts,
      runSettings: { temperature: 0, limits: { retries: 0, tokens: 20 } },
    }).run();
    expect(first.checkpoint.sourceBytesHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.checkpoint.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(first.checkpoint.runId).toBe(f.opts.sessionId);
    expect(first.checkpoint.lastCommittedChunkIndex).toBe(
      first.candidates.length - 1,
    );
    const spy = vi.fn(f.opts.adapter.analyzeChunk);
    await new AnalysisSession({
      ...f.opts,
      runSettings: { limits: { tokens: 20, retries: 0 }, temperature: 0 },
      adapter: { ...f.opts.adapter, analyzeChunk: spy },
    }).run();
    expect(spy).not.toHaveBeenCalled();
    await expect(
      new AnalysisSession({
        ...f.opts,
        runSettings: { limits: { tokens: 21, retries: 0 }, temperature: 0 },
      }).run(),
    ).rejects.toThrow("mismatch");
  });
  it.each(["cursor-only", "result-only", "outside-span"])(
    "rejects fault-injected %s checkpoint without a write",
    async (kind) => {
      const f = setup();
      await new AnalysisSession(f.opts).run();
      const corrupt = f.get();
      if (kind === "cursor-only") {
        corrupt.nextChunk++;
        corrupt.lastCommittedChunkIndex!++;
      }
      if (kind === "result-only")
        corrupt.candidates.push(structuredClone(corrupt.candidates[0]));
      if (kind === "outside-span")
        corrupt.chunkManifest![0].spans[0].end =
          f.opts.project.sources[0].text.length + 1;
      f.set(corrupt);
      const count = f.writes.length;
      await expect(new AnalysisSession(f.opts).run()).rejects.toThrow();
      expect(f.get()).toEqual(corrupt);
      expect(f.writes).toHaveLength(count);
    },
  );
});
