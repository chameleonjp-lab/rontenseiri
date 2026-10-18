import { openDB, type DBSchema } from "idb";
import type { AnalysisCheckpoint } from "../analysis/session";

export type RunState = "running" | "cancelled" | "failed" | "completed";
export interface LocalRunRecord {
  id: string;
  owner: string;
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
    await tx.store.put(update(record), id);
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
export async function claimLocalRun(id: string, owner: string, total: number) {
  const db = await database();
  const tx = db.transaction("runs", "readwrite");
  const done = tx.done;
  void done.catch(() => {});
  try {
    const old = await tx.store.get(id);
    await tx.store.put(
      { id, owner, total, state: "running", checkpoint: old?.checkpoint },
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
