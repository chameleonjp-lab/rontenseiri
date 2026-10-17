import type { Project } from "./types";
import { validateProject } from "./project";
import { semanticSnapshot } from "./snapshot";
import { invalidateDependents } from "./invalidation";
export function setDependency(
  project: Project,
  from: string,
  to: string,
  enabled: boolean,
  reason: string,
): Project {
  const p = validateProject(project);
  if (!reason.trim()) throw Error("関係を変更する理由が必要です");
  const source = p.utterances.find((u) => u.id === from),
    target = p.utterances.find((u) => u.id === to);
  if (!source || !target || source.order >= target.order)
    throw Error("依存先は後続の発言を指定してください");
  const before = semanticSnapshot(p);
  const edge = p.relations.find((r) => r.from === from && r.to === to);
  if (edge) {
    if (!enabled && edge.id.startsWith("dependency-"))
      p.relations = p.relations.filter((r) => r !== edge);
    else edge.dependency = enabled;
  } else if (enabled)
    p.relations.push({
      id: `dependency-${crypto.randomUUID()}`,
      from,
      to,
      kind: "main",
      evidenceIds: [from],
      dependency: true,
    });
  else throw Error("解除する依存関係がありません");
  const out = invalidateDependents(p, [from, to]);
  out.revisions.push({
    id: `revision-${crypto.randomUUID()}`,
    at: new Date().toISOString(),
    targetId: from,
    kind: "dependency-correction",
    before,
    after: semanticSnapshot(out),
    reason,
  });
  out.updatedAt = new Date().toISOString();
  return validateProject(out);
}
