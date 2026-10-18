import type { Agenda, Relation, Utterance } from "./types";

export type LineageOperation = "split" | "merge";
export type LineageStatus = "applied" | "conflict" | "pending" | "unresolved";
export type TransferStatus = "applied" | "conflict" | "pending" | "unresolved";

export interface LineageReferenceTransfer {
  kind:
    | "classification"
    | "important"
    | "agenda"
    | "summary"
    | "relation"
    | "evidence"
    | "revision"
    | "other";
  referenceId: string;
  targetIds: string[];
  status: TransferStatus;
  note?: string;
}

/** The old shape is retained for imports, but new records use the compact form. */
export interface LineageUndoSnapshot {
  __projectSnapshot?: {
    utterances: Utterance[];
    agendas: Agenda[];
    relations: Relation[];
    selectedAgendaId: string;
    lineage?: LineageLedger;
  };
  retiredUtterances?: Utterance[];
  originalRelations?: Relation[];
  originalAgendas?: Agenda[];
  originalReasoning?: unknown;
}

export interface LineageRecord {
  id: string;
  operation: LineageOperation;
  oldIds: string[];
  newIds: string[];
  status: LineageStatus;
  sourceVersionId: string;
  start: number;
  end: number;
  reason: string;
  createdAt: string;
  references: LineageReferenceTransfer[];
  /** Compact audit payload for new records; legacy records may contain a full snapshot. */
  undoSnapshot?: LineageUndoSnapshot;
  /** Full snapshot is stored once in Project.revisions.before. */
  undoRevisionId?: string;
}

export interface LineageLedger {
  records: LineageRecord[];
}

export function emptyLineageLedger(): LineageLedger {
  return { records: [] };
}
