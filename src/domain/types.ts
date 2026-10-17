export type SourceRole = "conversation" | "reference" | "later-explanation";
export type Extent = "full" | "excerpt" | "unknown";
export type Classification = "main" | "derived" | "drift" | "unknown";
export type Decision = "undecided" | "conditional" | "decided";
export interface Source {
  id: string;
  versionId: string;
  name: string;
  text: string;
  role: SourceRole;
  format: string;
  createdAt: string;
  warnings: string[];
  hash: string;
}
export interface Utterance {
  id: string;
  sourceId: string;
  sourceVersionId: string;
  start: number;
  end: number;
  quote: string;
  speaker: string;
  order: number;
  line: number;
  time?: string;
  classification: Classification;
  coverage: "unorganized" | "mapped" | "collapsed" | "failed";
  important: boolean;
  /** A linked return is represented by a relation; omission means not yet determined. */
  returnStatus?: "unknown" | "none";
}
export interface Agenda {
  id: string;
  title: string;
  utteranceIds: string[];
  boundary: "candidate" | "user-confirmed";
  decision: Decision;
  answer: "none" | "partial" | "present";
  agreement: "unknown" | "partial" | "explicit";
  verification: "unverified" | "user-recorded";
  arrival: string;
  unresolved: string[];
  nextAction: string;
  needsReview: boolean;
}
export interface Relation {
  id: string;
  from: string;
  to: string;
  kind: "main" | "derived" | "drift" | "return";
  evidenceIds: string[];
}
export interface Revision {
  id: string;
  at: string;
  targetId: string;
  kind: string;
  before: unknown;
  after: unknown;
  reason: string;
}
export interface AnalysisRun {
  id: string;
  at: string;
  engine: string;
  model: string;
  status: "complete" | "partial" | "failed";
  note: string;
}
export interface Project {
  schemaVersion: 1;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  extent: Extent;
  sources: Source[];
  utterances: Utterance[];
  agendas: Agenda[];
  relations: Relation[];
  revisions: Revision[];
  runs: AnalysisRun[];
  selectedAgendaId: string;
  saved: boolean;
}
export interface ParseResult {
  sources: Source[];
  utterances: Utterance[];
  warnings: string[];
}
export interface InputItem {
  name: string;
  text: string;
  format: string;
  role: SourceRole;
}
export interface ModelSuggestion {
  agendas: Array<{
    title: string;
    utteranceIds: string[];
    arrival: string;
    unresolved: string[];
    nextAction: string;
  }>;
  classifications: Array<{
    utteranceId: string;
    classification: Classification;
  }>;
  relations: Array<{ from: string; to: string; kind: Relation["kind"] }>;
}
export const labels = {
  classification: {
    main: "本筋",
    derived: "派生",
    drift: "ずれ候補",
    unknown: "未整理",
  },
  decision: {
    undecided: "未決",
    conditional: "条件付きの到達点",
    decided: "決定済み",
  },
  extent: { full: "全文（利用者申告）", excerpt: "抜粋", unknown: "不明" },
  role: {
    conversation: "会話本文",
    reference: "参考資料",
    "later-explanation": "後日の説明",
  },
} as const;
