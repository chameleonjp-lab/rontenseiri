import { spanCandidate, INVENTORY_LIMITS } from "../analysis/span-inventory";
import {
  reconcileFixtureCandidates,
  type FixtureCandidate,
  type BoundedCursor,
} from "../analysis/bounded-reconcile";
import type { AnalysisChunk } from "../analysis/session";
type Request = {
  runId: string;
  generationId: string;
  requestId: number;
} & (
  | { phase: "candidate"; chunk: AnalysisChunk }
  | {
      phase: "reconcile";
      candidates: FixtureCandidate[];
      cursor?: BoundedCursor;
    }
);
self.onmessage = (event: MessageEvent<Request>) => {
  const request = event.data;
  const identity = {
    runId: request.runId,
    generationId: request.generationId,
    requestId: request.requestId,
  };
  try {
    const value =
      request.phase === "candidate"
        ? spanCandidate(request.chunk)
        : reconcileFixtureCandidates(request.candidates, INVENTORY_LIMITS, {
            cursor: request.cursor,
          });
    self.postMessage({ ...identity, value });
  } catch (error) {
    self.postMessage({ ...identity, error: String(error) });
  }
};
