import { useEffect, useState } from "react";
import type { Project } from "../domain/types";
import { projectCapacity } from "../domain/capacity";
import { downloadDiagnosticLog, summarizeMetric } from "../diagnostics";
import {
  prepareOffline,
  readOfflineReadiness,
  type OfflineReadiness,
} from "../diagnostics/offline";
import "./readiness.css";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

export default function ReadinessPanel({
  project,
  onError,
}: {
  project: Project;
  onError: (message: string) => void;
}) {
  const capacity = projectCapacity(project);
  const storage =
    typeof indexedDB !== "undefined" ? "利用可能（ブラウザ依存）" : "利用不可";
  const [offline, setOffline] = useState<OfflineReadiness | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    readOfflineReadiness()
      .then(setOffline)
      .catch(() => undefined);
  }, []);

  const prepare = async () => {
    setChecking(true);
    const result = await prepareOffline();
    setOffline(result);
    setChecking(false);
    if (result.error && !result.ready) onError(result.error);
  };
  const save = () => {
    try {
      downloadDiagnosticLog([
        "AIはdisabled。モデルのオフライン性能・実機品質は未評価。",
        "独自オリジンは未確定。DB名だけでは同一origin他アプリとの完全隔離を保証しない。",
        offline?.status
          ? `静的shell ${formatBytes(offline.status.bytes)} / ${offline.status.entries} entries`
          : "offline shell未確認",
      ]);
    } catch (e) {
      onError(String(e));
    }
  };
  const metrics = ["input", "output", "save", "restore"].map(
    (name) => [name, summarizeMetric(name)] as const,
  );
  const production = import.meta.env.PROD;
  return (
    <section className="readiness-panel" aria-label="準備状況">
      <h2>準備状況</h2>
      <dl>
        <div>
          <dt>ローカル容量</dt>
          <dd>
            {(capacity.backupBytes / 1024 / 1024).toFixed(2)} / 50 MiB（残り{" "}
            {(capacity.remainingBytes / 1024 / 1024).toFixed(2)} MiB）
          </dd>
        </div>
        <div>
          <dt>IndexedDB</dt>
          <dd>{storage}</dd>
        </div>
      </dl>
      <div className="offline-readiness" aria-live="polite">
        <h3>オフライン静的shell</h3>
        {!production ? (
          <p>
            開発モードではService Workerを登録しません。production build（vite
            preview）で確認してください。
          </p>
        ) : (
          <>
            <button type="button" onClick={prepare} disabled={checking}>
              {checking ? "確認中…" : "オフライン準備を確認"}
            </button>
            {offline?.ready && offline.status ? (
              <p className="readiness-ok">
                準備完了：{offline.status.entries}件 /{" "}
                {formatBytes(offline.status.bytes)}。scope: {offline.scope}
              </p>
            ) : offline?.registered ? (
              <p className="readiness-warning">
                登録済みですが未完了：
                {offline.error || "precacheを確認できません"}
              </p>
            ) : (
              <p>明示ボタンを押すまで登録・precacheしません。</p>
            )}
            {offline?.status?.failures.length ? (
              <ul className="readiness-errors">
                {offline.status.failures.map((failure) => (
                  <li key={failure}>{failure}</li>
                ))}
              </ul>
            ) : null}
          </>
        )}
        <small>
          保存対象はproduction
          manifestのindex・静的JS/CSS/workerだけです。会話本文、IndexedDB、JSON/API、他アプリ経路、AIモデルはCacheへ保存しません。
        </small>
      </div>
      <p className="readiness-warning">
        性能・実機品質・独自オリジン分離は未評価です。AIはオフラインモデルを提供せず、AI
        disabledを維持します。
      </p>
      <h3>工程メトリクス（外部送信なし）</h3>
      <ul>
        {metrics.map(([name, s]) => (
          <li key={name}>
            {name}:{" "}
            {s.count
              ? `${s.count} samples / median ${s.median!.toFixed(1)}ms / p95 ${s.p95!.toFixed(1)}ms`
              : "未計測"}
          </li>
        ))}
      </ul>
      <button type="button" onClick={save}>
        本文なし診断ログをダウンロード
      </button>
      <small>
        静的診断情報と工程時間のみ。メモリ使用量は推測せず記録しません。
      </small>
    </section>
  );
}
