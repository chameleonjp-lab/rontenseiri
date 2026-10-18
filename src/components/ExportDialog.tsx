import { useEffect, useState } from "react";
import { AlertTriangle, Download } from "lucide-react";
import type { Project } from "../domain/types";
import { exportProject } from "../export/project";
interface Props {
  project: Project;
  visibleIds: string[];
  onError: (s: string) => void;
  onDone: (s: string) => void;
}
export default function ExportDialog({
  project,
  visibleIds,
  onError,
  onDone,
}: Props) {
  const [format, setFormat] = useState<"json" | "md" | "svg">("json");
  const [scope, setScope] = useState("all");
  const [pseudo, setPseudo] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [preview, setPreview] = useState("");
  useEffect(() => {
    setPreview("");
  }, [format, scope, pseudo, selectedIds, project]);
  const agenda = project.agendas.find((a) => a.id === scope);
  const available = project.utterances.filter(
    (u) => agenda?.utteranceIds.includes(u.id) && visibleIds.includes(u.id),
  );
  const hidden = (agenda?.utteranceIds.length || 0) - available.length;
  function build() {
    try {
      setPreview(
        exportProject(
          project,
          format,
          scope === "all" ? undefined : scope,
          pseudo,
          scope === "all" ? undefined : selectedIds,
        ),
      );
    } catch (e) {
      onError(String(e));
    }
  }
  function save() {
    const url = URL.createObjectURL(
      new Blob([preview], {
        type: format === "svg" ? "image/svg+xml" : "text/plain;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `rontenseiri-${scope === "all" ? "backup" : scope}.${format === "json" ? "rontenseiri.json" : format}`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    onDone("ダウンロードを開始しました。保存先のファイルをご確認ください。");
  }
  return (
    <>
      <div className="eyebrow">KEEP YOUR WORK</div>
      <h2>自分の資料として、持ち出す。</h2>
      <p className="muted">
        外部AIへの自動送信はありません。出力内容を自分で確認してから持ち出します。
      </p>
      <label className="field">
        出力範囲
        <select
          aria-label="出力範囲"
          value={scope}
          onChange={(e) => {
            setScope(e.target.value);
            setSelectedIds([]);
          }}
        >
          <option value="all">全体 — 原文・旧版・履歴を含む</option>
          {project.agendas.map((a) => (
            <option key={a.id} value={a.id}>
              {a.id}｜{a.title} — 発言を選択
            </option>
          ))}
        </select>
      </label>
      {scope !== "all" && (
        <fieldset className="export-selection">
          <legend>出力する発言を明示選択</legend>
          <p className="fineprint">
            未選択の発言・議題全体のまとめ・旧版・履歴は含めません。
            {hidden > 0 &&
              `折り畳み中の${hidden}件も対象外です。必要なら図で枝を開いてからやり直してください。`}
          </p>
          {available.map((u) => (
            <label className="export-utterance" key={u.id}>
              <input
                type="checkbox"
                aria-label={`${u.id}を出力に含める`}
                checked={selectedIds.includes(u.id)}
                onChange={(e) =>
                  setSelectedIds(
                    e.target.checked
                      ? [...selectedIds, u.id]
                      : selectedIds.filter((id) => id !== u.id),
                  )
                }
              />
              <span>
                <strong>
                  {u.id} · {u.speaker}
                </strong>
                <span>{u.quote}</span>
              </span>
            </label>
          ))}
          <p aria-live="polite">選択中：{selectedIds.length}件</p>
        </fieldset>
      )}
      <label className="field">
        形式
        <select
          aria-label="形式"
          value={format}
          onChange={(e) => setFormat(e.target.value as typeof format)}
        >
          <option value="json">
            JSON — 全体なら完全復元・限定なら別コピー
          </option>
          <option value="md">Markdown — 閲覧用資料</option>
          <option value="svg">SVG — 静的な図</option>
        </select>
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={pseudo}
          onChange={(e) => setPseudo(e.target.checked)}
        />
        人物ラベルを仮名化
      </label>
      <div className="export-warning">
        <AlertTriangle size={17} />
        <p>
          {scope === "all" && format === "json"
            ? "完全バックアップには原文・旧版・履歴が含まれます。"
            : "限定出力は選んだ発言だけです。完全な作業の控えにはなりません。"}{" "}
          仮名化しても原文中の名前・引用・URLは残ります。再特定を完全には防げません。
        </p>
      </div>
      <button
        className="full"
        disabled={scope !== "all" && !selectedIds.length}
        onClick={build}
      >
        出力内容をプレビュー
      </button>
      {preview && (
        <>
          <pre className="export-preview">{preview}</pre>
          <button className="primary full" onClick={save}>
            <Download size={17} />
            確認した内容をダウンロード
          </button>
        </>
      )}
    </>
  );
}
