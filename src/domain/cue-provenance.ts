import type { Source, SubtitleCue, CueSpan, Utterance } from "./types";

const fail = (message: string): never => {
  throw new Error(message);
};
const ledgerOf = (source: Source): SubtitleCue[] => source.cueLedger ?? [];
const cueMap = (source: Source) =>
  new Map(ledgerOf(source).map((c) => [c.id, c]));
const validRange = (source: Source, start: number, end: number) =>
  Number.isInteger(start) &&
  Number.isInteger(end) &&
  start >= 0 &&
  end > start &&
  end <= source.text.length;

/** Validate a parsed subtitle ledger. Raw IDs are deliberately not unique. */
export function validateSourceCues(source: Source): void {
  if (source.cueLedger === undefined) return;
  if (!Array.isArray(source.cueLedger)) fail("invalid cue ledger");
  const ids = new Set<string>();
  for (const [i, cue] of source.cueLedger.entries()) {
    if (
      !cue ||
      typeof cue.id !== "string" ||
      !cue.id ||
      ids.has(cue.id) ||
      cue.order !== i ||
      (cue.rawId !== undefined && typeof cue.rawId !== "string") ||
      !validRange(source, cue.start, cue.end) ||
      cue.startTime < 0 ||
      (i > 0 && cue.start < source.cueLedger![i - 1].end) ||
      cue.endTime < cue.startTime ||
      !Number.isFinite(cue.startTime) ||
      !Number.isFinite(cue.endTime) ||
      !Number.isInteger(cue.line) ||
      cue.line < 0 ||
      typeof cue.time !== "string"
    )
      fail("invalid cue ledger");
    ids.add(cue.id);
  }
}

/** Validate legacy scalar quotes or canonical cue-span quotes. */
export function validateUtteranceQuote(source: Source, u: Utterance): void {
  if (u.sourceVersionId && !source) fail("source missing");
  if (!validRange(source, u.start, u.end)) fail(`quote mismatch: ${u.id}`);
  if (u.cueSpans === undefined) {
    if (source.text.slice(u.start, u.end) !== u.quote)
      fail(`quote mismatch: ${u.id}`);
    return;
  }
  validateSourceCues(source);
  if (!Array.isArray(u.cueSpans) || !u.cueSpans.length)
    fail("cue spans required");
  const map = cueMap(source);
  let previousEnd = -1,
    previousCueOrder = -1,
    distinct = new Set<string>();
  let display = "";
  for (const [i, span] of u.cueSpans.entries()) {
    const cue = map.get(span.cueId);
    if (!cue) fail(`invalid cue span: ${u.id}`);
    if (
      !validRange(source, span.start, span.end) ||
      span.start < (cue as SubtitleCue).start ||
      span.end > (cue as SubtitleCue).end ||
      (i && span.start < previousEnd) ||
      (cue as SubtitleCue).order < previousCueOrder
    )
      fail(`invalid cue span: ${u.id}`);
    const validCue = cue as SubtitleCue;
    if (i) display += "\n";
    display += source.text.slice(span.start, span.end);
    previousEnd = span.end;
    previousCueOrder = validCue.order;
    distinct.add(validCue.id);
  }
  const first = u.cueSpans[0],
    last = u.cueSpans.at(-1)!;
  if (u.start !== first.start || u.end !== last.end || u.quote !== display)
    fail(`quote mismatch: ${u.id}`);
  if (
    u.time !== undefined &&
    (distinct.size > 1 || u.time !== map.get(first.cueId)!.time)
  )
    fail("cue time mismatch");
}

/** Construct an utterance whose quote is derived only from source spans. */
export function withCueSpans(
  u: Utterance,
  source: Source,
  spans: CueSpan[],
): Utterance {
  const normalized: CueSpan[] = [];
  for (const span of spans) {
    const previous = normalized.at(-1);
    if (
      previous &&
      previous.cueId === span.cueId &&
      previous.end === span.start
    )
      previous.end = span.end;
    else normalized.push({ ...span });
  }
  spans = normalized;
  const next = { ...u, cueSpans: spans };
  if (!spans.length) return fail("cue spans required");
  const map = cueMap(source);
  let quote = "",
    distinct = new Set<string>();
  for (const [i, span] of spans.entries()) {
    const cue = map.get(span.cueId);
    if (!cue) fail("invalid cue span");
    if (
      !validRange(source, span.start, span.end) ||
      span.start < (cue as SubtitleCue).start ||
      span.end > (cue as SubtitleCue).end
    )
      fail("invalid cue span");
    if (i) quote += "\n";
    quote += source.text.slice(span.start, span.end);
    distinct.add((cue as SubtitleCue).id);
  }
  next.start = spans[0].start;
  next.end = spans.at(-1)!.end;
  next.quote = quote;
  next.line = source.text.slice(0, next.start).split(/\r\n|\n|\r/).length;
  if (distinct.size === 1) {
    const cue = map.get(spans[0].cueId) as SubtitleCue;
    next.time = cue.time;
  } else delete next.time;
  return next;
}

/** Split a composite quote at display offset without assigning synthetic newlines to source. */
export function splitCueSpans(
  _source: Source,
  spans: CueSpan[],
  offset: number,
): [CueSpan[], CueSpan[]] {
  let display = 0;
  for (let i = 0; i < spans.length; i++) {
    const len = spans[i].end - spans[i].start;
    if (offset === display) return [spans.slice(0, i), spans.slice(i)];
    if (offset > display && offset < display + len) {
      const cut = spans[i].start + offset - display;
      return [
        spans.slice(0, i).concat({ ...spans[i], end: cut }),
        [{ ...spans[i], start: cut }, ...spans.slice(i + 1)],
      ];
    }
    display += len;
    if (i < spans.length - 1) {
      if (offset === display)
        return [spans.slice(0, i + 1), spans.slice(i + 1)];
      display++;
    }
  }
  if (offset === display) return [spans, []];
  return fail("split offset must be inside utterance");
}
