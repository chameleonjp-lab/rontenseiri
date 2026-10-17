import type { ModelSuggestion, Project } from "../domain/types";
import { validateProject } from "../domain/project";
import { withAnalysisOwnership, type OwnershipOptions } from "./ownership";

export const MODEL_OPTIONS: Array<{
  id: string;
  label: string;
  size: string;
  license: string;
  source: string;
}> = [
  {
    id: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    label: "Llama 3.2 1B Instruct (q4f16_1)",
    size: "取得量未測定、開始不可（固定version manifest確認が必要）",
    license: "Llama 3.2 Community License（配布前に原文確認が必要）",
    source: "https://huggingface.co/mlc-ai/Llama-3.2-1B-Instruct-q4f16_1-MLC",
  },
  {
    id: "Llama-3.2-1B-Instruct-q4f32_1-MLC",
    label: "Llama 3.2 1B Instruct (q4f32_1)",
    size: "取得量未測定、開始不可（固定version manifest確認が必要）",
    license: "Llama 3.2 Community License（配布前に原文確認が必要）",
    source: "https://huggingface.co/mlc-ai/Llama-3.2-1B-Instruct-q4f32_1-MLC",
  },
];

// Keep the prompt well below the smallest advertised context (4096 tokens).
// Never truncate a single utterance: it is safer to stop and explain than lose evidence.
const CHUNK_LIMIT = 3_000;
type WorkerReply =
  | { type: "progress"; text: string }
  | { type: "result"; suggestion: ModelSuggestion }
  | { type: "error"; message: string };

function validateSuggestion(value: unknown, project: Project): ModelSuggestion {
  if (!value || typeof value !== "object")
    throw new Error("モデル出力がJSONオブジェクトではありません");
  const raw = value as Record<string, unknown>;
  const ids = new Set(project.utterances.map((u) => u.id));
  const classifications = raw.classifications;
  const agendas = raw.agendas;
  const relations = raw.relations;
  if (
    !Array.isArray(classifications) ||
    !Array.isArray(agendas) ||
    !Array.isArray(relations)
  )
    throw new Error("モデル出力のschemaが不正です");
  const allowed = new Set(["main", "derived", "drift", "unknown"]);
  const cleanClassifications = classifications.map((entry) => {
    if (!entry || typeof entry !== "object")
      throw new Error("classificationの型が不正です");
    const e = entry as Record<string, unknown>;
    if (typeof e.utteranceId !== "string" || !ids.has(e.utteranceId))
      throw new Error(`未知のutterance ID: ${String(e.utteranceId)}`);
    if (typeof e.classification !== "string" || !allowed.has(e.classification))
      throw new Error("classification enumが不正です");
    return {
      utteranceId: e.utteranceId,
      classification: e.classification as
        "main" | "derived" | "drift" | "unknown",
    };
  });
  if (
    new Set(cleanClassifications.map((x) => x.utteranceId)).size !==
    cleanClassifications.length
  )
    throw new Error("classificationが重複しています");
  const cleanAgendas = agendas.map((entry) => {
    if (!entry || typeof entry !== "object")
      throw new Error("agendaの型が不正です");
    const e = entry as Record<string, unknown>;
    if (
      typeof e.title !== "string" ||
      !Array.isArray(e.utteranceIds) ||
      !e.utteranceIds.every((id) => typeof id === "string" && ids.has(id))
    )
      throw new Error("agendaのutterance IDが不正です");
    if (
      !Array.isArray(e.unresolved) ||
      !e.unresolved.every((x) => typeof x === "string")
    )
      throw new Error("agenda unresolvedの型が不正です");
    if (typeof e.arrival !== "string" || typeof e.nextAction !== "string")
      throw new Error("agenda fieldの型が不正です");
    return {
      title: e.title,
      utteranceIds: e.utteranceIds as string[],
      arrival: e.arrival,
      unresolved: e.unresolved as string[],
      nextAction: e.nextAction,
    };
  });
  const memberships = cleanAgendas.flatMap((a) => a.utteranceIds);
  if (new Set(memberships).size !== memberships.length)
    throw new Error("agenda membershipが重複しています");
  if (new Set(cleanAgendas.map((a) => a.title)).size !== cleanAgendas.length)
    throw new Error("agendaが重複しています");
  const relationKinds = new Set(["main", "derived", "drift", "return"]);
  const cleanRelations = relations.map((entry) => {
    if (!entry || typeof entry !== "object")
      throw new Error("relationの型が不正です");
    const e = entry as Record<string, unknown>;
    if (
      typeof e.from !== "string" ||
      typeof e.to !== "string" ||
      !ids.has(e.from) ||
      !ids.has(e.to)
    )
      throw new Error("relation endpointが不正です");
    if (e.from === e.to) throw new Error("自己参照relationは拒否されます");
    if (typeof e.kind !== "string" || !relationKinds.has(e.kind))
      throw new Error("relation kind enumが不正です");
    const from = project.utterances.find((u) => u.id === e.from)!;
    const to = project.utterances.find((u) => u.id === e.to)!;
    if (from.order > to.order)
      throw new Error("時間を逆行するrelationは拒否されます");
    return {
      from: e.from,
      to: e.to,
      kind: e.kind as "main" | "derived" | "drift" | "return",
    };
  });
  if (
    new Set(cleanRelations.map((r) => `${r.from}\0${r.to}\0${r.kind}`)).size !==
    cleanRelations.length
  )
    throw new Error("relationが重複しています");
  return {
    agendas: cleanAgendas,
    classifications: cleanClassifications,
    relations: cleanRelations,
  };
}

