import { validateFixtureCandidate } from "./fixture-protocol";
import type { Project } from "../domain/types";
import { AnalysisSession, type AnalysisAdapter } from "./session";
import { withAnalysisOwnership } from "./ownership";
import {
  claimLocalRun,
  readLocalRun,
  writeLocalRun,
  type LocalRunRecord,
} from "../storage/analysis-runs";
export const TRANSPORT_CONFIG =
  "transport-fixture-v2:400ms:no-model:no-inference";
export type FixtureScenario = "normal" | "fail-second";
export function createWorkerAdapter(
  runId: string,
  generationId: string,
  scenario: FixtureScenario,
  signal: AbortSignal,
) {
  const worker = new Worker(
    new URL("../workers/analysis.worker.ts", import.meta.url),
    { type: "module" },
  );
  let sequence = 0;
  let pending:
    | {
        id: number;
        resolve: (value: unknown) => void;
        reject: (error: Error) => void;
      }
    | undefined;
  const dispose = () => {
    worker.terminate();
    pending?.reject(new DOMException("cancelled", "AbortError"));
    pending = undefined;
  };
  signal.addEventListener("abort", dispose, { once: true });
  worker.onmessage = (event: MessageEvent) => {
    const reply = event.data;
    if (
      !reply ||
      signal.aborted ||
      reply.runId !== runId ||
      reply.generationId !== generationId ||
      reply.requestId !== pending?.id
    )
      return;
    const target = pending;
    pending = undefined;
    if (reply.error) target?.reject(new Error(reply.error));
    else target?.resolve(reply.value);
  };
  worker.onerror = (event) => {
    pending?.reject(new Error(event.message || "Worker failed"));
    pending = undefined;
  };
  const request = (payload: object) =>
    new Promise<unknown>((resolve, reject) => {
      if (signal.aborted) {
        reject(new DOMException("cancelled", "AbortError"));
        return;
      }
      if (pending) {
        reject(new Error("concurrent Worker request rejected"));
        return;
      }
      const requestId = ++sequence;
      pending = { id: requestId, resolve, reject };
      worker.postMessage({
        type: "transport-fixture",
        runId,
        generationId,
        requestId,
        scenario,
        ...payload,
      });
    });
  const adapter: AnalysisAdapter = {
    analyzeChunk: ({ chunk }) => request({ phase: "candidate", chunk }),
    reconcile: ({ candidates }) =>
      request({
        phase: "reconcile",
        chunkIds: candidates.map((c) => c.chunkId),
      }),
  };
  return {
    adapter,
    dispose: () => {
      signal.removeEventListener("abort", dispose);
      dispose();
    },
  };
}
export function localRunId(project: Project) {
  return `transport:${project.id}`;
}
export async function runLocalTransport(
  project: Project,
  scenario: FixtureScenario,
  signal: AbortSignal,
  onRecord: (record: LocalRunRecord) => void,
) {
  const snapshot = structuredClone(project);
  const id = localRunId(snapshot);
  const owner = crypto.randomUUID(); // A new generation for every start/resume attempt.
  return withAnalysisOwnership(
    async () => {
      if (signal.aborted) throw new DOMException("cancelled", "AbortError");
      const existing = await readLocalRun(id);
      const runId = existing?.runId ?? crypto.randomUUID();
      const workerController = new AbortController();
      let transport: ReturnType<typeof createWorkerAdapter> | undefined;
      let claimed = false;
      const session: AnalysisSession = new AnalysisSession({
        sessionId: runId,
        generationId: owner,
        project: snapshot,
        maxChars: 160,
        overlapChars: 0,
        configId: TRANSPORT_CONFIG,
        parserVersion: "input-parser-v1",
        analysisVersion: "transport-session-v2",
        outputSchemaVersion: "transport-evidence-v2",
        runSettings: {
          mode: "transport-only",
          responseDelayMs: 400,
          model: null,
          prompt: null,
          temperature: null,
        },
        initialCheckpoint: existing?.checkpoint,
        adapter: {
          analyzeChunk: (input, chunkSignal) =>
            transport!.adapter.analyzeChunk(input, chunkSignal),
          reconcile: (input, chunkSignal) =>
            transport!.adapter.reconcile(input, chunkSignal),
        },
        manualCorrectionIds: snapshot.revisions.map((r) => r.id),
        validateCandidate: validateFixtureCandidate,
        validateReconciled(value) {
          const expected = {
            mode: "transport-only",
            chunkIds: session.chunks.map((c) => c.id),
          };
          if (JSON.stringify(value) !== JSON.stringify(expected))
            throw new Error("照合結果が不完全です");
          return expected;
        },
        checkpointStore: {
          load: async () => (await readLocalRun(id))?.checkpoint,
          save: async (checkpoint, saveSignal) => {
            await writeLocalRun(
              id,
              owner,
              (record) => {
                if (record.state !== "running" || record.runId !== runId)
                  throw new Error("終了済みrunのchunk保存を拒否しました");
                return { ...record, checkpoint };
              },
              saveSignal,
            );
            if (!signal.aborted)
              onRecord({
                id,
                runId,
                owner,
                generationId: owner,
                fingerprint: checkpoint.fingerprint!,
                state: "running",
                total: session.chunks.length,
                checkpoint,
              });
          },
        },
      });
      // Linearization order: synchronously invalidate session generation, then stop Worker.
      const cancel = () => {
        session.cancel();
        workerController.abort();
      };
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) cancel();
      const publish = (state: LocalRunRecord["state"], error?: string) =>
        writeLocalRun(
          id,
          owner,
          (record) => ({ ...record, state, error }),
          state === "completed" ? signal : undefined,
        );
      try {
        // Pure validation first. A mismatch/corrupt prefix leaves the entire DB record unchanged.
        await session.inspectCheckpoint(existing?.checkpoint);
        if (signal.aborted) throw new DOMException("cancelled", "AbortError");
        const fingerprint = await session.fingerprint;
        await claimLocalRun(id, owner, session.chunks.length, {
          runId,
          fingerprint,
          expected: existing ?? null,
        });
        claimed = true;
        if (signal.aborted) throw new DOMException("cancelled", "AbortError");
        onRecord({
          id,
          runId,
          owner,
          generationId: owner,
          fingerprint,
          state: "running",
          total: session.chunks.length,
          checkpoint: existing?.checkpoint,
        });
        transport = createWorkerAdapter(
          runId,
          owner,
          scenario,
          workerController.signal,
        );
        await session.run(signal);
        await publish("completed");
      } catch (error) {
        const cancelled =
          signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError");
        if (claimed)
          await publish(
            cancelled ? "cancelled" : "failed",
            cancelled ? undefined : String(error),
          );
        throw error;
      } finally {
        signal.removeEventListener("abort", cancel);
        transport?.dispose();
      }
    },
    { signal, ownerId: owner, leaseMs: 3_600_000 },
  );
}
