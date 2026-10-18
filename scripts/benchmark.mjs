import { performance } from "node:perf_hooks";
import { writeFile, mkdir } from "node:fs/promises";
import { createServer } from "vite";

// Node-only local engineering measurements; this is not an AI or real-device gate.
const server = await createServer({
  configFile: false,
  cacheDir: "node_modules/.vite-benchmark",
  server: { middlewareMode: true },
  appType: "custom",
});
try {
  const [
    { parseInputs },
    { createProject, validateProject },
    { exportProject, importProject },
    { layoutProject },
    { projectCapacity },
  ] = await Promise.all([
    server.ssrLoadModule("/src/input/parse.ts"),
    server.ssrLoadModule("/src/domain/project.ts"),
    server.ssrLoadModule("/src/export/project.ts"),
    server.ssrLoadModule("/src/domain/layout.ts"),
    server.ssrLoadModule("/src/domain/capacity.ts"),
  ]);
  const rows = Array.from({ length: 500 }, (_, i) =>
    `話者: ${String(i).padStart(3, "0")} `.padEnd(99, "あ"),
  );
  let text = rows.join("\n");
  text += "あ".repeat(50000 - [...text].length);
  const samples = {
    input: [],
    validation: [],
    layout: [],
    output: [],
    restore: [],
  };
  let bytes = 0,
    nodes = 0;
  for (let iteration = 0; iteration < 20; iteration++) {
    let started = performance.now();
    const parsed = await parseInputs([
      { name: "架空の最大入力.txt", text, role: "conversation", format: "txt" },
    ]);
    samples.input.push(performance.now() - started);
    const project = createProject(parsed, "架空の性能用データ", "full");
    started = performance.now();
    validateProject(project);
    samples.validation.push(performance.now() - started);
    started = performance.now();
    const layout = layoutProject(project);
    samples.layout.push(performance.now() - started);
    nodes = project.utterances.length;
    if (!layout) throw new Error("Layout did not run");
    started = performance.now();
    const json = exportProject(project, "json", undefined, true);
    samples.output.push(performance.now() - started);
    bytes = projectCapacity(project).backupBytes;
    started = performance.now();
    const restored = importProject(json);
    samples.restore.push(performance.now() - started);
    if (restored.utterances.length !== nodes)
      throw new Error("Roundtrip lost utterances");
  }
  const measures = Object.fromEntries(
    Object.entries(samples).map(([name, values]) => {
      const sorted = values.toSorted((a, b) => a - b);
      return [
        name,
        {
          count: values.length,
          medianMs: sorted[Math.ceil(sorted.length * 0.5) - 1],
          p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
        },
      ];
    }),
  );
  const result = {
    environment: {
      os: process.platform,
      arch: process.arch,
      node: process.version,
      kind: "cloud Linux / Node; not Mac, Windows, iPhone or browser interaction",
    },
    fixture: {
      source: "synthetic, authored for this test",
      codePoints: [...text].length,
      nodes,
      backupBytes: bytes,
      history:
        "No history in this benchmark. 30 split/merge revisions are covered by lineage-integration.test.ts, not represented as a maximum-history timing.",
    },
    measures,
    gates: {
      G4: "not measured: model, real devices and memory",
      G5: "not passed: browser interaction p95, memory and maximum history require separate measurement",
    },
  };
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/software-benchmark.json",
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await server.close();
}
