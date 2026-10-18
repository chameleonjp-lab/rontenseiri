import { describe, expect, it } from "vitest";
import { sampleProject } from "../src/analysis/sample";
import {
  inventoryManifest,
  spanCandidate,
  validateSpanCandidate,
  INVENTORY_CAP,
  INVENTORY_CHARS,
  INVENTORY_LIMITS,
} from "../src/analysis/span-inventory";
import {
  reconcileFixtureCandidates,
  parseBoundedResult,
} from "../src/analysis/bounded-reconcile";
import {
  inspectInventoryRecord,
  inventoryRunId,
  inventoryProjectRevision,
} from "../src/analysis/inventory-run";
import { AnalysisSession } from "../src/analysis/session";

describe("source span inventory is not model/semantic output", () => {
  it("derives only exact source references, all hold; exposes gaps and other sources", () => {
    const project = sampleProject();
    const before = structuredClone(project);
    const source = project.sources[0];
    project.sources.push({
      ...source,
      id: "excluded-conversation",
      versionId: "other-v1",
    });
    const manifest = inventoryManifest(project);
    expect(manifest.excludedSources).toContain("excluded-conversation");
    expect(manifest.uncovered.length).toBeGreaterThan(0); // speaker prefixes/newlines are not utterance quotes
    expect(manifest.candidates.length).toBe(manifest.chunks.length);
    for (const [i, c] of manifest.candidates.entries()) {
      expect(c).toEqual(spanCandidate(manifest.chunks[i]));
      expect(c.disposition).toBe("hold");
      expect(Object.keys(c).sort()).toEqual(["disposition", "evidence", "id"]);
      for (const span of c.evidence) {
        expect(span.sourceVersionId).toBe(source.versionId);
        expect(span.sourceId).toBe(source.id);
        expect(source.text.slice(span.start, span.end).length).toBe(
          span.end - span.start,
        );
      }
    }
    expect(project.agendas).toEqual(before.agendas);
    expect(project.relations).toEqual(before.relations);
    const complete = reconcileFixtureCandidates(
      manifest.candidates,
      {
        ...INVENTORY_LIMITS,
        maxComparisons: 50_000,
        maxRetainedResults: 50_000,
      },
      { elapsedMs: 0 },
    );
    expect(complete.status).toBe("complete");
    expect(complete.results.every((r) => r.disposition === "hold")).toBe(true);
    expect(parseBoundedResult(complete, manifest.candidates)).toEqual(complete);
  });
  it.each(["disposition", "reference", "text", "extra"])(
    "rejects forged %s",
    (fault) => {
      const chunk = inventoryManifest(sampleProject()).chunks[0];
      const value: any = structuredClone(spanCandidate(chunk));
      if (fault === "disposition") value.disposition = "relation";
      if (fault === "reference") value.evidence[0].sourceVersionId = "old";
      if (fault === "text") value.evidence[0].text = "AI says";
      if (fault === "extra") value.semantic = true;
      expect(() => validateSpanCandidate(value, chunk)).toThrow();
    },
  );
  it("refuses over-cap scope without silently truncating; exact cap remains admissible", () => {
    const p = sampleProject();
    p.utterances = [];
    p.sources[0].text = "あ".repeat(INVENTORY_CHARS * INVENTORY_CAP);
    expect(inventoryManifest(p).candidates).toHaveLength(INVENTORY_CAP);
    p.sources[0].text += "あ";
    expect(() => inventoryManifest(p)).toThrow(/切り捨てず停止/);
  });
  it("covers raw source when no utterances exist and retains selected-source identity", () => {
    const p = sampleProject();
    p.utterances = [];
    p.sources[0].text = "あいうえお";
    const m = inventoryManifest(p);
    expect(m.uncovered).toEqual([]);
    expect(m.candidates[0].evidence).toEqual([
      {
        sourceId: p.sources[0].id,
        sourceVersionId: p.sources[0].versionId,
        start: 0,
        end: 5,
      },
    ]);
  });
  it("rejects a corrupt run before read-only display", async () => {
    const project = sampleProject();
    const session = new AnalysisSession({
      project,
      adapter: { analyzeChunk: async () => ({}), reconcile: async () => ({}) },
    });
    await expect(
      inspectInventoryRecord(project, {
        id: inventoryRunId(project),
        runId: session.id,
        generationId: "owner",
        owner: "owner",
        fingerprint: "0".repeat(64),
        total: 10,
        state: "completed",
      }),
    ).rejects.toThrow();
  });
  it("uses the durable semantic revision, not the save timestamp", () => {
    const saved = sampleProject();
    saved.saved = true;
    saved.storageRevision = 4;
    const sameRevision = structuredClone(saved);
    sameRevision.updatedAt = "2099-01-01T00:00:00.000Z";
    expect(inventoryProjectRevision(sameRevision)).toBe(
      inventoryProjectRevision(saved),
    );

    const dirty = structuredClone(saved);
    dirty.utterances[0].classification =
      dirty.utterances[0].classification === "main" ? "derived" : "main";
    expect(inventoryProjectRevision(dirty)).not.toBe(
      inventoryProjectRevision(saved),
    );
    const otherStorageRevision = structuredClone(saved);
    otherStorageRevision.storageRevision = 5;
    expect(inventoryProjectRevision(otherStorageRevision)).not.toBe(
      inventoryProjectRevision(saved),
    );
  });
});

it("source correction → fresh inventory selects the utterance-referenced current version, never historical first version", async () => {
  const { reviseSource } = await import("../src/domain/project");
  const original = sampleProject();
  const historical = structuredClone(original.sources[0]);
  const corrected = reviseSource(
    original,
    "U01",
    "訂正後の台帳専用本文😀。",
    "台帳の現行版回帰",
  );
  expect(corrected.sources[0]).toEqual(historical);
  expect(corrected.sources.length).toBeGreaterThan(original.sources.length);
  const manifest = inventoryManifest(corrected);
  const currentVersion = corrected.utterances.find(
    (u) => u.id === "U01",
  )!.sourceVersionId;
  expect(manifest.source.versionId).toBe(currentVersion);
  expect(manifest.source.versionId).not.toBe(historical.versionId);
  expect(manifest.source.text).toContain("訂正後の台帳専用本文😀。");
  expect(
    corrected.utterances
      .filter((u) => u.sourceId === manifest.source.id)
      .every((u) => u.sourceVersionId === currentVersion),
  ).toBe(true);
  expect(
    manifest.chunks.some((c) => c.text.includes("訂正後の台帳専用本文😀。")),
  ).toBe(true);
  expect(
    manifest.chunks.every((c) => c.sourceVersionId === currentVersion),
  ).toBe(true);
  expect(
    manifest.candidates.every((c) =>
      c.evidence.every((s) => s.sourceVersionId === currentVersion),
    ),
  ).toBe(true);
  expect(original.sources[0]).toEqual(historical);
});
