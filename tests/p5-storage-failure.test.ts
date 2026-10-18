import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleProject } from "../src/analysis/sample";
import type { Project } from "../src/domain/types";
import { MAX_BACKUP_BYTES, projectCapacity } from "../src/domain/capacity";

vi.mock("idb", () => ({ openDB: vi.fn() }));

type IndexedDBGlobal = { indexedDB?: unknown };
type SaveTransaction = {
  abort: () => void;
  store: {
    get: (key: string) => Promise<Project | undefined>;
    put: (value: Project, key: string) => Promise<void>;
  };
  readonly done: Promise<void>;
};

type Harness = {
  db: { transaction: () => SaveTransaction };
  persisted: Map<string, Project>;
  attempted: Project[];
  keys: string[];
  doneAccesses: number;
};

const indexedDBGlobal = globalThis as IndexedDBGlobal;
let hadIndexedDB = false;
let originalIndexedDB: unknown;

function richProject(saved: boolean, storageRevision: number): Project {
  const project = structuredClone(sampleProject());
  project.saved = saved;
  project.storageRevision = storageRevision;
  project.revisions = [
    {
      id: "revision-rich",
      at: "2026-10-17T12:00:00.000Z",
      targetId: "U01",
      kind: "user-revision",
      before: { classification: "main" },
      after: { classification: "derived" },
      reason: "保存失敗の復旧試験",
    },
  ];
  return project;
}

function makeHarness(
  putBehavior: "quota" | "abort-after-put" | "quota-and-abort" | "success",
  stored: Project,
): Harness {
  const key = `project:${stored.id}`;
  const persisted = new Map([[key, structuredClone(stored)]]);
  const attempted: Project[] = [];
  const keys: string[] = [];
  let doneAccesses = 0;
  let staged: Project | undefined;
  let resolveDone!: () => void;
  let rejectDone!: (error: unknown) => void;
  const donePromise = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  const transaction: SaveTransaction = {
    abort: () =>
      rejectDone(new DOMException("transaction aborted", "AbortError")),
    store: {
      get: async (requestedKey) => structuredClone(persisted.get(requestedKey)),
      put: async (value, requestedKey) => {
        keys.push(requestedKey);
        attempted.push(structuredClone(value));
        if (putBehavior === "quota" || putBehavior === "quota-and-abort") {
          if (putBehavior === "quota-and-abort")
            queueMicrotask(() =>
              rejectDone(
                new DOMException(
                  "transaction aborted after quota",
                  "AbortError",
                ),
              ),
            );
          throw new DOMException("storage quota reached", "QuotaExceededError");
        }
        staged = structuredClone(value);
        if (putBehavior === "success") queueMicrotask(resolveDone);
        else
          queueMicrotask(() =>
            rejectDone(new DOMException("transaction aborted", "AbortError")),
          );
      },
    },
    get done() {
      doneAccesses += 1;
      return donePromise;
    },
  };

  // A successful transaction is the only point at which the fake store commits.
  donePromise.then(
    () => {
      if (staged) persisted.set(key, structuredClone(staged));
    },
    () => undefined,
  );

  return {
    db: { transaction: () => transaction },
    persisted,
    attempted,
    keys,
    get doneAccesses() {
      return doneAccesses;
    },
  };
}

beforeEach(() => {
  hadIndexedDB = Object.prototype.hasOwnProperty.call(
    indexedDBGlobal,
    "indexedDB",
  );
  originalIndexedDB = indexedDBGlobal.indexedDB;
  indexedDBGlobal.indexedDB = {};
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (hadIndexedDB) indexedDBGlobal.indexedDB = originalIndexedDB;
  else delete indexedDBGlobal.indexedDB;
});

