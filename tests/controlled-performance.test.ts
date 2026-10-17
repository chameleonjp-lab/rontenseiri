import { describe, expect, it } from "vitest";
import {
  COUNT,
  ROUNDS,
  THRESHOLD_MS,
  WARMUP,
  schedule,
  validateResult,
  type Operation,
} from "../scripts/controlled-performance.mjs";

function result(operation: Operation = "selection") {
  const values = Array.from({ length: COUNT }, (_, index) => index + 1);
  const name = {
    selection: "node-selection",
    search: "node-search",
    fold: "branch-collapse-toggle",
  }[operation]!;
  const operationLog = [
    ...Array.from({ length: WARMUP }, (_, index) => ({
      operation,
      index: index - WARMUP,
      durationMs: 1,
      warmup: true,
    })),
    ...Array.from({ length: COUNT }, (_, index) => ({
      operation,
      index,
      durationMs: values[index],
      warmup: false,
    })),
  ];
  return {
    testedSha: "abc",
    dirtyWorkingTree: false,
    servedIdentity: { sha: "abc", dirty: false },
    diagnosticOnly: true,
    eligibleForG5: false,
    g5Passed: false,
    complete: true,
    failure: null as string | null,
    protocol: {
      mode: "controlled-production-v1",
      warmupOperations: WARMUP,
      excludedMeasuredOperations: 0,
      order: [operation],
    },
    latencyBudgetGate: { thresholdMs: THRESHOLD_MS, passed: true },
    operations: [
      {
        name,
        count: COUNT,
        p95: values[94],
        thresholdMs: THRESHOLD_MS,
        withinLatencyBudget: true,
        values,
      },
    ],
    operationLog,
  };
}

describe("controlled performance protocol", () => {
  it("固定3ラウンドの順序と9グループをスケジュールする", () => {
    const plan = schedule({ root: "/tmp/controlled-performance-test" });
    expect(plan.rounds).toEqual(ROUNDS);
    expect(plan.rounds.flat()).toHaveLength(9);
    expect(plan.port).toBe("4193");
  });

  it("対象metric一個の実際のcontrolled契約を受理する", () => {
    expect(validateResult(result("selection"), "selection", "abc")).toEqual([]);
  });

  it("served SHAとstale identityを拒否する", () => {
    const invalid = result();
    invalid.servedIdentity = { sha: "stale", dirty: false };
    expect(validateResult(invalid, "selection", "abc")).toEqual(
      expect.arrayContaining(["served identity mismatch"]),
    );
  });

  it("p95偽装、未完了、非有限raw値を拒否する", () => {
    const invalid = result();
    invalid.operations[0].p95 = 200;
    invalid.operations[0].values[0] = Number.NaN;
    invalid.complete = false;
    invalid.failure = "timeout";
    expect(validateResult(invalid, "selection", "abc")).toEqual(
      expect.arrayContaining([
        "result is incomplete or has failure",
        "node-selection has non-finite raw values",
        "node-selection p95 does not match raw values",
      ]),
    );
  });

  it("warmup欠落、order不一致、余分なmetricを拒否する", () => {
    const invalid = result("search");
    invalid.operationLog = invalid.operationLog.slice(1);
    invalid.protocol.order = ["selection"];
    invalid.operations.push({
      ...invalid.operations[0],
      name: "node-selection",
    });
    expect(validateResult(invalid, "search", "abc")).toEqual(
      expect.arrayContaining([
        "protocol order does not match operation",
        "operations must contain only the requested metric",
        "warmup operation log is incomplete or duplicated",
      ]),
    );
  });
});
