import { loadProject } from "../storage/projects";
import { canonicalSettings } from "./session";
import { activeSources } from "../domain/capacity";
import {
  inventoryManifest,
  INVENTORY_CHARS,
  INVENTORY_CONFIG,
  INVENTORY_LIMITS,
  validateSpanCandidate,
  parseInventoryPage,
  parseInventoryResult,
} from "./span-inventory";
import type { FixtureCandidate } from "./bounded-reconcile";
import type { Project } from "../domain/types";
import { AnalysisSession, type AnalysisAdapter } from "./session";
import { withAnalysisOwnership } from "./ownership";
import {
  assertLocalRunRecord,
  claimLocalRun,
  readLocalRun,
  writeLocalRun,
  type LocalRunRecord,
} from "../storage/analysis-runs";
export function createInventoryWorker(
  runId: string,
  generationId: string,
  signal: AbortSignal,
) {
  if (signal.aborted) throw new DOMException("cancelled", "AbortError");
  const worker = new Worker(
    new URL("../workers/inventory.worker.ts", import.meta.url),
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
        runId,
        generationId,
        requestId,
        ...payload,
      });
    });
  const adapter: AnalysisAdapter = {
    analyzeChunk: ({ chunk }) => request({ phase: "candidate", chunk }),
    reconcile: ({ candidates, prior }) => {
      const manifest = candidates.map((c) => c.value as FixtureCandidate);
      const previous =
        prior.reconciled === undefined
          ? undefined
          : parseInventoryResult(prior.reconciled, manifest);
      return request({
        phase: "reconcile",
        candidates: manifest,
        cursor: previous?.cursor,
      }).then((value) => parseInventoryPage(value, manifest));
    },
  };
  return {
    adapter,
    dispose: () => {
      signal.removeEventListener("abort", dispose);
      dispose();
    },
  };
}
export function inventoryRunId(project: Project) {
  return `span-inventory:${project.id}`;
}
function inventoryOptions(project: Project) {
  const manifest = inventoryManifest(project);
  return {
    project: { ...project, sources: activeSources(project) },
    maxChars: INVENTORY_CHARS,
    overlapChars: 0,
    configId: INVENTORY_CONFIG,
    parserVersion: "input-parser-v1",
    analysisVersion: "source-span-inventory-session-v1",
    outputSchemaVersion: "fixture-bounded-reconciliation-v1",
    runSettings: {
      mode: "source-span-inventory-all-hold",
      limits: INVENTORY_LIMITS,
      model: null,
      prompt: null,
      temperature: null,
    },
    manualCorrectionIds: project.revisions.map((r) => r.id),
    validateCandidate: validateSpanCandidate,
    validateReconciled: (value: unknown) =>
      parseInventoryResult(value, manifest.candidates),
  };
}
export async function inspectInventoryRecord(
  project: Project,
  record: LocalRunRecord,
) {
  const session = new AnalysisSession({
    ...inventoryOptions(project),
    sessionId: record.runId,
    adapter: {
      analyzeChunk: async () => {
        throw new Error("read-only");
      },
      reconcile: async () => {
        throw new Error("read-only");
      },
    },
  });
  assertLocalRunRecord(record, {
    id: inventoryRunId(project),
    runId: record.runId,
    fingerprint: await session.fingerprint,
    total: session.chunks.length,
  });
  await session.inspectCheckpoint(record.checkpoint);
  if (record.checkpoint?.reconciled === undefined) {
    if (record.state === "completed" || record.state === "partial")
      throw new Error("結果のない完了状態です");
    return undefined;
  }
  const result = parseInventoryResult(
    record.checkpoint.reconciled,
    inventoryManifest(project).candidates,
  );
  if (
    (record.state === "completed" && result.status !== "complete") ||
    (record.state === "partial" && result.status !== "partial")
  )
    throw new Error("保存状態と結果状態が一致しません");
  return result;
}
/**
 * A project revision for the inventory save gate. `updatedAt` is deliberately
 * excluded because IndexedDB assigns it during the completed save transaction;
 * every other field, including storageRevision, participates in the match.
 */
