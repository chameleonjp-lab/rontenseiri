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
  vi.unstubAllGlobals();
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

  it.each(["oversized", "empty"] as const)(
    "preserves constructor error priority and identity for %s input",
    async (input) => {
      const invalidProject = project();
      invalidProject.utterances =
        input === "empty"
          ? []
          : [
              {
                ...invalidProject.utterances[0],
                quote: "長い発言".repeat(1_000),
              },
            ];
      const constructorError = new Error("Worker constructor failed");
      const worker = vi.fn(function () {
        throw constructorError;
      });
      vi.stubGlobal("Worker", worker);

      await expect(
        analyzeLocally(
          invalidProject,
          MODEL_OPTIONS[0].id,
          vi.fn(),
          new AbortController().signal,
        ),
      ).rejects.toBe(constructorError);
      expect(worker).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ["oversized", "モデル入力上限"],
    ["empty", "解析対象の発言がありません"],
  ] as const)(
    "terminates a worker when %s input validation fails",
    async (input, message) => {
      const invalidProject = project();
      invalidProject.utterances =
        input === "empty"
          ? []
          : [
              {
                ...invalidProject.utterances[0],
                quote: "長い発言".repeat(1_000),
              },
            ];
      const terminate = vi.fn();
      const postMessage = vi.fn();
      const worker = vi.fn(function () {
        return { terminate, postMessage };
      });
      vi.stubGlobal("Worker", worker);

      await expect(
        analyzeLocally(
          invalidProject,
          MODEL_OPTIONS[0].id,
          vi.fn(),
          new AbortController().signal,
        ),
      ).rejects.toThrow(message);
      expect(worker).toHaveBeenCalledOnce();
      expect(terminate).toHaveBeenCalledOnce();
      expect(postMessage).not.toHaveBeenCalled();
    },
  );

  it("preserves the original chunking error identity while terminating the worker", async () => {
    const invalidProject = project();
    const validationError = new Error("original chunking error");
    Object.defineProperty(invalidProject.utterances[0], "quote", {
      get() {
        throw validationError;
      },
    });
    const terminate = vi.fn();
    const postMessage = vi.fn();
    vi.stubGlobal(
      "Worker",
      vi.fn(function () {
        return { terminate, postMessage };
      }),
    );

    await expect(
      analyzeLocally(
        invalidProject,
        MODEL_OPTIONS[0].id,
        vi.fn(),
        new AbortController().signal,
      ),
    ).rejects.toBe(validationError);
    expect(terminate).toHaveBeenCalledOnce();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("terminates a worker when postMessage throws synchronously", async () => {
    let instance: { terminate: ReturnType<typeof vi.fn> };
    const postMessageError = new Error("postMessage failed");
    class FakeWorker {
      terminate = vi.fn();
      postMessage = vi.fn(() => {
        throw postMessageError;
      });
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
    ).rejects.toBe(postMessageError);
    expect(instance!.terminate).toHaveBeenCalledOnce();
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
