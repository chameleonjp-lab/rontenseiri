import { useRef, useState, type FormEvent } from "react";
import type { Project } from "../domain/types";
import { useDraftGuard } from "./draft-guard";
import "./manual-interpretations.css";
import {
  saveManualInterpretationPair,
  retractManualInterpretationCandidate,
} from "../domain/manual-interpretations";

const alternative = () => ({
  id: undefined as string | undefined,
  premise: "",
  conclusion: "",
  evidenceIds: [] as string[],
  dependentConclusionIds: [] as string[],
});
const empty = () => ({
  groupId: "",
  questionVersionId: "",
  reason: "",
  alternatives: [alternative(), alternative()] as [
    ReturnType<typeof alternative>,
    ReturnType<typeof alternative>,
  ],
});
const toggle = (ids: string[], id: string) =>
  ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];

type Props = {
  project: Project;
  onUpdate: (project: Project) => void;
  onSelect: (id: string) => void;
};

export default function ManualInterpretations({
  project,
  onUpdate,
  onSelect,
}: Props) {
  const [draft, setDraft] = useState(empty);
  const [baseline, setBaseline] = useState(JSON.stringify(empty()));
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const status = useRef<HTMLParagraphElement>(null);
  const versionInput = useRef<HTMLSelectElement>(null);
  const dirty = JSON.stringify(draft) !== baseline;
  useDraftGuard(dirty, "view");
  const graph = project.reasoning;
  const items = graph?.items ?? [];
  const allGroups = graph?.exclusiveGroups ?? [];
  const groups = allGroups.filter((group) => {
    const candidates = group.interpretationIds.map((id) =>
      graph?.interpretations.find((item) => item.id === id),
    );
    return (
      candidates.length === 2 &&
      candidates.every(
        (candidate) =>
          candidate &&
          (candidate as typeof candidate & { manualExclusive?: boolean })
            .manualExclusive === true &&
          (candidate.certainty === "uncertain" ||
            candidate.certainty === "retracted") &&
          candidate.questionVersionId === candidates[0]?.questionVersionId &&
          candidate.premiseItemIds.length === 1 &&
          candidate.conclusionItemIds.length === 1 &&
          [...candidate.premiseItemIds, ...candidate.conclusionItemIds].every(
            (id) => items.some((item) => item.id === id),
          ),
      )
    );
  });
  const evidence = graph?.evidence ?? [];
  const patch = (
    index: number,
    value: Partial<ReturnType<typeof alternative>>,
  ) =>
    setDraft((old) => ({
      ...old,
      alternatives: old.alternatives.map((a, i) =>
        i === index ? { ...a, ...value } : a,
      ) as typeof old.alternatives,
    }));
  const reset = () => {
    const next = empty();
    setDraft(next);
    setBaseline(JSON.stringify(next));
  };
  function report(text: string) {
    setError("");
    setMessage(text);
    requestAnimationFrame(() => status.current?.focus());
  }
  function load(groupId: string) {
    if (
      dirty &&
      !window.confirm(
        "候補ペアの未保存の下書きを破棄して比較対象を開きますか？",
      )
    )
      return;
    const group = groups.find((g) => g.id === groupId);
    if (!group || group.interpretationIds.length !== 2) return;
    const candidates = group.interpretationIds.map((id) =>
      graph!.interpretations.find((i) => i.id === id)!,
    );
    if (
      candidates.some(
        (c) =>
          c.premiseItemIds.length !== 1 || c.conclusionItemIds.length !== 1,
      )
    ) {
      setError(
        "このグループは手動ペア編集の対象外です。元データを保持しています。",
      );
      return;
    }
    const next = {
      groupId,
      questionVersionId: candidates[0].questionVersionId,
      reason: "",
      alternatives: candidates.map((candidate) => {
        const premise = items.find(
          (item) => item.id === candidate.premiseItemIds[0],
        )!;
        const conclusion = items.find(
          (item) => item.id === candidate.conclusionItemIds[0],
        )!;
        return {
          id: candidate.id,
          premise: premise.text,
          conclusion: conclusion.text,
          evidenceIds: [...premise.evidenceIds],
          dependentConclusionIds: (graph?.uncertaintyPropagation ?? [])
            .filter(
              (link) =>
                link.fromItemId === conclusion.id &&
                link.toItemId !== conclusion.id,
            )
            .map((link) => link.toItemId),
        };
      }) as typeof draft.alternatives,
    };
    setDraft(next);
    setBaseline(JSON.stringify(next));
    setMessage("比較対象を開きました。選択は採用・確認ではありません。");
    setError("");
    requestAnimationFrame(() => versionInput.current?.focus());
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const result = saveManualInterpretationPair(project, {
        ...draft,
        groupId: draft.groupId || undefined,
      });
      onUpdate(result);
      reset();
      report("A/Bと排他関係を一括保存しました。両方とも未確定です。");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  function retract(index: number) {
    try {
      const group = groups.find((g) => g.id === draft.groupId);
      if (!group) throw Error("比較・修正するグループを開いてください");
      const original = JSON.parse(baseline) as typeof draft;
      if (
        JSON.stringify(draft.alternatives) !==
        JSON.stringify(original.alternatives)
      )
        throw Error(
          "前提・結論・依存先の下書きがあります。撤回する前にペアを保存するか、下書きを明示的に破棄してください",
        );
      const result = retractManualInterpretationCandidate(
        project,
        group.interpretationIds[index],
        draft.reason,
      );
      onUpdate(result);
      reset();
      report(
        `${index === 0 ? "A" : "B"}を撤回しました。もう一方の候補を採用していません。排他関係と履歴は保持しています。`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <section
      className="reasoning-section manual-interpretations"
      aria-label="手動の排他解釈"
    >
      <h3>手動の排他解釈 A/B</h3>
      <p>
        手動で登録した未確定候補。前提・結論・根拠を比較するための記録です。強調・選択・原文表示は採用や確認を意味しません。AIは使用しません。
      </p>
      <p
        role={message ? "status" : undefined}
        aria-live="polite"
        tabIndex={-1}
        ref={status}
      >
        {message}
      </p>
      {groups.length !== allGroups.length && (
        <p role="alert">
          手動A/B形式ではない排他グループがあります。この編集欄では確定状態を表示・変更できません。元の候補と関係は完全JSONに保持しています。
        </p>
      )}
      {error && (
        <p role="alert">
          {error}（保存済みデータは変更せず、下書きを保持しています）
        </p>
      )}
      {groups.map((group) => (
        <article className="reasoning-card" key={group.id}>
          <h4>排他グループ {group.id}</h4>
          <p>同時に確定できない解釈です。採用はしていません。</p>
          <div className="manual-pair-columns">
            {group.interpretationIds.map((id, index) => {
              const candidate = graph!.interpretations.find(
                (i) => i.id === id,
              )!;
              const label = index === 0 ? "A" : "B";
              const premise = items.filter((item) =>
                candidate.premiseItemIds.includes(item.id),
              );
              const conclusions = items.filter((item) =>
                candidate.conclusionItemIds.includes(item.id),
              );
              const dependentIds = (graph?.uncertaintyPropagation ?? [])
                .filter((link) =>
                  candidate.conclusionItemIds.includes(link.fromItemId),
                )
                .map((link) => link.toItemId);
              const sourceIds = [
                ...new Set(
                  [...premise, ...conclusions]
                    .flatMap((item) => item.evidenceIds)
                    .flatMap(
                      (eId) =>
                        evidence.find((e) => e.id === eId)?.utteranceIds ?? [],
                    ),
                ),
              ];
              return (
                <section
                  key={id}
                  aria-label={`保存済み候補${label}`}
                  className="reasoning-card"
                >
                  <h4>
                    {label} ·{" "}
                    {candidate.certainty === "retracted"
                      ? "撤回済み（未採用）"
                      : "手動で登録した未確定候補"}
                  </h4>
                  <p>対象問い版: {candidate.questionVersionId}</p>
                  <p>前提: {premise.map((item) => item.text).join(" / ")}</p>
                  <p>
                    結論: {conclusions.map((item) => item.text).join(" / ")}
                  </p>
                  <p>
                    依存する結論:{" "}
                    {dependentIds.length
                      ? dependentIds
                          .map(
                            (id) =>
                              `${items.find((item) => item.id === id)?.text} (${id})`,
                          )
                          .join(" / ")
                      : "明示指定なし"}{" "}
                    · 要再確認
                  </p>
                  <div className="reasoning-actions">
                    {sourceIds.map((id) => (
                      <button
                        type="button"
                        key={id}
                        onClick={() => onSelect(id)}
                      >
                        {label}の原文 {id}へ
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
          <button type="button" onClick={() => load(group.id)}>
            比較・修正 {group.id}
          </button>
        </article>
      ))}
      <form className="reasoning-form" onSubmit={submit}>
        <h4>
          {draft.groupId ? `ペアの修正 ${draft.groupId}` : "未確定ペアを作成"}
        </h4>
        <label>
          候補の対象問い版
          <select
            ref={versionInput}
            value={draft.questionVersionId}
            onChange={(event) =>
              setDraft({ ...draft, questionVersionId: event.target.value })
            }
            required
            disabled={Boolean(draft.groupId)}
          >
            <option value="">明示選択してください</option>
            {(graph?.questionVersions ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {v.text} ({v.id} / {v.status})
              </option>
            ))}
          </select>
        </label>
        <div className="manual-pair-columns">
          {draft.alternatives.map((value, index) => {
            const label = index === 0 ? "A" : "B";
            return (
              <fieldset key={label} className="reasoning-card">
                <legend>{label} · 未確定（確認・採用操作なし）</legend>
                <label>
                  {label}の前提
                  <textarea
                    required
                    value={value.premise}
                    onChange={(event) =>
                      patch(index, { premise: event.target.value })
                    }
                  />
                </label>
                <label>
                  {label}の結論
                  <textarea
                    required
                    value={value.conclusion}
                    onChange={(event) =>
                      patch(index, { conclusion: event.target.value })
                    }
                  />
                </label>
                <fieldset className="reasoning-checks">
                  <legend>{label}の明示根拠</legend>
                  {evidence.map((item) => (
                    <label key={item.id}>
                      <input
                        type="checkbox"
                        checked={value.evidenceIds.includes(item.id)}
                        onChange={() =>
                          patch(index, {
                            evidenceIds: toggle(value.evidenceIds, item.id),
                          })
                        }
                      />
                      {item.id}: {item.note || "根拠"}（発言{" "}
                      {item.utteranceIds.join(", ")}）
                    </label>
                  ))}
                  {!evidence.length && (
                    <p>先に「根拠を記録」で原文の根拠を登録してください。</p>
                  )}
                </fieldset>
                <fieldset className="reasoning-checks">
                  <legend>{label}の依存結論</legend>
                  {items
                    .filter(
                      (item) =>
                        !graph?.interpretations.some((i) =>
                          [
                            ...i.premiseItemIds,
                            ...i.conclusionItemIds,
                          ].includes(item.id),
                        ),
                    )
                    .map((item) => (
                      <label key={item.id}>
                        <input
                          type="checkbox"
                          checked={value.dependentConclusionIds.includes(
                            item.id,
                          )}
                          onChange={() =>
                            patch(index, {
                              dependentConclusionIds: toggle(
                                value.dependentConclusionIds,
                                item.id,
                              ),
                            })
                          }
                        />
                        {item.text} ({item.id})
                      </label>
                    ))}
                  <small>
                    この候補に依存する既存の結論だけを明示指定。無関係な結論には伝播しません。
                  </small>
                </fieldset>
                {draft.groupId && (
                  <button type="button" onClick={() => retract(index)}>
                    {label}を撤回
                  </button>
                )}
              </fieldset>
            );
          })}
        </div>
        <label>
          候補の変更理由
          <input
            required
            value={draft.reason}
            onChange={(event) =>
              setDraft({ ...draft, reason: event.target.value })
            }
          />
        </label>
        <button type="submit" className="primary">
          A/Bを一括保存
        </button>
        <button
          type="button"
          onClick={() => {
            if (!dirty || window.confirm("候補ペアの下書きを破棄しますか？")) {
              reset();
              setError("");
              setMessage("候補ペアの下書きだけを破棄しました");
            }
          }}
        >
          候補ペアの下書きを破棄
        </button>
        <small>
          保存はプロジェクトへの一括反映です。端末への永続化には「この端末に保存」を使用。撤回・修正は共通の訂正履歴から1回のUndoで戻せます。
        </small>
      </form>
    </section>
  );
}
