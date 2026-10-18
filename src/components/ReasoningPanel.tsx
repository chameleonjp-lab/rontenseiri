import { useMemo, useRef, useState, type FormEvent } from "react";
import type { Project } from "../domain/types";
import { useDraftGuard } from "./draft-guard";
import {
  addEvidence,
  addQuestion,
  addSemanticItem,
  linkResponse,
  updateResponse,
  removeResponse,
  reviseQuestion,
  retractQuestion,
  type ReasoningProject,
} from "../domain/reasoning";
import type {
  ClaimKind,
  Certainty,
  Fulfillment,
  ResponseKind,
} from "../domain/reasoning-types";
import "./reasoning.css";

type Props = {
  project: Project;
  onUpdate: (p: Project) => void;
  onError: (s: string) => void;
  onSelect: (id: string) => void;
};
const originLabel = {
  original: "原文",
  inferred: "推定",
  analysis: "分析用",
} as const;
const kindLabel: Record<ResponseKind, string> = {
  answer: "回答",
  clarification: "明確化",
  counterargument: "反論",
  objection: "異議",
  refusal: "拒否",
  partial: "部分回答",
  unknown: "不明",
};
const fulfillmentLabel: Record<Fulfillment, string> = {
  unassessed: "未評価",
  fulfilled: "充足",
  "partially-fulfilled": "部分充足",
  "not-fulfilled": "未充足",
  "not-applicable": "該当なし",
};
const claimLabel: Record<ClaimKind, string> = {
  claim: "主張",
  position: "立場",
  reason: "理由",
  condition: "条件",
  exception: "例外",
  scope: "範囲",
  term: "用語",
  objection: "異論",
  unverified: "未確認",
};
const certaintyLabel: Record<Certainty, string> = {
  confirmed: "利用者確認済み",
  inferred: "推定",
  uncertain: "未確定",
  retracted: "撤回",
};

const toggle = (ids: string[], id: string) =>
  ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];

const Checks = ({
  ids,
  setIds,
  label,
  utterances,
}: {
  ids: string[];
  setIds: (v: string[]) => void;
  label: string;
  utterances: Project["utterances"];
}) => (
  <fieldset className="reasoning-checks">
    <legend>{label}</legend>
    {utterances.map((u) => (
      <label key={u.id}>
        <input
          type="checkbox"
          checked={ids.includes(u.id)}
          onChange={() => setIds(toggle(ids, u.id))}
        />{" "}
        <span>
          {u.id} {u.speaker}: {u.quote}
        </span>
      </label>
    ))}
  </fieldset>
);

