/**
 * Model-independent fixture policy, NOT product/device safety limits.
 * Work limits reset per page; cursor counters are cumulative across pages.
 * Non-resettable internal ceilings also bound the entire retained run report.
 * Static manifest validation is separate bounded preflight (caps below), not
 * candidate admission or comparison work. No conversation text is accepted.
 */
export const BOUNDED_RECONCILIATION_CONTRACT = {
  kind: "fixture-bounded-reconciliation" as const,
  version: 1 as const,
  units: {
    candidates: "newly admitted candidates per page",
    comparisons: "performed pair comparisons per page",
    retainedResults:
      "all retained pair outcomes per page, including no-relation/hold",
    inputBytes:
      "cumulative canonical candidate JSON UTF-8 bytes admitted per page",
    outputBytes:
      "cumulative canonical PairResult JSON UTF-8 bytes retained per page; excludes bounded envelope/cursor",
    elapsedMs:
      "monotonic injected elapsed milliseconds per page; deadline is exclusive",
  },
} as const;
export const BOUNDED_RECONCILIATION_LIMITS = {
  maxCandidates: 10_000,
  maxComparisons: 50_000,
  maxRetainedResults: 50_000,
  maxInputBytes: 8 * 1024 * 1024,
  maxOutputBytes: 8 * 1024 * 1024,
  maxElapsedMs: 30_000,
} as const;
export const FIXTURE_MANIFEST_CAPS = {
  candidates: 10_000,
  evidencePerCandidate: 64,
  identifierChars: 128,
  canonicalBytes: 8 * 1024 * 1024,
} as const;
export type FixtureDisposition = "relation" | "no-relation" | "hold";
export type SourceSpan = Readonly<{
  sourceId: string;
  sourceVersionId: string;
  start: number;
  end: number;
}>;
export type FixtureCandidate = Readonly<{
  id: string;
  evidence: readonly SourceSpan[];
  disposition: FixtureDisposition;
}>;
export type BoundedLimits = Readonly<{
  maxCandidates: number;
  maxComparisons: number;
  maxRetainedResults: number;
  maxInputBytes: number;
  maxOutputBytes: number;
  maxElapsedMs: number;
}>;
export type BoundedCursor = Readonly<{
  schema: "fixture-bounded-reconciliation-cursor";
  version: 1;
  manifestId: string;
  candidateIds: readonly string[];
  nextPairIndex: number;
  candidates: number;
  comparisons: number;
  retainedResults: number;
  inputBytes: number;
  outputBytes: number;
  elapsedMs: number;
}>;
export type PairResult = Readonly<{
  leftId: string;
  rightId: string;
  disposition: FixtureDisposition;
}>;
export type UnexaminedRange = Readonly<{ start: number; end: number }>;
const reasons = [
  "candidate-budget",
  "comparison-budget",
  "retained-result-budget",
  "input-bytes-budget",
  "output-bytes-budget",
  "elapsed-ms-budget",
] as const;
export type ReconciliationResult = Readonly<{
  kind: "fixture-bounded-reconciliation";
  version: 1;
  status: "complete" | "partial";
  pageStartPairIndex: number;
  results: readonly PairResult[];
  cursor: BoundedCursor;
  stopReason?: (typeof reasons)[number];
  unexaminedRanges: readonly UnexaminedRange[];
  counters: Readonly<{
    candidates: number;
    comparisons: number;
    retainedResults: number;
    inputBytes: number;
    outputBytes: number;
    elapsedMs: number;
  }>;
}>;
const encoder = new TextEncoder();
const utf8 = (text: string) => encoder.encode(text).byteLength;
const integer = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const finite = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;
const object = (v: unknown): v is Record<string, unknown> =>
  !!v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.getPrototypeOf(v) === Object.prototype;
const keys = (
  v: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
) => {
  if (
    required.some((key) => !Object.hasOwn(v, key)) ||
    Object.keys(v).some(
      (key) => !required.includes(key) && !optional.includes(key),
    )
  )
    throw new Error("invalid contract fields");
};
const identifier = (v: unknown): v is string =>
  typeof v === "string" &&
  v.length > 0 &&
  v.length <= FIXTURE_MANIFEST_CAPS.identifierChars;
