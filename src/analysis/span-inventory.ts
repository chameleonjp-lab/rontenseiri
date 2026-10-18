import type { Project } from "../domain/types";
import { makeAnalysisChunks, type AnalysisChunk } from "./session";
import { canonicalSettings } from "./session";
import {
  reconcileFixtureCandidates,
  parseBoundedResult,
  type FixtureCandidate,
} from "./bounded-reconcile";

/** This is a source-span inventory, never semantic/model analysis. */
export const INVENTORY_CONFIG = "source-span-inventory-v1:all-hold:no-model";
export const INVENTORY_CHARS = 160;
export const INVENTORY_CAP = 256;
export const INVENTORY_LIMITS = {
  maxCandidates: 256,
  maxComparisons: 8,
  maxRetainedResults: 8,
  maxInputBytes: 256 * 1024,
  maxOutputBytes: 64 * 1024,
  maxElapsedMs: 50,
} as const;
export function spanCandidate(chunk: AnalysisChunk): FixtureCandidate {
  return {
    id: chunk.id,
    evidence: chunk.spans.map(({ sourceId, sourceVersionId, start, end }) => ({
      sourceId,
      sourceVersionId,
      start,
      end,
    })),
    disposition: "hold",
  };
}
export function inventoryManifest(project: Project) {
  const source = project.sources.find((s) => s.role === "conversation");
  if (!source) throw new Error("会話資料がありません");
  const chunks = makeAnalysisChunks(project, source.id, INVENTORY_CHARS, 0);
  if (!chunks.length || chunks.length > INVENTORY_CAP)
    throw new Error(
      `原文範囲台帳は1〜${INVENTORY_CAP}候補に限定しています。切り捨てず停止しました`,
    );
  const candidates = chunks.map(spanCandidate);
  // Validate the full immutable manifest using the existing bounded contract.
  // No pair work is performed by this validation.
  for (const chunk of chunks) {
    if (chunk.id.length > 128 || chunk.spans.length > 64)
      throw new Error("原文範囲台帳の識別子・参照数上限を超えています");
  }
  reconcileFixtureCandidates(candidates, {
    ...INVENTORY_LIMITS,
    maxComparisons: 0,
  });
  const ranges = candidates
    .flatMap((c) => c.evidence)
    .sort((a, b) => a.start - b.start);
  const uncovered: Array<{ start: number; end: number }> = [];
  let end = 0;
  for (const span of ranges) {
    if (span.start > end) uncovered.push({ start: end, end: span.start });
    end = Math.max(end, span.end);
  }
  if (end < source.text.length)
    uncovered.push({ start: end, end: source.text.length });
  return {
    source,
    chunks,
    candidates,
    uncovered,
    excludedSources: project.sources
      .filter((s) => s.id !== source.id)
      .map((s) => s.id),
  };
}
export function validateSpanCandidate(value: unknown, chunk: AnalysisChunk) {
  const expected = spanCandidate(chunk);
  if (canonicalSettings(value) !== canonicalSettings(expected))
    throw new Error("原文範囲候補が入力資料と一致しません");
  return expected;
}
export function parseInventoryResult(
  value: unknown,
  candidates: readonly FixtureCandidate[],
) {
  return parseBoundedResult(value, candidates);
}