function chunkProject(
  project: Project,
): Array<{ ids: string[]; text: string }> {
  const chunks: Array<{ ids: string[]; text: string }> = [];
  let current = { ids: [] as string[], text: "" };
  for (const utterance of project.utterances) {
    const item = `[${utterance.id}] ${utterance.speaker}: ${utterance.quote}\n`;
    if (current.text && current.text.length + item.length > CHUNK_LIMIT) {
      chunks.push(current);
      current = { ids: [], text: "" };
    }
    if (item.length > CHUNK_LIMIT)
      throw new Error(
        `発言 ${utterance.id} がモデル入力上限を超えています。黙って切り捨てず処理を中止しました。`,
      );
    current.ids.push(utterance.id);
    current.text += item;
  }
  if (current.text) chunks.push(current);
  return chunks;
}

export async function analyzeLocally(
  project: Project,
  modelId: string,
  onProgress: (text: string) => void,
  signal: AbortSignal,
  ownership: Omit<OwnershipOptions, "signal"> = {},
): Promise<ModelSuggestion> {
  if (!MODEL_OPTIONS.some((option) => option.id === modelId))
    throw new Error("未登録のモデルです");
  if (signal.aborted)
    throw new DOMException("解析を中止しました", "AbortError");
  return withAnalysisOwnership(
    async () => {
      if (signal.aborted)
        throw new DOMException("解析を中止しました", "AbortError");
      if (typeof Worker === "undefined")
        throw new Error(
          "Workerを利用できない環境です。AI解析は未提供で、手動整理のみ利用できます。",
        );
      const worker = new Worker(
        new URL("../workers/analysis.worker.ts", import.meta.url),
        { type: "module" },
      );
      const chunks = chunkProject(project);
      if (chunks.length === 0) {
        worker.terminate();
        throw new Error("解析対象の発言がありません");
      }
      return new Promise<ModelSuggestion>((resolve, reject) => {
        let settled = false;
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener("abort", abort);
          worker.terminate();
          fn();
        };
        const abort = () =>
          finish(() =>
            reject(new DOMException("解析を中止しました", "AbortError")),
          );
        signal.addEventListener("abort", abort, { once: true });
        worker.onmessage = (event: MessageEvent<WorkerReply>) => {
          const message = event.data;
          if (message.type === "progress") onProgress(message.text);
          else if (message.type === "error")
            finish(() => reject(new Error(message.message)));
          else if (message.type === "result") {
            try {
              // Validate before settling: finish() marks the promise settled and would
              // otherwise prevent the catch path from rejecting on malformed output.
              const validated = validateSuggestion(message.suggestion, project);
              finish(() => resolve(validated));
            } catch (error) {
              finish(() => reject(error));
            }
          }
        };
        worker.onerror = (event) =>
          finish(() =>
            reject(
              new Error(event.message || "ローカルWorkerで解析に失敗しました"),
            ),
          );
        worker.postMessage({
          type: "analyze",
          modelId,
          project: { utterances: project.utterances },
          chunks,
        });
      });
    },
    { ...ownership, signal },
  );
}

