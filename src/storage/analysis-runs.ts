import { openDB, type DBSchema } from "idb";
import type { AnalysisCheckpoint } from "../analysis/session";

export type RunState = "running" | "cancelled" | "failed" | "completed";
export interface LocalRunRecord {
  id: string;
  owner: string;
  runId: string;
  generationId: string;
  fingerprint: string;
  state: RunState;
  checkpoint?: AnalysisCheckpoint;
  error?: string;
  total: number;
}
interface RunSchema extends DBSchema {
  runs: { key: string; value: LocalRunRecord };
}
const database = () =>
  openDB<RunSchema>("rontenseiri-analysis-runs-v1", 1, {
    upgrade(db) {
      db.createObjectStore("runs");
    },
  });
export async function readLocalRun(id: string) {
  const db = await database();
  try {
    return await db.get("runs", id);
  } finally {
    db.close();
  }
}
/** A single IDB transaction is the fence: an older owner's late write cannot win. */
export async function writeLocalRun(
  id: string,
  owner: string,
  update: (record: LocalRunRecord) => LocalRunRecord,
  signal?: AbortSignal,
) {
  const db = await database();
  const tx = db.transaction("runs", "readwrite");
  const done = tx.done;
  void done.catch(() => {});
  const abort = () => {
    try {
      tx.abort();
    } catch {
      /* already finished */
    }
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) throw new DOMException("cancelled", "AbortError");
    const record = await tx.store.get(id);
    if (!record || record.owner !== owner)
      throw new Error("旧runの保存を拒否しました");
    const next = update(record);
    if (
      next.runId !== record.runId ||
      next.generationId !== owner ||
      next.owner !== owner ||
      next.fingerprint !== record.fingerprint
    )
      throw new Error("run/generation/fingerprint fence mismatch");
    const cp = next.checkpoint;
    if (
      cp &&
      (cp.runId !== next.runId ||
        cp.generationId !== next.generationId ||
        cp.fingerprint !== next.fingerprint ||
        cp.nextChunk !== cp.candidates.length ||
        cp.lastCommittedChunkIndex !== cp.nextChunk - 1)
    )
      throw new Error("checkpoint/cursor atomicity violation");
    if (
      next.state === "completed" &&
      (!cp || cp.nextChunk !== next.total || cp.reconciled === undefined)
    )
      throw new Error("incomplete run cannot complete");
    await tx.store.put(next, id);
    await done;
  } catch (error) {
    abort();
    await done.catch(() => {});
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    db.close();
  }
}
export async function claimLocalRun(
  id: string,
  owner: string,
  total: number,
  options: {
    runId?: string;
    fingerprint?: string;
    expected?: LocalRunRecord | null;
  } = {},
) {
  const db = await database();
  const tx = db.transaction("runs", "readwrite");
  const done = tx.done;
  void done.catch(() => {});
  try {
    const old = await tx.store.get(id);
    if (
      options.expected !== undefined &&
      JSON.stringify(old ?? null) !== JSON.stringify(options.expected)
    )
      throw new Error("run changed during preflight");
    const runId = options.runId ?? old?.runId ?? crypto.randomUUID();
    if (old && old.runId !== runId)
      throw new Error(
        "新runは別IDが必要です。checkpointを明示破棄してください",
      );
    const fingerprint = options.fingerprint ?? old?.fingerprint ?? "";
    if (old?.checkpoint && old.checkpoint.fingerprint !== fingerprint)
      throw new Error("checkpoint fingerprint mismatch");
    await tx.store.put(
      {
        id,
        runId,
        owner,
        generationId: owner,
        fingerprint,
        total,
        state: "running",
        checkpoint: old?.checkpoint
          ? { ...old.checkpoint, generationId: owner }
          : undefined,
      },
      id,
    );
    await done;
    return old?.checkpoint;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* already finished */
    }
    await done.catch(() => {});
    throw error;
  } finally {
    db.close();
  }
}
export async function clearLocalRun(id: string) {
  const db = await database();
  try {
    await db.delete("runs", id);
  } finally {
    db.close();
  }
}