describe("saveProject storage failure atomicity", () => {
  it("commits an exact 50MiB normalized save", async () => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-18T06:00:00.000Z"));
    const stored = richProject(true, 1);
    const caller = structuredClone(stored);
    caller.updatedAt = new Date().toISOString();
    caller.revisions[0].reason += "x".repeat(
      MAX_BACKUP_BYTES - projectCapacity(caller).backupBytes,
    );
    const originalCaller = structuredClone(caller);
    const harness = makeHarness("success", stored);
    const { openDB } = await import("idb");
    vi.mocked(openDB).mockResolvedValue(harness.db as never);
    const { saveProject } = await import("../src/storage/projects");
    const saved = await saveProject(caller);
    expect(projectCapacity(saved).backupBytes).toBe(MAX_BACKUP_BYTES);
    expect(harness.persisted.get(`project:${stored.id}`)).toEqual(saved);
    expect(saved.storageRevision).toBe(2);
    expect(caller).toEqual(originalCaller);
    expect(harness.attempted).toHaveLength(1);
  });

  it("rejects a normalized save exactly one byte over 50MiB without changing DB or caller", async () => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-18T06:00:00.000Z"));
    const stored = richProject(true, 1);
    const over = structuredClone(stored);
    over.updatedAt = new Date().toISOString();
    over.revisions[0].reason += "x".repeat(
      MAX_BACKUP_BYTES + 1 - projectCapacity(over).backupBytes,
    );
    const originalOver = structuredClone(over);
    const harness = makeHarness("success", stored);
    const { openDB } = await import("idb");
    vi.mocked(openDB).mockResolvedValue(harness.db as never);
    const { saveProject } = await import("../src/storage/projects");
    expect(projectCapacity(over).backupBytes).toBe(MAX_BACKUP_BYTES + 1);
    await expect(saveProject(over)).rejects.toThrow("50MiB");
    expect(harness.persisted.get(`project:${stored.id}`)).toEqual(stored);
    expect(over).toEqual(originalOver);
    expect(harness.attempted).toHaveLength(0);
  });

  it("aborts before put if storageRevision digit growth crosses the exact capacity boundary", async () => {
    vi.resetModules();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-18T06:00:00.000Z"));
    const stored = richProject(true, 9);
    const caller = structuredClone(stored);
    caller.updatedAt = new Date().toISOString();
    caller.revisions[0].reason += "x".repeat(
      MAX_BACKUP_BYTES - projectCapacity(caller).backupBytes,
    );
    const originalCaller = structuredClone(caller);
    const harness = makeHarness("success", stored);
    const { openDB } = await import("idb");
    vi.mocked(openDB).mockResolvedValue(harness.db as never);
    const { saveProject } = await import("../src/storage/projects");
    await expect(saveProject(caller)).rejects.toThrow("50MiB");
    expect(
      projectCapacity({ ...caller, storageRevision: 10 }).backupBytes,
    ).toBe(MAX_BACKUP_BYTES + 1);
    expect(harness.persisted.get(`project:${stored.id}`)).toEqual(stored);
    expect(caller).toEqual(originalCaller);
    expect(harness.attempted).toHaveLength(0);
    expect(harness.doneAccesses).toBe(1);
  });

  it.each(["quota", "abort-after-put", "quota-and-abort"] as const)(
    "first save %s leaves no record and preserves the caller",
    async (mode) => {
      vi.resetModules();
      const caller = richProject(false, 0);
      const originalCaller = structuredClone(caller);
      const harness = makeHarness(mode, caller);
      harness.persisted.clear();
      const { openDB } = await import("idb");
      vi.mocked(openDB).mockResolvedValue(harness.db as never);
      const { saveProject } = await import("../src/storage/projects");
      await expect(saveProject(caller)).rejects.toThrow();
      expect([...harness.persisted]).toEqual([]);
      expect(caller).toEqual(originalCaller);
      expect(harness.attempted).toHaveLength(1);
      expect(harness.attempted[0].storageRevision).toBe(1);
      expect(harness.doneAccesses).toBe(1);
    },
  );

  it("preserves the rich saved record and caller when put rejects for quota", async () => {
    vi.resetModules();
    const stored = richProject(true, 1);
    const caller = structuredClone(stored);
    caller.saved = false;
    caller.title = "編集途中の次版";
    const originalCaller = structuredClone(caller);
    const harness = makeHarness("quota", stored);
    const { openDB } = await import("idb");
    vi.mocked(openDB).mockResolvedValue(harness.db as never);

    const { saveProject } = await import("../src/storage/projects");
    await expect(saveProject(caller)).rejects.toThrow(
      "ブラウザの保存容量が不足しています",
    );

    expect(harness.persisted.get(`project:${stored.id}`)).toEqual(stored);
    expect(caller).toEqual(originalCaller);
    expect(harness.keys).toEqual([`project:${stored.id}`]);
    expect(harness.attempted).toHaveLength(1);
    expect(harness.attempted[0]).toEqual(
      expect.objectContaining({
        ...originalCaller,
        updatedAt: expect.any(String),
        saved: true,
        storageRevision: 2,
      }),
    );
    expect(harness.persisted.get(`project:${stored.id}`)).not.toEqual(
      harness.attempted[0],
    );
  });

  it("does not commit a staged put when transaction completion aborts", async () => {
    vi.resetModules();
    const stored = richProject(true, 1);
    const caller = structuredClone(stored);
    caller.saved = false;
    caller.title = "トランザクション中断の次版";
    const originalCaller = structuredClone(caller);
    const harness = makeHarness("abort-after-put", stored);
    const { openDB } = await import("idb");
    vi.mocked(openDB).mockResolvedValue(harness.db as never);

    const { saveProject } = await import("../src/storage/projects");
    await expect(saveProject(caller)).rejects.toThrow("transaction aborted");

    expect(harness.persisted.get(`project:${stored.id}`)).toEqual(stored);
    expect(caller).toEqual(originalCaller);
    expect(harness.keys).toEqual([`project:${stored.id}`]);
    expect(harness.attempted).toHaveLength(1);
    expect(harness.attempted[0]).toEqual(
      expect.objectContaining({
        ...originalCaller,
        updatedAt: expect.any(String),
        saved: true,
        storageRevision: 2,
      }),
    );
    expect(harness.doneAccesses).toBe(1);
    expect(harness.persisted.get(`project:${stored.id}`)).not.toEqual(
      harness.attempted[0],
    );
  });
  it("settles transaction completion as well when a quota request also aborts the transaction", async () => {
    vi.resetModules();
    const stored = richProject(true, 1);
    const caller = structuredClone(stored);
    caller.title = "quotaとabortが併発した次版";
    const originalCaller = structuredClone(caller);
    const harness = makeHarness("quota-and-abort", stored);
    const { openDB } = await import("idb");
    vi.mocked(openDB).mockResolvedValue(harness.db as never);
    const { saveProject } = await import("../src/storage/projects");
    await expect(saveProject(caller)).rejects.toThrow(
      "ブラウザの保存容量が不足しています",
    );
    expect(harness.persisted.get(`project:${stored.id}`)).toEqual(stored);
    expect(caller).toEqual(originalCaller);
    // The harness handles its own promise to avoid leaking the test's rejection.
    // Production must still observe transaction settlement, which idb caches
    // separately from the failing request promise.
    expect(harness.doneAccesses).toBeGreaterThan(0);
  });
});
