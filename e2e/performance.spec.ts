import { test, expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpus, release, totalmem } from "node:os";
import { parseInputs } from "../src/input/parse";
import { createProject } from "../src/domain/project";
import { exportProject } from "../src/export/project";

const COUNT = 100;
const THRESHOLD_MS = 200;
// Full DOM trace snapshots themselves dominate large-graph runs. Preserve the
// explicit action log instead; functional E2Es retain their normal traces.
test.use({ trace: "off" });
let evidenceWritten = false;
let sessionStartedAt = new Date().toISOString();
test.beforeEach(async () => {
  evidenceWritten = false;
  sessionStartedAt = new Date().toISOString();
});
test.afterEach(async ({}, info) => {
  if (evidenceWritten) return;
  let testedSha: string | null = null;
  try {
    testedSha = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim();
  } catch {
    /* Preserve preflight/git failure too. */
  }
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/canvas-performance.json",
    JSON.stringify(
      {
        testedSha,
        diagnosticOnly: true,
        eligibleForG5: false,
        g5Passed: false,
        complete: false,
        startedAt: sessionStartedAt,
        timestamp: new Date().toISOString(),
        failure: {
          phase: "preflight/fixture/git",
          errors: info.errors.map((e) => e.message),
          elapsedMs: Date.now() - Date.parse(sessionStartedAt),
        },
        operations: [],
      },
      null,
      2,
    ) + "\n",
  );
});
function metric(name: string, values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number) =>
    sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null;
  const p95 = percentile(0.95);
  return {
    name,
    count: values.length,
    p50: percentile(0.5),
    p95,
    max: sorted.at(-1) ?? null,
    thresholdMs: THRESHOLD_MS,
    withinDiagnosticThreshold:
      values.length === COUNT && p95 !== null && p95 <= THRESHOLD_MS,
    values,
  };
}
async function nextFrame(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
  );
}
async function settleNode(page: Page, id: string) {
  await page.waitForFunction(
    (nodeId) => {
      const hit = document.querySelector(`[data-id="${nodeId}"] .speech-hit`);
      const canvas = document.querySelector(".flow-container");
      if (!hit || !canvas) return false;
      const r = hit.getBoundingClientRect(),
        c = canvas.getBoundingClientRect();
      return (
        r.width > 0 &&
        r.x >= c.x - 1 &&
        r.y >= c.y - 1 &&
        r.right <= c.right + 1 &&
        r.bottom <= c.bottom + 1
      );
    },
    id,
    { timeout: 15_000 },
  );
  await page.evaluate(async (nodeId) => {
    let previous = "",
      stable = 0;
    for (let frame = 0; frame < 180; frame++) {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      const r = document
        .querySelector(`[data-id="${nodeId}"] .speech-hit`)
        ?.getBoundingClientRect();
      const current = r
        ? [r.x, r.y, r.width, r.height].map((n) => n.toFixed(1)).join(",")
        : "";
      stable = current && current === previous ? stable + 1 : 0;
      previous = current;
      if (stable >= 3) return;
    }
    throw new Error(`node ${nodeId} did not settle`);
  }, id);
}
async function measure(
  page: Page,
  name: string,
  action: () => Promise<void>,
  settled: () => Promise<void>,
) {
  await page.evaluate((key) => performance.mark(key), `${name}-start`);
  await action();
  await settled();
  await nextFrame(page);
  return page.evaluate((key) => {
    performance.mark(`${key}-end`);
    return performance.measure(key, `${key}-start`, `${key}-end`).duration;
  }, name);
}

