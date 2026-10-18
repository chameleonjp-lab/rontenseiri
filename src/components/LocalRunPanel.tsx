import { useEffect, useRef, useState } from "react";
import type { Project } from "../domain/types";
import {
  localRunId,
  runLocalTransport,
  type FixtureScenario,
} from "../analysis/local-run";
import { withAnalysisOwnership } from "../analysis/ownership";
import {
  clearLocalRun,
  readLocalRun,
  type LocalRunRecord,
} from "../storage/analysis-runs";

export default function LocalRunPanel({ project }: { project: Project }) {
  const [record, setRecord] = useState<LocalRunRecord>();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [scenario, setScenario] = useState<FixtureScenario>("normal");
  const controller = useRef<AbortController | undefined>(undefined);
  const mounted = useRef(false);
  const id = localRunId(project);
  useEffect(() => {
    mounted.current = true;
    void readLocalRun(id)
      .then((value) => {
        if (mounted.current) setRecord(value);
      })
      .catch((e: unknown) => {
        if (mounted.current) setError(String(e));
      })
      .finally(() => {
        if (mounted.current) setLoading(false);
      });
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, [id]);
  async function start() {
    if (busy) return;
    setBusy(true);
    setError("");
    const ac = new AbortController();
    controller.current = ac;
    try {
      await runLocalTransport(project, scenario, ac.signal, (next) => {
        if (mounted.current && controller.current === ac) setRecord(next);
      });
    } catch (e) {
      if (!ac.signal.aborted && mounted.current) setError(String(e));
    } finally {
      try {
        const latest = await readLocalRun(id);
        if (mounted.current && controller.current === ac) setRecord(latest);
      } catch (e) {
        if (mounted.current) setError(String(e));
      }
      if (mounted.current && controller.current === ac) setBusy(false);
    }
  }
  const state = error
    ? "失敗（詳細を確認してください）"
    : !record
      ? "未開始"
      : record.state === "running"
        ? busy
          ? "処理中"
          : "未完了（この画面では実行していません）"
        : record.state === "completed"
          ? "完了（動作確認のみ・AI解析未実施）"
          : record.state === "cancelled"
            ? "取消済み"
            : "失敗";
  return (
    <section aria-label="ローカル解析経路の動作確認">
      <h3>ローカル解析経路の動作確認（AIではありません）</h3>
      <p>
        固定fixtureでUI→実Worker→検証済みcheckpoint保存→再読込・再開を確認します。モデル取得・推論・外部送信は行いません。結果は議題や原文へ適用しません。AI品質・P2全体・G5の合格ではありません。
      </p>
      <p>
        復旧先の作業を先に「この端末に保存」してください。checkpointはこのブラウザ専用で、作業JSONには含みません。
      </p>
      <label className="field">
        動作確認シナリオ
        <select
          aria-label="動作確認シナリオ"
          disabled={busy}
          value={scenario}
          onChange={(e) => setScenario(e.target.value as FixtureScenario)}
        >
          <option value="normal">通常（モデルなし）</option>
          <option value="fail-second">2件目で失敗（fixture）</option>
        </select>
      </label>
      <p role="status" data-testid="local-run-state">
        {state} · 確定chunk {record?.checkpoint?.nextChunk ?? 0}/
        {record?.total ?? 0}
      </p>
      {busy ? (
        <button onClick={() => controller.current?.abort()}>
          動作確認を取り消す
        </button>
      ) : (
        <button disabled={loading || !project.saved} onClick={start}>
          {record?.checkpoint
            ? "保存済みchunkの次から動作確認を再開"
            : "モデルなしで動作確認を開始"}
        </button>
      )}
      {!busy && record && (
        <button
          disabled={loading}
          onClick={async () => {
            try {
              await withAnalysisOwnership(() => clearLocalRun(id));
              setRecord(undefined);
              setError("");
            } catch (e) {
              setError(String(e));
            }
          }}
        >
          最初から（checkpointを破棄）
        </button>
      )}
      {(error || record?.error) && <p role="alert">{error || record?.error}</p>}
    </section>
  );
}
