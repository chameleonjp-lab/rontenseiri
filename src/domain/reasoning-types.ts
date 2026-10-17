export type ReasoningId = string;
export type ReasoningActor = "user-recorded" | "manual";
export type QuestionOrigin = "original" | "inferred" | "analysis";
export type QuestionStatus = "active" | "superseded" | "retracted";
export type ResponseKind =
  | "answer"
  | "clarification"
  | "counterargument"
  | "objection"
  | "refusal"
  | "partial"
  | "unknown";
export type Fulfillment =
  | "unassessed"
  | "fulfilled"
  | "partially-fulfilled"
  | "not-fulfilled"
  | "not-applicable";
export type ClaimKind =
  | "claim"
  | "position"
  | "reason"
  | "condition"
  | "exception"
  | "scope"
  | "term"
  | "objection"
  | "unverified";
export type Certainty = "confirmed" | "inferred" | "uncertain" | "retracted";

export interface ReasoningTime {
  /** The time the statement/position applied in the conversation. */
  asOf: string;
  /** The time this record was entered or changed. */
  recordedAt: string;
}

export interface QuestionVersion {
  id: ReasoningId;
  questionId: ReasoningId;
  text: string;
  status: QuestionStatus;
  actor: ReasoningActor;
  time: ReasoningTime;
  sourceUtteranceIds: string[];
  supersedesId?: ReasoningId;
  reason?: string;
}

export interface Question {
  id: ReasoningId;
  origin: QuestionOrigin;
  versionIds: ReasoningId[];
  currentVersionId: ReasoningId;
}

export interface ResponseLink {
  id: ReasoningId;
  questionVersionId: ReasoningId;
  utteranceIds: string[];
  kind: ResponseKind;
  fulfillment: Fulfillment;
  actor: ReasoningActor;
  time: ReasoningTime;
  counterargumentToClaimIds: string[];
  evidenceIds: string[];
  note?: string;
}

export interface Evidence {
  id: ReasoningId;
  utteranceIds: string[];
  sourceIds: string[];
  actor: ReasoningActor;
  certainty: Certainty;
  note?: string;
  time: ReasoningTime;
}

export interface SemanticItem {
  id: ReasoningId;
  kind: ClaimKind;
  text: string;
  utteranceIds: string[];
  evidenceIds: string[];
  actor: ReasoningActor;
  certainty: Certainty;
  time: ReasoningTime;
  scope?: string;
  termDefinition?: string;
  counterargumentToId?: string;
}

export interface PositionChange {
  id: ReasoningId;
  subject: string;
  beforeItemId: string;
  afterItemId: string;
  triggerEvidenceIds: string[];
  /** Candidate causes are not asserted causes. */
  candidateReasonIds: string[];
  time: ReasoningTime;
  actor: ReasoningActor;
}

export interface Interpretation {
  id: ReasoningId;
  questionVersionId: string;
  premiseItemIds: string[];
  conclusionItemIds: string[];
  certainty: Certainty;
  exclusiveGroupId?: string;
  actor: ReasoningActor;
  time: ReasoningTime;
}

export interface ExclusiveInterpretationGroup {
  id: ReasoningId;
  interpretationIds: string[];
  /** true means the alternatives cannot simultaneously be treated as established. */
  mutuallyExclusive: true;
}

export interface UncertaintyPropagation {
  id: ReasoningId;
  fromItemId: string;
  toItemId: string;
  reason: string;
  status: "unresolved" | "resolved";
}

export interface ReasoningRevision {
  id: ReasoningId;
  at: string;
  targetId: string;
  kind: string;
  /** References only; full semantic snapshots live in Project.revisions. */
  before: { revisionId?: string; targetRevisionId?: string };
  after: { revisionId?: string; targetRevisionId?: string };
  reason: string;
}

export interface ReasoningGraph {
  questions: Question[];
  questionVersions: QuestionVersion[];
  responses: ResponseLink[];
  evidence: Evidence[];
  items: SemanticItem[];
  positionChanges: PositionChange[];
  interpretations: Interpretation[];
  exclusiveGroups: ExclusiveInterpretationGroup[];
  uncertaintyPropagation: UncertaintyPropagation[];
  revisions: ReasoningRevision[];
}

export type ReasoningProjectSnapshot = {
  reasoning?: ReasoningGraph;
  __projectSnapshot?: unknown;
};
