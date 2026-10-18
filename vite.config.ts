import { createHash } from "node:crypto";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

function productionBuildIdentity(): Plugin {
  let isProductionBuild = false;
  return {
    name: "rontenseiri-production-build-identity",
    apply: "build",
    configResolved(config) {
      isProductionBuild = config.command === "build" && config.isProduction;
    },
    generateBundle() {
      if (!isProductionBuild) return;
      const sha = execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim();
      this.emitFile({
        type: "asset",
        fileName: "__rontenseiri_build_identity",
        source:
          JSON.stringify({
            sha,
            buildSha: sha,
            dirty: Boolean(
              execFileSync("git", ["status", "--porcelain"], {
                encoding: "utf8",
              }).trim(),
            ),
            mode: "production",
          }) + "\n",
      });
    },
  };
}

function developmentBuildIdentity(): Plugin {
  return {
    name: "rontenseiri-development-build-identity",
    apply: "serve",
    configureServer(server) {
      let identity: {
        sha: string;
        buildSha: string;
        dirty: boolean;
        mode: "development";
      };
      try {
        const sha = execFileSync("git", ["rev-parse", "HEAD"], {
          encoding: "utf8",
        }).trim();
        identity = {
          sha,
          buildSha: sha,
          dirty: Boolean(
            execFileSync("git", ["status", "--porcelain"], {
              encoding: "utf8",
            }).trim(),
          ),
          mode: "development",
        };
      } catch {
        identity = {
          sha: "unknown",
          buildSha: "unknown",
          dirty: true,
          mode: "development",
        };
      }
      server.middlewares.use("/__rontenseiri_build_identity", (_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify(identity));
      });
    },
  };
}

function offlineServiceWorker(): Plugin {
  return {
    name: "rontenseiri-offline-service-worker",
    apply: "build",
    writeBundle(options, bundle) {
      const outputDir = options.dir ?? join(process.cwd(), "dist");
      const assets = Object.values(bundle)
        .filter((item) => item.type === "asset" || item.type === "chunk")
        .map((item) => item.fileName)
        .filter((name) => !name.endsWith("service-worker.js"));
      if (!assets.includes("index.html")) assets.push("index.html");
      const base = String(
        this.meta.watchMode ? "./" : process.env.__RONTENSEIRI_BASE || "./",
      );
      const assetUrls = [base, ...assets.map((name) => `${base}${name}`)];
      const source = readFileSync(
        join(process.cwd(), "public/service-worker.js"),
        "utf8",
      )
        .replace(
          "__RONTENSEIRI_VERSION__",
          JSON.stringify(
            createHash("sha256")
              .update(JSON.stringify(bundle))
              .digest("hex")
              .slice(0, 16),
          ),
        )
        .replace("__RONTENSEIRI_ASSETS__", JSON.stringify(assetUrls));
      writeFileSync(join(outputDir, "service-worker.js"), source);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "CUE_");
  const base = env.CUE_APP_BASE || process.env.VITE_APP_BASE || "./";
  process.env.__RONTENSEIRI_BASE = base;
  return {
    // The first real Worker must not discover WebLLM late and invalidate the
    // optimized dependency graph, reloading the UI in the middle of a run.
    optimizeDeps: { include: ["@mlc-ai/web-llm"] },
    plugins: [
      react(),
      developmentBuildIdentity(),
      productionBuildIdentity(),
      offlineServiceWorker(),
    ],
    base,
    server: {
      watch: {
        ignored: [
          "**/test-results*/**",
          "**/artifacts/**",
          "**/playwright-report/**",
        ],
      },
      host: "127.0.0.1",
      allowedHosts: env.CUE_PREVIEW_HOST ? [env.CUE_PREVIEW_HOST] : undefined,
    },
    preview: { host: "127.0.0.1" },
    worker: { format: "es" },
    build: { chunkSizeWarningLimit: 1500 },
  };
});
