import { describe, expect, it } from "vitest";
import { sampleProject } from "../src/analysis/sample";
import { validateProject } from "../src/domain/project";
import {
  reviseCompleteness,
  validateOmissions,
} from "../src/domain/completeness";
import { undoLastRevision } from "../src/domain/revisions";
import { exportProject, importProject } from "../src/export/project";

describe("P1 project completeness omissions", () => {
  it("accepts absence and empty reports, but rejects null, invented fields and duplicate ids", () => {
    expect(() => validateOmissions(undefined)).not.toThrow();
    expect(() => validateOmissions([])).not.toThrow();
    expect(() => validateOmissions(null)).toThrow();
    expect(() =>
      validateOmissions([
        { id: "x", description: "d", reason: "r", offset: 1 },
      ]),
    ).toThrow();
    expect(() =>
      validateOmissions([
        { id: "x", description: "d", reason: "r" },
        { id: "x", description: "d2", reason: "r2" },
      ]),
    ).toThrow();
    expect(() =>
      validateOmissions([
        { id: "x", description: "d", reason: "r", source: "s" },
      ]),
    ).toThrow();
  });

  it("records presence exactly, then undo restores omission presence", () => {
    const original = sampleProject();
    const report = [
      {
        id: "gap-1",
        description: "前半の添付資料",
        reason: "入力に含まれていない",
        location: "冒頭",
      },
    ];
    const changed = reviseCompleteness(
      original,
      "excerpt",
      report,
      "利用者報告を記録",
    );
    expect(changed.extent).toBe("excerpt");
    expect(changed.omissions).toEqual(report);
    expect(
      (changed.revisions.at(-1)?.before as Record<string, unknown>).omissions,
    ).toBeUndefined();
    expect(
      (changed.revisions.at(-1)?.after as Record<string, unknown>).omissions,
    ).toEqual(report);
    const undone = undoLastRevision(changed);
    expect(undone.extent).toBe(original.extent);
    expect(Object.prototype.hasOwnProperty.call(undone, "omissions")).toBe(
      false,
    );
  });

  it("keeps legacy JSON without omissions byte-for-byte at the project field", () => {
    const legacy = sampleProject();
    delete legacy.omissions;
    const roundTrip = importProject(exportProject(legacy, "json"));
    expect(Object.prototype.hasOwnProperty.call(roundTrip, "omissions")).toBe(
      false,
    );
    expect(validateProject(roundTrip).extent).toBe(legacy.extent);
  });
});
