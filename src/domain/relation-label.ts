import type { Relation } from "./types";
/** A navigation boundary never overrides an explicit semantic relation. */
export function relationLabel(
  relation: Relation,
  fromAgendaId?: string,
  toAgendaId?: string,
): string {
  if (relation.kind === "return") return "本筋へ復帰";
  if (relation.kind === "derived") return "派生";
  if (relation.kind === "drift") return "ずれ候補";
  if (relation.dependency) return "根拠への依存";
  return fromAgendaId && toAgendaId && fromAgendaId !== toAgendaId
    ? "議題の切替"
    : "";
}
