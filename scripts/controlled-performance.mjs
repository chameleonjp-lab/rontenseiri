import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { cpus, freemem, loadavg, release, totalmem } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const OPERATIONS = ["selection", "search", "fold"];
export const ROUNDS = [
  ["selection", "search", "fold"],
  ["search", "fold", "selection"],
  ["fold", "selection", "search"],
];
export const COUNT = 100;
export const WARMUP = 20;
export const THRESHOLD_MS = 200;

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const metricNames = ["node-selection", "node-search", "branch-collapse-toggle"];
const metricFor = {
  selection: "node-selection",
  search: "node-search",
  fold: "branch-collapse-toggle",
};

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/** Validate one controlled child result against the operation-specific contract. */
export function validateResult(result, operation, expectedSha) {
  const errors = [];
  if (!result || typeof result !== "object") return ["result is not an object"];
  if (result.testedSha !== expectedSha) errors.push("testedSha mismatch");
  if (result.dirtyWorkingTree !== false)
    errors.push("working tree was not clean");
  if (
    JSON.stringify(result.servedIdentity) !==
    JSON.stringify({ sha: expectedSha, dirty: false })
  )
    errors.push("served identity mismatch");
  if (
    result.diagnosticOnly !== true ||
    result.eligibleForG5 !== false ||
    result.g5Passed !== false
  )
    errors.push("diagnostic/G5 flags are invalid");
  if (result.complete !== true || result.failure !== null)
    errors.push("result is incomplete or has failure");
  const protocol = result.protocol;
  if (
    !protocol ||
    protocol.mode !== "controlled-production-v1" ||
    protocol.warmupOperations !== WARMUP ||
    protocol.excludedMeasuredOperations !== 0
  )
    errors.push("protocol mode or warmup is invalid");
  if (
    !Array.isArray(protocol?.order) ||
    protocol.order.length !== 1 ||
    protocol.order[0] !== operation
  )
    errors.push("protocol order does not match operation");
  if (protocol?.excludedMeasuredOperations !== 0)
    errors.push("excluded measured operations is not zero");
  const operations = result.operations;
  if (!Array.isArray(operations))
    return [...errors, "operations is not an array"];
  const name = metricFor[operation];
  if (operations.length !== 1 || operations[0]?.name !== name)
    errors.push("operations must contain only the requested metric");
  const metric = operations.find((item) => item?.name === name);
  if (!metric) return [...errors, `missing ${name}`];
  if (
    metric.count !== COUNT ||
    !Array.isArray(metric.values) ||
    metric.values.length !== COUNT
  )
    errors.push(`${name} count/values is not 100`);
  if (!metric.values?.every((value) => finiteNumber(value) && value >= 0))
    errors.push(`${name} has non-finite raw values`);
  const sorted = [...(metric.values ?? [])].sort((a, b) => a - b);
  const expectedP95 =
    sorted.length === COUNT ? sorted[Math.ceil(COUNT * 0.95) - 1] : undefined;
  if (!finiteNumber(metric.p95) || metric.p95 !== expectedP95)
    errors.push(`${name} p95 does not match raw values`);
  if (
    metric.thresholdMs !== THRESHOLD_MS ||
    metric.withinLatencyBudget !== true ||
    metric.p95 > THRESHOLD_MS
  )
    errors.push(`${name} p95 exceeds threshold`);
  const gate = result.latencyBudgetGate;
  if (!gate || gate.thresholdMs !== THRESHOLD_MS || gate.passed !== true)
    errors.push("latency budget gate is invalid");
  const log = result.operationLog;
  if (!Array.isArray(log)) errors.push("operation log is not an array");
  else {
    if (log.length !== WARMUP + COUNT)
      errors.push("operation log has unexpected length");
    const warmup = log.filter((entry) => entry?.warmup === true);
    const measured = log.filter((entry) => entry?.warmup === false);
    const validIndexes = (entries, start, count) =>
      entries.length === count &&
      new Set(entries.map((entry) => entry?.index)).size === count &&
      entries.every(
        (entry, index) =>
          entry?.operation === operation && entry?.index === start + index,
      );
    if (!validIndexes(warmup, -WARMUP, WARMUP))
      errors.push("warmup operation log is incomplete or duplicated");
    if (!validIndexes(measured, 0, COUNT))
      errors.push("measured operation log is incomplete or duplicated");
  }
  return errors;
}

async function hashTree(directory) {
  const files = [];
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
    }
  }
  if (existsSync(directory)) await visit(directory);
  files.sort();
  const manifest = {};
  for (const path of files)
    manifest[path.slice(directory.length + 1)] = createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
  return manifest;
}

function hostSnapshot() {
  return {
    loadavg: [...loadavg()],
    freeMemoryBytes: freemem(),
    totalMemoryBytes: totalmem(),
  };
}
function progress(message) {
  console.log(`[controlled-performance] ${message}`);
}

