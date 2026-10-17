import { openDB, type DBSchema } from "idb";
import type { Project } from "../domain/types";
import { validateProject } from "../domain/project";
interface Schema extends DBSchema {
  projects: { key: string; value: Project };
}
const MAX = 50 * 1024 * 1024;
const db = openDB<Schema>("rontenseiri", 1, {
  upgrade(d) {
    if (!d.objectStoreNames.contains("projects"))
      d.createObjectStore("projects");
  },
});
const size = (p: Project) =>
  new TextEncoder().encode(JSON.stringify(p)).byteLength;
export async function listProjects(): Promise<Project[]> {
  const d = await db;
  const values = await d.getAll("projects");
  return values.map(validateProject);
}
export async function saveProject(project: Project): Promise<void> {
  const p = validateProject(project);
  if (size(p) > MAX) throw new Error("保存データが50MiBを超えています");
  p.saved = true;
  p.updatedAt = new Date().toISOString();
  const d = await db;
  await d.put("projects", p, p.id);
}
export async function deleteProject(id: string): Promise<void> {
  if (!id) throw new Error("id required");
  const d = await db;
  await d.delete("projects", id);
}
