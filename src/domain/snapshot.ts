import type { Project } from "./types";
export function semanticSnapshot(p: Project) {
  return structuredClone({
    utterances: p.utterances,
    agendas: p.agendas,
    relations: p.relations,
    selectedAgendaId: p.selectedAgendaId,
    ...(p.reasoning !== undefined ? { reasoning: p.reasoning } : {}),
    ...(p.lineage !== undefined ? { lineage: p.lineage } : {}),
  });
}
