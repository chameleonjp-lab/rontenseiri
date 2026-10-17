import type { Project, Source, Utterance } from "./types";
export type CoverageKind =
  "utterance" | "metadata" | "excluded" | "unclassified";
export interface CoverageSpan {
  start: number;
  end: number;
  kind: CoverageKind;
  reason: string;
  utteranceId?: string;
}
const metadata = (text: string, format: string) => {
  if (!text.trim()) return "改行・空白";
  if (!["srt", "vtt"].includes(format)) return undefined;
  if (/^\uFEFF?WEBVTT(?:\s|$)/.test(text.trim())) return "WebVTTヘッダー";
  if (/^\s*\d+\s*$/.test(text)) return "字幕キュー識別子";
  if (/-->/.test(text)) return "字幕の参照時刻";
  if (/^\s*(NOTE(?:\s|$)|STYLE\s*$|REGION\s*$)/.test(text))
    return "WebVTTの非発言ブロック";
  return undefined;
};
export function buildSourceCoverage(
  source: Source,
  utterances: Utterance[],
): CoverageSpan[] {
  const current = utterances
    .filter((u) => u.sourceVersionId === source.versionId)
    .sort((a, b) => a.start - b.start);
  const spans: CoverageSpan[] = [];
  const addGap = (start: number, end: number) => {
    if (start >= end) return;
    const saved = (source.coverage ?? []).filter(
      (s) =>
        ["metadata", "excluded"].includes(s.kind) &&
        s.start >= start &&
        s.end <= end,
    );
    const points = new Set([
      start,
      end,
      ...saved.flatMap((s) => [s.start, s.end]),
    ]);
    const lines = /[^\r\n]*(?:\r\n|\r|\n|$)/g;
    lines.lastIndex = start;
    let m: RegExpExecArray | null;
    while ((m = lines.exec(source.text)) && m.index < end) {
      if (!m[0]) break;
      points.add(Math.min(end, m.index + m[0].length));
    }
    const sorted = [...points].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1],
        b = sorted[i];
      if (a === b) continue;
      const old = saved.find((s) => s.start <= a && s.end >= b);
      const reason =
        old?.reason ?? metadata(source.text.slice(a, b), source.format);
      spans.push({
        start: a,
        end: b,
        kind: old?.kind ?? (reason ? "metadata" : "unclassified"),
        reason: reason ?? "発言化前の未対応範囲。内容を確認してください",
      });
    }
  };
  let cursor = 0;
  for (const u of current) {
    if (u.start < cursor) throw Error("原文の発言範囲が重複しています");
    addGap(cursor, u.start);
    spans.push({
      start: u.start,
      end: u.end,
      kind: "utterance",
      reason: "原文位置に対応する発言",
      utteranceId: u.id,
    });
    cursor = u.end;
  }
  addGap(cursor, source.text.length);
  return spans;
}
export function auditSourceCoverage(source: Source, utterances: Utterance[]) {
  const spans = source.coverage ?? buildSourceCoverage(source, utterances);
  let cursor = 0;
  let mapped = 0;
  const issues: string[] = [];
  const active = utterances.filter(
    (u) => u.sourceVersionId === source.versionId,
  );
  for (const span of spans) {
    if (
      !span ||
      !Number.isInteger(span.start) ||
      !Number.isInteger(span.end) ||
      span.start !== cursor ||
      span.end <= span.start ||
      span.end > source.text.length ||
      !["utterance", "metadata", "excluded", "unclassified"].includes(
        span.kind,
      ) ||
      typeof span.reason !== "string" ||
      !span.reason.trim()
    ) {
      issues.push("原文対応に欠落・重複・不正な区分があります");
      break;
    }
    if (
      span.kind === "utterance" &&
      !active.some(
        (u) =>
          u.id === span.utteranceId &&
          u.start === span.start &&
          u.end === span.end,
      )
    )
      issues.push("発言と原文対応が一致しません");
    if (span.kind !== "unclassified") mapped += span.end - span.start;
    cursor = span.end;
  }
  if (cursor !== source.text.length)
    issues.push("対応先のない原文範囲があります");
  const pending = spans.filter((s) => s.kind === "unclassified");
  return {
    spans,
    issues,
    pending,
    complete: issues.length === 0 && pending.length === 0,
    totalCodeUnits: source.text.length,
    mappedCodeUnits: mapped,
  };
}
export function classifySourceRange(
  project: Project,
  versionId: string,
  start: number,
  end: number,
  kind: "metadata" | "excluded",
  reason: string,
): Project {
  if (!reason.trim()) throw Error("対象外・非発言の理由が必要です");
  const p = structuredClone(project);
  const source = p.sources.find((s) => s.versionId === versionId);
  if (!source) throw Error("資料がありません");
  const spans = source.coverage ?? buildSourceCoverage(source, p.utterances);
  const span = spans.find(
    (s) => s.start === start && s.end === end && s.kind !== "utterance",
  );
  if (!span) throw Error("分類できる原文範囲ではありません");
  const before = structuredClone(spans);
  span.kind = kind;
  span.reason = reason.trim();
  source.coverage = spans;
  p.revisions.push({
    id: `coverage-${crypto.randomUUID()}`,
    at: new Date().toISOString(),
    targetId: versionId,
    kind: "source-coverage",
    before: { versionId, coverage: before },
    after: { versionId, coverage: structuredClone(spans) },
    reason,
  });
  p.updatedAt = new Date().toISOString();
  return p;
}

export function projectCoverageComplete(project: Project): boolean {
  const active = new Set(project.utterances.map((u) => u.sourceVersionId));
  const activeLogicalIds = new Set(
    project.sources.filter((s) => active.has(s.versionId)).map((s) => s.id),
  );
  return project.sources
    .filter((s) => active.has(s.versionId) || !activeLogicalIds.has(s.id))
    .every((s) => auditSourceCoverage(s, project.utterances).complete);
}
