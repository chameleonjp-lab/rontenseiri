import { describe, expect, it } from "vitest";
import dataset from "../evals/cases.json";
import {
  evaluateCase,
  evaluateSuite,
  renderEvaluationMarkdown,
} from "../src/evaluation/metrics";

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
    expect(result.features.meaningGoldRecall.status).toBe("not-run");
    expect(result.features.sourceRetentionRate.complete).toBe(true);
  });

  it("reports gold-string recall separately from supplementary F1", () => {
    const result = evaluateCase(dataset.cases[0], {
      summaryMeaning: ["u2の賛成と理由"],
    });
    expect(result.features.meaningGoldRecall.value).toBe(0.5);
    expect(result.features.meaningGoldRecall.recall).toBe(0.5);
    expect(result.features.meaningGoldRecall.f1).toBeCloseTo(2 / 3);
    expect(result.features.meaningGoldRecall.status).toBe("measured");
    expect(result.features.meaningGoldRecall.officialR27).toBe(false);
    expect(result.features).not.toHaveProperty("meaningReflectionRate");
  });

  it("does not lower recall for extra predictions but retains precision and F1", () => {
    const result = evaluateCase(dataset.cases[0], {
      meaningUnits: [...dataset.cases[0].gold.summaryMeaning, "根拠のない追加"],
    });
    expect(result.features.meaningGoldRecall.value).toBe(1);
    expect(result.features.meaningGoldRecall.precision).toBeCloseTo(2 / 3);
    expect(result.features.meaningGoldRecall.f1).toBe(0.8);
  });

  it.each([{ summaryMeaning: [] }, { summaryMeaning: ["一致しない意味"] }])(
    "scores empty or disjoint submitted predictions as zero, not perfect F1: $summaryMeaning",
    ({ summaryMeaning }) => {
      const result = evaluateCase(dataset.cases[0], {
        summaryMeaning,
        questions: ["未知の問い"],
        answers: [],
        evidenceRefs: ["未知の根拠"],
      });
      expect(result.features.meaningGoldRecall.value).toBe(0);
      expect(result.features.meaningGoldRecall.f1).toBe(0);
      expect(result.features.questions.f1).toBe(0);
      expect(result.features.answers.f1).toBe(0);
      expect(result.features.evidence.f1).toBe(0);
    },
  );

  it.each([
    { gold: undefined, prediction: [] },
    { gold: [], prediction: [] },
    { gold: [], prediction: ["extra"] },
  ])(
    "keeps absent or empty meaning gold not-run without a denominator: $gold / $prediction",
    ({ gold, prediction }) => {
      const item = {
        ...dataset.cases[0],
        gold: { ...dataset.cases[0].gold, summaryMeaning: gold },
      };
      const result = evaluateCase(item, { summaryMeaning: prediction });
      expect(result.features.meaningGoldRecall.status).toBe("not-run");
      expect(result.features.meaningGoldRecall.value).toBeNull();
      expect(result.features.meaningGoldRecall.recall).toBeNull();
      const suite = evaluateSuite({ cases: [item] }, [
        { caseId: item.id, summaryMeaning: prediction },
      ]);
      expect(suite.aggregate.meaningGoldRecall).toBeNull();
      expect(suite.aggregate.meaningGoldF1).toBeNull();
    },
  );

  it("does not fabricate a numeric success from entirely empty comparison sets", () => {
    const item = {
      id: "empty-sets",
      questions: [],
      gold: { answers: [], evidenceRefs: [] },
    };
    const result = evaluateCase(item, {
      questions: [],
      answers: [],
      evidenceRefs: [],
    });
    for (const name of ["questions", "answers", "evidence"]) {
      expect(result.features[name].status).toBe("not-run");
      expect(result.features[name].f1).toBeNull();
    }
  });

  it("aggregates recall explicitly rather than preferring the supplementary F1", () => {
    const first = dataset.cases[0];
    const second = dataset.cases[1];
    const result = evaluateSuite({ cases: [first, second, dataset.cases[2]] }, [
      {
        caseId: first.id,
        summaryMeaning: [first.gold.summaryMeaning[0]],
      },
      {
        caseId: second.id,
        summaryMeaning: [...second.gold.summaryMeaning, "追加"],
      },
    ]);
    expect(result.aggregate.meaningGoldRecall).toBe(0.75);
    expect(result.aggregate.meaningGoldF1).toBeCloseTo(2 / 3);
    expect(result.aggregate).not.toHaveProperty("meaningReflectionRate");
    expect(result.schemaVersion).toBe("evaluation-result-v3");
    expect(result.notRun.join(" ")).toContain("formal R27");
    expect(result.limitations.join(" ")).toContain("goldがある空配列予測は0");
    const markdown = renderEvaluationMarkdown(result);
    expect(markdown).toContain("Meaning gold-string recall (proxy): 0.750");
    expect(markdown).toContain("Meaning gold-string F1 (supplementary): 0.667");
    expect(markdown).toContain("Formal R27 semantic reflection: not-run");
  });

  it("counts duplicate meaning strings as one gold/prediction unit", () => {
    const first = dataset.cases[0];
    const item = {
      ...first,
      gold: {
        ...first.gold,
        summaryMeaning: [
          ...first.gold.summaryMeaning,
          first.gold.summaryMeaning[0],
        ],
      },
    };
    const result = evaluateCase(item, {
      summaryMeaning: [
        first.gold.summaryMeaning[0],
        first.gold.summaryMeaning[0],
      ],
    });
    expect(result.features.meaningGoldRecall.value).toBe(0.5);
    expect(result.features.meaningGoldRecall.goldUnits).toBe(2);
    expect(result.features.meaningGoldRecall.predictionUnits).toBe(1);
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
