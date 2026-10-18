import { recordMetric } from "../diagnostics/metrics";
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Project } from "../domain/types";
import { validateProject } from "../domain/project";
import { projectCapacity, MAX_BACKUP_BYTES } from "../domain/capacity";

export const DB_NAME = "rontenseiri-projects-v1";
export const LEGACY_DB_NAME = "rontenseiri";
const STORE = "projects";
interface Schema extends DBSchema {
  projects: { key: string; value: Project };
}
let dbPromise: Promise<IDBPDatabase<Schema>> | undefined;
function unavailable(): Error {
  return new Error(
    "ブラウザのローカル保存（IndexedDB）が利用できません。JSONをダウンロードして保管してください。",
  );
}
function getDb() {
  if (typeof indexedDB === "undefined") return Promise.reject(unavailable());
  return (dbPromise ??= openDB<Schema>(DB_NAME, 1, {
    upgrade(d) {
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
    },
  }));
}
function explain(error: unknown): Error {
  const e = error instanceof Error ? error : new Error(String(error));
  if (/quota|out.of.space|disk.*full/i.test(e.name + e.message))
    return new Error(
      "ブラウザの保存容量が不足しています。既存の保存は維持されます。JSONをダウンロードしてください。",
    );
  return e;
}
export async function listProjects(): Promise<Project[]> {
  const started = performance.now();
  try {
    const result = (await (await getDb()).getAll(STORE)).map(validateProject);
    recordMetric("restore", performance.now() - started);
    return result;
  } catch (e) {
    throw explain(e);
  }
}
export class StorageConflictError extends Error {
  constructor() {
    super(
      "保存の競合：別の画面または処理で新しい版が保存されています。現在の編集をJSONへ退避し、ホームから最新保存版を開いてください。",
    );
    this.name = "StorageConflictError";
  }
}
export function storageGeneration(
  incoming: Project,
  stored: Project | undefined,
): number {
  const expected = incoming.storageRevision ?? 0;
  const actual = stored?.storageRevision ?? 0;
  if (stored && expected !== actual) throw new StorageConflictError();
  if (!Number.isSafeInteger(actual) || actual < 0)
    throw new Error("保存版が不正です");
  return actual + 1;
}
export async function loadProject(id: string): Promise<Project> {
  const p = await (await getDb()).get(STORE, `project:${id}`);
  if (!p) throw new Error("保存データが見つかりません");
  return validateProject(p);
}
export async function saveProject(project: Project): Promise<Project> {
  const started = performance.now();
  const p = validateProject({
    ...project,
    saved: true,
    updatedAt: new Date().toISOString(),
  });
  try {
    const db = await getDb();
    const tx = db.transaction(STORE, "readwrite");
    // idb exposes request errors and transaction completion separately. Observe
    // completion before any request can fail, but preserve the original error.
    const completion = tx.done;
    void completion.catch(() => {});
    const key = `project:${p.id}`;
    try {
      const stored = await tx.store.get(key);
      const previousRevision = p.storageRevision;
      p.storageRevision = storageGeneration(p, stored);
      // validateProject already checked the normalized record's full size.
      // Only adding the generation field or increasing its digit count can
      // grow the JSON after that check; equal-width numbers cost equal bytes.
      if (
        (previousRevision === undefined ||
          String(p.storageRevision).length > String(previousRevision).length) &&
        projectCapacity(p).backupBytes > MAX_BACKUP_BYTES
      )
        throw new Error(
          "保存データが50MiBを超えています。既存の保存は維持されます。",
        );
      await tx.store.put(p, key);
      await completion;
    } catch (error) {
      try {
        tx.abort();
      } catch {
        // A failed request may already have aborted the transaction.
      }
      await completion.catch(() => {});
      throw error;
    }
    recordMetric("save", performance.now() - started);
    return p;
  } catch (error) {
    throw explain(error);
  }
}
export async function deleteProject(id: string): Promise<void> {
  if (!id) throw new Error("id required");
  try {
    await (await getDb()).delete(STORE, `project:${id}`);
  } catch (e) {
    throw explain(e);
  }
}
/** Legacy data is intentionally not opened or deleted automatically. Call this only after an explicit user migration choice. */
export async function migrateLegacyProjects(): Promise<{
  migrated: number;
  source: string;
}> {
  throw new Error(
    `旧版データ（${LEGACY_DB_NAME}）は自動移行しません。明示的なJSONエクスポート／インポートを使用してください。`,
  );
}
