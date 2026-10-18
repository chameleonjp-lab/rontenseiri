import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { sampleProject } from "../src/analysis/sample";
import { activeSources } from "../src/domain/capacity";
import {
  INVENTORY_CHARS,
  INVENTORY_CONFIG,
  INVENTORY_LIMITS,
  inventoryManifest,
  spanCandidate,
  validateSpanCandidate,
  parseInventoryResult,
} from "../src/analysis/span-inventory";
import { reconcileFixtureCandidates } from "../src/analysis/bounded-reconcile";
import {
  AnalysisSession,
  type AnalysisCheckpoint,
} from "../src/analysis/session";
import {
  inventoryRunId,
  runSpanInventory,
} from "../src/analysis/inventory-run";
import type { LocalRunRecord } from "../src/storage/analysis-runs";
import * as runsStorage from "../src/storage/analysis-runs";
import * as projectStorage from "../src/storage/projects";

vi.mock("../src/storage/projects", () => ({ loadProject: vi.fn() }));
vi.mock("../src/storage/analysis-runs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/storage/analysis-runs")>()),
  claimLocalRun: vi.fn(),
  readLocalRun: vi.fn(),
  writeLocalRun: vi.fn(),
}));

const runId = "completed-fixture-run";
const owner = "completed-fixture-owner";
function fixtureProject() {
  const project = sampleProject();
  project.saved = true;
  project.utterances = [];
  project.agendas = project.agendas.map((agenda) => ({
    ...agenda,
    utteranceIds: [],
  }));
  project.relations = [];
  project.sources[0].text = "決定的な棚卸しfixture";
  return project;
}
function sessionOptions(project: ReturnType<typeof fixtureProject>) {
  const manifest = inventoryManifest({
    ...project,
    sources: activeSources(project),
  });
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
    manualCorrectionIds: project.revisions.map((revision) => revision.id),
    validateCandidate: validateSpanCandidate,
    validateReconciled: (value: unknown) =>
      parseInventoryResult(value, manifest.candidates),
  };
}
async function completedRecord(project: ReturnType<typeof fixtureProject>) {
  let checkpoint: AnalysisCheckpoint | undefined;
  const manifest = inventoryManifest({
    ...project,
    sources: activeSources(project),
  });
  const session = new AnalysisSession({
    ...sessionOptions(project),
    sessionId: runId,
    generationId: owner,
    adapter: {
      analyzeChunk: async ({ chunk }) => spanCandidate(chunk),
      reconcile: async ({ candidates }) =>
        reconcileFixtureCandidates(
          candidates.map(
            (candidate) => candidate.value as ReturnType<typeof spanCandidate>,
          ),
          INVENTORY_LIMITS,
          { elapsedMs: 0 },
        ),
    },
    checkpointStore: {
      load: async () => checkpoint,
      save: async (next) => {
        checkpoint = structuredClone(next);
      },
    },
  });
  const result = await session.run();
  expect(result.status).toBe("complete");
  expect(checkpoint).toBeDefined();
  expect(manifest.chunks).toHaveLength(1);
  return {
    id: inventoryRunId(project),
    owner,
    runId,
    generationId: owner,
    fingerprint: checkpoint!.fingerprint!,
    state: "completed",
    total: manifest.chunks.length,
    checkpoint,
  } satisfies LocalRunRecord;
}
class FixtureLocks {
  async request(
    _name: string,
    _options: LockOptions,
    callback: (lock: Lock | null) => Promise<void>,
  ) {
    await callback({ name: "rontenseiri-analysis" } as Lock);
  }
}

describe("completed inventory notification ownership fence", () => {
  let project: ReturnType<typeof fixtureProject>;
  let existing: LocalRunRecord;
  beforeEach(async () => {
    vi.useFakeTimers();
    project = fixtureProject();
    existing = await completedRecord(project);
    vi.mocked(projectStorage.loadProject).mockResolvedValue(
      structuredClone(project),
    );
    vi.mocked(runsStorage.readLocalRun).mockResolvedValue(existing);
    vi.mocked(runsStorage.claimLocalRun).mockClear();
    vi.mocked(runsStorage.writeLocalRun).mockClear();
    vi.stubGlobal("navigator", { locks: new FixtureLocks() });
    vi.stubGlobal(
      "Worker",
      vi.fn(() => {
        throw new Error("unexpected Worker");
      }),
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it.each(["cancel", "expiry"] as const)(
    "rejects after %s during completed inspection without notifying or mutating storage",
    async (mode) => {
      const original = AnalysisSession.prototype.inspectCheckpoint;
      const inspect = vi.spyOn(AnalysisSession.prototype, "inspectCheckpoint");
      let releaseInspection!: () => void;
      const paused = new Promise<void>((resolve) => {
        releaseInspection = resolve;
      });
      inspect
        .mockImplementationOnce(function (this: AnalysisSession, checkpoint) {
          return original.call(this, checkpoint);
        })
        .mockImplementationOnce(function (this: AnalysisSession, checkpoint) {
          return paused.then(() => original.call(this, checkpoint));
        });
      const onRecord = vi.fn();
      const controller = new AbortController();
      const before = structuredClone(existing);
      const beforeBytes = JSON.stringify(existing);
      const run = runSpanInventory(project, controller.signal, onRecord);
      await vi.waitFor(() => expect(inspect).toHaveBeenCalledTimes(2));
      if (mode === "cancel") controller.abort();
      else await vi.advanceTimersByTimeAsync(3_600_000);
      releaseInspection();
      await expect(run).rejects.toMatchObject({ name: "AbortError" });
      expect(onRecord).toHaveBeenCalledTimes(0);
      expect(runsStorage.claimLocalRun).toHaveBeenCalledTimes(0);
      expect(runsStorage.writeLocalRun).toHaveBeenCalledTimes(0);
      expect(Worker).not.toHaveBeenCalled();
      expect(existing).toEqual(before);
      expect(JSON.stringify(existing)).toBe(beforeBytes);
    },
  );
  it("publishes an already-completed record exactly once when ownership remains valid", async () => {
    const onRecord = vi.fn();
    await expect(
      runSpanInventory(project, new AbortController().signal, onRecord),
    ).resolves.toBeUndefined();
    expect(onRecord).toHaveBeenCalledTimes(1);
    expect(onRecord).toHaveBeenCalledWith(existing);
    expect(runsStorage.claimLocalRun).toHaveBeenCalledTimes(0);
    expect(runsStorage.writeLocalRun).toHaveBeenCalledTimes(0);
    expect(Worker).not.toHaveBeenCalled();
  });
});
