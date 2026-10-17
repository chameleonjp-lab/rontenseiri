import { useState } from "react";
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
  const next = project.utterances
    .filter((t) => t.order > u.order)
    .sort((a, b) => a.order - b.order)[0];
  const sameAgenda =
    next &&
    project.agendas.some(
      (a) => a.utteranceIds.includes(u.id) && a.utteranceIds.includes(next.id),
    );
  const canMerge =
    next &&
    sameAgenda &&
    next.speaker === u.speaker &&
    next.sourceVersionId === u.sourceVersionId;
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
      <details className="boundary-edit">
        <summary>発言本文の区切りを編集</summary>
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
        <button
          disabled={Array.from(u.quote).length < 2}
          onClick={() =>
            apply(() =>
              splitUtterance(
                project,
                u.id,
                Array.from(u.quote).slice(0, cut).join("").length,
                reason,
              ),
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
      </details>
      <details className="boundary-edit">
        <summary>意味上の依存関係を指定</summary>
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
            apply(() => setDependency(project, u.id, dependent, true, reason))
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
            apply(() => setDependency(project, u.id, dependent, false, reason))
          }
        >
          依存関係を解除
        </button>
      </details>
      {!!project.lineage?.records.length && (
        <details className="boundary-edit">
          <summary>発言IDの移送状況を確認</summary>
          {project.lineage.records.slice(-20).map((record) => (
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
                    onApply={(ids) =>
                      apply(() =>
                        resolveLineageTransfer(
                          project,
                          record.id,
                          ref.referenceId,
                          ids,
                          "applied",
                          reason,
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
        </details>
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
  onApply: (ids: string[]) => void;
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
      <button disabled={!selected.length} onClick={() => onApply(selected)}>
        選択した移し先に適用
      </button>
    </fieldset>
  );
}