export function applySuggestion(
  project: Project,
  suggestion: ModelSuggestion,
  modelId: string,
): Project {
  validateProject(project);
  const checkedSuggestion = validateSuggestion(suggestion, project);
  if (
    project.revisions.some(
      (r) =>
        r.kind === "user-revision" ||
        r.kind === "source-revision" ||
        r.kind.startsWith("agenda-"),
    )
  )
    throw new Error(
      "利用者の訂正後はAI候補を自動適用できません。現在の訂正を確認してから手動で整理してください。",
    );
  const ids = new Set(project.utterances.map((u) => u.id));
  const memberships = checkedSuggestion.agendas.flatMap((a) => a.utteranceIds);
  if (
    memberships.some((id) => !ids.has(id)) ||
    new Set(memberships).size !== memberships.length
  )
    throw new Error("候補agendaのmembershipが不正です");
  const now = new Date().toISOString();
  const classifications = new Map(
    checkedSuggestion.classifications.map((item) => [
      item.utteranceId,
      item.classification,
    ]),
  );
  const candidateItems = [...checkedSuggestion.agendas];
  const missing = project.utterances
    .map((u) => u.id)
    .filter((id) => !memberships.includes(id));
  if (missing.length)
    candidateItems.push({
      title: "未整理",
      utteranceIds: missing,
      arrival: "",
      unresolved: ["議題への対応付け未確定"],
      nextAction: "手動で議題を確認する。",
    });
  const agendas = candidateItems.map((item, index) => ({
    id: `candidate-${now}-${index}`,
    title: item.title,
    utteranceIds: item.utteranceIds,
    boundary: "candidate" as const,
    decision: "undecided" as const,
    answer: "none" as const,
    agreement: "unknown" as const,
    verification: "unverified" as const,
    arrival: item.arrival,
    unresolved: item.unresolved,
    nextAction: item.nextAction,
    needsReview: true,
  }));
  const relations = checkedSuggestion.relations.map((item, index) => ({
    id: `candidate-relation-${now}-${index}`,
    ...item,
    evidenceIds: [item.from, item.to],
  }));
  const result: Project = {
    ...project,
    utterances: project.utterances.map((utterance) => ({
      ...utterance,
      classification:
        classifications.get(utterance.id) ?? utterance.classification,
      coverage: classifications.has(utterance.id) ? "mapped" : "unorganized",
    })),
    agendas,
    selectedAgendaId: agendas[0].id,
    relations,
    revisions: [
      ...project.revisions,
      {
        id: `analysis-${now}`,
        at: now,
        targetId: project.id,
        kind: "analysis-suggestion",
        before: {
          agendas: project.agendas,
          relations: project.relations,
          utterances: project.utterances,
          selectedAgendaId: project.selectedAgendaId,
        },
        after: { agendas, relations },
        reason:
          "AI解析候補を新しいcandidate構造として適用。旧解析と原文はrevision.beforeに保存。",
      },
    ],
    runs: [
      ...project.runs,
      {
        id: `run-${now}`,
        at: now,
        engine: "WebLLM-local-worker",
        model: modelId,
        status: "complete",
        note: "P0評価用の実験的候補。合意・正しさ・解決を判定していない。未処理範囲は別途表示する。",
      },
    ],
    updatedAt: now,
    saved: false,
  };
  return validateProject(result);
}
