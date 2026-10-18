import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  validateResult,
  type Operation,
} from "../scripts/controlled-performance.mjs";

const root = fileURLToPath(
  new URL("../docs/evaluation/evidence/7da450f/", import.meta.url),
);
const SHA = "7da450fd60dd8eb91ca686867c7dbcdaef944e53";
const readJson = (name: string) =>
  JSON.parse(readFileSync(join(root, name), "utf8"));

describe("PR11 archived diagnosis, not acceptance of the merge or current SHA", () => {
  it("rejects a forged pass made by clipping the archived failed fold values but retaining its log", () => {
    const forged = readJson("local-production/round-2-fold.json.raw");
    const metric = forged.operations[0];
    metric.values = metric.values.map((value: number) => Math.min(value, 199));
    const sorted = [...metric.values].sort((a: number, b: number) => a - b);
    metric.p50 = sorted[49];
    metric.p95 = sorted[94];
    metric.max = sorted[99];
    metric.withinLatencyBudget = true;
    forged.latencyBudgetGate.passed = true;
    forged.latencyBudgetGate.failedOperations = [];
    expect(validateResult(forged, "fold", SHA)).toEqual([
      "measured operation log does not match raw values",
    ]);
    // This deliberately corrupts only an in-memory copy; never the archived bytes.
    expect(
      readJson("local-production/round-2-fold.json.raw").operations[0].p95,
    ).toBe(200.5);
  });

  it.each(["39125745484", "39125750810"])(
    "keeps CI %s legacy dev success distinct from production groups",
    (run) => {
      const raw = readJson(`ci-${run}/legacy-development.json.raw`);
      expect(raw.testedSha).toBe(SHA);
      expect(raw.environment.browser).toBe("156.0.8078.4");
      expect(raw.servedIdentity.mode).toBe("development");
      expect(raw.protocol.mode).toBe("legacy-development-v2.1");
      expect(raw.protocol.warmupOperations).toBe(0);
      expect(raw.latencyBudgetGate.passed).toBe(true);
      expect(raw.g5Passed).toBe(false);
      expect(raw.operations).toHaveLength(3);
      for (const metric of raw.operations) {
        expect(metric.values).toHaveLength(100);
        expect(metric.thresholdMs).toBe(200);
        expect(
          [...metric.values].sort((a: number, b: number) => a - b)[94],
        ).toBe(metric.p95);
        expect(metric.withinLatencyBudget).toBe(true);
      }
    },
  );

  it("preserves all 39 source files byte-for-byte and keeps causality unresolved", () => {
    const manifest = readJson("manifest.json");
    expect(manifest.testedApplicationSha).toBe(SHA);
    expect(manifest.mainMergeSha).not.toBe(SHA);
    expect(manifest.historicalExperimentRerun).toBe(false);
    expect(manifest.historicalCauseResolved).toBe(false);
    expect(manifest.g5Passed).toBe(false);
    expect(manifest.files).toHaveLength(39);
    for (const file of manifest.files) {
      const bytes = readFileSync(join(root, file.file));
      expect(file.byteExactCopy).toBe(true);
      expect(bytes.length, file.file).toBe(file.bytes);
      expect(createHash("sha256").update(bytes).digest("hex"), file.file).toBe(
        file.sha256,
      );
    }
  });

  it.each([
    [
      "dev-attempt1.json.raw",
      [199.69999998807907, 220.39999997615814, 181],
      [4, 11, 2],
    ],
    [
      "dev-attempt2.json.raw",
      [217.10000002384186, 221.29999995231628, 193.5999999642372],
      [18, 18, 4],
    ],
  ])(
    "keeps %s complete but FAILED, without pooling or removing slow samples",
    (file, p95s, overBudgetCounts) => {
      const raw = readJson(file as string);
      expect(raw.testedSha).toBe(SHA);
      expect(raw.servedIdentity).toMatchObject({
        sha: SHA,
        buildSha: SHA,
        dirty: false,
        mode: "development",
      });
      expect(raw.healthCheck.passed).toBe(true);
      expect(raw.protocol).toMatchObject({
        mode: "legacy-development-v2.1",
        warmupOperations: 0,
        excludedMeasuredOperations: 0,
      });
      expect(raw.complete).toBe(true);
      expect(raw.failure).toBeNull();
      expect(raw.latencyBudgetGate.passed).toBe(false);
      expect(raw.g5Passed).toBe(false);
      expect(raw.operations).toHaveLength(3);
      for (const [index, metric] of raw.operations.entries()) {
        expect(metric.values).toHaveLength(100);
        expect(metric.thresholdMs).toBe(200);
        const sorted = [...metric.values].sort((a: number, b: number) => a - b);
        expect(metric.p95).toBe(sorted[94]);
        expect(metric.p95).toBe((p95s as number[])[index]);
        expect(metric.values.filter((v: number) => v > 200)).toHaveLength(
          (overBudgetCounts as number[])[index],
        );
        expect(metric.withinLatencyBudget).toBe(metric.p95 <= 200);
      }
    },
  );

  it.each([
    ["local-production", 8],
    ["ci-39125745484", 9],
    ["ci-39125750810", 9],
  ])(
    "revalidates every %s group with the strengthened validator and retains %i/9",
    (directory, passedCount) => {
      const summary = readJson(`${directory}/summary.json.raw`);
      expect(summary.testedSha).toBe(SHA);
      expect(summary.groups).toHaveLength(9);
      expect(summary.g5Passed).toBe(false);
      let passed = 0;
      for (const group of summary.groups) {
        const raw = readJson(`${directory}/${group.group}.json.raw`);
        const errors = validateResult(raw, group.operation as Operation, SHA);
        expect(raw.eligibleForG5).toBe(false);
        expect(raw.g5Passed).toBe(false);
        if (
          directory === "local-production" &&
          group.group === "round-2-fold"
        ) {
          expect(raw.operations[0].p95).toBe(200.5);
          expect(
            raw.operations[0].values.filter((v: number) => v > 200),
          ).toHaveLength(6);
          expect(errors).toEqual([
            "branch-collapse-toggle p95 exceeds threshold",
            "latency budget gate is invalid",
          ]);
          expect(group.childExitCode).toBe(1);
          expect(group.passed).toBe(false);
        } else {
          expect(errors, `${directory}/${group.group}`).toEqual([]);
          expect(group.childExitCode).toBe(0);
          expect(group.passed).toBe(true);
          passed++;
        }
      }
      expect(passed).toBe(passedCount);
      expect(summary.passed).toBe(passedCount === 9);
    },
  );
});
