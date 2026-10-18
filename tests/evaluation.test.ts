import { describe, expect, it } from "vitest";
import dataset from "../evals/cases.json";
import { evaluateCase, evaluateSuite } from "../src/evaluation/metrics";

describe("fixed Japanese evaluation foundation", () => {
  it("has >=20 synthetic cases, provenance, and root-level question schema", () => {
    expect(dataset.cases.length).toBeGreaterThanOrEqual(20);
    expect(dataset.provenance.origin).toContain("架空");
    expect(dataset.provenance.gold).toContain("手動");
    expect(dataset.cases.every((item) => Array.isArray(item.questions))).toBe(
      true,
    );
  });

  it("covers required edge cases", () => {
    const text = JSON.stringify(dataset);
    for (const value of [
      "撤回",
      "反対",
      "後日",
      "SYSTEM",
      "非発言",
      "話者不明",
    ])
      expect(text).toContain(value);
    expect(
      dataset.cases.filter((item) => item.pairId).length,
    ).toBeGreaterThanOrEqual(6);
  });

  it("does not call missing predictions measured and excludes them from denominators", () => {
    const result = evaluateSuite(dataset, []);
    expect(result.status).toBe("not-run");
    expect(result.measuredCaseCount).toBe(0);
    expect(result.aggregate.questionF1).toBeNull();
    expect(result.aggregate.answerF1).toBeNull();
    expect(result.results.every((item) => item.status === "not-run")).toBe(
      true,
    );
  });

  it("keeps source range separate from semantic meaning and ID-link proxy", () => {
    const prediction = {
      sourceUtteranceIds: ["u1", "u2", "u3"],
      evidenceRefs: ["u2"],
      answers: [{ questionId: "q1", utteranceIds: ["u2"] }],
    };
    const result = evaluateCase(dataset.cases[0], prediction);
    expect(result.features.sourceRetentionRate.value).toBe(1);
    expect(result.features.meaningReflectionRate.status).toBe("not-run");
    expect(result.features.sourceRetentionRate.complete).toBe(true);
  });

  it("measures semantic reflection only against supplied meaning gold units", () => {
    const result = evaluateCase(dataset.cases[0], {
      summaryMeaning: ["u2の賛成と理由"],
    });
    expect(result.features.meaningReflectionRate.value).toBeCloseTo(2 / 3);
    expect(result.features.meaningReflectionRate.status).toBe("measured");
  });

  it("detects injection-induced fabricated consensus without a safety flag", () => {
    const item = dataset.cases.find((value) => value.id === "jp-11-injection")!;
    const result = evaluateCase(item, {
      answers: [{ questionId: "q1", stance: "agree" }],
    });
    expect(result.features.safety.pass).toBe(false);
  });

  it("marks fairness pairs not-run when one side is missing", () => {
    const item = dataset.cases.find(
      (value) => value.id === "jp-16-politeness-pair",
    )!;
    const result = evaluateSuite(dataset, [{ caseId: item.id, answers: [] }]);
    expect(result.fairness["fair-01"].status).toBe("not-run");
    expect(result.fairness["fair-01"].maxDifference).toBeNull();
  });

  it("rejects unknown IDs, duplicate predictions, duplicate cases, and empty gold", () => {
    expect(
      evaluateSuite(dataset, [{ caseId: "unknown", answers: [] }]).errors,
    ).toContain("unknown prediction caseId");
    expect(
      evaluateSuite(dataset, [
        { caseId: "jp-01-question-answer" },
        { caseId: "jp-01-question-answer" },
      ]).errors,
    ).toContain("duplicate prediction caseId");
    const duplicate = {
      ...dataset,
      cases: [dataset.cases[0], dataset.cases[0]],
    };
    expect(evaluateSuite(duplicate, []).errors).toContain("duplicate case id");
    expect(evaluateCase({ id: "empty", questions: [], gold: {} }).status).toBe(
      "not-run",
    );
  });

  it("never emits NaN or Infinity and does not present selftest as AI quality", () => {
    const result = evaluateSuite(dataset, []);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/NaN|Infinity/);
    expect(result.limitations.join(" ")).toContain("AI品質合格");
  });
});
