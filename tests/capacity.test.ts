import { describe, expect, it } from "vitest";
import { fullBackupEnvelope, projectCapacity } from "../src/domain/capacity";
import { sampleProject } from "../src/analysis/sample";
describe("capacity", () => {
  it("counts full JSON round trip envelope", () => {
    const p = sampleProject();
    const restored = JSON.parse(JSON.stringify(fullBackupEnvelope(p)));
    expect(restored.project).toEqual(p);
    expect(projectCapacity(p).backupBytes).toBeGreaterThan(0);
  });
});
