import type { Project } from "../domain/types";

export type AnalysisPhase = "candidates" | "reconcile";
export type SessionStatus =
  "idle" | "running" | "paused" | "complete" | "cancelled" | "failed";

export interface SourceSpan {
  sourceId: string;
  sourceVersionId: string;
  start: number;
  end: number;
  text: string;
  utteranceId?: string;
}
export interface AnalysisChunk {
  id: string;
  sourceId: string;
  sourceVersionId: string;
  spans: SourceSpan[];
  text: string;
}
export interface AnalysisCandidate {
  chunkId: string;
  value: unknown;
}
export interface AnalysisCheckpoint {
  version: 1;
  sessionId: string;
  configId?: string;
  inputId?: string;
  sourceId: string;
  sourceVersionId: string;
  sourceHash: string;
  phase: AnalysisPhase;
  nextChunk: number;
  candidates: AnalysisCandidate[];
  reconciled: unknown;
  terms: unknown[];
  questions: unknown[];
  answers: unknown[];
  relations: unknown[];
  manualCorrectionIds: string[];
  updatedAt: string;
}
export interface AnalysisCheckpointStore {
  load(sessionId: string): Promise<AnalysisCheckpoint | undefined>;
  save(checkpoint: AnalysisCheckpoint, signal?: AbortSignal): Promise<void>;
  clear?(sessionId: string): Promise<void>;
}
export interface CandidateInput {
  chunk: AnalysisChunk;
  prior: AnalysisCheckpoint;
}
export interface ReconcileInput {
  candidates: AnalysisCandidate[];
  sourceId: string;
  sourceVersionId: string;
  prior: AnalysisCheckpoint;
}
export interface AnalysisAdapter {
  analyzeChunk(input: CandidateInput, signal: AbortSignal): Promise<unknown>;
  reconcile(input: ReconcileInput, signal: AbortSignal): Promise<unknown>;
}
export interface AnalysisSessionOptions {
  sessionId?: string;
  project: Project;
  sourceId?: string;
  maxChars?: number;
  overlapChars?: number;
  adapter: AnalysisAdapter;
  checkpointStore?: AnalysisCheckpointStore;
  initialCheckpoint?: AnalysisCheckpoint;
  manualCorrectionIds?: Iterable<string>;
  configId?: string;
  validateCandidate?: (value: unknown, chunk: AnalysisChunk) => unknown;
  validateReconciled?: (value: unknown) => unknown;
  onProgress?: (event: {
    phase: AnalysisPhase;
    completed: number;
    total: number;
  }) => void;
}
export interface AnalysisSessionResult {
  status: "complete";
  sourceId: string;
  sourceVersionId: string;
  candidates: AnalysisCandidate[];
  reconciled: unknown;
  checkpoint: AnalysisCheckpoint;
}

const now = () => new Date().toISOString();
const abortError = () =>
  new DOMException("分析がキャンセルされました", "AbortError");
function check(signal: AbortSignal) {
  if (signal.aborted) throw abortError();
}

export function makeAnalysisChunks(
  project: Project,
  sourceId: string,
  maxChars = 3000,
  overlapChars = 200,
): AnalysisChunk[] {
  if (
    !Number.isInteger(maxChars) ||
    maxChars < 1 ||
    overlapChars < 0 ||
    overlapChars >= maxChars
  )
    throw new Error("invalid chunk limits");
  const source = project.sources.find((s) => s.id === sourceId);
  if (!source) throw new Error(`source not found: ${sourceId}`);
  const utterances = project.utterances
    .filter(
      (u) => u.sourceId === sourceId && u.sourceVersionId === source.versionId,
    )
    .sort((a, b) => a.start - b.start);
  const spans: SourceSpan[] = [];
  for (const u of utterances) {
    const start = Math.max(0, u.start),
      end = Math.min(source.text.length, u.end);
    if (end <= start) continue;
    for (let p = start; p < end; p += maxChars) {
      const e = Math.min(end, p + maxChars);
      spans.push({
        sourceId,
        sourceVersionId: source.versionId,
        start: p,
        end: e,
        text: source.text.slice(p, e),
        utteranceId: u.id,
      });
    }
  }
  // Include text that has not been segmented into an utterance; never silently drop source evidence.
  if (!spans.length && source.text.length) {
    for (let p = 0; p < source.text.length; p += maxChars)
      spans.push({
        sourceId,
        sourceVersionId: source.versionId,
        start: p,
        end: Math.min(source.text.length, p + maxChars),
        text: source.text.slice(p, Math.min(source.text.length, p + maxChars)),
      });
  }
  const chunks: AnalysisChunk[] = [];
  for (let i = 0; i < spans.length; i++) {
    const first = spans[i];
    const group: SourceSpan[] = [first];
    let end = first.end;
    for (
      let j = i + 1;
      j < spans.length &&
      spans[j].start <= end &&
      spans[j].end - first.start <= maxChars;
      j++
    ) {
      group.push(spans[j]);
      end = Math.max(end, spans[j].end);
    }
    const text = group.map((s) => s.text).join("");
    chunks.push({
      id: `${source.id}:${source.versionId}:${i}`,
      sourceId,
      sourceVersionId: source.versionId,
      spans: group,
      text,
    });
    while (i + 1 < spans.length && spans[i + 1].start < end - overlapChars) i++;
  }
  return chunks;
}

