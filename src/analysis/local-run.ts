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
  "transport-fixture-v1:400ms:no-model:no-inference";
export type FixtureScenario = "normal" | "fail-second";
export function createWorkerAdapter(
  owner: string,
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
      signal.aborted ||
      reply.owner !== owner ||
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
      const requestId = ++sequence;
      pending = { id: requestId, resolve, reject };
      worker.postMessage({
        type: "transport-fixture",
        owner,
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
  const id = localRunId(project);
  const owner = crypto.randomUUID();
  // This path never selects a model. It proves transport/recovery, not AI quality.
  return withAnalysisOwnership(
    async () => {
      if (signal.aborted) throw new DOMException("cancelled", "AbortError");
      const transport = createWorkerAdapter(owner, scenario, signal);
      let session: AnalysisSession | undefined;
      const publish = async (
        state: LocalRunRecord["state"],
        error?: string,
      ) => {
        await writeLocalRun(
          id,
          owner,
          (record) => ({ ...record, state, error }),
          state === "completed" ? signal : undefined,
        );
      };
      try {
        session = new AnalysisSession({
          sessionId: id,
          project,
          maxChars: 160,
          overlapChars: 0,
          configId: TRANSPORT_CONFIG,
          adapter: transport.adapter,
          manualCorrectionIds: project.revisions.map((r) => r.id),
          validateCandidate: validateFixtureCandidate,
          validateReconciled(value) {
            const expected = {
              mode: "transport-only",
              chunkIds: session!.chunks.map((c) => c.id),
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
                  if (record.state !== "running")
                    throw new Error("終了済みrunのchunk保存を拒否しました");
                  return { ...record, checkpoint };
                },
                saveSignal,
              );
              if (!signal.aborted)
                onRecord({
                  id,
                  owner,
                  state: "running",
                  total: session!.chunks.length,
                  checkpoint,
                });
            },
          },
        });
        const checkpoint = await claimLocalRun(
          id,
          owner,
          session.chunks.length,
        );
        onRecord({
          id,
          owner,
          state: "running",
          total: session.chunks.length,
          checkpoint,
        });
        await session.run(signal);
        await publish("completed");
      } catch (error) {
        const cancelled =
          signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError");
        await publish(
          cancelled ? "cancelled" : "failed",
          cancelled ? undefined : String(error),
        );
        throw error;
      } finally {
        transport.dispose();
      }
    },
    { signal, ownerId: owner, leaseMs: 3_600_000 },
  );
}
