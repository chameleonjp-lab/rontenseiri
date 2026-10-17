import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

const port = process.env.PLAYWRIGHT_PORT || "4193";
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig(base, {
  testMatch: "performance.spec.ts",
  retries: 0,
  workers: 1,
  use: { ...base.use, baseURL, serviceWorkers: "block" },
  webServer: {
    command: `npm run preview -- --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
  },
});