test("500ノードの選択・検索・折り畳みを各100操作で観測する", async ({
  page,
}) => {
  test.setTimeout(600_000);
  const text =
    Array.from({ length: 500 }, (_, i) =>
      `話者: ${String(i).padStart(3, "0")} `.padEnd(99, "あ"),
    ).join("\n") + "あ";
  const parsed = await parseInputs([
    { name: "性能500ノード.txt", text, format: "txt", role: "conversation" },
  ]);
  const project = createProject(parsed, "500ノード性能フィクスチャ", "full");
  project.utterances.forEach((u, i) => {
    if (i % 7 === 0) u.classification = "derived";
    else if (i % 11 === 0) u.classification = "drift";
  });
  expect([...text]).toHaveLength(50_000);
  expect(project.utterances).toHaveLength(500);
  const ids = Array.from(
    { length: 8 },
    (_, i) =>
      project.utterances[Math.round((i * (project.utterances.length - 1)) / 7)]
        .id,
  );
  const values: Record<string, number[]> = {
    selection: [],
    search: [],
    fold: [],
  };
  const operationLog: object[] = [];
  const startedAt = new Date().toISOString();
  const testedSha = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const dirty = Boolean(
    execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(),
  );
  let failure: string | null = null;
  let browserDetails: object = {};
  let servedIdentity: unknown = null;
  let activeStep = {
    operation: "setup",
    index: -1,
    id: "",
    startedAt: new Date().toISOString(),
    wallStart: Date.now(),
  };
  const log = (
    operation: string,
    index: number,
    duration: number,
    details: object = {},
  ) => {
    operationLog.push({
      operation,
      index,
      durationMs: duration,
      completedAt: new Date().toISOString(),
      ...details,
    });
    if ((index + 1) % 10 === 0)
      console.log(`[diagnostic] ${operation} ${index + 1}/${COUNT}`);
  };
  try {
    expect(dirty, "診断対象はclean checkoutであること").toBe(false);
    const response = await page.request.get("/__rontenseiri_build_identity");
    expect(response.ok()).toBe(true);
    servedIdentity = await response.json();
    expect(servedIdentity).toEqual({ sha: testedSha, dirty: false });
    await page.goto("/");
    browserDetails = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl");
      const ext = gl?.getExtension("WEBGL_debug_renderer_info");
      return {
        userAgent: navigator.userAgent,
        logicalCores: navigator.hardwareConcurrency,
        webglRenderer:
          ext && gl ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
        webgpuAdapter: "未取得・実GPU機種未検証",
      };
    });
    await page.locator('input[type="file"]').setInputFiles({
      name: "performance-500.json",
      mimeType: "application/json",
      buffer: Buffer.from(exportProject(project, "json", undefined, true)),
    });
    await expect(page.locator(".flow-container")).toBeVisible();
    await expect(page.locator(".speech-node")).toHaveCount(500);
    const searchButton = page.getByRole("button", {
      name: "発言を検索",
      exact: true,
    });
    const searchBox = page.getByRole("textbox", { name: "発言を検索" });
    const agendaButton = page.locator(".sidebar-agendas > button").first();
    for (let i = 0; i < COUNT; i++) {
      const id = ids[i % ids.length];
      activeStep = {
        operation: "selection-preparation-and-click",
        index: i,
        id,
        startedAt: new Date().toISOString(),
        wallStart: Date.now(),
      };
      if (!(await searchBox.isVisible())) await searchButton.click();
      await searchBox.fill(id);
      await searchBox.press("Enter");
      await settleNode(page, id);
      await expect(
        page.locator(`[data-id="${id}"] .speech-node.is-selected`),
      ).toHaveCount(1);
      await agendaButton.click();
      await expect(
        page.locator(`[data-id="${id}"] .speech-node.is-selected`),
      ).toHaveCount(0);
      await settleNode(page, id);
      const hit = page.locator(`[data-id="${id}"] .speech-hit`);
      const duration = await measure(
        page,
        `selection-${i}`,
        async () => {
          const box = await hit.boundingBox();
          expect(box).not.toBeNull();
          await page.mouse.click(
            box!.x + box!.width / 2,
            box!.y + box!.height / 2,
          );
        },
        async () => {
          await expect(
            page.locator(`[data-id="${id}"] .speech-node.is-selected`),
          ).toHaveCount(1);
          await expect(page.locator(".inspector")).toContainText(id);
          await settleNode(page, id);
        },
      );
      values.selection.push(duration);
      log("selection", i, duration, { id, selectedIdConfirmed: true });
    }
    for (let i = 0; i < COUNT; i++) {
      const id = ids[(i + 1) % ids.length];
      activeStep = {
        operation: "search",
        index: i,
        id,
        startedAt: new Date().toISOString(),
        wallStart: Date.now(),
      };
      if (!(await searchBox.isVisible())) await searchButton.click();
      const duration = await measure(
        page,
        `search-${i}`,
        async () => {
          await searchBox.fill(id);
          await searchBox.press("Enter");
        },
        async () => {
          await expect(
            page.locator(`[data-id="${id}"] .speech-node.is-selected`),
          ).toHaveCount(1);
          await expect(page.locator(".inspector")).toContainText(id);
          await settleNode(page, id);
        },
      );
      values.search.push(duration);
      log("search", i, duration, {
        id,
        selectedIdConfirmed: true,
        canvasVisibleConfirmed: true,
      });
    }
    const foldButton = page.getByRole("button", {
      name: /枝を(折りたたむ|開く)/,
    });
    const baselinePositions = await page
      .locator(".speech-hit")
      .evaluateAll((elements) =>
        elements
          .map((el) => {
            const node = el.closest<HTMLElement>(".react-flow__node")!;
            return { id: node.dataset.id!, transform: node.style.transform };
          })
          .sort((a, b) => a.id.localeCompare(b.id)),
      );
    let previousVisible = await page.locator(".speech-node").count();
    for (let i = 0; i < COUNT; i++) {
      const before = previousVisible;
      activeStep = {
        operation: "fold",
        index: i,
        id: i % 2 === 0 ? "collapse" : "expand",
        startedAt: new Date().toISOString(),
        wallStart: Date.now(),
      };
      const expectedIds = new Set(
        project.utterances
          .filter(
            (u) =>
              i % 2 !== 0 ||
              (u.classification !== "derived" && u.classification !== "drift"),
          )
          .map((u) => u.id),
      );
      const expectedPositions = baselinePositions.filter((n) =>
        expectedIds.has(n.id),
      );
      const duration = await measure(
        page,
        `fold-${i}`,
        async () => {
          await foldButton.click();
        },
        async () => {
          await expect(page.locator(".speech-node")).toHaveCount(
            expectedIds.size,
          );
          await expect
            .poll(() =>
              page.locator(".speech-hit").evaluateAll((elements) =>
                elements
                  .map((el) => {
                    const node = el.closest<HTMLElement>(".react-flow__node")!;
                    return {
                      id: node.dataset.id!,
                      transform: node.style.transform,
                    };
                  })
                  .sort((a, b) => a.id.localeCompare(b.id)),
              ),
            )
            .toEqual(expectedPositions);
          await nextFrame(page);
          await nextFrame(page);
        },
      );
      previousVisible = await page.locator(".speech-node").count();
      values.fold.push(duration);
      log("fold", i, duration, {
        beforeVisibleNodes: before,
        afterVisibleNodes: previousVisible,
        expectedVisibleNodes: expectedIds.size,
        exactVisibleIdsAndPositionsConfirmed: true,
      });
    }
  } catch (error) {
    failure = String(error);
    operationLog.push({
      failure: true,
      ...activeStep,
      failedAt: new Date().toISOString(),
      phaseAndPreparationElapsedMs: Date.now() - activeStep.wallStart,
      error: failure,
    });
    throw error;
  } finally {
    const operations = [
      metric("node-selection", values.selection),
      metric("node-search", values.search),
      metric("branch-collapse-toggle", values.fold),
    ];
    await mkdir("artifacts", { recursive: true });
    await writeFile(
      "artifacts/canvas-performance.json",
      JSON.stringify(
        {
          testedSha,
          dirtyWorkingTree: dirty,
          servedIdentity,
          diagnosticOnly: true,
          eligibleForG5: false,
          protocol: {
            sessions: 1,
            warmupOperations: 0,
            excludedOperations: 0,
            order: ["selection", "search", "fold"],
            cacheIsolation:
              "uncontrolled across operation groups; selection preparation includes search; not a controlled G5 protocol",
            concurrentHostLoad: "not controlled",
          },
          startedAt,
          timestamp: new Date().toISOString(),
          evaluator: "automated Playwright observation",
          environment: {
            browser: page.context().browser()?.version(),
            viewport: { width: 1440, height: 980 },
            os: process.platform,
            kernel: release(),
            cpu: cpus()[0]?.model,
            memoryBytes: totalmem(),
            ...browserDetails,
            cache:
              "fresh browser context; no model; Vite development server/module cache may be warm",
            build: "Vite development server (not production timing)",
          },
          fixture: {
            caseId: "canvas-500-v1",
            schema: "Project v1",
            nodes: 500,
            codePoints: 50000,
            textSha256: createHash("sha256").update(text).digest("hex"),
            sampledNodeIds: ids,
            includesDerivedAndDriftBranches: true,
          },
          procedure:
            "UI JSON import; selection: search/focus preparation outside timing, agenda click clears selectedId, real pointer click on unselected node; search: textbox fill+Enter; fold: alternating toolbar toggles, visible node-count change. 8 IDs distributed across the full chronology.",
          durationDefinition:
            "performance.mark before action through DOM assertions and next frame; selection/search additionally require 3 stable animation frames. Includes Playwright RPC/assertion overhead, not paint or real-device input latency. Full-DOM tracing disabled; operationLog retained.",
          observational: true,
          ciMeaning:
            "CI only checks diagnostic execution and assertions. Threshold exceedance is NOT a performance gate pass. This harness is ineligible for G5 acceptance.",
          operations,
          operationLog,
          failure,
          complete:
            failure === null && operations.every((m) => m.count === COUNT),
          g5Passed: false,
          g5Status:
            "部分測定。性能閾値、主要キーボード導線・アクセシビリティ・全復旧ケースの証跡、およびiPhone/Mac/Windows実機ゲートは別途確認が必要。Linux観測だけではG5全体を合格にしない。",
        },
        null,
        2,
      ) + "\n",
    );
    evidenceWritten = true;
  }
  expect(
    Object.values(values).every(
      (v) => v.length === COUNT && v.every((n) => Number.isFinite(n) && n >= 0),
    ),
  ).toBe(true);
});
