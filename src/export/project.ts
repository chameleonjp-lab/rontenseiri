import { projectCoverageComplete } from "../domain/coverage";
import { recordMetric } from "../diagnostics/metrics";
import type { Agenda, Project, Source, Utterance } from "../domain/types";
import { validateProject } from "../domain/project";
import { projectSvg } from "./svg";
import { completenessLines, markdownLiteral } from "./completeness";
import { fullBackupEnvelope, MAX_BACKUP_BYTES } from "../domain/capacity";

const MAX = MAX_BACKUP_BYTES;
const bytes = (s: string) => new TextEncoder().encode(s).byteLength;
function pseudonymMap(utterances: Utterance[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const u of utterances)
    if (!m.has(u.speaker)) m.set(u.speaker, `話者${m.size + 1}`);
  return m;
}
function sourceDto(source: Source, includeCoverage = false): Source {
  const result: Source = {
    id: source.id,
    versionId: source.versionId,
    name: source.name,
    text: source.text,
    role: source.role,
    format: source.format,
    createdAt: source.createdAt,
    warnings: [...source.warnings],
    hash: source.hash,
  };
  if (includeCoverage && source.coverage !== undefined)
    result.coverage = structuredClone(source.coverage);
  if (includeCoverage && source.cueLedger !== undefined)
    result.cueLedger = structuredClone(source.cueLedger);
  return result;
}
function utteranceDto(u: Utterance): Utterance {
  const result: Utterance = {
    id: u.id,
    sourceId: u.sourceId,
    sourceVersionId: u.sourceVersionId,
    start: u.start,
    end: u.end,
    quote: u.quote,
    speaker: u.speaker,
    order: u.order,
    line: u.line,
    classification: u.classification,
    coverage: u.coverage,
    important: u.important,
  };
  if (u.cueSpans !== undefined) result.cueSpans = structuredClone(u.cueSpans);
  if (u.time !== undefined) result.time = u.time;
  if (u.returnStatus !== undefined) result.returnStatus = u.returnStatus;
  return result;
}
function agendaDto(a: Agenda): Agenda {
  return {
    id: a.id,
    title: a.title,
    utteranceIds: [...a.utteranceIds],
    boundary: a.boundary,
    decision: a.decision,
    answer: a.answer,
    agreement: a.agreement,
    verification: a.verification,
    arrival: a.arrival,
    unresolved: [...a.unresolved],
    nextAction: a.nextAction,
    needsReview: a.needsReview,
    ...(a.summaryDependencies === undefined
      ? {}
      : { summaryDependencies: [...a.summaryDependencies] }),
  };
}
function relationDto(
  r: Project["relations"][number],
): Project["relations"][number] {
  return {
    id: r.id,
    from: r.from,
    to: r.to,
    kind: r.kind,
    ...(r.dependency !== undefined ? { dependency: r.dependency } : {}),
    evidenceIds: [...r.evidenceIds],
  };
}
function projectDto(p: Project, includeAdvanced = false): Project {
  const result: Project = {
    schemaVersion: p.schemaVersion,
    id: p.id,
    title: p.title,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    extent: p.extent,
    sources: p.sources.map((source) => sourceDto(source)),
    utterances: p.utterances.map(utteranceDto),
    agendas: p.agendas.map(agendaDto),
    relations: p.relations.map(relationDto),
    revisions: p.revisions.map((r) => ({
      id: r.id,
      at: r.at,
      targetId: r.targetId,
      kind: r.kind,
      before: structuredClone(r.before),
      after: structuredClone(r.after),
      reason: r.reason,
    })),
    runs: p.runs.map((r) => ({
      id: r.id,
      at: r.at,
      engine: r.engine,
      model: r.model,
      status: r.status,
      note: r.note,
    })),
    selectedAgendaId: p.selectedAgendaId,
    saved: p.saved,
  };
  if (p.storageRevision !== undefined)
    result.storageRevision = p.storageRevision;
  if (includeAdvanced) {
    if (p.omissions !== undefined)
      result.omissions = structuredClone(p.omissions);
    if (p.reasoning !== undefined)
      result.reasoning = structuredClone(p.reasoning);
    if (p.lineage !== undefined) result.lineage = structuredClone(p.lineage);
    result.sources = p.sources.map((source) => sourceDto(source, true));
  }
  return result;
}
function hasExclusiveInterpretationGroups(p: Project): boolean {
  return (p.reasoning?.exclusiveGroups.length ?? 0) > 0;
}
const exclusiveExportLimitation =
  "排他的な解釈候補を含むため、この形式では不確定性と排他関係を保持できません。全体JSON出力を使用してください。";
