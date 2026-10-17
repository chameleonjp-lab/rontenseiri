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
  save(checkpoint: AnalysisCheckpoint): Promise<void>;
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

export class AnalysisSession {
  readonly id: string;
  readonly chunks: AnalysisChunk[];
  readonly sourceId: string;
  readonly sourceVersionId: string;
  status: SessionStatus = "idle";
  private readonly opts: AnalysisSessionOptions;
  private controller?: AbortController;
  private generation = 0;
  private checkpoint?: AnalysisCheckpoint;
  constructor(opts: AnalysisSessionOptions) {
    this.opts = opts;
    this.id = opts.sessionId ?? `analysis-${crypto.randomUUID()}`;
    const source = opts.project.sources.find(
      (s) =>
        s.id ===
        (opts.sourceId ??
          opts.project.sources.find((x) => x.role === "conversation")?.id),
    );
    if (!source) throw new Error("conversation source not found");
    this.sourceId = source.id;
    this.sourceVersionId = source.versionId;
    this.chunks = makeAnalysisChunks(
      opts.project,
      source.id,
      opts.maxChars,
      opts.overlapChars,
    );
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
    const source = this.opts.project.sources.find(
      (s) => s.id === this.sourceId,
    )!;
    const stored =
      this.checkpoint ??
      this.opts.initialCheckpoint ??
      (await this.opts.checkpointStore?.load(this.id));
    if (
      stored &&
      (stored.sourceId !== source.id ||
        stored.sourceVersionId !== source.versionId ||
        stored.sourceHash !== source.hash)
    )
      throw new Error("checkpoint belongs to an older source version");
    const base: AnalysisCheckpoint = stored ?? {
      version: 1,
      sessionId: this.id,
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
    };
    this.checkpoint = base;
    this.status = "running";
    const generation = ++this.generation;
    const combined = new AbortController();
    this.controller = combined;
    const forward = () => combined.abort();
    if (signal?.aborted) combined.abort();
    else signal?.addEventListener("abort", forward, { once: true });
    const save = async () => {
      check(combined.signal);
      if (generation !== this.generation) throw abortError();
      this.checkpoint!.updatedAt = now();
      await this.opts.checkpointStore?.save(this.checkpoint!);
    };
    try {
      for (let i = base.nextChunk; i < this.chunks.length; i++) {
        check(combined.signal);
        const value = await this.opts.adapter.analyzeChunk(
          { chunk: this.chunks[i], prior: this.checkpoint! },
          combined.signal,
        );
        check(combined.signal);
        this.checkpoint.candidates.push({ chunkId: this.chunks[i].id, value });
        this.checkpoint.nextChunk = i + 1;
        this.opts.onProgress?.({
          phase: "candidates",
          completed: i + 1,
          total: this.chunks.length,
        });
        await save();
      }
      this.checkpoint.phase = "reconcile";
      await save();
      check(combined.signal);
      const reconciled = await this.opts.adapter.reconcile(
        {
          candidates: this.checkpoint.candidates,
          sourceId: source.id,
          sourceVersionId: source.versionId,
          prior: this.checkpoint,
        },
        combined.signal,
      );
      check(combined.signal);
      this.checkpoint.reconciled = reconciled;
      await save();
      this.status = "complete";
      return {
        status: "complete",
        sourceId: source.id,
        sourceVersionId: source.versionId,
        candidates: [...this.checkpoint.candidates],
        reconciled,
        checkpoint: structuredClone(this.checkpoint),
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        this.status = "cancelled";
      } else {
        this.status = "failed";
      }
      throw error;
    } finally {
      signal?.removeEventListener("abort", forward);
      if (this.status === "cancelled") this.controller = undefined;
    }
  }
}
export function createAnalysisSession(options: AnalysisSessionOptions) {
  return new AnalysisSession(options);
}
