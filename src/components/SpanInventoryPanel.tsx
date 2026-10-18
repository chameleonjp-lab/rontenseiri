import { useEffect, useRef, useState } from "react";
import type { Project } from "../domain/types";
import {
  inventoryRunId,
  inspectInventoryRecord,
  runSpanInventory,
} from "../analysis/inventory-run";
import { inventoryManifest } from "../analysis/span-inventory";
import type { ReconciliationResult } from "../analysis/bounded-reconcile";
import {
  clearLocalRun,
  readLocalRun,
  type LocalRunRecord,
} from "../storage/analysis-runs";
import { withAnalysisOwnership } from "../analysis/ownership";

export default function SpanInventoryPanel({ project }: { project: Project }) {
  const [record, setRecord] = useState<LocalRunRecord>();
  const [result, setResult] = useState<ReconciliationResult>();
  const [checkedProject, setCheckedProject] = useState<Project>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [runError, setRunError] = useState("");
  const controller = useRef<AbortController | undefined>(undefined);
  const projectRef = useRef(project);
  projectRef.current = project;
  const id = inventoryRunId(project);
  const [revision, refresh] = useState(0);
  useEffect(() => {
    let active = true;
    setResult(undefined);
    setCheckedProject(undefined);
    setError("");
    void (async () => {
      try {
        const value = await readLocalRun(id);
        if (active) setRecord(value);
        const parsed = value
          ? await inspectInventoryRecord(project, value)
          : undefined;
        if (active) {
          setRecord(value);
          setResult(parsed);
          setCheckedProject(project);
        }
      } catch (e) {
        if (active) {
          setError(`保存結果を現在の資料として検証できません: ${String(e)}`);
          setCheckedProject(project);
        }
      }
    })();
    return () => {
      active = false;
      controller.current?.abort();
    };
  }, [id, project, revision]);
  // A project edit immediately hides old results, even before async validation finishes.
  const current = checkedProject === project;
  let scope: ReturnType<typeof inventoryManifest> | undefined;
  let scopeError = "";
  try {
    scope = inventoryManifest(project);
  } catch (e) {
    scopeError = String(e);
  }
  async function start() {
    if (busy) return;
    const snapshot = project;
    const ac = new AbortController();
    controller.current = ac;
    setBusy(true);
    setRunError("");
    try {
      await runSpanInventory(snapshot, ac.signal, () => {});
    } catch (e) {
      if (!ac.signal.aborted && projectRef.current === snapshot)
        setRunError(String(e));
    } finally {
      if (controller.current === ac) {
        controller.current = undefined;
        setBusy(false);
        if (projectRef.current === snapshot) refresh((n) => n + 1);
      }
    }
  }
  const visible = current ? result : undefined;
  return (
    <section aria-label="原文範囲台帳（意味解析なし）">
      <h3>原文範囲台帳（意味解析なし）</h3>
      <p>
        現在の最初の会話資料の範囲を、最大160文字のchunkから決定論的に列挙します。全候補・全ペアは意味未判定（hold）です。AI・モデル取得・外部送信は行いません。議題・関係・分類・原文は変更しません。
      </p>
      <p>
        完了は候補ペアの列挙完了だけです。関係の発見・不存在・合意・正しさ・会話全体の解析完了を意味しません。fixture-bounded契約を使う限定スライスで、AI品質やR22全体の合格ではありません。
      </p>
      <p>
        作業を先に「この端末に保存」してください。台帳checkpointはこのブラウザ専用・作業JSONの対象外です。資料や訂正が変わった場合は旧結果を再利用しません。
      </p>
      {scope && (
        <details>
          <summary>対象と対象外の範囲</summary>
          <p>
            対象資料: {scope.source.id} / version: {scope.source.versionId} ·
            候補 {scope.candidates.length}件
          </p>
          <p>
            ペア順序は候補順の辞書式、範囲は0始まり・終端を含まないUTF-16位置です。
          </p>
          <p>
            候補に含まれない原文範囲:{" "}
            {scope.uncovered.length
              ? scope.uncovered.map((r) => `[${r.start}, ${r.end})`).join(", ")
              : "なし"}
          </p>
          <p>
            対象外資料（参考資料・追加会話を含む）:{" "}
            {scope.excludedSources.join(", ") || "なし"}
            。全資料の意味は未判定です。
          </p>
          <ul>
            {scope.candidates.map((c) => (
              <li key={c.id}>
                {c.id}:{" "}
                {c.evidence.map((s) => `[${s.start}, ${s.end})`).join(", ")} ·
                意味未判定
              </li>
            ))}
          </ul>
        </details>
      )}
      <p role="status" data-testid="inventory-state">
        {busy
          ? "処理中（未確定ページは表示しません）"
          : !current
            ? "保存結果を検証中"
            : error || runError
              ? "検証・実行失敗"
              : visible
                ? visible.status === "partial"
                  ? "部分結果（保存済み）"
                  : "列挙完了（意味未判定）"
                : record
                  ? "未完了・確定chunkから再開可能"
                  : "未開始"}
      </p>
      {visible && (
        <div data-testid="inventory-result">
          <p>
            保存済みペア: {visible.results.length} · 次のペア位置:{" "}
            {visible.cursor.nextPairIndex} · 状態: {visible.status}
          </p>
          <p>
            未処理ペア範囲:{" "}
            {visible.unexaminedRanges.length
              ? visible.unexaminedRanges
                  .map((r) => `[${r.start}, ${r.end})`)
                  .join(", ")
              : "なし（意味は全件未判定）"}
          </p>
          {visible.stopReason && (
            <p>
              停止理由: {visible.stopReason}
              。次ページも同じ上限で続行します。累積上限で進めない場合は停止のままで、自動再試行しません。
            </p>
          )}
          <details>
            <summary>
              保存済みペア（全{visible.results.length}件、先頭32件を表示）
            </summary>
            <ol>
              {visible.results.slice(0, 32).map((r) => (
                <li key={`${r.leftId}|${r.rightId}`}>
                  {r.leftId} / {r.rightId}: 意味未判定（hold）
                </li>
              ))}
            </ol>
          </details>
        </div>
      )}
      {busy ? (
        <button onClick={() => controller.current?.abort()}>
          台帳処理を取り消す
        </button>
      ) : (
        <button
          disabled={
            !current ||
            !project.saved ||
            !!scopeError ||
            !!error ||
            visible?.status === "complete"
          }
          onClick={start}
        >
          {visible?.status === "partial"
            ? "保存済みペアの次ページへ"
            : record
              ? "保存済みchunkから台帳を再開"
              : "意味解析なしで台帳を開始"}
        </button>
      )}
      {!busy && current && (record || error) && (
        <button
          onClick={async () => {
            try {
              await withAnalysisOwnership(() => clearLocalRun(id));
              setRunError("");
              setRecord(undefined);
              setResult(undefined);
              setError("");
              refresh((n) => n + 1);
            } catch (e) {
              setError(String(e));
            }
          }}
        >
          台帳checkpointを破棄して最初から
        </button>
      )}
      {(error || runError || record?.error || scopeError) && (
        <p role="alert">
          {error || runError || record?.error || scopeError}
          。保存済み結果は自動削除しません。
        </p>
      )}
    </section>
  );
}
