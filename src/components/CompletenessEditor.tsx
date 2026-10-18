import { useEffect, useState } from "react";
import type { Extent, Omission, Project } from "../domain/types";
import { labels } from "../domain/types";
import { reviseCompleteness } from "../domain/completeness";

type Props = {
  project: Project;
  onUpdate: (project: Project) => void;
  onError: (message: string) => void;
};

const newId = () =>
  `omission-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const copy = <T,>(value: T): T => structuredClone(value);

/** Edits only local drafts until the user explicitly saves this completeness record. */
export default function CompletenessEditor({
  project,
  onUpdate,
  onError,
}: Props) {
  const [extent, setExtent] = useState<Extent>(project.extent);
  const [omissions, setOmissions] = useState<Omission[] | undefined>(() =>
    Object.prototype.hasOwnProperty.call(project, "omissions")
      ? copy(project.omissions)
      : undefined,
  );
  const [reason, setReason] = useState("");

  const reportSignature = JSON.stringify(project.omissions);
  useEffect(() => {
    setExtent(project.extent);
    setOmissions(
      Object.prototype.hasOwnProperty.call(project, "omissions")
        ? copy(project.omissions)
        : undefined,
    );
  }, [project.id, project.extent, reportSignature]);

  const update = (id: string, field: keyof Omission, value: string) =>
    setOmissions((current) =>
      (current ?? []).map((item) =>
        item.id === id ? { ...item, [field]: value } : item,
      ),
    );
  const add = () =>
    setOmissions((current) => [
      ...(current ?? []),
      { id: newId(), description: "", reason: "", location: "" },
    ]);
  const remove = (id: string) =>
    setOmissions((current) => (current ?? []).filter((item) => item.id !== id));

  return (
    <section
      aria-labelledby="completeness-editor-title"
      className="completeness-editor"
    >
      <h2 id="completeness-editor-title">記録範囲と欠落申告</h2>
      <p>
        ここでの欠落は、利用者が入力の外部にあると報告した内容です。原文位置やソース範囲は推測しません。
        欠落の申告がないことは、欠落がないことの証明ではありません。
      </p>
      <label className="field" htmlFor="project-extent">
        記録範囲
        <select
          id="project-extent"
          aria-label="記録範囲"
          value={extent}
          onChange={(event) => setExtent(event.target.value as Extent)}
        >
          {(Object.keys(labels.extent) as Extent[]).map((value) => (
            <option key={value} value={value}>
              {labels.extent[value]}
            </option>
          ))}
        </select>
      </label>
      <h3>利用者が報告した欠落</h3>
      {omissions === undefined ? (
        <p role="status">未申告（欠落がないことを意味しません）</p>
      ) : omissions.length === 0 ? (
        <p role="status">
          報告された項目はありません（会話全体の完了を証明しません）
        </p>
      ) : (
        <ol aria-label="利用者が報告した欠落の一覧">
          {omissions.map((item, index) => (
            <li key={item.id}>
              <fieldset>
                <legend>欠落申告 {index + 1}</legend>
                <label className="field">
                  内容
                  <textarea
                    aria-label={`欠落申告${index + 1}の内容`}
                    value={item.description}
                    onChange={(e) =>
                      update(item.id, "description", e.target.value)
                    }
                  />
                </label>
                <label className="field">
                  理由
                  <textarea
                    aria-label={`欠落申告${index + 1}の理由`}
                    value={item.reason}
                    onChange={(e) => update(item.id, "reason", e.target.value)}
                  />
                </label>
                <label className="field">
                  位置（任意。推測せず利用者の記述のみ）
                  <input
                    aria-label={`欠落申告${index + 1}の位置`}
                    value={item.location ?? ""}
                    onChange={(e) =>
                      update(item.id, "location", e.target.value)
                    }
                  />
                </label>
                <button type="button" onClick={() => remove(item.id)}>
                  この申告を削除
                </button>
              </fieldset>
            </li>
          ))}
        </ol>
      )}
      <div className="form-row">
        <button type="button" onClick={add}>
          欠落申告を追加
        </button>
        {omissions !== undefined && (
          <button type="button" onClick={() => setOmissions(undefined)}>
            未申告に戻す
          </button>
        )}
      </div>
      <label className="field" htmlFor="completeness-reason">
        この変更を適用する理由
        <input
          id="completeness-reason"
          aria-label="この変更を適用する理由"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <button
        type="button"
        onClick={() => {
          try {
            onUpdate(reviseCompleteness(project, extent, omissions, reason));
          } catch (error) {
            onError(String(error));
          }
        }}
      >
        記録範囲と欠落申告を保存
      </button>
    </section>
  );
}
