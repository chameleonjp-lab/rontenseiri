import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(
  new URL("../docs/evaluation/evidence/5b0ac40/", import.meta.url),
);
const SHA = "5b0ac40129ded26a1cff844d7de5937c7f866b12";
const readJson = (name: string) =>
  JSON.parse(readFileSync(join(root, name), "utf8"));

describe("preserved diagnostic evidence, not current-SHA acceptance", () => {
  it("preserves every archived source byte and the source SHA", () => {
    const manifest = readJson("manifest.json") as {
      testedApplicationSha: string;
      files: Array<{ file: string; sha256: string; byteExactCopy: boolean }>;
    };
    expect(manifest.testedApplicationSha).toBe(SHA);
    expect(manifest.files).toHaveLength(12);
    for (const file of manifest.files) {
      expect(file.byteExactCopy).toBe(true);
      const actual = createHash("sha256")
        .update(readFileSync(join(root, file.file)))
        .digest("hex");
      expect(actual, file.file).toBe(file.sha256);
    }
  });

  it("keeps the original completed dev measurement a failed nearest-rank budget result", () => {
    const raw = readJson("legacy-performance.json.raw");
    expect(raw.testedSha).toBe(SHA);
    expect(raw.servedIdentity).toMatchObject({
      sha: SHA,
      buildSha: SHA,
      dirty: false,
      mode: "development",
    });
    expect(raw.complete).toBe(true);
    expect(raw.failure).toBeNull();
    expect(raw.eligibleForG5).toBe(false);
    const expected: Record<string, { p95: number; passed: boolean }> = {
      "node-selection": { p95: 249.9, passed: false },
      "node-search": { p95: 296.7, passed: false },
      "branch-collapse-toggle": { p95: 185.0, passed: true },
    };
    expect(raw.operations).toHaveLength(3);
    for (const op of raw.operations) {
      expect(op.count).toBe(100);
      expect(op.values).toHaveLength(100);
      expect(op.thresholdMs).toBe(200);
      const sorted = [...op.values].sort((a: number, b: number) => a - b);
      expect(op.p95).toBe(sorted[Math.ceil(100 * 0.95) - 1]);
      expect(op.p95).toBeCloseTo(expected[op.name].p95, 1);
      expect(op.withinLatencyBudget).toBe(expected[op.name].passed);
    }
  });

  it("does not turn 8-operation profiling into a rerun or budget/causality acceptance", () => {
    const manifest = readJson("manifest.json");
    expect(manifest.historicalExperimentRerun).toBe(false);
    expect(manifest.historicalCauseResolved).toBe(false);
    expect(manifest.shortDiagnosticIsNotBudgetAcceptance).toBe(true);
    for (const mode of ["dev", "production"]) {
      const raw = readJson(`short-profile/${mode}/diagnostic.json.raw`);
      expect(raw.protocol).toBe("diagnostic-cdp-short-v1");
      expect(raw.sha).toBe(SHA);
      expect(raw.dirty).toBe(false);
      expect(raw.health).toMatchObject({
        sha: SHA,
        buildSha: SHA,
        mode: mode === "dev" ? "development" : "production",
        dirty: false,
      });
      expect(raw.operations).toHaveLength(8);
      expect(
        raw.operations.filter((op: { name: string }) =>
          op.name.startsWith("selection-"),
        ),
      ).toHaveLength(4);
      expect(
        raw.operations.filter((op: { name: string }) =>
          op.name.startsWith("search-"),
        ),
      ).toHaveLength(4);
      expect(raw).not.toHaveProperty("withinLatencyBudget");
      expect(raw).not.toHaveProperty("p95");
    }
  });
});
