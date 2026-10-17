import { describe, expect, it } from "vitest";
import { DB_NAME, LEGACY_DB_NAME } from "../src/storage/projects";
describe("storage scope", () => {
  it("uses an app-specific database and preserves legacy identity", () => {
    expect(DB_NAME).toMatch(/^rontenseiri-projects-v1$/);
    expect(DB_NAME).not.toBe(LEGACY_DB_NAME);
  });
});
