import CompletenessEditor from "./CompletenessEditor";
import { useState } from "react";
import type { Project } from "../domain/types";
import { labels } from "../domain/types";
import { activeSources, projectCapacity } from "../domain/capacity";
import { auditSourceCoverage, classifySourceRange } from "../domain/coverage";
import { useFormDraftGuard } from "./draft-guard";
const names = {
  utterance: "発言",
  metadata: "非発言情報",
  excluded: "対象外（理由あり）",
  unclassified: "未確定・要確認",
};
export default function CoveragePanel({
  project,
  onUpdate,
  onError,
  onSelect,
}: {
  project: Project;
  onUpdate: (p: Project) => void;
  onError: (s: string) => void;
  onSelect: (id: string) => void;
}) {
  const [pages, setPages] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const markApplied = useFormDraftGuard(reason, "view");
  const capacity = projectCapacity(project);
  return (
    <section className="reading-view coverage-panel">
      <div className="eyebrow">SOURCE COVERAGE</div>
      <h1>原文を、抜けなくたどる。</h1>
      <p>
        発言になる前の文字も、発言・非発言・対象外・未確定へ対応させます。処理が完了しても、記録範囲が全文であることや意味の反映は保証しません。
      </p>
      <CompletenessEditor
        project={project}
        onUpdate={onUpdate}
        onError={onError}
      />
      <div className="coverage-stats">
        <span>記録範囲：{labels.extent[project.extent]}</span>
        <span>
          現行入力：{capacity.activeCodePoints.toLocaleString()} / 50,000文字
        </span>
        <span>
          旧版原文：{(capacity.historyTextBytes / 1024).toFixed(1)} KiB
        </span>
        <span>
          完全バックアップ：{(capacity.backupBytes / 1024 / 1024).toFixed(2)} /
          50 MiB
        </span>
      </div>
      <label className="field">
        原文対応の理由
        <input
          aria-label="原文対応の理由"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="未確定の範囲を非発言・対象外にする理由"
        />
      </label>
      {activeSources(project).map((source) => {
        const audit = auditSourceCoverage(source, project.utterances);
        const page = pages[source.versionId] ?? 0;
        const shown = audit.spans.slice(page * 50, (page + 1) * 50);
        return (
          <article className="coverage-source" key={source.versionId}>
            <h2>{source.name}</h2>
            <p>
              {labels.role[source.role]} · {source.versionId}
            </p>
            <p className={audit.complete ? "" : "warning-text"}>
              {audit.complete
                ? "全範囲の対応を確認できます（意味品質の合格ではありません）"
                : `未確定 ${audit.pending.length}件 / 不整合 ${audit.issues.length}件。確認が必要です`}
            </p>
            {audit.issues.map((x, i) => (
              <p role="alert" key={i}>
                {x}
              </p>
            ))}
            <ol className="coverage-ranges" start={page * 50 + 1}>
              {shown.map((span) => (
                <li key={`${span.start}-${span.end}`}>
                  <div>
                    <span className="badge">{names[span.kind]}</span>{" "}
                    <small>
                      原文位置 {span.start}–{span.end}
                    </small>
                  </div>
                  <pre>{source.text.slice(span.start, span.end)}</pre>
                  <small>{span.reason}</small>
                  {span.utteranceId && (
                    <button onClick={() => onSelect(span.utteranceId!)}>
                      発言 {span.utteranceId} の原文へ
                    </button>
                  )}
                  {span.kind === "unclassified" && (
                    <div>
                      {(["metadata", "excluded"] as const).map((kind) => (
                        <button
                          key={kind}
                          onClick={() => {
                            try {
                              onUpdate(
                                classifySourceRange(
                                  project,
                                  source.versionId,
                                  span.start,
                                  span.end,
                                  kind,
                                  reason,
                                ),
                              );
                              markApplied();
                            } catch (e) {
                              onError(String(e));
                            }
                          }}
                        >
                          {kind === "metadata"
                            ? "非発言情報として記録"
                            : "対象外として理由を記録"}
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ol>
            {audit.spans.length > 50 && (
              <div className="form-row">
                <button
                  disabled={page === 0}
                  onClick={() =>
                    setPages({ ...pages, [source.versionId]: page - 1 })
                  }
                >
                  前の50件
                </button>
                <span>
                  {page * 50 + 1}–
                  {Math.min((page + 1) * 50, audit.spans.length)} /{" "}
                  {audit.spans.length}範囲
                </span>
                <button
                  disabled={(page + 1) * 50 >= audit.spans.length}
                  onClick={() =>
                    setPages({ ...pages, [source.versionId]: page + 1 })
                  }
                >
                  次の50件
                </button>
              </div>
            )}
            <details>
              <summary>抽出原文の全文を見る</summary>
              <pre>{source.text}</pre>
            </details>
          </article>
        );
      })}
    </section>
  );
}
