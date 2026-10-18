import { useState } from "react";
import LazyDetails from "./LazyDetails";
import type { Project } from "../domain/types";
import {
  lineageTargetIds,
  splitUtterance,
  mergeUtterances,
  resolveLineageTransfer,
} from "../domain/utterance-editing";
import { setDependency } from "../domain/dependencies";
export default function UtteranceBoundaryEditor({
  project,
  utteranceId,
  onUpdate,
  onError,
}: {
  project: Project;
  utteranceId: string;
  onUpdate: (p: Project) => void;
  onError: (s: string) => void;
}) {
  const u = project.utterances.find((x) => x.id === utteranceId)!;
  const [cut, setCut] = useState(
    Math.max(1, Math.floor(Array.from(u.quote).length / 2)),
  );
  const [reason, setReason] = useState("");
  const [dependent, setDependent] = useState("");
  const [reasoningDestinations, setReasoningDestinations] = useState<
    Record<string, "left" | "right" | "both" | "unresolved">
  >({});
  const lineageRecords = project.lineage?.records ?? [];
  const getNext = () =>
    project.utterances
      .filter((t) => t.order > u.order)
      .sort((a, b) => a.order - b.order)[0];
  const apply = (fn: () => Project) => {
    try {
      if (!reason.trim())
        throw Error("区切り・関係の変更理由を入力してください");
      onUpdate(fn());
    } catch (e) {
      onError(String(e));
    }
  };
  return (
    <>
      <LazyDetails className="boundary-edit" summary="発言本文の区切りを編集">
        {() => {
          const next = getNext();
          const sameAgenda =
            next &&
            project.agendas.some(
              (a) =>
                a.utteranceIds.includes(u.id) &&
                a.utteranceIds.includes(next.id),
            );
          const canMerge =
            next &&
            sameAgenda &&
            next.speaker === u.speaker &&
            next.sourceVersionId === u.sourceVersionId;
          return (
            <>
              <p className="fineprint">
                議題を分ける操作とは別です。原文・旧IDと変更履歴は保持します。関係や意味の移し先は、未確定なら後から確認します。
              </p>
              <label className="field">
                区切り・関係の変更理由
                <input
                  aria-label="区切り・関係の変更理由"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <label className="field">
                先頭から何文字で分けるか
                <input
                  aria-label="先頭から何文字で分けるか"
                  type="number"
                  min={1}
                  max={Array.from(u.quote).length - 1}
                  value={cut}
                  onChange={(e) => setCut(Number(e.target.value))}
                />
              </label>
              {!!project.reasoning &&
                (() => {
                  const affected = [
                    ...project.reasoning.evidence.filter((x) =>
                      x.utteranceIds.includes(u.id),
                    ),
                    ...project.reasoning.responses.filter(
                      (x) =>
                        x.utteranceIds.includes(u.id) ||
                        x.evidenceIds.some((id) =>
                          project.reasoning!.evidence.some(
                            (e) => e.id === id && e.utteranceIds.includes(u.id),
                          ),
                        ),
                    ),
                    ...project.reasoning.items.filter((x) =>
                      x.utteranceIds.includes(u.id),
                    ),
                    ...project.reasoning.questionVersions.filter((x) =>
                      x.sourceUtteranceIds.includes(u.id),
                    ),
                  ];
                  return affected.length ? (
                    <fieldset>
                      <legend>分割後の解釈参照先</legend>
                      <p className="fineprint">
                        未選択は
                        unresolved（両片を原根拠として保持）です。判断確定やfulfilledは自動再認定しません。
                      </p>
                      {affected.map((x) => (
                        <label className="field" key={x.id}>
                          {x.id}
                          <select
                            aria-label={`${x.id} の分割先`}
                            value={reasoningDestinations[x.id] ?? "unresolved"}
                            onChange={(e) =>
                              setReasoningDestinations({
                                ...reasoningDestinations,
                                [x.id]: e.target.value as
                                  "left" | "right" | "both" | "unresolved",
                              })
                            }
                          >
                            <option value="unresolved">
                              unresolved（両片・要確認）
                            </option>
                            <option value="left">left（左片）</option>
                            <option value="right">right（右片）</option>
                            <option value="both">both（両片）</option>
                          </select>
                        </label>
                      ))}
                    </fieldset>
                  ) : null;
                })()}
              <button
                disabled={Array.from(u.quote).length < 2}
                onClick={() =>
                  apply(() =>
                    splitUtterance(project, u.id, {
                      offset: Array.from(u.quote).slice(0, cut).join("").length,
                      reason,
                      reasoningDestinations,
                    }),
                  )
                }
              >
                この発言を2つに分ける
              </button>
              <button
                disabled={!canMerge}
                onClick={() =>
                  apply(() => mergeUtterances(project, [u.id, next.id], reason))
                }
              >
                直後の同じ話者の発言と統合
              </button>
              <p className="fineprint">
                別話者・別原文版・別議題は統合しません。話者が不明のときは、同じ人だと確認してから統合してください。
              </p>
            </>
          );
        }}
      </LazyDetails>
      <LazyDetails className="boundary-edit" summary="意味上の依存関係を指定">
        {() => (
          <>
            <p className="fineprint">
              時系列の接続だけでは依存扱いにしません。この根拠に依存する後続発言を明示すると、訂正時に別議題でも要再確認になります。
            </p>
            <label className="field">
              この根拠に依存する後続発言
              <select
                aria-label="この根拠に依存する後続発言"
                value={dependent}
                onChange={(e) => setDependent(e.target.value)}
              >
                <option value="">選択してください</option>
                {project.utterances
                  .filter((t) => t.order > u.order)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.id} · {t.quote.slice(0, 25)}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              依存関係を変更する理由
              <input
                aria-label="依存関係を変更する理由"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <button
              disabled={!dependent}
              onClick={() =>
                apply(() =>
                  setDependency(project, u.id, dependent, true, reason),
                )
              }
            >
              依存関係を記録
            </button>
            <button
              disabled={
                !dependent ||
                !project.relations.some(
                  (r) => r.from === u.id && r.to === dependent && r.dependency,
                )
              }
              onClick={() =>
                apply(() =>
                  setDependency(project, u.id, dependent, false, reason),
                )
              }
            >
              依存関係を解除
            </button>
          </>
        )}
      </LazyDetails>
      {!!lineageRecords.length && (
        <LazyDetails className="boundary-edit" summary="発言IDの移送状況を確認">
          {() => (
            <>
              {lineageRecords.slice(-20).map((record) => (
                <div className="lineage-record" key={record.id}>
                  <strong>
                    {record.oldIds.join(", ")} → {record.newIds.join(", ")}
                  </strong>
                  <p>
                    {record.status === "applied"
                      ? "適用済み"
                      : record.status === "conflict"
                        ? "衝突・要確認"
                        : "移し先未確定"}{" "}
                    · {record.reason}
                  </p>
                  {record.references
                    .filter((ref) => ref.status !== "applied")
                    .map((ref) => (
                      <TransferChoice
                        key={`${record.id}-${ref.referenceId}`}
                        candidates={lineageTargetIds(project, record.id)}
                        label={ref.referenceId}
                        onApply={(ids, status) =>
                          apply(() =>
                            resolveLineageTransfer(
                              project,
                              record.id,
                              ref.referenceId,
                              ids,
                              status,
                              reason ||
                                (status === "unresolved"
                                  ? "分割境界未確定のため両片を保持"
                                  : "移し先を確認"),
                            ),
                          )
                        }
                      />
                    ))}
                </div>
              ))}
              <p className="fineprint">
                最新20操作を表示。全履歴は完全JSONと訂正履歴に保持されます。
              </p>
            </>
          )}
        </LazyDetails>
      )}
    </>
  );
}
function TransferChoice({
  candidates,
  label,
  onApply,
}: {
  candidates: string[];
  label: string;
  onApply: (ids: string[], status: "applied" | "unresolved") => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <fieldset>
      <legend>{label} の移し先</legend>
      {candidates.map((id) => (
        <label className="checkbox" key={id}>
          <input
            type="checkbox"
            checked={selected.includes(id)}
            onChange={(e) =>
              setSelected(
                e.target.checked
                  ? [...selected, id]
                  : selected.filter((x) => x !== id),
              )
            }
          />
          {id}
        </label>
      ))}
      <button
        disabled={!selected.length}
        onClick={() => onApply(selected, "applied")}
      >
        選択した移し先に適用
      </button>
      <button
        disabled={!candidates.length}
        onClick={() => onApply(candidates, "unresolved")}
      >
        未確定（全候補を保持）
      </button>
    </fieldset>
  );
}
