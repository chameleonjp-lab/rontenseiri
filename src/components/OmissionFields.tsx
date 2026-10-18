import type { Omission } from "../domain/types";

type Props = {
  value: Omission[] | undefined;
  onChange: (value: Omission[] | undefined) => void;
  legend?: string;
};

const newId = () =>
  `omission-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** Controlled fields for user-reported omissions; undefined means unreported. */
export default function OmissionFields({
  value,
  onChange,
  legend = "利用者が報告した欠落",
}: Props) {
  const update = (id: string, field: keyof Omission, next: string) =>
    onChange(
      (value ?? []).map((item) =>
        item.id === id ? { ...item, [field]: next } : item,
      ),
    );
  const add = () =>
    onChange([
      ...(value ?? []),
      { id: newId(), description: "", reason: "", location: "" },
    ]);
  const remove = (id: string) =>
    onChange((value ?? []).filter((item) => item.id !== id));

  return (
    <fieldset aria-label={legend}>
      <legend>{legend}</legend>
      <p>
        ここでの欠落は、利用者が入力の外部にあると報告した内容です。原文位置やソース範囲は推測しません。
        欠落の申告がないことは、欠落がないことの証明ではありません。
      </p>
      {value === undefined ? (
        <p role="status">未申告（欠落がないことを意味しません）</p>
      ) : value.length === 0 ? (
        <p role="status">報告された項目はありません</p>
      ) : (
        <ol aria-label="利用者が報告した欠落の一覧">
          {value.map((item, index) => (
            <li key={item.id}>
              <fieldset>
                <legend>欠落申告 {index + 1}</legend>
                <label className="field">
                  内容
                  <textarea
                    required
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
                    required
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
        {value !== undefined && (
          <button type="button" onClick={() => onChange(undefined)}>
            未申告に戻す
          </button>
        )}
      </div>
    </fieldset>
  );
}