export default function ReasoningPanel({
  project,
  onUpdate,
  onError,
  onSelect,
}: Props) {
  const graph = project.reasoning;
  const agenda =
    project.agendas.find((a) => a.id === project.selectedAgendaId) ??
    project.agendas[0];
  const utterances = useMemo(
    () =>
      agenda
        ? project.utterances
            .filter((u) => agenda.utteranceIds.includes(u.id))
            .sort((a, b) => a.order - b.order)
        : [],
    [project, agenda],
  );
  const [questionText, setQuestionText] = useState("");
  const [origin, setOrigin] = useState<"original" | "inferred" | "analysis">(
    "original",
  );
  const [questionReason, setQuestionReason] = useState("");
  const [questionSources, setQuestionSources] = useState<string[]>([]);
  const [revision, setRevision] = useState<{
    id: string;
    text: string;
    reason: string;
  } | null>(null);
  const responseVersionRef = useRef<HTMLSelectElement>(null);
  const [editingResponseId, setEditingResponseId] = useState<string | null>(
    null,
  );
  const [relationMessage, setRelationMessage] = useState("");
  const [response, setResponse] = useState({
    versionId: "",
    kind: "answer" as ResponseKind,
    fulfillment: "unassessed" as Fulfillment,
    reason: "",
    ids: [] as string[],
    evidenceIds: [] as string[],
    counterargumentToClaimIds: [] as string[],
  });
  const [evidence, setEvidence] = useState({
    note: "",
    certainty: "uncertain" as Certainty,
    reason: "",
    ids: [] as string[],
  });
  const [item, setItem] = useState({
    text: "",
    kind: "claim" as ClaimKind,
    certainty: "inferred" as Certainty,
    reason: "",
    ids: [] as string[],
    evidenceIds: [] as string[],
  });
  useDraftGuard(
    questionText !== "" ||
      questionReason !== "" ||
      questionSources.length > 0 ||
      revision !== null ||
      response.versionId !== "" ||
      response.reason !== "" ||
      response.ids.length > 0 ||
      evidence.note !== "" ||
      evidence.reason !== "" ||
      evidence.ids.length > 0 ||
      item.text !== "" ||
      item.reason !== "" ||
      item.ids.length > 0 ||
      item.evidenceIds.length > 0,
    "view",
  );
  const questions = graph?.questions ?? [],
    versions = graph?.questionVersions ?? [],
    responses = graph?.responses ?? [],
    evidenceList = graph?.evidence ?? [],
    items = graph?.items ?? [];
  const run = (fn: () => Project) => {
    try {
      onUpdate(fn());
      return true;
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
      return false;
    }
  };
  const selectedText = questionSources.length
    ? questionSources.join(", ")
    : "未選択（全発言を根拠にしません）";
  function submitQuestion(e: FormEvent) {
    e.preventDefault();
    if (!questionSources.length)
      return onError("問いの根拠にする発言を1つ以上、明示的に選択してください");
    run(() =>
      addQuestion(
        project as ReasoningProject,
        questionText,
        origin,
        questionSources,
        "manual",
        undefined,
        questionReason,
      ),
    );
    setQuestionText("");
    setQuestionReason("");
    setQuestionSources([]);
  }
  function submitRevision(e: FormEvent) {
    e.preventDefault();
    if (!revision) return;
    const q = questions.find((x) => x.id === revision.id);
    const current = q
      ? versions.find((v) => v.id === q.currentVersionId)
      : undefined;
    run(() =>
      reviseQuestion(
        project as ReasoningProject,
        revision.id,
        revision.text,
        revision.reason,
        current?.sourceUtteranceIds ?? [],
      ),
    );
    setRevision(null);
  }
  function submitResponse(e: FormEvent) {
    e.preventDefault();
    if (!response.versionId || !response.ids.length)
      return onError("対象の問い版と発言を明示選択してください");
    const value = {
      questionVersionId: response.versionId,
      utteranceIds: response.ids,
      kind: response.kind,
      fulfillment: response.fulfillment,
      counterargumentToClaimIds: response.counterargumentToClaimIds,
      evidenceIds: response.evidenceIds,
    };
    const ok = run(() =>
      editingResponseId
        ? updateResponse(project, editingResponseId, value, response.reason)
        : linkResponse(
            project,
            {
              ...value,
              actor: "manual",
              note: response.reason,
              time: {
                asOf: new Date().toISOString(),
                recordedAt: new Date().toISOString(),
              },
            },
            response.reason,
          ),
    );
    if (ok) {
      setRelationMessage(
        editingResponseId ? "応答の関連を修正しました" : "応答を登録しました",
      );
      setEditingResponseId(null);
      setResponse({
        versionId: "",
        kind: "answer",
        fulfillment: "unassessed",
        reason: "",
        ids: [],
        evidenceIds: [],
        counterargumentToClaimIds: [],
      });
    }
  }
  function submitEvidence(e: FormEvent) {
    e.preventDefault();
    if (!evidence.ids.length)
      return onError("根拠となる発言を明示選択してください");
    const sourceIds = [
      ...new Set(
        evidence.ids
          .map((id) => project.utterances.find((u) => u.id === id)?.sourceId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    run(() =>
      addEvidence(
        project as ReasoningProject,
        {
          utteranceIds: evidence.ids,
          sourceIds,
          actor: "manual",
          certainty: evidence.certainty,
          note: evidence.note,
          time: {
            asOf: new Date().toISOString(),
            recordedAt: new Date().toISOString(),
          },
        },
        evidence.reason,
      ),
    );
    setEvidence({ note: "", certainty: "uncertain", reason: "", ids: [] });
  }
  function submitItem(e: FormEvent) {
    e.preventDefault();
    if (!item.ids.length)
      return onError("意味項目の発言根拠を明示選択してください");
    run(() =>
      addSemanticItem(
        project as ReasoningProject,
        {
          kind: item.kind,
          text: item.text,
          utteranceIds: item.ids,
          evidenceIds: item.evidenceIds,
          actor: "manual",
          certainty: item.certainty,
          time: {
            asOf: new Date().toISOString(),
            recordedAt: new Date().toISOString(),
          },
        },
        item.reason,
      ),
    );
    setItem({
      text: "",
      kind: "claim",
      certainty: "inferred",
      reason: "",
      ids: [],
      evidenceIds: [],
    });
  }
  return (
    <section className="reasoning-panel" aria-label="問い・根拠">
      <header className="reasoning-panel__header">
        <div>
          <p className="eyebrow">REASONING / EVIDENCE</p>
          <h2>問い・根拠</h2>
        </div>
        <span className="reasoning-panel__notice">
          確認記録は本人認証ではありません
        </span>
      </header>
      {!agenda ? (
        <p className="reasoning-empty">
          議題ブロックがありません。問いは未特定です。
        </p>
      ) : (
        <>
          <div className="reasoning-agenda">
            <strong>{agenda.title}</strong>
            <span>議題ブロック {agenda.id}</span>
            <span>{utterances.length} 発言</span>
            <span className="reasoning-muted">
              会話本文のみを参加者として扱い、参考資料・後日の説明は分離
            </span>
          </div>
          <div className="reasoning-utterances">
            {utterances.map((u) => (
              <button
                key={u.id}
                type="button"
                className="reasoning-utterance"
                onClick={() => onSelect(u.id)}
              >
                <span>
                  {u.speaker} ·{" "}
                  {project.sources.find((s) => s.id === u.sourceId)?.role ??
                    "役割不明"}
                </span>
                <b>{u.quote}</b>
                <small>発言 {u.id} / 原文へ戻る</small>
              </button>
            ))}
          </div>
          <form className="reasoning-form" onSubmit={submitQuestion}>
            <h3>問いを記録（議題 {agenda.id}）</h3>
            <label>
              問い
              <textarea
                value={questionText}
                onChange={(e) => setQuestionText(e.target.value)}
                required
                placeholder="何を決める／確認するのか"
              />
            </label>
            <div className="reasoning-form__row">
              <label>
                区分
                <select
                  value={origin}
                  onChange={(e) => setOrigin(e.target.value as typeof origin)}
                >
                  <option value="original">原文</option>
                  <option value="inferred">推定</option>
                  <option value="analysis">分析用</option>
                </select>
              </label>
              <label>
                登録理由
                <input
                  value={questionReason}
                  onChange={(e) => setQuestionReason(e.target.value)}
                  required
                  placeholder="記録した理由"
                />
              </label>
            </div>
            <Checks
              utterances={utterances}
              ids={questionSources}
              setIds={setQuestionSources}
              label={`根拠発言（選択中: ${selectedText}）`}
            />
            <button className="primary" type="submit">
              明示選択した発言に問いを追加
            </button>
          </form>
          <section className="reasoning-section">
            <h3>問いの版（問い未特定を別表示）</h3>
            {questions.length === 0 && (
              <p className="reasoning-empty">問い未特定</p>
            )}
            {questions.map((q) => (
              <article className="reasoning-card" key={q.id}>
                <strong>
                  {originLabel[q.origin]}：{q.id}
                </strong>
                {q.versionIds.map((id) => {
                  const v = versions.find((x) => x.id === id);
                  if (!v) return null;
                  return (
                    <div
                      key={id}
                      className={`reasoning-version ${v.status !== "active" ? "is-muted" : ""}`}
                    >
                      <span>
                        <b>{v.text}</b>
                        <small>
                          {v.status === "active"
                            ? "現行"
                            : v.status === "superseded"
                              ? "新版に置換（旧版の応答対象は保持）"
                              : "撤回"}{" "}
                          · 根拠 {v.sourceUtteranceIds.join(", ") || "未特定"}
                          {v.reason ? ` · 理由: ${v.reason}` : ""}
                        </small>
                      </span>
                      {v.status === "active" && (
                        <span className="reasoning-actions">
                          <button
                            type="button"
                            onClick={() =>
                              setRevision({
                                id: q.id,
                                text: v.text,
                                reason: "",
                              })
                            }
                          >
                            版を変更
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const reason = window.prompt("撤回理由");
                              if (reason)
                                run(() =>
                                  retractQuestion(
                                    project as ReasoningProject,
                                    q.id,
                                    reason,
                                  ),
                                );
                            }}
                          >
                            撤回
                          </button>
                        </span>
                      )}
                    </div>
                  );
                })}
              </article>
            ))}
          </section>
          {revision && (
            <form
              className="reasoning-form reasoning-inline"
              onSubmit={submitRevision}
            >
              <h3>問い版を変更（旧版の応答対象は保持）</h3>
              <label>
                新しい問い
                <textarea
                  value={revision.text}
                  onChange={(e) =>
                    setRevision({ ...revision, text: e.target.value })
                  }
                  required
                />
              </label>
              <label>
                変更理由
                <input
                  value={revision.reason}
                  onChange={(e) =>
                    setRevision({ ...revision, reason: e.target.value })
                  }
                  required
                />
              </label>
              <button className="primary" type="submit">
                新しい版を登録
              </button>
            </form>
          )}
          <section className="reasoning-section">
            <h3>問い版への応答（kind と要求充足は独立）</h3>
            <p aria-live="polite">{relationMessage}</p>
            <form
              className="reasoning-form"
              aria-label="応答関係の編集"
              onSubmit={submitResponse}
            >
              <p>
                {editingResponseId
                  ? `修正中: ${editingResponseId}`
                  : "新しい応答を登録"}
                （旧版から新版へ自動移動しません）
              </p>
              <label>
                対象問い版
                <select
                  ref={responseVersionRef}
                  value={response.versionId}
                  onChange={(e) =>
                    setResponse({ ...response, versionId: e.target.value })
                  }
                >
                  <option value="">問い版を選択</option>
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.id} · {v.text} ({v.status})
                    </option>
                  ))}
                </select>
              </label>
              <div className="reasoning-form__row">
                <label>
                  応答種別
                  <select
                    value={response.kind}
                    onChange={(e) =>
                      setResponse({
                        ...response,
                        kind: e.target.value as ResponseKind,
                      })
                    }
                  >
                    {Object.entries(kindLabel).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  要求充足
                  <select
                    value={response.fulfillment}
                    onChange={(e) =>
                      setResponse({
                        ...response,
                        fulfillment: e.target.value as Fulfillment,
                      })
                    }
                  >
                    {Object.entries(fulfillmentLabel).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <Checks
                utterances={[...project.utterances].sort(
                  (a, b) => a.order - b.order,
                )}
                ids={response.ids}
                setIds={(ids) => setResponse({ ...response, ids })}
                label="回答にする発言（複数選択可）"
              />
              <fieldset className="reasoning-checks">
                <legend>応答の根拠（複数選択可・外すと関連だけ解除）</legend>
                {evidenceList.map((e) => (
                  <label key={e.id}>
                    <input
                      type="checkbox"
                      checked={response.evidenceIds.includes(e.id)}
                      onChange={() =>
                        setResponse({
                          ...response,
                          evidenceIds: toggle(response.evidenceIds, e.id),
                        })
                      }
                    />
                    {e.id} · {e.note || e.utteranceIds.join(", ")}
                  </label>
                ))}
              </fieldset>
              <fieldset className="reasoning-checks">
                <legend>
                  反論先の意味項目（種別・要求充足とは独立、複数選択可）
                </legend>
                {items.map((x) => (
                  <label key={x.id}>
                    <input
                      type="checkbox"
                      checked={response.counterargumentToClaimIds.includes(
                        x.id,
                      )}
                      onChange={() =>
                        setResponse({
                          ...response,
                          counterargumentToClaimIds: toggle(
                            response.counterargumentToClaimIds,
                            x.id,
                          ),
                        })
                      }
                    />
                    {x.id} · {x.text}
                  </label>
                ))}
              </fieldset>
              <label>
                登録理由
                <input
                  value={response.reason}
                  onChange={(e) =>
                    setResponse({ ...response, reason: e.target.value })
                  }
                  required
                />
              </label>
              <button className="primary" type="submit">
                {editingResponseId ? "応答の修正を保存" : "応答を登録"}
              </button>
              {editingResponseId && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        run(() =>
                          removeResponse(
                            project,
                            editingResponseId,
                            response.reason,
                          ),
                        )
                      ) {
                        setEditingResponseId(null);
                        setResponse({
                          versionId: "",
                          kind: "answer",
                          fulfillment: "unassessed",
                          reason: "",
                          ids: [],
                          evidenceIds: [],
                          counterargumentToClaimIds: [],
                        });
                        setRelationMessage(
                          "関連を解除しました。未回答・反論なしとは断定しません",
                        );
                        responseVersionRef.current?.focus();
                      }
                    }}
                  >
                    理由を記録して応答の関連を解除
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingResponseId(null);
                      setResponse({
                        versionId: "",
                        kind: "answer",
                        fulfillment: "unassessed",
                        reason: "",
                        ids: [],
                        evidenceIds: [],
                        counterargumentToClaimIds: [],
                      });
                      responseVersionRef.current?.focus();
                    }}
                  >
                    応答の修正をキャンセル
                  </button>
                </>
              )}
            </form>
            {responses.length === 0 ? (
              <p className="reasoning-empty">応答未記録</p>
            ) : (
              responses.map((r) => (
                <article className="reasoning-card" key={r.id}>
                  <div className="reasoning-tags">
                    <span>{kindLabel[r.kind]}</span>
                    <span className={`fulfillment-${r.fulfillment}`}>
                      要求充足：{fulfillmentLabel[r.fulfillment]}
                    </span>
                  </div>
                  <p>
                    問い版 {r.questionVersionId} · 発言{" "}
                    {r.utteranceIds.join(", ") || "未特定"}
                  </p>
                  <p>
                    根拠 {r.evidenceIds.join(", ") || "関連未記録"} · 反論先{" "}
                    {r.counterargumentToClaimIds.join(", ") ||
                      "関連未記録（反論なしとは断定しません）"}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingResponseId(r.id);
                      setResponse({
                        versionId: r.questionVersionId,
                        ids: [...r.utteranceIds],
                        kind: r.kind,
                        fulfillment: r.fulfillment,
                        reason: "",
                        evidenceIds: [...r.evidenceIds],
                        counterargumentToClaimIds: [
                          ...r.counterargumentToClaimIds,
                        ],
                      });
                      responseVersionRef.current?.focus();
                    }}
                  >
                    応答 {r.id} を修正
                  </button>
                  <small>
                    登録時点 {r.time.recordedAt} / 対象時点 {r.time.asOf}
                  </small>
                </article>
              ))
            )}
          </section>
          <section className="reasoning-section">
            <h3>明示根拠と意味項目</h3>
            <form className="reasoning-form" onSubmit={submitEvidence}>
              <h4>根拠を登録</h4>
              <Checks
                utterances={utterances}
                ids={evidence.ids}
                setIds={(ids) => setEvidence({ ...evidence, ids })}
                label="根拠発言（明示選択）"
              />
              <div className="reasoning-form__row">
                <label>
                  確度
                  <select
                    value={evidence.certainty}
                    onChange={(e) =>
                      setEvidence({
                        ...evidence,
                        certainty: e.target.value as Certainty,
                      })
                    }
                  >
                    {Object.entries(certaintyLabel).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  注記
                  <input
                    value={evidence.note}
                    onChange={(e) =>
                      setEvidence({ ...evidence, note: e.target.value })
                    }
                  />
                </label>
              </div>
              <label>
                登録理由
                <input
                  value={evidence.reason}
                  onChange={(e) =>
                    setEvidence({ ...evidence, reason: e.target.value })
                  }
                  required
                />
              </label>
              <button className="primary" type="submit">
                根拠を登録
              </button>
            </form>
            <form className="reasoning-form" onSubmit={submitItem}>
              <h4>意味項目を登録</h4>
              <label>
                内容
                <textarea
                  value={item.text}
                  onChange={(e) => setItem({ ...item, text: e.target.value })}
                  required
                />
              </label>
              <div className="reasoning-form__row">
                <label>
                  項目
                  <select
                    value={item.kind}
                    onChange={(e) =>
                      setItem({ ...item, kind: e.target.value as ClaimKind })
                    }
                  >
                    {Object.entries(claimLabel).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  確度
                  <select
                    value={item.certainty}
                    onChange={(e) =>
                      setItem({
                        ...item,
                        certainty: e.target.value as Certainty,
                      })
                    }
                  >
                    {Object.entries(certaintyLabel).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <Checks
                utterances={utterances}
                ids={item.ids}
                setIds={(ids) => setItem({ ...item, ids })}
                label="意味項目の発言根拠（明示選択）"
              />
              <fieldset className="reasoning-checks">
                <legend>登録済みEvidenceを関連付け</legend>
                {evidenceList.map((e) => (
                  <label key={e.id}>
                    <input
                      type="checkbox"
                      checked={item.evidenceIds.includes(e.id)}
                      onChange={() =>
                        setItem({
                          ...item,
                          evidenceIds: toggle(item.evidenceIds, e.id),
                        })
                      }
                    />{" "}
                    {e.id} · {certaintyLabel[e.certainty]}
                  </label>
                ))}
              </fieldset>
              <label>
                登録理由
                <input
                  value={item.reason}
                  onChange={(e) => setItem({ ...item, reason: e.target.value })}
                  required
                />
              </label>
              <button className="primary" type="submit">
                意味項目を登録
              </button>
            </form>
            {items.length === 0 ? (
              <p className="reasoning-empty">意味項目未記録</p>
            ) : (
              <div className="reasoning-items">
                {items.map((x) => (
                  <span key={x.id} className={`certainty-${x.certainty}`}>
                    {claimLabel[x.kind]}：{x.text} · 根拠{" "}
                    {x.evidenceIds.join(", ") || "未特定"} ·{" "}
                    {certaintyLabel[x.certainty]}
                  </span>
                ))}
              </div>
            )}
          </section>
          <p className="reasoning-muted">
            時刻は登録時点（recordedAt）と対象時点（asOf）を別に保持します。対象時点未指定を会話時刻とは断定しません。立場変化・排他的解釈の登録操作は未実装です。
          </p>
        </>
      )}
    </section>
  );
}
