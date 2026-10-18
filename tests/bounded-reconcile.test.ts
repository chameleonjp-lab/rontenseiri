import { describe, expect, it, vi } from "vitest";
import {
  BOUNDED_RECONCILIATION_LIMITS,
  assertBoundedCursor,
  parseBoundedCursor,
  parseBoundedResult,
  reconcileFixtureCandidates,
  type BoundedLimits,
  type FixtureCandidate,
} from "../src/analysis/bounded-reconcile";

const limits = (overrides: Partial<BoundedLimits> = {}): BoundedLimits => ({
  maxCandidates: 99,
  maxComparisons: 99,
  maxRetainedResults: 99,
  maxInputBytes: 99_999,
  maxOutputBytes: 99_999,
  maxElapsedMs: 99,
  ...overrides,
});

const candidate = (
  id: string,
  disposition: FixtureCandidate["disposition"] = "relation",
): FixtureCandidate => ({
  id,
  disposition,
  evidence: [
    {
      sourceId: "source-日本語",
      sourceVersionId: "v-α",
      start: 0,
      end: [...id].length || 1,
    },
  ],
});

const fixture = [
  candidate("あ"),
  candidate("b", "no-relation"),
  candidate("c", "hold"),
];
const inputBytes = (c: FixtureCandidate) =>
  new TextEncoder().encode(
    JSON.stringify({
      id: c.id,
      evidence: c.evidence,
      disposition: c.disposition,
    }),
  ).byteLength;
const pairBytes = (
  leftId: string,
  rightId: string,
  disposition: "relation" | "no-relation" | "hold",
) =>
  new TextEncoder().encode(JSON.stringify({ leftId, rightId, disposition }))
    .byteLength;
const totalInputBytes = fixture.reduce((n, c) => n + inputBytes(c), 0);
const firstPairBytes = pairBytes("あ", "b", "no-relation");
const totalOutputBytes =
  firstPairBytes + pairBytes("あ", "c", "hold") + pairBytes("b", "c", "hold");

