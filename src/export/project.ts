import type { Agenda, Project, Source, Utterance } from "../domain/types";
import { validateProject } from "../domain/project";
import { projectSvg } from "./svg";

const MAX = 50 * 1024 * 1024;
const clone = <T>(x: T): T => structuredClone(x);
const bytes = (s: string) => new TextEncoder().encode(s).byteLength;
function pseudonymMap(utterances: Utterance[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const u of utterances)
    if (!m.has(u.speaker)) m.set(u.speaker, `話者${m.size + 1}`);
  return m;
}
function limitedProject(
  p: Project,
  agenda: Agenda,
  selectedIds: string[],
): Project {
  const selected = selectedIds.map((id) =>
    p.utterances.find((u) => u.id === id)!,
  );
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
      const u = clone(sourceUtterance);
      if (offset) offset++;
      u.start = offset;
      u.end = offset + u.quote.length;
      u.sourceId = sourceId;
      u.sourceVersionId = limitedVersion;
      utterances.push(u);
      offset = u.end;
    }
    sources.push({
      ...clone(original),
      id: sourceId,
      versionId: limitedVersion,
      name: "選択発言の原文",
      text: group.map((u) => u.quote).join("\n"),
      warnings: [],
      hash: `limited-${sourceIndex}`,
    });
  }
  const idSet = new Set(selectedIds);
  const limitedAgenda: Agenda = {
    ...clone(agenda),
    utteranceIds: [...selectedIds],
    decision: "undecided",
    answer: "none",
    agreement: "unknown",
    verification: "unverified",
    arrival: "選択発言のみの限定出力。議題全体の到達点は含めません。",
    unresolved: [],
    nextAction: "",
    needsReview: false,
  };
  return {
    ...clone(p),
    title: agenda.title,
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
      .map(clone),
    revisions: [],
    runs: [],
    saved: false,
  };
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
export function exportProject(
  project: Project,
  format: "json" | "md" | "svg",
  agendaId?: string,
  pseudonymize = false,
  utteranceIds?: string[],
): string {
  const p = validateProject(project);
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
  const scoped = agenda ? limitedProject(p, agenda, selectedIds) : clone(p);
  const scopedAgenda = agenda ? scoped.agendas[0] : undefined;
  const names = pseudonymize ? pseudonymMap(scoped.utterances) : undefined;
  if (format === "json") {
    if (pseudonymize)
      scoped.utterances = scoped.utterances.map((u) => ({
        ...u,
        speaker: names!.get(u.speaker)!,
      }));
    const text = JSON.stringify({
      scope: agenda ? "agenda" : "full",
      manifest: agenda
        ? {
            schemaVersion: 1,
            limited: true,
            allowedUtteranceIds: [...selectedIds],
            fullBackup: false,
            historyIncluded: false,
          }
        : {
            schemaVersion: 1,
            limited: false,
            fullBackup: true,
            historyIncluded: true,
          },
      project: scoped,
    });
    if (bytes(text) > MAX) throw new Error("出力が50MiBを超えています");
    return text;
  }
  if (format === "md")
    return markdown(
      scoped,
      scopedAgenda,
      pseudonymize,
      agenda ? selectedIds : undefined,
    );
  return projectSvg(scoped, names);
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
    manifest?: { limited?: unknown; allowedUtteranceIds?: unknown };
  };
  if (!wrapper || typeof wrapper !== "object" || !("project" in wrapper))
    throw new Error("Project wrapperが必要です");
  if (
    wrapper.scope === "agenda" &&
    (wrapper.manifest?.limited !== true ||
      !Array.isArray(wrapper.manifest.allowedUtteranceIds))
  )
    throw new Error("限定出力manifestが不正です");
  const p = validateProject(wrapper.project);
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
      )
    )
      throw new Error("限定出力のmanifestと内容が一致しません");
  } else if (wrapper.scope !== "full") throw new Error("未対応の出力範囲です");
  return {
    ...p,
    id: `restored-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    saved: false,
    updatedAt: new Date().toISOString(),
  };
}
