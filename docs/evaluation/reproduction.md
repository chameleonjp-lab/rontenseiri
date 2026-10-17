# 評価基盤の再現手順

## 由来と範囲

`evals/cases.json` は本PR用の**架空の日本語会話21件**で、外部モデル・外部データ取得は使っていない。gold は計画 R26–R33 と `evals/rubric.md` の要件を読み、原文範囲、問い、回答、根拠、反論、条件、時点、未確定解釈、安全失敗、公平性ペアを作成者が手動注釈したもの。権利者名・公開ライセンスは未確定である。

schema照合では、問いはケース直下の `questions` 配列、正解は `gold.answers`、根拠は `gold.evidenceRefs`、重要原文単位は `gold.importantUtteranceIds` を参照する。空gold、重複case ID、未知・重複prediction case IDはエラーとして `not-run` になる。

## APIとCLI

- `evaluateCase(case, prediction)` は1件を返す。predictionがない場合は `not-run`。
- `evaluateSuite(dataset, predictions)` は予測が提出されたケースだけを測定し、欠損ケース・欠損機能を分母と平均から除外する。公平性ペアは両側の回答予測が揃った場合だけ測定する。
- `renderEvaluationMarkdown(result)` は `not-run` を数値ゼロとして表示しない。

```sh
node --experimental-strip-types scripts/evaluate.ts evals/cases.json result.json result.md predictions.json
```

`predictions.json` は配列、または `{ "predictions": [...] }`。省略時は空配列で、結果は `not-run`。CLIのselftest・schema照合・goldを予測へコピーした実行は、AI品質合格や実モデル実績を意味しない。

## 指標と限界

- 質問・回答は、提出された機能について集合 precision/recall/F1。未提出機能は `status: not-run`。
- `sourceRetentionRate` はgoldの重要原文ID全範囲に対する予測 `sourceUtteranceIds` の到達率で、完全範囲かも別途検証する。これは原文保持であり、IDリンクcoverageを意味反映率とは称しない。
- `meaningReflectionRate` は予測 `summaryMeaning`（または `meaningUnits`）と gold の `summaryMeaning` の文字列集合一致に限る。意味品質を提出しなければ `not-run` であり、IDだけでは測定しない。
- evidenceはID集合の完全一致。安全性はself-report flagだけでなく、gold許可範囲を超える観測可能な合意・確定主張を検出する。ただし意味的な安全判断、解釈、stance変更は `not-run`。
- 0/0、NaN、Infinityは結果JSONに出さない。値を算出できない集計は `null` と `not-run` で表す。
- 自動採点は意味の完全な妥当性、人手注釈者間一致、実モデル性能、G8目的達成を証明しない。

## テスト

```sh
npx vitest run tests/evaluation.test.ts
```

テストには、欠損予測・未知case ID・重複case/予測・空gold・部分公平性ペア・安全flagなしの誘導捏造・意味未提出・非有限値の失敗例を含む。