describe("fixture-bounded-reconciliation", () => {
  it("空/単一fixtureは比較せず、完全結果のdiscriminantを返す", () => {
    for (const candidates of [[], [candidate("あ")]]) {
      const result = reconcileFixtureCandidates(
        candidates,
        limits({ maxCandidates: 0, maxComparisons: 0 }),
      );
      expect(result).toMatchObject({
        kind: "fixture-bounded-reconciliation",
        version: 1,
        status: "complete",
      });
      expect(result.results).toEqual([]);
      expect(result.counters.comparisons).toBe(0);
    }
  });

  describe.each([
    [
      "maxCandidates",
      (n: number) => limits({ maxCandidates: n }),
      (r: ReturnType<typeof reconcileFixtureCandidates>) =>
        r.stopReason === "candidate-budget",
      2,
      true,
    ],
    [
      "maxComparisons",
      (n: number) => limits({ maxComparisons: n }),
      (r: ReturnType<typeof reconcileFixtureCandidates>) =>
        r.stopReason === "comparison-budget",
      3,
      false,
    ],
    [
      "maxRetainedResults",
      (n: number) => limits({ maxRetainedResults: n }),
      (r: ReturnType<typeof reconcileFixtureCandidates>) =>
        r.stopReason === "retained-result-budget",
      3,
      false,
    ],
    [
      "maxInputBytes",
      (n: number) => limits({ maxInputBytes: n }),
      (r: ReturnType<typeof reconcileFixtureCandidates>) =>
        r.stopReason === "input-bytes-budget",
      totalInputBytes,
      false,
    ],
    [
      "maxOutputBytes",
      (n: number) => limits({ maxOutputBytes: n }),
      (r: ReturnType<typeof reconcileFixtureCandidates>) =>
        r.stopReason === "output-bytes-budget",
      totalOutputBytes,
      false,
    ],
  ] as const)(
    "%s: 0 / limit-1 / exact / limit+1",
    (_name, makeLimits, isBudgetStop, total, exactStops) => {
      it.each([
        ["zero", 0, true],
        ["limit-1", Math.max(0, total - 1), true],
        ["exact", total, exactStops],
        ["limit+1", total + 1, false],
      ])("%s", (_case, budget, shouldStop) => {
        const result = reconcileFixtureCandidates(fixture, makeLimits(budget));
        if (shouldStop) expect(isBudgetStop(result)).toBe(true);
        else expect(result.status).toBe("complete");
        expect(result.results.length).toBeLessThanOrEqual(3);
      });
    },
  );

  it.each([
    ["zero", 0, false],
    ["limit-1", 9, false],
    ["exact deadline", 10, true],
    ["limit+1", 11, true],
  ])(
    "maxElapsedMs %s は elapsed >= limit で停止し、fractional ms を受け付ける",
    (_name, now, shouldStop) => {
      const result = reconcileFixtureCandidates(
        fixture,
        limits({ maxElapsedMs: 10 }),
        { elapsedMs: now },
      );
      if (shouldStop) {
        expect(result.stopReason).toBe("elapsed-ms-budget");
        expect(result.results).toEqual([]);
      } else expect(result.status).toBe("complete");
    },
  );

  it("各page budgetはfresh、入力/比較spyは実施直前だけ呼ばれ、exact deadlineを overshoot しない", () => {
    const onInput = vi.fn();
    const onCompare = vi.fn();
    const page = reconcileFixtureCandidates(
      fixture,
      limits({ maxComparisons: 1 }),
      { onInput, onCompare },
    );
    expect(onInput).toHaveBeenCalledTimes(2);
    expect(onCompare).toHaveBeenCalledTimes(1);
    const next = reconcileFixtureCandidates(
      fixture,
      limits({ maxComparisons: 1 }),
      { cursor: page.cursor, onInput, onCompare },
    );
    expect(next.results).toHaveLength(1);
    expect(onCompare).toHaveBeenCalledTimes(2);
    expect(next.counters.comparisons).toBe(2);
    expect(next.counters.candidates).toBe(3);
  });

  it("admitted prefixをcursorで再開し、重複も欠落もなく全pairを得る", () => {
    const all: Array<
      ReturnType<typeof reconcileFixtureCandidates>["results"][number]
    > = [];
    let cursor: unknown;
    let page = reconcileFixtureCandidates(
      fixture,
      limits({ maxComparisons: 1 }),
    );
    all.push(...page.results);
    cursor = page.cursor;
    while (page.status === "partial") {
      page = reconcileFixtureCandidates(
        fixture,
        limits({ maxComparisons: 1 }),
        { cursor },
      );
      all.push(...page.results);
      cursor = page.cursor;
    }
    expect(all).toEqual([
      { leftId: "あ", rightId: "b", disposition: "no-relation" },
      { leftId: "あ", rightId: "c", disposition: "hold" },
      { leftId: "b", rightId: "c", disposition: "hold" },
    ]);
    expect(new Set(all.map((p) => `${p.leftId}:${p.rightId}`)).size).toBe(3);
    expect(page.counters.comparisons).toBe(3);
    expect(page.counters.candidates).toBe(3);
  });

  it("cursorのschema、unknown ID、span、duplicate、counter、unknown fieldを拒否し入力を変更しない", () => {
    const page = reconcileFixtureCandidates(
      fixture,
      limits({ maxComparisons: 1 }),
    );
    const base = structuredClone(page.cursor) as Record<string, unknown>;
    const cases: Record<string, unknown>[] = [
      { ...base, schema: "wrong" },
      { ...base, candidateIds: ["あ", "b", "unknown"] },
      { ...base, nextPairIndex: 99 },
      { ...base, comparisons: 0 },
      { ...base, unexpected: true },
    ];
    for (const value of cases)
      expect(() => parseBoundedCursor(value, fixture)).toThrow();
    const unchanged = structuredClone(page.cursor);
    expect(() =>
      assertBoundedCursor(
        { ...(page.cursor as object), candidateIds: ["unknown"] },
        fixture,
      ),
    ).toThrow();
    expect(page.cursor).toEqual(unchanged);
  });

  it("malformed candidate、source ref、span、duplicate ID、unknown fieldを拒否する", () => {
    expect(() =>
      reconcileFixtureCandidates([{ ...candidate("x"), id: "" }], limits()),
    ).toThrow();
    expect(() =>
      reconcileFixtureCandidates([candidate("x"), candidate("x")], limits()),
    ).toThrow();
    expect(() =>
      reconcileFixtureCandidates(
        [{ ...candidate("x"), extra: true } as never],
        limits(),
      ),
    ).toThrow();
    expect(() =>
      reconcileFixtureCandidates(
        [
          {
            ...candidate("x"),
            evidence: [
              { sourceId: "", sourceVersionId: "v", start: 0, end: 1 },
            ],
          },
        ],
        limits(),
      ),
    ).toThrow();
    expect(() =>
      reconcileFixtureCandidates(
        [
          {
            ...candidate("x"),
            evidence: [
              { sourceId: "s", sourceVersionId: "v", start: 2, end: 1 },
            ],
          },
        ],
        limits(),
      ),
    ).toThrow();
    expect(() =>
      reconcileFixtureCandidates(
        [
          {
            ...candidate("x"),
            evidence: [
              {
                sourceId: "s",
                sourceVersionId: "v",
                start: 0,
                end: 1,
                extra: 1,
              } as never,
            ],
          },
        ],
        limits(),
      ),
    ).toThrow();
  });

  it("result parserはforeign pair、duplicate/unknown result、range、counter、unknown fieldを拒否する", () => {
    const page = reconcileFixtureCandidates(
      fixture,
      limits({ maxComparisons: 1 }),
    );
    const malformed = [
      {
        ...page,
        results: [{ leftId: "unknown", rightId: "b", disposition: "hold" }],
      },
      { ...page, results: [page.results[0], page.results[0]] },
      { ...page, counters: { ...page.counters, comparisons: 0 } },
      { ...page, counters: { ...page.counters, unknown: 1 } },
      { ...page, unexaminedRanges: [{ start: 0, end: 1, unknown: true }] },
      { ...page, unexpected: true },
    ];
    for (const value of malformed)
      expect(() => parseBoundedResult(value, fixture)).toThrow();
  });

  it("injected clockはfinite・nonnegative・monotonicでなければ拒否する", () => {
    expect(() =>
      reconcileFixtureCandidates(fixture, limits(), { elapsedMs: -1 }),
    ).toThrow();
    expect(() =>
      reconcileFixtureCandidates(fixture, limits(), { elapsedMs: Number.NaN }),
    ).toThrow();
    expect(() =>
      reconcileFixtureCandidates(fixture, limits(), {
        elapsedMs: Number.POSITIVE_INFINITY,
      }),
    ).toThrow();
    let now = 0;
    expect(() =>
      reconcileFixtureCandidates(fixture, limits(), {
        elapsedMs: () => (now++ === 0 ? 1 : 0),
      }),
    ).toThrow();
  });
});