export function inventoryProjectRevision(project: Project): string {
  return canonicalSettings({ ...project, updatedAt: "" });
}

export async function assertInventoryDurable(project: Project) {
  if (!project.saved)
    throw new Error("台帳を開始する前に現在版をこの端末に保存してください");
  let durable: Project;
  try {
    durable = await loadProject(project.id);
  } catch {
    throw new Error(
      "現在版の永続保存を確認できません。保存完了後に台帳を開始してください",
    );
  }
  if (
    !durable.saved ||
    inventoryProjectRevision(project) !== inventoryProjectRevision(durable)
  )
    throw new Error(
      "現在版の永続保存を確認できません。保存完了後に台帳を開始してください",
    );
}
export async function runSpanInventory(
  project: Project,
  signal: AbortSignal,
  onRecord: (record: LocalRunRecord) => void,
) {
  const snapshot = structuredClone(project);
  inventoryManifest(snapshot);
  const id = inventoryRunId(snapshot);
  const owner = crypto.randomUUID(); // A new generation for every start/resume attempt.
  return withAnalysisOwnership(
    async (lease) => {
      if (lease.signal.aborted)
        throw new DOMException("cancelled", "AbortError");
      await assertInventoryDurable(snapshot);
      if (lease.signal.aborted)
        throw new DOMException("cancelled", "AbortError");
      const existing = await readLocalRun(id);
      const runId = existing?.runId ?? crypto.randomUUID();
      const workerController = new AbortController();
      let transport: ReturnType<typeof createInventoryWorker> | undefined;
      let claimed = false;
      const session: AnalysisSession = new AnalysisSession({
        sessionId: runId,
        generationId: owner,
        ...inventoryOptions(snapshot),
        initialCheckpoint: existing?.checkpoint,
        adapter: {
          analyzeChunk: (input, chunkSignal) =>
            transport!.adapter.analyzeChunk(input, chunkSignal),
          reconcile: (input, chunkSignal) =>
            transport!.adapter.reconcile(input, chunkSignal),
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
            if (!lease.signal.aborted)
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
      lease.signal.addEventListener("abort", cancel, { once: true });
      if (lease.signal.aborted) cancel();
      const publish = (state: LocalRunRecord["state"], error?: string) =>
        writeLocalRun(
          id,
          owner,
          (record) => ({ ...record, state, error }),
          state === "completed" || state === "partial"
            ? lease.signal
            : undefined,
        );
      try {
        // Pure validation first. A mismatch/corrupt prefix leaves the entire DB record unchanged.
        await session.inspectCheckpoint(existing?.checkpoint);
        if (lease.signal.aborted)
          throw new DOMException("cancelled", "AbortError");
        const fingerprint = await session.fingerprint;
        if (existing)
          assertLocalRunRecord(existing, {
            id,
            runId,
            fingerprint,
            total: session.chunks.length,
          });
        if (existing) {
          await inspectInventoryRecord(snapshot, existing);
          if (existing.state === "completed") {
            onRecord(existing);
            return;
          }
        }
        await claimLocalRun(id, owner, session.chunks.length, {
          runId,
          fingerprint,
          expected: existing ?? null,
        });
        claimed = true;
        if (lease.signal.aborted)
          throw new DOMException("cancelled", "AbortError");
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
        transport = createInventoryWorker(
          runId,
          owner,
          workerController.signal,
        );
        const result = await session.run(lease.signal);
        await publish(result.status === "partial" ? "partial" : "completed");
      } catch (error) {
        const cancelled =
          lease.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError");
        if (claimed)
          await publish(
            cancelled ? "cancelled" : "failed",
            cancelled ? undefined : String(error),
          );
        throw error;
      } finally {
        lease.signal.removeEventListener("abort", cancel);
        transport?.dispose();
      }
    },
    { signal, ownerId: owner, leaseMs: 3_600_000 },
  );
}