export function schedule({
  root = resolve(repository, "artifacts/controlled-performance"),
  cwd = repository,
  port = process.env.PLAYWRIGHT_PORT || "4193",
} = {}) {
  return { root, cwd, port, rounds: ROUNDS.map((order) => [...order]) };
}

export async function runControlledPerformance(options = {}) {
  const plan = schedule(options);
  const startedAt = new Date().toISOString();
  await rm(plan.root, { recursive: true, force: true });
  await mkdir(plan.root, { recursive: true });
  let sha;
  try {
    sha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: plan.cwd,
      encoding: "utf8",
    }).trim();
  } catch {
    sha = null;
  }
  const status = spawnSync("git", ["status", "--porcelain"], {
    cwd: plan.cwd,
    encoding: "utf8",
  });
  const clean = status.status === 0 && !status.stdout.trim();
  if (!clean)
    progress("warning: checkout is not clean; child evidence will be invalid");

  progress("npm run build (once)");
  const build = spawnSync("npm", ["run", "build"], {
    cwd: plan.cwd,
    stdio: "inherit",
    timeout: 120_000,
    encoding: "utf8",
  });
  const buildOk = build.status === 0;
  const distManifest = buildOk
    ? await hashTree(resolve(plan.cwd, "dist"))
    : null;
  const groups = [];
  if (buildOk && clean)
    for (let roundIndex = 0; roundIndex < ROUNDS.length; roundIndex++) {
      for (const operation of ROUNDS[roundIndex]) {
        const groupName = `round-${roundIndex + 1}-${operation}`;
        const groupRoot = resolve(plan.root, groupName);
        await mkdir(groupRoot, { recursive: true });
        const output = resolve(groupRoot, "canvas-performance.json");
        const report = resolve(groupRoot, "e2e-results.json");
        const testResults = resolve(groupRoot, "test-results");
        const before = hostSnapshot();
        progress(`${groupName} start (${groups.length + 1}/9)`);
        const child = spawnSync(
          "npx",
          [
            "playwright",
            "test",
            "e2e/performance.spec.ts",
            "--config=playwright.performance.config.ts",
            `--output=${testResults}`,
          ],
          {
            cwd: plan.cwd,
            env: {
              ...process.env,
              RONTENSEIRI_PERFORMANCE_OPERATION: operation,
              RONTENSEIRI_PERFORMANCE_WARMUP: String(WARMUP),
              RONTENSEIRI_PERFORMANCE_OUTPUT: output,
              PLAYWRIGHT_REPORT_PATH: report,
              PLAYWRIGHT_PORT: String(plan.port),
            },
            stdio: "inherit",
            timeout: 600_000,
            encoding: "utf8",
          },
        );
        const after = hostSnapshot();
        let result = null;
        let errors = [];
        try {
          result = JSON.parse(await readFile(output, "utf8"));
          errors = validateResult(result, operation, sha);
        } catch (error) {
          errors = [`cannot read result: ${error.message}`];
        }
        groups.push({
          group: groupName,
          round: roundIndex + 1,
          operation,
          childExitCode: child.status,
          childSignal: child.signal,
          timeout: child.error?.code === "ETIMEDOUT",
          before,
          after,
          resultErrors: errors,
          passed: child.status === 0 && errors.length === 0,
        });
        progress(`${groupName} ${groups.at(-1).passed ? "passed" : "failed"}`);
      }
    }
  const summary = {
    mode: "controlled-production-v1",
    startedAt,
    finishedAt: new Date().toISOString(),
    testedSha: sha,
    cleanCheckout: clean,
    build: {
      ranOnce: true,
      passed: buildOk,
      timeoutSeconds: 120,
      distManifest,
    },
    protocol: {
      rounds: 3,
      sessionsPerOperation: 3,
      operationsPerSession: COUNT,
      warmupOperations: WARMUP,
      thresholdMs: THRESHOLD_MS,
      orders: ROUNDS,
      eachGroupNewBrowserContextAndServerProcess: true,
    },
    groups,
    diagnosticOnly: true,
    eligibleForG5: false,
    g5Passed: false,
    note: "独立性能runnerはG5全体、実機、AI、ATの代用ではない。OS負荷は記録のみで、ホスト負荷統制を主張しない。",
    passed:
      buildOk &&
      clean &&
      groups.length === 9 &&
      groups.every((group) => group.passed),
    host: {
      os: process.platform,
      kernel: release(),
      cpu: cpus()[0]?.model,
      before: groups[0]?.before,
      after: groups.at(-1)?.after,
    },
  };
  await writeFile(
    resolve(plan.root, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  if (!summary.passed) process.exitCode = 1;
  return summary;
}

const invoked =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invoked) await runControlledPerformance();
