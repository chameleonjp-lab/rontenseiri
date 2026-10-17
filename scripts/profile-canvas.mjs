import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(repository, "package.json"));
const { chromium } = require("playwright");
import { spawn, execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = process.env.PROFILE_ROOT || repository,
  port = Number(process.env.PROFILE_PORT || 4196),
  tag = process.argv[2] || "candidate";
const output = resolve(repository, "artifacts/profiles");
await mkdir(output, { recursive: true });
const server = spawn(
  "npm",
  ["run", "dev", "--", "--port", String(port), "--strictPort"],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"], detached: true },
);
let serverOutput = "";
server.stdout.on("data", (x) => (serverOutput += x));
server.stderr.on("data", (x) => (serverOutput += x));
let browser;
try {
  let ready = false;
  for (let i = 0; i < 150; i++) {
    try {
      if (
        (await fetch(`http://127.0.0.1:${port}/__rontenseiri_build_identity`))
          .ok
      ) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!ready) throw Error(serverOutput);
  browser = await chromium.launch({
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    headless: true,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 980 },
  });
  await page.goto(`http://127.0.0.1:${port}/`);
  const fixture = await page.evaluate(async () => {
    const parsePath = "/src/input/parse.ts",
      domainPath = "/src/domain/project.ts",
      exportPath = "/src/export/project.ts";
    const { parseInputs } = await import(parsePath),
      { createProject } = await import(domainPath),
      { exportProject } = await import(exportPath);
    const text =
      Array.from({ length: 500 }, (_, i) =>
        `話者: ${String(i).padStart(3, "0")} `.padEnd(99, "あ"),
      ).join("\n") + "あ";
    const p = createProject(
      await parseInputs([
        { name: "profile500.txt", format: "txt", role: "conversation", text },
      ]),
      "500-node profile",
      "full",
    );
    p.utterances.forEach((u, i) => {
      if (i % 7 === 0) u.classification = "derived";
      else if (i % 11 === 0) u.classification = "drift";
    });
    return exportProject(p, "json", undefined, true);
  });
  await page.locator('input[type="file"]').setInputFiles({
    name: "profile.json",
    mimeType: "application/json",
    buffer: Buffer.from(fixture),
  });
  await page.locator(".speech-hit").first().waitFor();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.start");
  const ids = ["U01", "U143", "U286", "U500"];
  const rows = [];
  const metrics = async () =>
    Object.fromEntries(
      (await cdp.send("Performance.getMetrics")).metrics.map((m) => [
        m.name,
        m.value,
      ]),
    );
  const settle = async () => {
    await page.evaluate(async () => {
      for (let i = 0; i < 4; i++)
        await new Promise((r) => requestAnimationFrame(r));
    });
  };
  const searchBox = page.getByRole("textbox", { name: "発言を検索" });
  await page.getByRole("button", { name: "発言を検索", exact: true }).click();
  async function observe(operation, index, action, check) {
    const before = await metrics();
    const start = Date.now();
    await action();
    await check();
    await settle();
    const after = await metrics();
    rows.push({
      operation,
      index,
      wallMs: Date.now() - start,
      scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000,
      layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
      styleMs: (after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000,
      taskMs: (after.TaskDuration - before.TaskDuration) * 1000,
      layouts: after.LayoutCount - before.LayoutCount,
      styleRecalcs: after.RecalcStyleCount - before.RecalcStyleCount,
      domNodes: after.Nodes,
      heapBytes: after.JSHeapUsedSize,
    });
  }
  for (let i = 0; i < 8; i++) {
    const id = ids[i % ids.length];
    await searchBox.fill(id);
    await searchBox.press("Enter");
    await page.locator(`[data-id="${id}"] .speech-node.is-selected`).waitFor();
    await page.waitForTimeout(350);
    await page.locator(".sidebar-agendas > button").first().click();
    await page.waitForFunction(
      (id) => !document.querySelector(`[data-id="${id}"] .is-selected`),
      id,
    );
    await settle();
    await observe(
      "selection",
      i,
      async () => {
        const b = await page
          .locator(`[data-id="${id}"] .speech-hit`)
          .boundingBox();
        await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
      },
      async () => {
        await page
          .locator(`[data-id="${id}"] .speech-node.is-selected`)
          .waitFor();
      },
    );
  }
  for (let i = 0; i < 8; i++) {
    const id = ids[(i + 1) % ids.length];
    await observe(
      "search",
      i,
      async () => {
        await searchBox.fill(id);
        await searchBox.press("Enter");
      },
      async () => {
        await page
          .locator(`[data-id="${id}"] .speech-node.is-selected`)
          .waitFor();
        await page.waitForTimeout(300);
      },
    );
  }
  for (let i = 0; i < 8; i++) {
    const before = await page.locator(".speech-node").count();
    await observe(
      "fold",
      i,
      async () => {
        await page
          .getByRole("button", { name: /枝を(折りたたむ|開く)/ })
          .click();
      },
      async () => {
        await page.waitForFunction(
          (before) =>
            document.querySelectorAll(".speech-node").length !== before,
          before,
        );
      },
    );
  }
  const { profile } = await cdp.send("Profiler.stop");
  await writeFile(`${output}/${tag}.cpuprofile`, JSON.stringify(profile));
  const sources = {};
  for (const p of [
    "src/components/DiscussionCanvas.tsx",
    "src/components/Inspector.tsx",
    "src/components/UtteranceBoundaryEditor.tsx",
    "src/App.tsx",
    "src/components/canvas-model.ts",
    "src/components/LazyDetails.tsx",
  ]) {
    try {
      sources[p] = createHash("sha256")
        .update(await readFile(`${root}/${p}`))
        .digest("hex");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const result = {
    tag,
    sha: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
    servedIdentity: await (
      await page.request.get(
        `http://127.0.0.1:${port}/__rontenseiri_build_identity`,
      )
    ).json(),
    browser: browser.version(),
    timestamp: new Date().toISOString(),
    profilingOnly: true,
    notG5: true,
    note: "8 samples per operation; extra 300ms search wait for baseline animation is profiling synchronization, not a G5 duration; warm preparation outside selection. Compare script/layout/style/task deltas, not this wall metric.",
    sources,
    rows,
  };
  await writeFile(
    `${output}/${tag}.json`,
    JSON.stringify(result, null, 2) + "\n",
  );
  for (const op of ["selection", "search", "fold"]) {
    const a = rows.filter((r) => r.operation === op);
    console.log(
      op,
      Object.fromEntries(
        [
          "wallMs",
          "scriptMs",
          "layoutMs",
          "styleMs",
          "taskMs",
          "layouts",
          "styleRecalcs",
        ].map((k) => [k, a.reduce((s, r) => s + r[k], 0) / a.length]),
      ),
    );
  }
  console.log("profile saved", tag);
} finally {
  await browser?.close();
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {}
}
