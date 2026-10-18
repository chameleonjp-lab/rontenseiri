import { describe, expect, it, vi } from "vitest";
import type { Project } from "../src/domain/types";
import {
  AnalysisSession,
  createAnalysisSession,
  makeAnalysisChunks,
  type AnalysisAdapter,
  type AnalysisCheckpoint,
} from "../src/analysis/session";
import { applySuggestion, MODEL_OPTIONS } from "../src/analysis/client";
import { sampleProject } from "../src/analysis/sample";

const project = (): Project => {
  const text = "会話本文A。会話本文B。";
  const referenceText = "参考資料だけの文。";
  return {
    schemaVersion: 1,
    id: "fixture-project",
    title: "fixture",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    extent: "full",
    sources: [
      {
        id: "conversation",
        versionId: "conversation-v1",
        name: "conversation",
        text,
        role: "conversation",
        format: "txt",
        createdAt: "2026-01-01T00:00:00.000Z",
        warnings: [],
        hash: "conversation-hash",
      },
      {
        id: "reference",
        versionId: "reference-v1",
        name: "reference",
        text: referenceText,
        role: "reference",
        format: "txt",
        createdAt: "2026-01-01T00:00:00.000Z",
        warnings: [],
        hash: "reference-hash",
      },
    ],
    utterances: [
      {
        id: "u1",
        sourceId: "conversation",
        sourceVersionId: "conversation-v1",
        start: 0,
        end: 6,
        quote: "会話本文A。",
        speaker: "A",
        order: 0,
        line: 1,
        classification: "unknown",
        coverage: "unorganized",
        important: false,
      },
      {
        id: "u2",
        sourceId: "conversation",
        sourceVersionId: "conversation-v1",
        start: 6,
        end: text.length,
        quote: "会話本文B。",
        speaker: "B",
        order: 1,
        line: 2,
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
  };
};

class Store {
  saved: AnalysisCheckpoint[] = [];
  async load(id: string) {
    return this.saved.find((x) => x.sessionId === id);
  }
  async save(value: AnalysisCheckpoint) {
    this.saved.push(structuredClone(value));
  }
}
const adapter = (calls: string[] = [], delay = 0): AnalysisAdapter => ({
  async analyzeChunk({ chunk }, signal) {
    calls.push(chunk.sourceId);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, delay);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new DOMException("aborted", "AbortError"));
        },
        { once: true },
      );
    });
    return { text: chunk.text };
  },
  async reconcile({ candidates, sourceId }, signal) {
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    return { sourceId, count: candidates.length };
  },
});

describe("analysis session fixture adapter boundaries", () => {
  it("keeps candidate and reconcile phases separate and checkpoints after each chunk", async () => {
    const store = new Store();
    const calls: string[] = [];
    const session = createAnalysisSession({
      sessionId: "s1",
      project: project(),
      maxChars: 8,
      overlapChars: 0,
      adapter: adapter(calls),
      checkpointStore: store,
      manualCorrectionIds: ["manual-1"],
    });
    const result = await session.run();
    expect(result.status).toBe("complete");
    expect(result.checkpoint.phase).toBe("reconcile");
    expect(result.checkpoint.nextChunk).toBe(session.chunks.length);
    expect(result.checkpoint.manualCorrectionIds).toEqual(["manual-1"]);
    expect(result.reconciled).toEqual({
      sourceId: "conversation",
      count: session.chunks.length,
    });
    expect(calls.every((id) => id === "conversation")).toBe(true);
    expect(store.saved.at(-1)?.reconciled).toEqual(result.reconciled);
  });

  it("stops on an adapter failure, then resumes from the saved checkpoint", async () => {
    const store = new Store();
    let attempts = 0;
    const failing: AnalysisAdapter = {
      ...adapter([], 0),
      async analyzeChunk(input, signal) {
        attempts++;
        if (attempts === 2) throw new Error("fixture failure");
        return adapter([], 0).analyzeChunk(input, signal);
      },
    };
    const first = createAnalysisSession({
      sessionId: "s2",
      project: project(),
      maxChars: 8,
      overlapChars: 0,
      adapter: failing,
      checkpointStore: store,
    });
    await expect(first.run()).rejects.toThrow("fixture failure");
    expect(first.status).toBe("failed");
    const resumed = createAnalysisSession({
      sessionId: "s2",
      project: project(),
      maxChars: 8,
      overlapChars: 0,
      adapter: adapter(),
      checkpointStore: store,
    });
    const result = await resumed.resume();
    expect(result.status).toBe("complete");
    expect(result.candidates.length).toBe(resumed.chunks.length);
    expect(
      store.saved.filter((x) => x.sessionId === "s2").at(-1)?.nextChunk,
    ).toBe(resumed.chunks.length);
  });

  it("cancels delayed work without accepting its late response and can resume", async () => {
    const store = new Store();
    const session = createAnalysisSession({
      sessionId: "s3",
      project: project(),
      maxChars: 8,
      overlapChars: 0,
      adapter: adapter([], 30),
      checkpointStore: store,
    });
    const pending = session.run();
    await new Promise((resolve) => setTimeout(resolve, 2));
    session.cancel();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(session.status).toBe("cancelled");
    expect(store.saved.at(-1)?.candidates ?? []).toHaveLength(0);
    expect((await session.resume()).status).toBe("complete");
  });

  it("rejects a checkpoint from an older source version before invoking the adapter", async () => {
    const spy = vi.fn(adapter().analyzeChunk);
    const old: AnalysisCheckpoint = {
      version: 1,
      sessionId: "old",
      sourceId: "conversation",
      sourceVersionId: "conversation-v0",
      sourceHash: "old",
      phase: "candidates",
      nextChunk: 0,
      candidates: [],
      reconciled: undefined,
      terms: [],
      questions: [],
      answers: [],
      relations: [],
      manualCorrectionIds: [],
      updatedAt: new Date().toISOString(),
    };
    const session = new AnalysisSession({
      project: project(),
      initialCheckpoint: old,
      adapter: { analyzeChunk: spy, reconcile: adapter().reconcile },
    });
    await expect(session.run()).rejects.toThrow("older source version");
    expect(spy).not.toHaveBeenCalled();
  });

  it("processes exactly one selected source and never mixes conversation with reference material", async () => {
    const calls: string[] = [];
    const selected = createAnalysisSession({
      project: project(),
      sourceId: "reference",
      adapter: adapter(calls),
      maxChars: 100,
      overlapChars: 0,
    });
    const result = await selected.run();
    expect(result.sourceId).toBe("reference");
    expect(calls).toEqual(["reference"]);
    expect(
      makeAnalysisChunks(project(), "conversation").every(
        (chunk) => chunk.sourceId === "conversation",
      ),
    ).toBe(true);
  });

  it("preserves manual corrections instead of applying a candidate automatically", () => {
    const original = sampleProject();
    const withManual = {
      ...original,
      revisions: [
        {
          id: "r",
          at: "2026-01-01",
          targetId: "u1",
          kind: "user-revision",
          before: {},
          after: {},
          reason: "manual",
        },
      ],
    };
    expect(() =>
      applySuggestion(
        withManual,
        { agendas: [], classifications: [], relations: [] },
        MODEL_OPTIONS[0].id,
      ),
    ).toThrow("訂正後");
  });
});
