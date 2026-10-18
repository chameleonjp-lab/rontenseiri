import { describe, expect, it } from "vitest";
import { validatePerformancePreflight } from "../scripts/performance-preflight.mjs";

const sha = "15ce833";
const signals = {
  htmlDevClient: false,
  devClientEndpoint: false,
  runtimeDevClient: false,
  hmrWebSocket: false,
};

function check(overrides: Record<string, unknown> = {}) {
  return {
    baseURL: "http://127.0.0.1:4173/",
    endpoint: "http://127.0.0.1:4173/__rontenseiri_build_identity",
    status: 200,
    response: { sha, buildSha: sha, dirty: false, mode: "production" },
    expectedSha: sha,
    expectedMode: "production",
    signals,
    ...overrides,
  };
}

describe("validatePerformancePreflight", () => {
  it("accepts a valid production response", () => {
    expect(validatePerformancePreflight(check())).toEqual([]);
  });

  it.each([
    [
      "sha",
      {
        response: {
          sha: "other",
          buildSha: sha,
          dirty: false,
          mode: "production",
        },
      },
    ],
    [
      "buildSha",
      {
        response: { sha, buildSha: "other", dirty: false, mode: "production" },
      },
    ],
    [
      "dirty",
      { response: { sha, buildSha: sha, dirty: true, mode: "production" } },
    ],
    [
      "mode",
      { response: { sha, buildSha: sha, dirty: false, mode: "development" } },
    ],
  ])("rejects %s mismatch", (_name, override) => {
    expect(validatePerformancePreflight(check(override))).not.toEqual([]);
  });

  it.each([
    ["baseURL", { baseURL: "/relative" }],
    ["endpoint", { endpoint: "http://127.0.0.1:4173/not-identity" }],
    ["status", { status: 500 }],
  ])("rejects bad %s", (_name, override) => {
    expect(validatePerformancePreflight(check(override))).not.toEqual([]);
  });

  it.each([
    "htmlDevClient",
    "devClientEndpoint",
    "runtimeDevClient",
    "hmrWebSocket",
  ])("rejects production %s signal", (signal) => {
    expect(
      validatePerformancePreflight(
        check({ signals: { ...signals, [signal]: true } }),
      ),
    ).not.toEqual([]);
  });

  it("accepts the explicit legacy development mode with dev signals", () => {
    expect(
      validatePerformancePreflight(
        check({
          expectedMode: "development",
          response: { sha, buildSha: sha, dirty: false, mode: "development" },
          signals: { ...signals, htmlDevClient: true, hmrWebSocket: true },
        }),
      ),
    ).toEqual([]);
  });

  it.each([
    null,
    undefined,
    { ...check(), response: null },
    { ...check(), signals: undefined },
    { ...check(), signals: { ...signals, runtimeDevClient: "yes" } },
    { ...check(), response: { sha, buildSha: sha, dirty: false } },
  ])("rejects malformed payload %#", (value) => {
    expect(validatePerformancePreflight(value)).not.toEqual([]);
  });
});
