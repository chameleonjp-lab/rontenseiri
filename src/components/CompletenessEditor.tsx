import { useEffect, useState } from "react";
import type { Extent, Omission, Project } from "../domain/types";
import { labels } from "../domain/types";
import { reviseCompleteness } from "../domain/completeness";
import OmissionFields from "./OmissionFields";
import { useDraftGuard } from "./draft-guard";

type Props = {
  project: Project;
  onUpdate: (project: Project) => void;
  onError: (message: string) => void;
};

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
  useDraftGuard(
    extent !== project.extent ||
      JSON.stringify(omissions) !== reportSignature ||
      reason !== "",
    "view",
  );
  useEffect(() => {
    setExtent(project.extent);
    setOmissions(
      Object.prototype.hasOwnProperty.call(project, "omissions")
        ? copy(project.omissions)
        : undefined,
    );
  }, [project.id, project.extent, reportSignature]);

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
      <OmissionFields value={omissions} onChange={setOmissions} />
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
            setReason("");
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
