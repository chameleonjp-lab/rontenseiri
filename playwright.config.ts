import { defineConfig } from "@playwright/test";
const port = process.env.PLAYWRIGHT_PORT || "4173";
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile:
          process.env.PLAYWRIGHT_REPORT_PATH || "artifacts/e2e-results.json",
      },
    ],
  ],
  use: {
    baseURL,
    viewport: { width: 1440, height: 980 },
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
      args: ["--no-sandbox"],
    },
  },
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
  },
});
