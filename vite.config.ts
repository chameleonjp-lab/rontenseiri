import { createHash } from "node:crypto";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

function developmentBuildIdentity(): Plugin {
  return {
    name: "rontenseiri-development-build-identity",
    apply: "serve",
    configureServer(server) {
      let identity: { sha: string; dirty: boolean };
      try {
        identity = {
          sha: execFileSync("git", ["rev-parse", "HEAD"], {
            encoding: "utf8",
          }).trim(),
          dirty: Boolean(
            execFileSync("git", ["status", "--porcelain"], {
              encoding: "utf8",
            }).trim(),
          ),
        };
      } catch {
        identity = { sha: "unknown", dirty: true };
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
    plugins: [react(), developmentBuildIdentity(), offlineServiceWorker()],
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