/** Await cancellation even when an adapter ignores its signal. Late settlement is observed, not accepted. */
function cancellable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
function jsonValue(value: unknown): unknown {
  const text = JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === "number" && !Number.isFinite(item))
      throw new Error("invalid result number");
    if (
      typeof item === "function" ||
      typeof item === "symbol" ||
      typeof item === "bigint"
    )
      throw new Error("invalid result value");
    return item;
  });
  if (!text || value === null || typeof value !== "object")
    throw new Error("invalid result object");
  return JSON.parse(text);
}
export class AnalysisSession {
  readonly id: string;
  readonly chunks: AnalysisChunk[];
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly configId: string;
  readonly inputId: Promise<string>;
  status: SessionStatus = "idle";
  private readonly opts: AnalysisSessionOptions;
  private controller?: AbortController;
  private generation = 0;
  private checkpoint?: AnalysisCheckpoint;
  constructor(opts: AnalysisSessionOptions) {
    // Neither UI edits nor caller mutation may change a run's input/configuration.
    this.opts = {
      ...opts,
      adapter: {
        analyzeChunk: opts.adapter.analyzeChunk.bind(opts.adapter),
        reconcile: opts.adapter.reconcile.bind(opts.adapter),
      },
      project: structuredClone(opts.project),
      initialCheckpoint:
        opts.initialCheckpoint && structuredClone(opts.initialCheckpoint),
      manualCorrectionIds: [...(opts.manualCorrectionIds ?? [])],
    };
    this.id = opts.sessionId ?? `analysis-${crypto.randomUUID()}`;
    const source = this.opts.project.sources.find(
      (s) =>
        s.id ===
        (opts.sourceId ??
          this.opts.project.sources.find((x) => x.role === "conversation")?.id),
    );
    if (!source) throw new Error("conversation source not found");
    this.sourceId = source.id;
    this.sourceVersionId = source.versionId;
    this.configId = JSON.stringify([
      "session-v2",
      opts.configId ?? "generic-json-v1",
      opts.maxChars ?? 3000,
      opts.overlapChars ?? 200,
    ]);
    const identity = JSON.stringify([
      source,
      this.opts.project.utterances.filter((u) => u.sourceId === source.id),
      this.opts.manualCorrectionIds,
    ]);
    this.inputId = crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(identity))
      .then((bytes) =>
        [...new Uint8Array(bytes)]
          .map((b) => b.toString(16).padStart(2, "0"))
          .join(""),
      );
    this.chunks = makeAnalysisChunks(
      this.opts.project,
      source.id,
      opts.maxChars,
      opts.overlapChars,
    );
    for (const chunk of this.chunks) {
      for (const span of chunk.spans) Object.freeze(span);
      Object.freeze(chunk.spans);
      Object.freeze(chunk);
    }
    Object.freeze(this.chunks);
  }
  cancel() {
    this.generation++;
    this.controller?.abort();
    if (this.status === "running") this.status = "cancelled";
  }
  async resume(signal?: AbortSignal): Promise<AnalysisSessionResult> {
    return this.run(signal);
  }
  async run(signal?: AbortSignal): Promise<AnalysisSessionResult> {
    if (this.status === "running")
      throw new Error("analysis session is already running");
    const generation = ++this.generation;
    const combined = new AbortController();
    this.controller = combined;
    this.status = "running";
    const forward = () => combined.abort();
    if (signal?.aborted) forward();
    else signal?.addEventListener("abort", forward, { once: true });
    const guard = () => {
      check(combined.signal);
      if (generation !== this.generation) throw abortError();
    };
    const source = this.opts.project.sources.find(
      (s) => s.id === this.sourceId,
    )!;
    try {
      guard();
      const inputId = await cancellable(this.inputId, combined.signal);
      guard();
      const loaded =
        this.checkpoint ??
        this.opts.initialCheckpoint ??
        (await cancellable(
          Promise.resolve(this.opts.checkpointStore?.load(this.id)),
          combined.signal,
        ));
      guard();
      if (
        loaded &&
        (loaded.sourceId !== source.id ||
          loaded.sourceVersionId !== source.versionId ||
          loaded.sourceHash !== source.hash)
      )
        throw new Error("checkpoint belongs to an older source version");
      if (
        loaded &&
        (loaded.version !== 1 ||
          loaded.sessionId !== this.id ||
          loaded.configId !== this.configId ||
          loaded.inputId !== inputId)
      )
        throw new Error("checkpoint input/configuration mismatch");
      let checkpoint: AnalysisCheckpoint = structuredClone(
        loaded ?? {
          version: 1,
          sessionId: this.id,
          configId: this.configId,
          inputId,
          sourceId: source.id,
          sourceVersionId: source.versionId,
          sourceHash: source.hash,
          phase: "candidates",
          nextChunk: 0,
          candidates: [],
          reconciled: undefined,
          terms: [],
          questions: [],
          answers: [],
          relations: [],
          manualCorrectionIds: [...(this.opts.manualCorrectionIds ?? [])],
          updatedAt: now(),
        },
      );
      if (
        !Number.isInteger(checkpoint.nextChunk) ||
        checkpoint.nextChunk < 0 ||
        checkpoint.nextChunk > this.chunks.length ||
        !Array.isArray(checkpoint.candidates) ||
        checkpoint.candidates.length !== checkpoint.nextChunk ||
        !["candidates", "reconcile"].includes(checkpoint.phase) ||
        (checkpoint.phase === "reconcile" &&
          checkpoint.nextChunk !== this.chunks.length) ||
        (checkpoint.reconciled !== undefined &&
          (checkpoint.phase !== "reconcile" ||
            checkpoint.nextChunk !== this.chunks.length))
      )
        throw new Error("invalid checkpoint prefix");
      checkpoint.candidates = checkpoint.candidates.map((c, i) => {
        if (c.chunkId !== this.chunks[i].id)
          throw new Error("invalid checkpoint chunk order");
        return {
          chunkId: c.chunkId,
          value: this.validateCandidate(c.value, this.chunks[i]),
        };
      });
      if (checkpoint.reconciled !== undefined)
        checkpoint.reconciled = this.validateReconciled(checkpoint.reconciled);
      const save = async (next: AnalysisCheckpoint) => {
        guard();
        next.updatedAt = now();
        await cancellable(
          Promise.resolve(
            this.opts.checkpointStore?.save(
              structuredClone(next),
              combined.signal,
            ),
          ),
          combined.signal,
        );
        guard();
        checkpoint = next;
        this.checkpoint = structuredClone(next);
      };
      // Establish a durable empty prefix, so cancellation of the first chunk is resumable.
      await save(checkpoint);
      for (let i = checkpoint.nextChunk; i < this.chunks.length; i++) {
        guard();
        const value = await cancellable(
          this.opts.adapter.analyzeChunk(
            {
              chunk: structuredClone(this.chunks[i]),
              prior: structuredClone(checkpoint),
            },
            combined.signal,
          ),
          combined.signal,
        );
        guard();
        const checked = this.validateCandidate(value, this.chunks[i]);
        await save({
          ...checkpoint,
          nextChunk: i + 1,
          candidates: [
            ...checkpoint.candidates,
            { chunkId: this.chunks[i].id, value: checked },
          ],
        });
        this.opts.onProgress?.({
          phase: "candidates",
          completed: i + 1,
          total: this.chunks.length,
        });
      }
      if (!this.chunks.length) throw new Error("解析対象がありません");
      if (checkpoint.reconciled === undefined) {
        await save({ ...checkpoint, phase: "reconcile" });
        const value = await cancellable(
          this.opts.adapter.reconcile(
            {
              candidates: structuredClone(checkpoint.candidates),
              sourceId: source.id,
              sourceVersionId: source.versionId,
              prior: structuredClone(checkpoint),
            },
            combined.signal,
          ),
          combined.signal,
        );
        guard();
        await save({
          ...checkpoint,
          reconciled: this.validateReconciled(value),
        });
      }
      guard();
      this.status = "complete";
      return {
        status: "complete",
        sourceId: source.id,
        sourceVersionId: source.versionId,
        candidates: structuredClone(checkpoint.candidates),
        reconciled: structuredClone(checkpoint.reconciled),
        checkpoint: structuredClone(checkpoint),
      };
    } catch (error) {
      if (generation === this.generation)
        this.status = combined.signal.aborted ? "cancelled" : "failed";
      throw error;
    } finally {
      signal?.removeEventListener("abort", forward);
      if (generation === this.generation) this.controller = undefined;
    }
  }
  private validateCandidate(value: unknown, chunk: AnalysisChunk) {
    return jsonValue(
      this.opts.validateCandidate
        ? this.opts.validateCandidate(value, structuredClone(chunk))
        : value,
    );
  }
  private validateReconciled(value: unknown) {
    return jsonValue(
      this.opts.validateReconciled
        ? this.opts.validateReconciled(value)
        : value,
    );
  }
}
export function createAnalysisSession(options: AnalysisSessionOptions) {
  return new AnalysisSession(options);
}
