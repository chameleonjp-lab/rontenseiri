import type { Project } from "../domain/types";

export type AnalysisPhase = "candidates" | "reconcile";
export type SessionStatus =
  | "idle"
  | "running"
  | "paused"
  | "partial"
  | "complete"
  | "cancelled"
  | "failed";

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
  version: 1 | 2;
  runId?: string;
  generationId?: string;
  fingerprint?: string;
  sourceBytesHash?: string;
  chunkManifest?: Array<{
    id: string;
    spans: Array<{
      sourceId: string;
      sourceVersionId: string;
      start: number;
      end: number;
    }>;
  }>;
  sessionId: string;
  configId?: string;
  inputId?: string;
  sourceId: string;
  sourceVersionId: string;
  sourceHash: string;
  phase: AnalysisPhase;
  nextChunk: number;
  lastCommittedChunkIndex?: number;
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
  parserVersion?: string;
  analysisVersion?: string;
  outputSchemaVersion?: string;
  runSettings?: Record<string, unknown>;
  generationId?: string;
  validateCandidate?: (value: unknown, chunk: AnalysisChunk) => unknown;
  validateReconciled?: (value: unknown) => unknown;
  onProgress?: (event: {
    phase: AnalysisPhase;
    completed: number;
    total: number;
  }) => void;
}
export interface AnalysisSessionResult {
  status: "complete" | "partial";
  sourceId: string;
  sourceVersionId: string;
  candidates: AnalysisCandidate[];
  reconciled: unknown;
  checkpoint: AnalysisCheckpoint;
}