const validDisposition = (v: unknown): v is FixtureDisposition =>
  v === "relation" || v === "no-relation" || v === "hold";
const disposition = (
  a: FixtureDisposition,
  b: FixtureDisposition,
): FixtureDisposition =>
  a === "hold" || b === "hold"
    ? "hold"
    : a === "relation" && b === "relation"
      ? "relation"
      : "no-relation";
const canonicalCandidate = (c: FixtureCandidate) =>
  JSON.stringify({
    id: c.id,
    evidence: c.evidence.map((s) => ({
      sourceId: s.sourceId,
      sourceVersionId: s.sourceVersionId,
      start: s.start,
      end: s.end,
    })),
    disposition: c.disposition,
  });
const pairAt = (n: number, index: number): [number, number] => {
  for (let left = 0; left < n - 1; left++) {
    const count = n - left - 1;
    if (index < count) return [left, left + 1 + index];
    index -= count;
  }
  throw new Error("pair index out of range");
};
function manifest(candidates: readonly FixtureCandidate[]) {
  if (
    !Array.isArray(candidates) ||
    candidates.length > FIXTURE_MANIFEST_CAPS.candidates
  )
    throw new Error("fixture manifest candidate cap");
  const ids: string[] = [],
    canonical: string[] = [],
    inputPrefix = [0],
    idPrefix = [0];
  const typePrefix = { relation: [0], "no-relation": [0], hold: [0] };
  const seen = new Set<string>();
  let bytes = utf8("[]");
  for (const candidate of candidates) {
    if (!object(candidate)) throw new Error("malformed candidate");
    keys(candidate, ["id", "evidence", "disposition"]);
    if (!identifier(candidate.id) || seen.has(candidate.id))
      throw new Error("invalid or duplicate candidate ID");
    if (
      !validDisposition(candidate.disposition) ||
      !Array.isArray(candidate.evidence) ||
      candidate.evidence.length < 1 ||
      candidate.evidence.length > FIXTURE_MANIFEST_CAPS.evidencePerCandidate
    )
      throw new Error("malformed candidate references");
    const refs = new Set<string>();
    for (const span of candidate.evidence) {
      if (!object(span)) throw new Error("malformed evidence ref");
      keys(span, ["sourceId", "sourceVersionId", "start", "end"]);
      if (
        !identifier(span.sourceId) ||
        !identifier(span.sourceVersionId) ||
        !integer(span.start) ||
        !integer(span.end) ||
        span.start >= span.end
      )
        throw new Error("invalid evidence span");
      const ref = JSON.stringify([
        span.sourceId,
        span.sourceVersionId,
        span.start,
        span.end,
      ]);
      if (refs.has(ref)) throw new Error("duplicate evidence reference");
      refs.add(ref);
    }
    const text = canonicalCandidate(candidate as unknown as FixtureCandidate);
    const size = utf8(text);
    bytes += size + (ids.length ? utf8(",") : 0);
    if (bytes > FIXTURE_MANIFEST_CAPS.canonicalBytes)
      throw new Error("fixture manifest byte cap");
    seen.add(candidate.id);
    ids.push(candidate.id);
    canonical.push(text);
    inputPrefix.push(inputPrefix.at(-1)! + size);
    idPrefix.push(
      idPrefix.at(-1)! + utf8(JSON.stringify(candidate.id)) - utf8('""'),
    );
    for (const type of ["relation", "no-relation", "hold"] as const)
      typePrefix[type].push(
        typePrefix[type].at(-1)! + (candidate.disposition === type ? 1 : 0),
      );
  }
  // Exact bounded identity, not a collision-prone noncryptographic hash.
  const identity = `[${canonical.join(",")}]`;
  const totalPairs = (candidates.length * (candidates.length - 1)) / 2;
  const outputPrefix = (count: number) => {
    let sum = 0;
    const envelope = utf8(
      JSON.stringify({ leftId: "", rightId: "", disposition: "" }),
    );
    for (let left = 0; count > 0; left++) {
      const length = Math.min(count, candidates.length - left - 1);
      const end = left + length + 1;
      sum +=
        length * (envelope + idPrefix[left + 1] - idPrefix[left]) +
        idPrefix[end] -
        idPrefix[left + 1];
      for (const type of ["relation", "no-relation", "hold"] as const) {
        const occurrences = typePrefix[type][end] - typePrefix[type][left + 1];
        sum +=
          occurrences * utf8(disposition(candidates[left].disposition, type));
      }
      count -= length;
    }
    return sum;
  };
  return { ids, identity, totalPairs, inputPrefix, outputPrefix };
}
type Manifest = ReturnType<typeof manifest>;
function cursorFor(value: unknown, m: Manifest): BoundedCursor {
  if (!object(value)) throw new Error("invalid cursor");
  keys(value, [
    "schema",
    "version",
    "manifestId",
    "candidateIds",
    "nextPairIndex",
    "candidates",
    "comparisons",
    "retainedResults",
    "inputBytes",
    "outputBytes",
    "elapsedMs",
  ]);
  if (
    value.schema !== "fixture-bounded-reconciliation-cursor" ||
    value.version !== 1
  )
    throw new Error("invalid cursor schema");
  if (
    value.manifestId !== m.identity ||
    !Array.isArray(value.candidateIds) ||
    value.candidateIds.length !== m.ids.length ||
    m.ids.some((id, i) => (value.candidateIds as unknown[])[i] !== id)
  )
    throw new Error("cursor manifest identity mismatch");
  for (const key of [
    "nextPairIndex",
    "candidates",
    "comparisons",
    "retainedResults",
    "inputBytes",
    "outputBytes",
  ])
    if (!integer(value[key])) throw new Error("invalid cursor counter");
  if (!finite(value.elapsedMs)) throw new Error("invalid cursor elapsed clock");
  const cursor = value as unknown as BoundedCursor;
  const k = cursor.nextPairIndex;
  if (
    k > m.totalPairs ||
    k > BOUNDED_RECONCILIATION_LIMITS.maxComparisons ||
    k > BOUNDED_RECONCILIATION_LIMITS.maxRetainedResults ||
    cursor.outputBytes > BOUNDED_RECONCILIATION_LIMITS.maxOutputBytes ||
    cursor.comparisons !== k ||
    cursor.retainedResults !== k
  )
    throw new Error("cursor work counters mismatch");
  const min = k ? Math.min(m.ids.length, k + 1) : 0;
  const max = m.ids.length < 2 ? 0 : Math.min(m.ids.length, k + 2);
  if (
    cursor.candidates < min ||
    cursor.candidates > max ||
    cursor.inputBytes !== m.inputPrefix[cursor.candidates] ||
    cursor.outputBytes !== m.outputPrefix(k)
  )
    throw new Error("cursor admission/byte counters mismatch");
  return structuredClone(cursor);
}
export function parseBoundedCursor(
  value: unknown,
  candidates: readonly FixtureCandidate[],
): BoundedCursor {
  return cursorFor(value, manifest(candidates));
}
export function assertBoundedCursor(
  value: unknown,
  candidates: readonly FixtureCandidate[],
): asserts value is BoundedCursor {
  parseBoundedCursor(value, candidates);
}
export function parseBoundedResult(
  value: unknown,
  candidates: readonly FixtureCandidate[],
): ReconciliationResult {
  if (!object(value)) throw new Error("invalid reconciliation result");
  keys(
    value,
    [
      "kind",
      "version",
      "status",
      "pageStartPairIndex",
      "results",
      "cursor",
      "unexaminedRanges",
      "counters",
    ],
    ["stopReason"],
  );
  if (
    value.kind !== "fixture-bounded-reconciliation" ||
    value.version !== 1 ||
    !["complete", "partial"].includes(value.status as string)
  )
    throw new Error("invalid reconciliation schema/status");
  const m = manifest(candidates),
    cursor = cursorFor(value.cursor, m);
  if (
    !integer(value.pageStartPairIndex) ||
    value.pageStartPairIndex > cursor.nextPairIndex ||
    !Array.isArray(value.results) ||
    value.results.length > BOUNDED_RECONCILIATION_LIMITS.maxRetainedResults ||
    value.results.length !== cursor.nextPairIndex - value.pageStartPairIndex ||
    !Array.isArray(value.unexaminedRanges)
  )
    throw new Error("invalid page prefix");
  if (
    cursor.outputBytes - m.outputPrefix(value.pageStartPairIndex) >
    BOUNDED_RECONCILIATION_LIMITS.maxOutputBytes
  )
    throw new Error("page output byte cap");
  for (let i = 0; i < value.results.length; i++) {
    const result = value.results[i];
    if (!object(result)) throw new Error("invalid pair result");
    keys(result, ["leftId", "rightId", "disposition"]);
    const [left, right] = pairAt(
      candidates.length,
      value.pageStartPairIndex + i,
    );
    if (
      result.leftId !== m.ids[left] ||
      result.rightId !== m.ids[right] ||
      result.disposition !==
        disposition(candidates[left].disposition, candidates[right].disposition)
    )
      throw new Error("invalid pair ordering/disposition/reference");
  }
  if (value.status === "complete") {
    if (
      value.stopReason !== undefined ||
      cursor.nextPairIndex !== m.totalPairs ||
      value.unexaminedRanges.length
    )
      throw new Error("invalid complete result");
  } else {
    if (
      cursor.nextPairIndex >= m.totalPairs ||
      !reasons.includes(value.stopReason as (typeof reasons)[number]) ||
      value.unexaminedRanges.length !== 1
    )
      throw new Error("invalid partial result");
    const range = value.unexaminedRanges[0];
    if (!object(range)) throw new Error("invalid unexamined range");
    keys(range, ["start", "end"]);
    if (range.start !== cursor.nextPairIndex || range.end !== m.totalPairs)
      throw new Error("unexamined range mismatch");
  }
  if (!object(value.counters)) throw new Error("invalid result counters");
  keys(value.counters, [
    "candidates",
    "comparisons",
    "retainedResults",
    "inputBytes",
    "outputBytes",
    "elapsedMs",
  ]);
  for (const key of [
    "candidates",
    "comparisons",
    "retainedResults",
    "inputBytes",
    "outputBytes",
  ] as const)
    if (value.counters[key] !== cursor[key])
      throw new Error("result counters mismatch");
  if (
    !finite(value.counters.elapsedMs) ||
    value.counters.elapsedMs !== cursor.elapsedMs
  )
    throw new Error("invalid elapsed clock");
  return structuredClone(value) as unknown as ReconciliationResult;
}
export function reconcileFixtureCandidates(
  candidates: readonly FixtureCandidate[],
  limits: BoundedLimits,
  options: Readonly<{
    cursor?: unknown;
    elapsedMs?: number | (() => number);
    onInput?: (candidate: FixtureCandidate) => void;
    onCompare?: (left: FixtureCandidate, right: FixtureCandidate) => void;
  }> = {},
): ReconciliationResult {
  if (!object(limits)) throw new Error("invalid limits");
  keys(limits, Object.keys(BOUNDED_RECONCILIATION_LIMITS));
  for (const [key, value] of Object.entries(limits)) {
    if (
      (key === "maxElapsedMs" ? !finite(value) : !integer(value)) ||
      value > BOUNDED_RECONCILIATION_LIMITS[key as keyof BoundedLimits]
    )
      throw new Error(`invalid limit: ${key}`);
  }
  // Freeze a bounded, validated snapshot so observers cannot alter the run.
  const m = manifest(candidates);
  candidates = structuredClone(candidates);
  const previous =
    options.cursor === undefined ? undefined : cursorFor(options.cursor, m);
  const start = previous?.nextPairIndex ?? 0;
  let admitted = previous?.candidates ?? 0,
    index = start;
  let pageCandidates = 0,
    pageInput = 0,
    pageOutput = 0;
  const priorOutput = previous?.outputBytes ?? 0;
  const results: PairResult[] = [];
  const started = performance.now();
  let lastElapsed = 0;
  const elapsed = () => {
    const value =
      typeof options.elapsedMs === "function"
        ? options.elapsedMs()
        : (options.elapsedMs ?? performance.now() - started);
    if (!finite(value) || value < lastElapsed)
      throw new Error("invalid or non-monotonic elapsed clock");
    lastElapsed = value;
    return value;
  };
  let stopReason: ReconciliationResult["stopReason"];
  while (index < m.totalPairs) {
    if (
      elapsed() >= limits.maxElapsedMs ||
      (previous?.elapsedMs ?? 0) + lastElapsed >=
        BOUNDED_RECONCILIATION_LIMITS.maxElapsedMs
    ) {
      stopReason = "elapsed-ms-budget";
      break;
    }
    if (
      index >= BOUNDED_RECONCILIATION_LIMITS.maxComparisons ||
      results.length >= limits.maxComparisons
    ) {
      stopReason = "comparison-budget";
      break;
    }
    if (
      index >= BOUNDED_RECONCILIATION_LIMITS.maxRetainedResults ||
      results.length >= limits.maxRetainedResults
    ) {
      stopReason = "retained-result-budget";
      break;
    }
    const [left, right] = pairAt(candidates.length, index);
    const result: PairResult = {
      leftId: m.ids[left],
      rightId: m.ids[right],
      disposition: disposition(
        candidates[left].disposition,
        candidates[right].disposition,
      ),
    };
    const output = utf8(JSON.stringify(result));
    if (
      priorOutput + pageOutput + output >
        BOUNDED_RECONCILIATION_LIMITS.maxOutputBytes ||
      pageOutput + output > limits.maxOutputBytes
    ) {
      stopReason = "output-bytes-budget";
      break;
    }
    // Lexicographic pairs only introduce candidates in contiguous input order.
    while (admitted <= right) {
      if (
        elapsed() >= limits.maxElapsedMs ||
        (previous?.elapsedMs ?? 0) + lastElapsed >=
          BOUNDED_RECONCILIATION_LIMITS.maxElapsedMs
      ) {
        stopReason = "elapsed-ms-budget";
        break;
      }
      if (pageCandidates >= limits.maxCandidates) {
        stopReason = "candidate-budget";
        break;
      }
      const input = m.inputPrefix[admitted + 1] - m.inputPrefix[admitted];
      if (pageInput + input > limits.maxInputBytes) {
        stopReason = "input-bytes-budget";
        break;
      }
      options.onInput?.(structuredClone(candidates[admitted]));
      admitted++;
      pageCandidates++;
      pageInput += input;
    }
    if (stopReason) break;
    if (
      elapsed() >= limits.maxElapsedMs ||
      (previous?.elapsedMs ?? 0) + lastElapsed >=
        BOUNDED_RECONCILIATION_LIMITS.maxElapsedMs
    ) {
      stopReason = "elapsed-ms-budget";
      break;
    }
    options.onCompare?.(
      structuredClone(candidates[left]),
      structuredClone(candidates[right]),
    );
    results.push(result);
    pageOutput += output;
    index++;
  }
  const cumulativeElapsed = (previous?.elapsedMs ?? 0) + elapsed();
  const cursor: BoundedCursor = {
    schema: "fixture-bounded-reconciliation-cursor",
    version: 1,
    manifestId: m.identity,
    candidateIds: m.ids,
    nextPairIndex: index,
    candidates: admitted,
    comparisons: index,
    retainedResults: index,
    inputBytes: m.inputPrefix[admitted],
    outputBytes: m.outputPrefix(index),
    elapsedMs: cumulativeElapsed,
  };
  return {
    kind: "fixture-bounded-reconciliation",
    version: 1,
    status: index === m.totalPairs ? "complete" : "partial",
    pageStartPairIndex: start,
    results,
    cursor,
    ...(stopReason ? { stopReason } : {}),
    unexaminedRanges:
      index === m.totalPairs ? [] : [{ start: index, end: m.totalPairs }],
    counters: {
      candidates: admitted,
      comparisons: index,
      retainedResults: index,
      inputBytes: cursor.inputBytes,
      outputBytes: cursor.outputBytes,
      elapsedMs: cumulativeElapsed,
    },
  };
}
export const runBoundedReconciliation = reconcileFixtureCandidates;