describe("stopping does not consume the next operation", () => {
  it.each([
    ["candidate", { maxCandidates: 2 }, 2, 1],
    ["comparison", { maxComparisons: 1 }, 2, 1],
    ["retained", { maxRetainedResults: 1 }, 2, 1],
    [
      "input",
      { maxInputBytes: inputBytes(fixture[0]) + inputBytes(fixture[1]) },
      2,
      1,
    ],
    ["output", { maxOutputBytes: firstPairBytes }, 2, 1],
    ["elapsed", { maxElapsedMs: 0 }, 0, 0],
  ] as const)(
    "%s limit stops before the next input/comparison and resumes exactly",
    (_name, budget, admitted, compared) => {
      const onInput = vi.fn(),
        onCompare = vi.fn();
      const first = reconcileFixtureCandidates(fixture, limits(budget), {
        elapsedMs: () => 0,
        onInput,
        onCompare,
      });
      expect(first.status).toBe("partial");
      expect(onInput).toHaveBeenCalledTimes(admitted);
      expect(onCompare).toHaveBeenCalledTimes(compared);
      expect(parseBoundedResult(first, fixture)).toEqual(first);
      const last = reconcileFixtureCandidates(fixture, limits(), {
        cursor: first.cursor,
        elapsedMs: () => 0,
        onInput,
        onCompare,
      });
      const expected = reconcileFixtureCandidates(fixture, limits(), {
        elapsedMs: () => 0,
      });
      expect([...first.results, ...last.results]).toEqual(expected.results);
      expect(last.status).toBe("complete");
      expect(onInput).toHaveBeenCalledTimes(fixture.length);
      expect(onCompare).toHaveBeenCalledTimes(expected.results.length);
      expect(last.counters.inputBytes).toBe(expected.counters.inputBytes);
      expect(last.counters.outputBytes).toBe(expected.counters.outputBytes);
      expect(parseBoundedResult(last, fixture)).toEqual(last);
    },
  );

  it("rejects missing results, forged byte/admission counters, and duplicate evidence", () => {
    const page = reconcileFixtureCandidates(fixture, limits(), {
      elapsedMs: () => 0,
    });
    expect(() =>
      parseBoundedResult({ ...page, results: [] }, fixture),
    ).toThrow();
    for (const fault of [
      { inputBytes: page.cursor.inputBytes + 1 },
      { outputBytes: page.cursor.outputBytes + 1 },
      { candidates: 0 },
    ])
      expect(() =>
        parseBoundedCursor({ ...page.cursor, ...fault }, fixture),
      ).toThrow();
    const duplicated = {
      ...fixture[0],
      evidence: [...fixture[0].evidence, ...fixture[0].evidence],
    };
    expect(() => reconcileFixtureCandidates([duplicated], limits())).toThrow();
  });

  it("uses deterministic mid-page deadline expiry with no later work", () => {
    let clock = 0;
    const onInput = vi.fn(),
      onCompare = vi.fn(() => {
        clock = 10;
      });
    const page = reconcileFixtureCandidates(
      fixture,
      limits({ maxElapsedMs: 10 }),
      {
        elapsedMs: () => clock,
        onInput,
        onCompare,
      },
    );
    expect(page.stopReason).toBe("elapsed-ms-budget");
    expect(onInput).toHaveBeenCalledTimes(2);
    expect(onCompare).toHaveBeenCalledTimes(1);
    expect(page.cursor.nextPairIndex).toBe(1);
  });

  it("checks compact cursor identity, byte prefixes and lazy row transitions on a larger fixture", () => {
    const candidates = Array.from({ length: 9 }, (_, i) =>
      candidate(
        `候補-${i}`,
        (["relation", "hold", "no-relation"] as const)[i % 3],
      ),
    );
    let page = reconcileFixtureCandidates(
      candidates,
      limits({ maxComparisons: 4 }),
      { elapsedMs: () => 0 },
    );
    const pairs = [...page.results];
    while (page.status === "partial") {
      expect(page.unexaminedRanges).toHaveLength(1);
      parseBoundedResult(page, candidates);
      page = reconcileFixtureCandidates(
        candidates,
        limits({ maxComparisons: 4 }),
        { cursor: page.cursor, elapsedMs: () => 0 },
      );
      pairs.push(...page.results);
    }
    parseBoundedResult(page, candidates);
    expect(pairs).toEqual(
      reconcileFixtureCandidates(candidates, limits(), { elapsedMs: () => 0 })
        .results,
    );
    expect(
      new Set(pairs.map((pair) => `${pair.leftId}|${pair.rightId}`)).size,
    ).toBe(pairs.length);
    expect(page.counters.outputBytes).toBe(
      pairs.reduce(
        (sum, pair) =>
          sum + new TextEncoder().encode(JSON.stringify(pair)).byteLength,
        0,
      ),
    );
    expect(() =>
      parseBoundedCursor(
        page.cursor,
        candidates.map((c, i) => (i ? c : { ...c, disposition: "hold" })),
      ),
    ).toThrow();
  });
});

