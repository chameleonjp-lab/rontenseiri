import { expect, it } from "vitest";
import performance from "../playwright.performance.config";

it("starts exactly one production-preview server, never an inherited development server", () => {
  expect(Array.isArray(performance.webServer)).toBe(false);
  const server = performance.webServer as {
    command: string;
    url: string;
    reuseExistingServer: boolean;
  };
  expect(server.command).toMatch(
    /^npm run preview -- --port \d+ --strictPort$/,
  );
  expect(server.url).toBe(performance.use?.baseURL);
  expect(server.reuseExistingServer).toBe(false);
  expect(performance.retries).toBe(0);
  expect(performance.workers).toBe(1);
  expect(performance.use?.serviceWorkers).toBe("block");
});
