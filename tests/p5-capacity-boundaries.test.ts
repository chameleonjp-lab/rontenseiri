import { describe, expect, it } from "vitest";
import { sampleProject } from "../src/analysis/sample";
import {
  encodeBytes,
  fullBackupEnvelope,
  MAX_BACKUP_BYTES,
  projectCapacity,
} from "../src/domain/capacity";
import { validateProject } from "../src/domain/project";
import type { Project, Revision, Source } from "../src/domain/types";
import { exportProject } from "../src/export/project";

const revision = (id: string, reason: string): Revision => ({
  id,
  at: "2026-10-17T12:00:00.000Z",
  targetId: "U01",
  kind: "user-revision",
  before: { classification: "main" },
  after: { classification: "main" },
  reason,
});

function projectWithReason(reason: string): Project {
  const project = structuredClone(sampleProject());
  project.revisions = [revision("capacity-revision", reason)];
  return project;
}

describe("P5 capacity boundaries", () => {
  it("accepts exact MAX_BACKUP_BYTES and rejects MAX_BACKUP_BYTES + 1 for validation and JSON export", () => {
    const emptyReason = projectWithReason("");
    const exactReason = "x".repeat(
      MAX_BACKUP_BYTES - projectCapacity(emptyReason).backupBytes,
    );
    const exact = projectWithReason(exactReason);
    const over = projectWithReason(`${exactReason}x`);
    const originalOver = structuredClone(over);

    expect(projectCapacity(exact).backupBytes).toBe(MAX_BACKUP_BYTES);
    expect(() => validateProject(exact)).not.toThrow();
    const exportedExact = exportProject(exact, "json", undefined, false);
    expect(encodeBytes(exportedExact)).toBe(MAX_BACKUP_BYTES);
    expect(encodeBytes(exportedExact)).toBe(projectCapacity(exact).backupBytes);

    expect(projectCapacity(over).backupBytes).toBe(MAX_BACKUP_BYTES + 1);
    expect(() => validateProject(over)).toThrow();
    expect(() => exportProject(over, "json", undefined, false)).toThrow();
    expect(over).toEqual(originalOver);
  });

  it("enforces the 1000-revision boundary with small valid revision objects", () => {
    const accepted = structuredClone(sampleProject());
    accepted.revisions = Array.from({ length: 1000 }, (_, index) =>
      revision(`revision-${index}`, "r"),
    );
    expect(() => validateProject(accepted)).not.toThrow();

    const rejected = structuredClone(accepted);
    rejected.revisions.push(revision("revision-1000", "r"));
    const originalRejected = structuredClone(rejected);
    expect(() => validateProject(rejected)).toThrow(
      "project history or utterance limit exceeded",
    );
    expect(rejected).toEqual(originalRejected);
  });

  it("counts history-only source growth in backup bytes without counting it as active input", () => {
    const project = structuredClone(sampleProject());
    const baseline = projectCapacity(project);
    const historical: Source = {
      ...structuredClone(project.sources[0]),
      versionId: "sample-source-v0",
      text: "履歴だけに残る原文",
    };
    project.sources = [historical, ...project.sources];
    const withHistory = projectCapacity(project);

    expect(withHistory.activeCodePoints).toBe(baseline.activeCodePoints);
    expect(withHistory.activeFiles).toBe(baseline.activeFiles);
    expect(withHistory.historyTextBytes).toBeGreaterThan(0);
    expect(withHistory.backupBytes).toBeGreaterThan(baseline.backupBytes);
  });

  it("rejects history-only source growth at MAX_BACKUP_BYTES + 1 without increasing active input", () => {
    const project = sampleProject();
    const baseline = projectCapacity(project);
    const historical: Source = {
      ...structuredClone(project.sources[0]),
      versionId: "history-only-boundary-v0",
      text: "",
    };
    project.sources.unshift(historical);
    historical.text = "x".repeat(
      MAX_BACKUP_BYTES - projectCapacity(project).backupBytes,
    );
    expect(projectCapacity(project).backupBytes).toBe(MAX_BACKUP_BYTES);
    expect(() => validateProject(project)).not.toThrow();
    historical.text += "x";
    const over = projectCapacity(project);
    expect(over.backupBytes).toBe(MAX_BACKUP_BYTES + 1);
    expect(over.activeCodePoints).toBe(baseline.activeCodePoints);
    expect(over.activeFiles).toBe(baseline.activeFiles);
    expect(over.historyTextBytes).toBe(encodeBytes(historical.text));
    expect(() => validateProject(project)).toThrow("50MiB");
    expect(() => exportProject(project, "json", undefined, false)).toThrow(
      "50MiB",
    );
  });

  it.each(["", "日本語😀", 'quote" slash\\\nline', "\ud800"])(
    "matches direct serialization for escaped and UTF-8 revision text %j",
    (reason) => {
      const project = projectWithReason(reason);
      const capacity = projectCapacity(project);
      expect(capacity.revisionBytes).toBe(
        encodeBytes(JSON.stringify(project.revisions)),
      );
      expect(capacity.projectBytes).toBe(encodeBytes(JSON.stringify(project)));
      expect(capacity.backupBytes).toBe(
        encodeBytes(JSON.stringify(fullBackupEnvelope(project))),
      );
    },
  );

  it("uses UTF-8 byte length rather than JavaScript string length", () => {
    const project = structuredClone(sampleProject());
    project.title += "あ";
    const serialized = JSON.stringify(fullBackupEnvelope(project));
    const capacity = projectCapacity(project);

    expect(capacity.backupBytes).toBe(encodeBytes(serialized));
    expect(capacity.backupBytes).toBeGreaterThan(serialized.length);
  });
});