function limitedProject(
  p: Project,
  agenda: Agenda,
  selectedIds: string[],
): Project {
  const selected = selectedIds.map((id) => {
    const u = p.utterances.find((x) => x.id === id);
    if (!u) throw new Error("selected utterance not found");
    return u;
  });
  const groups = new Map<string, Utterance[]>();
  for (const u of selected)
    groups.set(u.sourceVersionId, [
      ...(groups.get(u.sourceVersionId) ?? []),
      u,
    ]);
  const sources: Source[] = [];
  const utterances: Utterance[] = [];
  let sourceIndex = 0;
  for (const [versionId, group] of groups) {
    const original = p.sources.find((s) => s.versionId === versionId);
    if (!original) throw new Error("selected utterance source not found");
    sourceIndex++;
    const sourceId = `limited-source-${String(sourceIndex).padStart(2, "0")}`;
    const limitedVersion = `${sourceId}-v1`;
    let offset = 0;
    for (const sourceUtterance of group) {
      if (offset) offset++;
      const quote = sourceUtterance.quote;
      utterances.push(
        utteranceDto({
          id: sourceUtterance.id,
          sourceId,
          sourceVersionId: limitedVersion,
          start: offset,
          end: offset + quote.length,
          quote,
          speaker: sourceUtterance.speaker,
          order: sourceUtterance.order,
          line: sourceUtterance.line,
          ...(sourceUtterance.time === undefined
            ? {}
            : { time: sourceUtterance.time }),
          classification: sourceUtterance.classification,
          coverage: sourceUtterance.coverage,
          important: sourceUtterance.important,
          ...(sourceUtterance.returnStatus === undefined
            ? {}
            : { returnStatus: sourceUtterance.returnStatus }),
        }),
      );
      offset += quote.length;
    }
    sources.push(
      sourceDto({
        id: sourceId,
        versionId: limitedVersion,
        name: "選択発言の原文",
        text: group.map((u) => u.quote).join("\n"),
        role: original.role,
        format: original.format,
        createdAt: original.createdAt,
        warnings: [],
        hash: `limited-${sourceIndex}`,
      }),
    );
  }
  const idSet = new Set(selectedIds);
  const limitedAgenda = agendaDto({
    id: agenda.id,
    title: agenda.title,
    utteranceIds: [...selectedIds],
    boundary: agenda.boundary,
    decision: "undecided",
    answer: "none",
    agreement: "unknown",
    verification: "unverified",
    arrival: "選択発言のみの限定出力。議題全体の到達点は含めません。",
    unresolved: [],
    nextAction: "",
    needsReview: false,
  });
  return projectDto({
    schemaVersion: p.schemaVersion,
    id: p.id,
    title: agenda.title,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    extent: "excerpt",
    sources,
    utterances: utterances.sort((a, b) => a.order - b.order),
    agendas: [limitedAgenda],
    selectedAgendaId: agenda.id,
    relations: p.relations
      .filter(
        (r) =>
          idSet.has(r.from) &&
          idSet.has(r.to) &&
          r.evidenceIds.every((id) => idSet.has(id)),
      )
      .map(relationDto),
    revisions: [],
    runs: [],
    saved: false,
  });
}

