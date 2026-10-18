import { returnTargetOption } from "./return-target-option";
import { semanticSnapshot } from "../domain/snapshot";
import UtteranceBoundaryEditor from "./UtteranceBoundaryEditor";
import LazyDetails from "./LazyDetails";
import { invalidateDependents } from "../domain/invalidation";
import { useEffect, useState } from "react";
import { ArrowRight, Check, X } from "lucide-react";
import type { Classification, Project } from "../domain/types";
import { labels } from "../domain/types";
import {
  mergeAgenda,
  reviseProject,
  reviseSource,
  splitAgenda,
} from "../domain/project";
import {
  clearIncomingReturns,
  correctReturn,
  moveUtterance,
} from "../domain/revisions";
interface Props {
  project: Project;
  utteranceId: string;
  onUpdate: (p: Project) => void;
  onClose: () => void;
  onTranscript: () => void;
  onSummary: () => void;
  onGraph: () => void;
  onError: (s: string) => void;
}
export default function Inspector({
  project,
  utteranceId,
  onUpdate,
  onClose,
  onTranscript,
  onSummary,
  onGraph,
  onError,
}: Props) {
  const u = project.utterances.find((item) => item.id === utteranceId)!;
  const agenda = project.agendas.find((a) => a.utteranceIds.includes(u.id));
  const existingReturn = project.relations.find(
    (r) => r.from === u.id && r.kind === "return",
  );
  const returnValue = existingReturn
    ? existingReturn.to
    : u.returnStatus === "none"
      ? ""
      : "__unknown";
  const incomingReturns = project.relations.filter(
    (r) => r.to === u.id && r.kind === "return",
  );
  const incomingSourceIds = new Set(incomingReturns.map((r) => r.from));
  const preservedReturns = project.relations.filter(
    (r) =>
      r.kind === "return" && r.to !== u.id && incomingSourceIds.has(r.from),
  );
  const incomingReturnSignature = JSON.stringify(
    [incomingReturns, preservedReturns].map((relations) =>
      relations.map((relation) => ({
        ...relation,
        evidenceQuotes: relation.evidenceIds.map(
          (id) => project.utterances.find((item) => item.id === id)?.quote,
        ),
      })),
    ),
  );
  const [classification, setClassification] = useState(u.classification);
  const [speaker, setSpeaker] = useState(u.speaker);
  const [important, setImportant] = useState(u.important);
  const [reason, setReason] = useState("");
  const [quote, setQuote] = useState(u.quote);
  const [mode, setMode] = useState<"classification" | "source">(
    "classification",
  );
  const [returnTo, setReturnTo] = useState(returnValue);
  const [incomingReturnAction, setIncomingReturnAction] = useState<
    "" | "keep" | "remove"
  >("");
  const [targetAgenda, setTargetAgenda] = useState(agenda?.id || "");
  const [boundaryReason, setBoundaryReason] = useState("");
  useEffect(() => {
    setClassification(u.classification);
  }, [utteranceId, u.classification]);
  useEffect(() => {
    setSpeaker(u.speaker);
  }, [utteranceId, u.speaker]);
  useEffect(() => {
    setImportant(u.important);
  }, [utteranceId, u.important]);
  useEffect(() => {
    setQuote(u.quote);
  }, [utteranceId, u.quote]);
  useEffect(() => {
    setReturnTo(returnValue);
  }, [utteranceId, returnValue]);
  useEffect(() => {
    setTargetAgenda(agenda?.id || "");
  }, [utteranceId, agenda?.id]);
  useEffect(() => {
    setIncomingReturnAction("");
  }, [utteranceId, u.classification, incomingReturnSignature]);
  const source = project.sources.find((s) => s.versionId === u.sourceVersionId);
  const userCorrection = project.revisions.some(
    (r) =>
      r.targetId === u.id &&
      (r.kind === "user-revision" || r.kind === "source-revision"),
  );
  const provenance = userCorrection
    ? "利用者の訂正あり"
    : project.runs.some((r) => r.engine === "sample")
      ? "架空サンプルの手動整理"
      : project.runs.length
        ? "AI推定候補・要確認"
        : "未整理・AI未実行";
  function apply() {
    try {
      if (!reason.trim()) throw Error("変更理由を入力してください。");
      let next = project;
      if (mode === "source") {
        if (quote === u.quote) throw Error("原文に変更がありません。");
        next = reviseSource(project, u.id, quote, reason);
      } else {
        const patch: Record<string, unknown> = {};
        if (classification !== u.classification)
          patch.classification = classification;
        if (speaker !== u.speaker) patch.speaker = speaker;
        if (important !== u.important) patch.important = important;
        if (Object.keys(patch).length)
          next = reviseProject(project, u.id, patch, reason);
        if (
          incomingReturns.length > 0 &&
          classification !== u.classification &&
          classification !== "main" &&
          incomingReturnAction === "remove"
        ) {
          next = clearIncomingReturns(next, u.id, reason);
        }
        if (
          incomingReturns.length > 0 &&
          classification !== u.classification &&
          classification !== "main" &&
          incomingReturnAction === ""
        ) {
          throw Error(
            "復帰先の分類が変わります。線を残すか外すか選択してください。",
          );
        }
        if (returnTo !== returnValue) {
          next = correctReturn(next, u.id, returnTo, reason);
        }
        if (next === project) throw Error("変更がありません。");
      }
      next = invalidateDependents(next, [u.id]);
      if (next.revisions.length > project.revisions.length + 1) {
        const after = semanticSnapshot(next);
        next.revisions = [
          ...project.revisions,
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            targetId: u.id,
            kind: "inspector-correction",
            before: semanticSnapshot(project),
            after,
            reason,
          },
        ];
      }
      onUpdate(next);
      setReason("");
    } catch (e) {
      onError(String(e));
    }
  }
  function boundary(action: () => Project) {
    try {
      if (!boundaryReason.trim())
        throw Error("議題所属・境界を変更する理由を入力してください。");
      const next = action();
      onUpdate(next);
      setBoundaryReason("");
    } catch (e) {
      onError(String(e));
    }
  }
  return (
    <aside className="inspector" aria-label="選択した発言の詳細">
      <div className="inspector-heading">
        <span>
          選択中：{agenda?.id} → {u.id}
        </span>
        <button
          className="icon-button"
          aria-label="詳細を閉じる"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <div className="inspector-scroll">
        <section className="evidence-card">
          <div className="card-kicker">原文 · {u.id}</div>
          <strong>{u.speaker || "話者不明"}</strong>
          <blockquote>{u.quote}</blockquote>
          <div className="evidence-position">
            {source?.name} · {u.line}行 · {u.sourceVersionId}
            {u.time && ` · ${u.time}`}
          </div>
          <button onClick={onTranscript}>
            発言一覧で見る
            <ArrowRight size={14} />
          </button>
        </section>
        <div className="agenda-mini">
          <small>所属する議題</small>
          <strong>
            {agenda?.id}｜{agenda?.title}
          </strong>
          <div>
            <span>分類の来歴</span>
            <span className="badge subtle">{provenance}</span>
          </div>
          <div>
            <span>決定状況</span>
            <span className="badge decision">
              {agenda && labels.decision[agenda.decision]}
            </span>
          </div>
          <div>
            <span>外部確認</span>
            <span className="badge">
              {agenda?.verification === "user-recorded"
                ? "利用者の確認記録あり"
                : "未確認"}
            </span>
          </div>
          {agenda?.needsReview && (
            <p className="warning-text">訂正の影響：振り返りは要再確認</p>
          )}
        </div>
        <div className="correction-panel">
          <h3>議題内の発言を訂正</h3>
          <div className="segmented">
            <button
              aria-pressed={mode === "classification"}
              onClick={() => setMode("classification")}
            >
              分類・関係
            </button>
            <button
              aria-pressed={mode === "source"}
              onClick={() => setMode("source")}
            >
              発言・原文
            </button>
          </div>
          {mode === "classification" ? (
            <>
              <label className="field">
                発言の分類
                <select
                  aria-label="発言の分類"
                  value={classification}
                  onChange={(e) =>
                    setClassification(e.target.value as Classification)
                  }
                >
                  {Object.entries(labels.classification).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                話者
                <input
                  aria-label="話者"
                  value={speaker}
                  onChange={(e) => setSpeaker(e.target.value)}
                />
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={important}
                  onChange={(e) => setImportant(e.target.checked)}
                />
                この一言が重要
              </label>
              <label className="field">
                この発言からの復帰先
                <select
                  aria-label="この発言からの復帰先"
                  value={returnTo}
                  onChange={(e) => setReturnTo(e.target.value)}
                >
                  <option value="__unknown">未確定 — 線を引かない</option>
                  <option value="">復帰先なし</option>
                  {existingReturn &&
                    !project.utterances.some(
                      (t) =>
                        t.id === existingReturn.to &&
                        t.order > u.order &&
                        t.classification === "main",
                    ) && (
                      <option value={existingReturn.to}>
                        {existingReturn.to} · 現在の復帰先（要確認）
                      </option>
                    )}
                  {project.utterances
                    .filter(
                      (t) => t.order > u.order && t.classification === "main",
                    )
                    .map(returnTargetOption)}
                </select>
              </label>
              {incomingReturns.length > 0 && (
                <section aria-label="この発言への復帰線">
                  <h4>この発言への復帰線：{incomingReturns.length}件</h4>
                  {[
                    { title: "解除対象", relations: incomingReturns },
                    {
                      title: "解除対象外・同じ始点から別の復帰先への線は保持",
                      relations: preservedReturns,
                    },
                  ]
                    .filter((group) => group.relations.length > 0)
                    .map((group) => (
                      <div key={group.title}>
                        <h5>{group.title}</h5>
                        <ul>
                          {group.relations.map((relation) => (
                            <li key={relation.id}>
                              <strong>
                                {relation.from} → {relation.to}
                              </strong>
                              <span> · 関係ID：{relation.id}</span>
                              {relation.evidenceIds.length === 0 && (
                                <p>根拠未登録</p>
                              )}
                              <ul>
                                {relation.evidenceIds.map((id) => (
                                  <li key={id}>
                                    根拠 {id}：「
                                    {
                                      project.utterances.find(
                                        (item) => item.id === id,
                                      )?.quote
                                    }
                                    」
                                  </li>
                                ))}
                              </ul>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  <p className="fineprint">
                    分類変更で外す場合は、ここに示した復帰線をすべて解除します。別の復帰先への線や他の種類の関係は残します。
                  </p>
                </section>
              )}
              {incomingReturns.length > 0 &&
                classification !== u.classification &&
                classification !== "main" && (
                  <fieldset className="field">
                    <legend>この発言を復帰先から分類変更します</legend>
                    <p className="fineprint">
                      上記{incomingReturns.length}
                      件すべての線をどう扱うか明示してください。未選択のままでは保存できません。
                    </p>
                    <label className="checkbox">
                      <input
                        type="radio"
                        name={`incoming-return-${u.id}`}
                        checked={incomingReturnAction === "keep"}
                        onChange={() => setIncomingReturnAction("keep")}
                      />
                      線を残して要確認
                    </label>
                    <label className="checkbox">
                      <input
                        type="radio"
                        name={`incoming-return-${u.id}`}
                        checked={incomingReturnAction === "remove"}
                        onChange={() => setIncomingReturnAction("remove")}
                      />
                      線を外して未確定
                    </label>
                  </fieldset>
                )}
              <p className="fineprint">
                復帰は後の本筋への関係です。「なし」と「未確定」は分けて記録し、推測で線を引きません。
              </p>
            </>
          ) : (
            <>
              <label className="field">
                訂正後の原文
                <textarea
                  aria-label="訂正後の原文"
                  rows={5}
                  value={quote}
                  onChange={(e) => setQuote(e.target.value)}
                />
              </label>
              <p className="warning-text">
                原文は新しい版として追加し、旧版・変更前後・理由を残します。本文を別の発言へ分割する操作とは異なります。
              </p>
              <button
                onClick={() => {
                  const url = URL.createObjectURL(
                    new Blob([quote], { type: "text/plain;charset=utf-8" }),
                  );
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "編集中の原文.txt";
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                入力中の原文をテキストで退避
              </button>
            </>
          )}
          <label className="field">
            変更理由
            <textarea
              aria-label="変更理由"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="なぜ訂正するかを記録"
            />
          </label>
          <button className="primary full" onClick={apply}>
            訂正を保存
            <Check size={15} />
          </button>
          <p className="fineprint">
            分類だけの変更では原文・発言順・議題所属・他の発言を変えません。影響するまとめだけ要再確認にします。
          </p>
        </div>
        <LazyDetails
          className="boundary-edit"
          summary="議題の所属・境界を別に変更"
        >
          {() => (
            <>
              <p className="fineprint">
                派生やずれだけで新議題にしません。同じ議題が後で再登場しても、所属先の議題IDを引き継ぎます。
              </p>
              <label className="field">
                所属先の議題
                <select
                  aria-label="所属先の議題"
                  value={targetAgenda}
                  onChange={(e) => setTargetAgenda(e.target.value)}
                >
                  {project.agendas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.id}｜{a.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                所属・境界の変更理由
                <input
                  aria-label="所属・境界の変更理由"
                  value={boundaryReason}
                  onChange={(e) => setBoundaryReason(e.target.value)}
                />
              </label>
              <button
                disabled={targetAgenda === agenda?.id}
                onClick={() =>
                  boundary(() =>
                    moveUtterance(project, u.id, targetAgenda, boundaryReason),
                  )
                }
              >
                この発言の所属先だけ変更
              </button>
              <button
                onClick={() =>
                  boundary(() => splitAgenda(project, u.id, boundaryReason))
                }
              >
                この発言から新議題に分ける
              </button>
              <button
                disabled={!agenda || project.agendas[0]?.id === agenda.id}
                onClick={() =>
                  boundary(() =>
                    mergeAgenda(project, agenda!.id, boundaryReason),
                  )
                }
              >
                前の議題と結合
              </button>
              <p className="fineprint">
                議題を分けても、発言の本文は分割しません。操作を取り消す場合は訂正履歴のUndoを使えます。
              </p>
            </>
          )}
        </LazyDetails>
        <UtteranceBoundaryEditor
          project={project}
          utteranceId={u.id}
          onUpdate={onUpdate}
          onError={onError}
        />
        <div className="detail-return-actions">
          <button onClick={onGraph}>選択した発言の図へ戻る</button>
          <button className="review-link" onClick={onSummary}>
            この議題の振り返りへ
            <ArrowRight size={16} />
          </button>
        </div>
        <p className="fineprint">
          原文・AI推定・利用者の訂正を分けて保存します。
        </p>
      </div>
    </aside>
  );
}
