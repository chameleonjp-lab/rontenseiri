import { projectCoverageComplete } from "./coverage";
import type { Project, Source } from "./types";
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;
export const encodeBytes = (value: string) =>
  new TextEncoder().encode(value).byteLength;
export function fullBackupEnvelope(project: Project) {
  return {
    scope: "full",
    manifest: {
      sourceCoverageComplete: projectCoverageComplete(project),
      organizationComplete: false,
      schemaVersion: 1,
      limited: false,
      fullBackup: true,
      historyIncluded: true,
    },
    project,
  };
}
export function activeSources(project: Project): Source[] {
  const ids = [...new Set(project.sources.map((s) => s.id))];
  return ids.map((id) => {
    const used = new Set(
      project.utterances
        .filter((u) => u.sourceId === id)
        .map((u) => u.sourceVersionId),
    );
    if (used.size > 1)
      throw Error("同じ資料の現行発言に複数の原文版が混在しています");
    const versions = project.sources.filter((s) => s.id === id);
    return used.size
      ? versions.find((s) => used.has(s.versionId))!
      : versions[versions.length - 1];
  });
}
export function projectCapacity(project: Project) {
  const current = activeSources(project);
  const activeIds = new Set(current.map((s) => s.versionId));
  const activeCodePoints = current.reduce(
    (n, s) => n + Array.from(s.text).length,
    0,
  );
  const historyTextBytes = project.sources
    .filter((s) => !activeIds.has(s.versionId))
    .reduce((n, s) => n + encodeBytes(s.text), 0);
  const revisionBytes = encodeBytes(JSON.stringify(project.revisions));
  // The revision log can occupy almost the entire 50MiB budget. Serialize it
  // once, then replace the two-byte [] placeholder arithmetically. Likewise
  // replace the four-byte null in the envelope, without serializing it again.
  const projectBytes =
    encodeBytes(JSON.stringify({ ...project, revisions: [] })) -
    2 +
    revisionBytes;
  const backupBytes =
    projectBytes +
    encodeBytes(
      JSON.stringify({
        ...fullBackupEnvelope(project),
        project: null,
      }),
    ) -
    4;
  return {
    activeCodePoints,
    activeFiles: current.length,
    historyTextBytes,
    revisionBytes,
    projectBytes,
    backupBytes,
    remainingBytes: Math.max(0, MAX_BACKUP_BYTES - backupBytes),
  };
}
