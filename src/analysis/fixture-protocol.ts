import type { AnalysisChunk } from "./session";
export function fixtureCandidate(chunk: AnalysisChunk) {
  return {
    mode: "transport-only",
    chunkId: chunk.id,
    sourceVersionId: chunk.sourceVersionId,
    spanCount: chunk.spans.length,
  };
}
export function validateFixtureCandidate(value: unknown, chunk: AnalysisChunk) {
  const expected = fixtureCandidate(chunk);
  if (JSON.stringify(value) !== JSON.stringify(expected))
    throw new Error("Worker chunkの検証に失敗しました");
  return expected;
}
