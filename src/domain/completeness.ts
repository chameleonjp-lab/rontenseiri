import type { Extent, Omission, Project } from "./types";
import { validateProject } from "./project";

const extents: readonly Extent[] = ["full", "excerpt", "unknown"];
const clone = <T>(value: T): T => structuredClone(value);
const now = () => new Date().toISOString();
const makeId = () =>
  `revision-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;

/** Validate the user-reported, project-level omissions without inventing source offsets. */
export function validateOmissions(value: unknown): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) throw new Error("omissions must be an array");
  const ids = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new Error("invalid omission");
    const record = item as Record<string, unknown>;
    const keys = Object.keys(record);
    if (
      keys.some(
        (key) => !["id", "description", "reason", "location"].includes(key),
      ) ||
      typeof record.id !== "string" ||
      !record.id.trim() ||
      typeof record.description !== "string" ||
      !record.description.trim() ||
      typeof record.reason !== "string" ||
      !record.reason.trim() ||
      (Object.prototype.hasOwnProperty.call(record, "location") &&
        typeof record.location !== "string") ||
      ids.has(record.id)
    )
      throw new Error("invalid omission fields or duplicate id");
    ids.add(record.id);
  }
}

export function reviseCompleteness(
  project: Project,
  extent: Extent,
  omissions: Omission[] | undefined,
  reason: string,
): Project {
  const p = validateProject(project);
  if (!extents.includes(extent)) throw new Error("invalid project extent");
  if (typeof reason !== "string" || !reason.trim())
    throw new Error("reason required");
  validateOmissions(omissions);
  if (
    p.extent === extent &&
    JSON.stringify(p.omissions) === JSON.stringify(omissions)
  )
    throw new Error("記録範囲と欠落申告に変更がありません");

  const before: { extent: Extent; omissions?: Omission[] } = {
    extent: p.extent,
  };
  if (Object.prototype.hasOwnProperty.call(p, "omissions"))
    before.omissions = clone(p.omissions);
  p.extent = extent;
  if (omissions === undefined) delete p.omissions;
  else p.omissions = clone(omissions);
  const after: { extent: Extent; omissions?: Omission[] } = {
    extent: p.extent,
  };
  if (Object.prototype.hasOwnProperty.call(p, "omissions"))
    after.omissions = clone(p.omissions);
  p.revisions.push({
    id: makeId(),
    at: now(),
    targetId: p.id,
    kind: "project-completeness",
    before,
    after,
    reason: reason.trim(),
  });
  p.updatedAt = now();
  return validateProject(p);
}
