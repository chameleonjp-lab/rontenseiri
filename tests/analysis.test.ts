import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project } from "../src/domain/types";
import {
  MODEL_OPTIONS,
  analyzeLocally,
  applySuggestion,
} from "../src/analysis/client";
import { sampleProject } from "../src/analysis/sample";

const project = (): Project => sampleProject();

afterEach(() => {
  vi.restoreAllMocks();
});

describe("local analysis adapter safety boundaries", () => {
  it("exposes only catalogued candidates and sample preserves exact quotes/offsets", () => {
    expect(MODEL_OPTIONS).toHaveLength(2);
    const sample = project();
    for (const utterance of sample.utterances)
      expect(sample.sources[0].text.slice(utterance.start, utterance.end)).toBe(
        utterance.quote,
      );
    expect(sample.utterances.find((u) => u.id === "U10")?.classification).toBe(
      "main",
    );
  });

  it("rejects unknown model without creating a worker", async () => {
    const worker = vi.fn();
    vi.stubGlobal("Worker", worker);
    await expect(
      analyzeLocally(
        project(),
        "not-a-model",
        vi.fn(),
        new AbortController().signal,
      ),
    ).rejects.toThrow("未登録");
    expect(worker).not.toHaveBeenCalled();
  });

  it.each(["oversized", "empty"] as const)(
    "rejects %s input before creating a model Worker",
    async (mode) => {
      const input = project();
      if (mode === "oversized") input.utterances[0].quote = "あ".repeat(3_001);
      else input.utterances = [];
      const terminate = vi.fn();
      const worker = vi.fn(function () {
        return { terminate, postMessage: vi.fn() };
      });
      vi.stubGlobal("Worker", worker);
      try {
        await expect(
          analyzeLocally(
            input,
            MODEL_OPTIONS[0].id,
            vi.fn(),
            new AbortController().signal,
          ),
        ).rejects.toThrow(
          mode === "oversized"
            ? "モデル入力上限"
            : "解析対象の発言がありません",
        );
        expect(worker).not.toHaveBeenCalled();
        expect(terminate).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it("cleans the model Worker and lease listener before releasing a failed synchronous dispatch", async () => {
    const order: string[] = [];
    const failure = new DOMException("cannot clone payload", "DataCloneError");
    const caller = new AbortController();
    const add = vi.spyOn(AbortSignal.prototype, "addEventListener");
    const remove = vi.spyOn(AbortSignal.prototype, "removeEventListener");
    const terminate = vi.fn(() => order.push("terminated"));
    class FakeWorker {
      onmessage?: (event: MessageEvent) => void;
      onerror?: (event: ErrorEvent) => void;
      terminate = terminate;
      postMessage = vi.fn(() => {
        order.push("dispatch-failed");
        throw failure;
      });
    }
    vi.stubGlobal("Worker", FakeWorker);
    try {
      await expect(
        analyzeLocally(project(), MODEL_OPTIONS[0].id, vi.fn(), caller.signal, {
          lockName: "model-synchronous-dispatch-failure",
          locks: {
            request: async (name, _options, callback) => {
              try {
                await callback({ name } as Lock);
              } finally {
                order.push("released");
              }
            },
          },
        }),
      ).rejects.toBe(failure);
      expect(terminate).toHaveBeenCalledTimes(1);
      expect(order).toEqual(["dispatch-failed", "terminated", "released"]);
      const clientRegistration = add.mock.calls.findIndex(
        ([type], index) =>
          type === "abort" && add.mock.contexts[index] !== caller.signal,
      );
      expect(clientRegistration).toBeGreaterThanOrEqual(0);
      const listener = add.mock.calls[clientRegistration][1];
      const leaseSignal = add.mock.contexts[clientRegistration];
      expect(
        remove.mock.calls.some(
          ([type, removed], index) =>
            type === "abort" &&
            removed === listener &&
            remove.mock.contexts[index] === leaseSignal,
        ),
      ).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("validates mocked output IDs and supports abort termination", async () => {
    let instance: {
      onmessage?: (event: MessageEvent) => void;
      onerror?: (event: ErrorEvent) => void;
      terminate: ReturnType<typeof vi.fn>;
      postMessage: ReturnType<typeof vi.fn>;
    };
    class FakeWorker {
      onmessage?: (event: MessageEvent) => void;
      onerror?: (event: ErrorEvent) => void;
      terminate = vi.fn();
      postMessage = vi.fn(() =>
        setTimeout(
          () =>
            this.onmessage?.({
              data: {
                type: "result",
                suggestion: {
                  agendas: [],
                  classifications: [
                    { utteranceId: "NOPE", classification: "main" },
                  ],
                  relations: [],
                },
              },
            } as MessageEvent),
          0,
        ),
      );
      constructor() {
        instance = this;
      }
    }
    vi.stubGlobal("Worker", FakeWorker);
    await expect(
      analyzeLocally(
        project(),
        MODEL_OPTIONS[0].id,
        vi.fn(),
        new AbortController().signal,
      ),
    ).rejects.toThrow("未知のutterance ID");
    expect(instance!.terminate).toHaveBeenCalled();

    const controller = new AbortController();
    const pending = analyzeLocally(
      project(),
      MODEL_OPTIONS[0].id,
      vi.fn(),
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("lease expiry terminates the model Worker and rejects late progress/results without external fetch", async () => {
    vi.useFakeTimers();
    try {
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
      const progress = vi.fn();
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const pending = analyzeLocally(
        project(),
        MODEL_OPTIONS[0].id,
        progress,
        new AbortController().signal,
        {
          lockName: "model-lease-expiry",
          leaseMs: 10,
          locks: {
            request: async (name, _options, callback) => {
              await callback({ name } as Lock);
            },
          },
        },
      );
      const rejected = expect(pending).rejects.toMatchObject({
        name: "AbortError",
      });
      await vi.advanceTimersByTimeAsync(10);
      await rejected;
      expect(worker.terminate).toHaveBeenCalledTimes(1);
      worker.onmessage?.({
        data: { type: "progress", text: "late" },
      } as MessageEvent);
      worker.onmessage?.({
        data: {
          type: "result",
          suggestion: { agendas: [], classifications: [], relations: [] },
        },
      } as MessageEvent);
      expect(progress).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("does not call fetch from the UI adapter (only the worker may fetch model artifacts)", async () => {
    class FakeWorker {
      onmessage?: (event: MessageEvent) => void;
      onerror?: (event: ErrorEvent) => void;
      terminate = vi.fn();
      postMessage = vi.fn(() =>
        setTimeout(
          () =>
            this.onmessage?.({
              data: {
                type: "result",
                suggestion: { agendas: [], classifications: [], relations: [] },
              },
            } as MessageEvent),
          0,
        ),
      );
    }
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    vi.stubGlobal("Worker", FakeWorker);
    await analyzeLocally(
      project(),
      MODEL_OPTIONS[0].id,
      vi.fn(),
      new AbortController().signal,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("applySuggestion preserves source text and replaces agendas with a complete candidate partition", () => {
    const original = project();
    const result = applySuggestion(
      original,
      {
        agendas: [
          {
            title: "候補",
            utteranceIds: ["U01"],
            arrival: "",
            unresolved: [],
            nextAction: "",
          },
        ],
        classifications: [{ utteranceId: "U01", classification: "main" }],
        relations: [{ from: "U09", to: "U10", kind: "return" }],
      },
      MODEL_OPTIONS[0].id,
    );
    expect(result.sources[0].text).toBe(original.sources[0].text);
    expect(result.agendas).not.toEqual(original.agendas);
    expect(new Set(result.agendas.flatMap((a) => a.utteranceIds)).size).toBe(
      original.utterances.length,
    );
    expect(result.agendas.flatMap((a) => a.utteranceIds)).toHaveLength(
      original.utterances.length,
    );
    expect(result.revisions).toHaveLength(original.revisions.length + 1);
    expect(result.relations.at(-1)?.kind).toBe("return");
    expect(result.runs.at(-1)?.note).toContain("実験的");
  });
});