export interface FixtureBoundedReconciliationResult {
  kind: "fixture-bounded-reconciliation";
  version: 1;
  status: "complete" | "partial";
  [key: string]: unknown;
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
function isBoundedReconciliation(
  value: unknown,
): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).kind === "fixture-bounded-reconciliation"
  );
}
function explicitReconciliationStatus(value: unknown): "complete" | "partial" {
  if (value === null || typeof value !== "object") return "complete";
  const record = value as Record<string, unknown>;
  // Generic adapter results remain opaque, except that an unmarked partial
  // result must never be presented as complete.
  if (record.kind !== "fixture-bounded-reconciliation") {
    if (record.status === "partial")
      throw new Error("generic reconciliation result cannot be partial");
    return "complete";
  }
  if (record.version !== 1)
    throw new Error("unknown reconciliation result schema");
  if (record.status !== "complete" && record.status !== "partial")
    throw new Error("unknown reconciliation result status");
  return record.status;
}
export function canonicalSettings(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map(canonicalSettings).join(",")}]`;
  if (
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  )
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalSettings(item)}`)
      .join(",")}}`;
  throw new Error("run settings must be finite JSON values");
}
const sha256 = (text: string) =>
  crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(text))
    .then((bytes) =>
      [...new Uint8Array(bytes)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""),
    );
export class AnalysisSession {
  readonly id: string;
  readonly chunks: AnalysisChunk[];
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly configId: string;
  readonly inputId: Promise<string>;
  readonly sourceBytesHash: Promise<string>;
  readonly fingerprint: Promise<string>;
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
    this.configId = canonicalSettings({
      checkpointSchema: 2,
      projectSchema: opts.project.schemaVersion,
      parser: opts.parserVersion ?? "input-parser-v1",
      sessionImplementation: "analysis-session-v5",
      implementation: opts.analysisVersion ?? "generic-json-adapter-v1",
      outputSchema: opts.outputSchemaVersion ?? "generic-json-v1",
      adapter: opts.configId ?? "generic-json-v1",
      maxChars: opts.maxChars ?? 3000,
      overlapChars: opts.overlapChars ?? 200,
      settings: structuredClone(opts.runSettings ?? {}),
    });
    const identity = JSON.stringify([
      source,
      this.opts.project.utterances.filter((u) => u.sourceId === source.id),
      this.opts.manualCorrectionIds,
    ]);
    this.inputId = sha256(identity);
    this.sourceBytesHash = sha256(source.text);
    this.fingerprint = Promise.all([this.inputId, this.sourceBytesHash]).then(
      ([inputId, sourceBytesHash]) =>
        sha256(
          canonicalSettings({
            sourceId: source.id,
            sourceVersionId: source.versionId,
            sourceBytesHash,
            inputId,
            configuration: this.configId,
          }),
        ),
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
    const forward = () => {
      if (generation === this.generation) {
        this.generation++;
        this.status = "cancelled";
      }
      combined.abort();
    };
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
      // Commit may win just before cancellation, while memory still holds the
      // preceding prefix. A configured durable store is authoritative on EVERY
      // invocation, including resume() on this same Session instance.
      const loaded = this.opts.checkpointStore
        ? ((await cancellable(
            this.opts.checkpointStore.load(this.id),
            combined.signal,
          )) ?? (this.checkpoint ? undefined : this.opts.initialCheckpoint))
        : (this.checkpoint ?? this.opts.initialCheckpoint);
      guard();
      let checkpoint = await cancellable(
        this.inspectCheckpoint(loaded),
        combined.signal,
      );
      const resumingBoundedPartial =
        isBoundedReconciliation(checkpoint.reconciled) &&
        explicitReconciliationStatus(checkpoint.reconciled) === "partial";
      checkpoint.generationId =
        this.opts.generationId ?? `${this.id}:${generation}`;
      guard();
      const save = async (next: AnalysisCheckpoint) => {
        guard();
        next.updatedAt = now();
        next.lastCommittedChunkIndex = next.nextChunk - 1;
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
      // Establish a durable empty prefix for candidate work. A bounded partial
      // already has a durable reconcile prefix: do not rewrite even metadata
      // until the resumed page has passed all continuation checks.
      if (!resumingBoundedPartial) await save(checkpoint);
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
      const priorReconciliationStatus =
        checkpoint.reconciled === undefined
          ? undefined
          : explicitReconciliationStatus(checkpoint.reconciled);
      if (priorReconciliationStatus !== "complete") {
        if (!resumingBoundedPartial)
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
        if (
          isBoundedReconciliation(checkpoint.reconciled) &&
          !isBoundedReconciliation(value)
        )
          throw new Error(
            "bounded reconciliation cannot resume with a generic result",
          );
        const page = this.validateReconciledResult(value);
        const reconciled = this.mergeBoundedReconciliationPage(
          checkpoint.reconciled,
          page,
        );
        const checkedReconciled = this.validateReconciledResult(
          reconciled,
          true,
        );
        await save({
          ...checkpoint,
          reconciled: checkedReconciled,
        });
      }
      guard();
      const resultStatus = explicitReconciliationStatus(checkpoint.reconciled);
      this.status = resultStatus;
      return {
        status: resultStatus,
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
  /** Read-only preflight: invalid checkpoints must not claim an owner or modify IndexedDB. */
  async inspectCheckpoint(
    loaded?: AnalysisCheckpoint,
  ): Promise<AnalysisCheckpoint> {
    const [inputId, sourceBytesHash, fingerprint] = await Promise.all([
      this.inputId,
      this.sourceBytesHash,
      this.fingerprint,
    ]);
    const source = this.opts.project.sources.find(
      (item) => item.id === this.sourceId,
    )!;
    if (
      loaded &&
      (loaded.sourceId !== source.id ||
        loaded.sourceVersionId !== source.versionId ||
        loaded.sourceHash !== source.hash)
    )
      throw new Error("checkpoint belongs to an older source version");
    if (
      loaded &&
      (loaded.version !== 2 ||
        loaded.sessionId !== this.id ||
        loaded.configId !== this.configId ||
        loaded.inputId !== inputId ||
        loaded.fingerprint !== fingerprint ||
        loaded.sourceBytesHash !== sourceBytesHash ||
        loaded.runId !== this.id)
    )
      throw new Error("checkpoint input/configuration mismatch");
    let checkpoint: AnalysisCheckpoint = structuredClone(
      loaded ?? {
        version: 2,
        runId: this.id,
        generationId: this.opts.generationId,
        fingerprint,
        sourceBytesHash,
        chunkManifest: this.chunkManifest(),
        sessionId: this.id,
        configId: this.configId,
        inputId,
        sourceId: source.id,
        sourceVersionId: source.versionId,
        sourceHash: source.hash,
        phase: "candidates",
        nextChunk: 0,
        lastCommittedChunkIndex: -1,
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
      checkpoint.lastCommittedChunkIndex !== checkpoint.nextChunk - 1 ||
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
    if (
      canonicalSettings(checkpoint.chunkManifest) !==
      canonicalSettings(this.chunkManifest())
    )
      throw new Error("checkpoint evidence span mismatch");
    for (const item of checkpoint.chunkManifest ?? [])
      for (const span of item.spans) {
        if (
          !Number.isInteger(span.start) ||
          !Number.isInteger(span.end) ||
          span.start < 0 ||
          span.end <= span.start ||
          span.end > source.text.length ||
          span.sourceId !== source.id ||
          span.sourceVersionId !== source.versionId
        )
          throw new Error("checkpoint evidence span outside current source");
      }
    checkpoint.candidates = checkpoint.candidates.map((c, i) => {
      if (c.chunkId !== this.chunks[i].id)
        throw new Error("invalid checkpoint chunk order");
      return {
        chunkId: c.chunkId,
        value: this.validateCandidate(c.value, this.chunks[i]),
      };
    });
    if (checkpoint.reconciled !== undefined)
      checkpoint.reconciled = this.validateReconciledResult(
        checkpoint.reconciled,
        true,
      );
    return checkpoint;
  }
  private chunkManifest() {
    return this.chunks.map((chunk) => ({
      id: chunk.id,
      spans: chunk.spans.map(({ sourceId, sourceVersionId, start, end }) => ({
        sourceId,
        sourceVersionId,
        start,
        end,
      })),
    }));
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
  /**
   * Versioned fixture results are a context contract, not a generic adapter
   * convention.  Validate the raw discriminant before invoking the context
   * validator, then validate the returned value again and require the
   * discriminant to survive validation (a validator must not erase status).
   */
  private validateReconciledResult(value: unknown, requireAggregate = false) {
    const rawStatus = explicitReconciliationStatus(value);
    const isFixture =
      value !== null &&
      typeof value === "object" &&
      (value as Record<string, unknown>).kind ===
        "fixture-bounded-reconciliation";
    if (isFixture && !this.opts.validateReconciled)
      throw new Error(
        "fixture-bounded-reconciliation requires validateReconciled",
      );
    if (!isFixture && rawStatus === "partial")
      throw new Error("generic reconciliation result cannot be partial");
    const checked = this.validateReconciled(value);
    explicitReconciliationStatus(checked);
    if (isFixture) {
      if (
        checked === null ||
        typeof checked !== "object" ||
        (checked as Record<string, unknown>).kind !==
          "fixture-bounded-reconciliation" ||
        (checked as Record<string, unknown>).version !== 1 ||
        (checked as Record<string, unknown>).status !== rawStatus
      )
        throw new Error(
          "reconciled validator changed fixture result discriminant",
        );
      if (requireAggregate) {
        const result = checked as Record<string, unknown>;
        if (result.pageStartPairIndex !== 0)
          throw new Error("bounded checkpoint must contain the full aggregate");
      }
    }
    return checked;
  }

  private mergeBoundedReconciliationPage(prior: unknown, page: unknown) {
    if (!isBoundedReconciliation(page)) {
      if (isBoundedReconciliation(prior))
        throw new Error(
          "bounded reconciliation cannot resume with a generic result",
        );
      return page;
    }
    const cursor = page.cursor;
    const start = page.pageStartPairIndex;
    if (!cursor || typeof cursor !== "object" || !Number.isSafeInteger(start))
      throw new Error("invalid bounded reconciliation page");
    const pageCursor = cursor as Record<string, unknown>;
    const pageIds = pageCursor.candidateIds;
    if (!Array.isArray(pageIds))
      throw new Error("invalid bounded reconciliation cursor");
    if (prior === undefined) {
      if (start !== 0)
        throw new Error(
          "initial bounded reconciliation page must start at zero",
        );
      return page;
    }
    if (!isBoundedReconciliation(prior))
      throw new Error(
        "bounded reconciliation cannot resume from a generic result",
      );
    const oldCursor = prior.cursor;
    const oldResults = prior.results;
    if (
      !oldCursor ||
      typeof oldCursor !== "object" ||
      !Array.isArray(oldResults) ||
      prior.pageStartPairIndex !== 0
    )
      throw new Error(
        "persisted bounded reconciliation is not a full aggregate",
      );
    const priorCursor = oldCursor as Record<string, unknown>;
    const priorIds = priorCursor.candidateIds;
    if (
      !Array.isArray(priorIds) ||
      pageCursor.manifestId !== priorCursor.manifestId ||
      pageIds.length !== priorIds.length ||
      pageIds.some((id, i) => id !== priorIds[i]) ||
      start !== priorCursor.nextPairIndex ||
      oldResults.length !== priorCursor.nextPairIndex
    )
      throw new Error(
        "bounded reconciliation page cursor gap or manifest mismatch",
      );
    const cumulativeFields = [
      "candidates",
      "comparisons",
      "retainedResults",
      "inputBytes",
      "outputBytes",
      "elapsedMs",
    ];
    const nonRegressing = (
      next: unknown,
      previous: unknown,
      label: string,
      fields: readonly string[],
    ) => {
      if (
        !next ||
        !previous ||
        typeof next !== "object" ||
        typeof previous !== "object" ||
        Array.isArray(next) ||
        Array.isArray(previous)
      )
        throw new Error(`invalid bounded ${label}`);
      const current = next as Record<string, unknown>;
      const before = previous as Record<string, unknown>;
      for (const field of fields) {
        const n = current[field],
          p = before[field];
        const valid = (v: unknown): v is number =>
          typeof v === "number" &&
          Number.isFinite(v) &&
          v >= 0 &&
          (field === "elapsedMs" || Number.isSafeInteger(v));
        if (!valid(n) || !valid(p) || n < p)
          throw new Error(`bounded ${label}.${field} must not regress`);
      }
    };
    nonRegressing(pageCursor, priorCursor, "cursor", [
      "nextPairIndex",
      ...cumulativeFields,
    ]);
    nonRegressing(page.counters, prior.counters, "counters", cumulativeFields);
    return {
      ...page,
      pageStartPairIndex: 0,
      results: [
        ...oldResults,
        ...(Array.isArray(page.results) ? page.results : []),
      ],
    };
  }
}
export function createAnalysisSession(options: AnalysisSessionOptions) {
  return new AnalysisSession(options);
}