function markdown(
  p: Project,
  agenda: Agenda | undefined,
  pseudonymize: boolean,
  selectedIds?: string[],
): string {
  const limited = Boolean(agenda);
  const map = pseudonymize ? pseudonymMap(p.utterances) : undefined;
  const ids = selectedIds ?? p.utterances.map((u) => u.id);
  const idSet = new Set(ids);
  const lines = [
    `# ${agenda?.title ?? p.title}`,
    "",
    `範囲: ${limited ? "限定出力" : "完全出力"}`,
    ...completenessLines(p, limited).map(markdownLiteral),
    "",
  ];
  for (const a of agenda ? [agenda] : p.agendas) {
    lines.push(`## ${a.title}`);
    if (limited)
      lines.push(
        "- 到達点: 選択発言のみの限定出力。議題全体の到達点は含めません。",
        "- 決定: 未決",
        "- 回答: なし",
        "- 合意: 不明",
        "- 検証: 未検証",
        "- 未解決: なし",
        "- 次の行動: なし",
      );
    else
      lines.push(
        `- 到達点: ${a.arrival || "なし"}`,
        `- 決定: ${a.decision}`,
        `- 回答: ${a.answer}`,
        `- 合意: ${a.agreement}`,
        `- 検証: ${a.verification}`,
        `- 未解決: ${a.unresolved.length ? a.unresolved.join(" / ") : "なし"}`,
        `- 次の行動: ${a.nextAction || "なし"}`,
      );
    const evidence = p.relations
      .filter((r) => r.evidenceIds.some((id) => idSet.has(id)))
      .flatMap((r) => r.evidenceIds)
      .filter((id) => idSet.has(id));
    lines.push(
      `- 根拠ID: ${evidence.join(", ") || "なし"}`,
      `- 制約: ${a.needsReview ? "要レビュー" : "なし"}`,
      "",
    );
    for (const id of a.utteranceIds) {
      const u = p.utterances.find((x) => x.id === id);
      if (u && idSet.has(id))
        lines.push(
          `- **${pseudonymize ? map!.get(u.speaker) : u.speaker}**: ${u.quote}`,
        );
    }
    lines.push("");
  }
  return lines.join("\n");
}
function exportProjectCore(
  project: Project,
  format: "json" | "md" | "svg",
  agendaId?: string,
  pseudonymize = false,
  utteranceIds?: string[],
): string {
  const started = performance.now();
  const p = validateProject(project);
  recordMetric("output-validation", performance.now() - started);
  const hasAgenda = agendaId !== undefined;
  if (!hasAgenda && utteranceIds !== undefined)
    throw new Error("全体出力ではutteranceIdsを指定できません");
  const agenda = hasAgenda
    ? p.agendas.find((a) => a.id === agendaId)
    : undefined;
  if (hasAgenda && !agenda) throw new Error("agenda not found");
  if (agenda) {
    if (!utteranceIds || utteranceIds.length === 0)
      throw new Error("限定出力にはutteranceIdsが必要です");
    if (new Set(utteranceIds).size !== utteranceIds.length)
      throw new Error("utteranceIdsに重複があります");
    const allowed = new Set(agenda.utteranceIds);
    if (
      utteranceIds.some(
        (id) => !allowed.has(id) || !p.utterances.some((u) => u.id === id),
      )
    )
      throw new Error("utteranceIdsに議題外の発言があります");
  }
  const selectedIds = agenda
    ? [...utteranceIds!].sort(
        (a, b) =>
          p.utterances.find((u) => u.id === a)!.order -
          p.utterances.find((u) => u.id === b)!.order,
      )
    : p.utterances.map((u) => u.id);
  const scoped = agenda
    ? limitedProject(p, agenda, selectedIds)
    : projectDto(p, true);
  const scopedAgenda = agenda ? scoped.agendas[0] : undefined;
  const names = pseudonymize ? pseudonymMap(scoped.utterances) : undefined;
  if (format === "json") {
    // Full JSON is the lossless backup path; limited JSON must not silently
    // omit the optional reasoning graph (including exclusive alternatives).
    if (agenda && hasExclusiveInterpretationGroups(p))
      throw new Error(exclusiveExportLimitation);
    if (pseudonymize)
      scoped.utterances = scoped.utterances.map((u) => ({
        ...u,
        speaker: names!.get(u.speaker)!,
      }));
    const envelope = agenda
      ? {
          scope: "agenda",
          manifest: {
            schemaVersion: 1,
            limited: true,
            allowedUtteranceIds: [...selectedIds],
            fullBackup: false,
            historyIncluded: false,
          },
          project: scoped,
        }
      : fullBackupEnvelope(scoped);
    const text = JSON.stringify({
      ...envelope,
      manifest: {
        ...envelope.manifest,
        sourceCoverageComplete: agenda ? false : projectCoverageComplete(p),
        organizationComplete: false,
      },
    });
    if (bytes(text) > MAX) throw new Error("出力が50MiBを超えています");
    return text;
  }
  if (hasExclusiveInterpretationGroups(p))
    throw new Error(exclusiveExportLimitation);
  if (format === "md")
    return markdown(
      scoped,
      scopedAgenda,
      pseudonymize,
      agenda ? selectedIds : undefined,
    );
  return projectSvg(scoped, names, Boolean(agenda));
}
export function importProject(text: string): Project {
  if (typeof text !== "string" || bytes(text) > MAX)
    throw new Error("JSONが50MiBを超えています");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("JSONを解釈できません");
  }
  const wrapper = value as {
    project?: unknown;
    scope?: unknown;
    manifest?: Record<string, unknown>;
  };
  if (!wrapper || typeof wrapper !== "object" || !("project" in wrapper))
    throw new Error("Project wrapperが必要です");
  if (
    wrapper.scope === "agenda" &&
    (wrapper.manifest?.schemaVersion !== 1 ||
      wrapper.manifest.limited !== true ||
      wrapper.manifest.fullBackup !== false ||
      wrapper.manifest.historyIncluded !== false ||
      wrapper.manifest.sourceCoverageComplete !== false ||
      wrapper.manifest.organizationComplete !== false ||
      !Array.isArray(wrapper.manifest.allowedUtteranceIds))
  )
    throw new Error("限定出力manifestが不正です");
  if (wrapper.scope === "full" && wrapper.manifest !== undefined) {
    const manifest = wrapper.manifest;
    if (
      !manifest ||
      typeof manifest !== "object" ||
      manifest.schemaVersion !== 1 ||
      manifest.limited !== false ||
      manifest.fullBackup !== true ||
      manifest.historyIncluded !== true ||
      typeof manifest.sourceCoverageComplete !== "boolean" ||
      manifest.organizationComplete !== false ||
      Object.prototype.hasOwnProperty.call(manifest, "allowedUtteranceIds")
    )
      throw new Error("完全出力manifestが不正です");
  }
  const validated = validateProject(wrapper.project);
  if (
    wrapper.scope === "full" &&
    wrapper.manifest !== undefined &&
    wrapper.manifest.sourceCoverageComplete !==
      projectCoverageComplete(validated)
  )
    throw new Error("完全出力manifestと原文対応が一致しません");
  const p = projectDto(validated, wrapper.scope === "full");
  if (wrapper.scope === "agenda") {
    const allowed = wrapper.manifest!.allowedUtteranceIds as unknown[];
    if (
      p.agendas.length !== 1 ||
      p.revisions.length ||
      p.runs.length ||
      allowed.length !== p.utterances.length ||
      new Set(allowed).size !== allowed.length ||
      allowed.some(
        (id) =>
          typeof id !== "string" || !p.utterances.some((u) => u.id === id),
      ) ||
      allowed.some((id, index) => id !== p.utterances[index]?.id)
    )
      throw new Error("限定出力のmanifestと内容が一致しません");
    const agenda = p.agendas[0];
    if (
      agenda.decision !== "undecided" ||
      agenda.answer !== "none" ||
      agenda.agreement !== "unknown" ||
      agenda.verification !== "unverified" ||
      agenda.arrival !==
        "選択発言のみの限定出力。議題全体の到達点は含めません。" ||
      agenda.unresolved.length !== 0 ||
      agenda.nextAction !== "" ||
      agenda.needsReview !== false ||
      agenda.utteranceIds.length !== allowed.length ||
      agenda.utteranceIds.some((id, index) => id !== allowed[index])
    )
      throw new Error("限定出力の内容が限定契約と一致しません");
    if (p.extent !== "excerpt") throw new Error("限定出力の範囲が不正です");
    for (const [index, source] of p.sources.entries()) {
      const sourceQuotes = p.utterances
        .filter((u) => u.sourceId === source.id)
        .sort((a, b) => a.order - b.order)
        .map((u) => u.quote)
        .join("\n");
      const expectedId = `limited-source-${String(index + 1).padStart(2, "0")}`;
      if (
        !sourceQuotes ||
        source.text !== sourceQuotes ||
        source.id !== expectedId ||
        source.versionId !== `${expectedId}-v1` ||
        source.name !== "選択発言の原文" ||
        source.warnings.length !== 0 ||
        source.hash !== `limited-${index + 1}`
      )
        throw new Error("限定出力の原文に範囲外の内容があります");
    }
  } else if (wrapper.scope !== "full") throw new Error("未対応の出力範囲です");
  return {
    ...p,
    id: `restored-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    saved: false,
    storageRevision: 0,
    updatedAt: new Date().toISOString(),
  };
}

export function exportProject(
  ...args: Parameters<typeof exportProjectCore>
): string {
  const start = performance.now();
  try {
    return exportProjectCore(...args);
  } finally {
    recordMetric("output", performance.now() - start);
  }
}