describe("non-resettable internal ceilings", () => {
  it("retains the comparison ceiling across resume without the next callback", () => {
    const candidates = Array.from({ length: 317 }, (_, i) =>
      candidate(`c${i}`),
    );
    const first = reconcileFixtureCandidates(
      candidates,
      BOUNDED_RECONCILIATION_LIMITS,
      { elapsedMs: () => 0 },
    );
    expect(first.status).toBe("partial");
    expect(first.cursor.comparisons).toBe(
      BOUNDED_RECONCILIATION_LIMITS.maxComparisons,
    );
    const onInput = vi.fn(),
      onCompare = vi.fn();
    const last = reconcileFixtureCandidates(
      candidates,
      BOUNDED_RECONCILIATION_LIMITS,
      { cursor: first.cursor, elapsedMs: () => 0, onInput, onCompare },
    );
    expect(last.status).toBe("partial");
    expect(last.cursor).toEqual(first.cursor);
    expect(last.results).toEqual([]);
    expect(onInput).not.toHaveBeenCalled();
    expect(onCompare).not.toHaveBeenCalled();
    expect(parseBoundedResult(first, candidates)).toEqual(first);
  });

  it("does not reset the cumulative elapsed ceiling and accepts fractional clocks", () => {
    const first = reconcileFixtureCandidates(
      fixture,
      BOUNDED_RECONCILIATION_LIMITS,
      { elapsedMs: () => 30_000 },
    );
    const onInput = vi.fn(),
      onCompare = vi.fn();
    const last = reconcileFixtureCandidates(
      fixture,
      BOUNDED_RECONCILIATION_LIMITS,
      { cursor: first.cursor, elapsedMs: () => 0, onInput, onCompare },
    );
    expect(last.stopReason).toBe("elapsed-ms-budget");
    expect(last.counters.elapsedMs).toBe(30_000);
    expect(onInput).not.toHaveBeenCalled();
    expect(onCompare).not.toHaveBeenCalled();
    expect(
      reconcileFixtureCandidates(fixture, limits({ maxElapsedMs: 0.5 }), {
        elapsedMs: () => 0.25,
      }).status,
    ).toBe("complete");
  });

  it("cannot expand injected limits beyond the internal policy or exceed static manifest caps", () => {
    expect(() =>
      reconcileFixtureCandidates(fixture, {
        ...BOUNDED_RECONCILIATION_LIMITS,
        maxComparisons: 50_001,
      }),
    ).toThrow();
    expect(() =>
      reconcileFixtureCandidates(Array(10_001).fill(fixture[0]), limits()),
    ).toThrow();
    expect(() =>
      reconcileFixtureCandidates(
        [{ ...fixture[0], evidence: Array(65).fill(fixture[0].evidence[0]) }],
        limits(),
      ),
    ).toThrow();
    expect(() =>
      reconcileFixtureCandidates(
        [{ ...fixture[0], id: "x".repeat(129) }],
        limits(),
      ),
    ).toThrow();
  });
});
