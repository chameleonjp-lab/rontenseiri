# 評価基盤の再現手順

## 由来と範囲

`evals/cases.json` は本PR用の**架空の日本語会話21件**で、外部モデル・外部データ取得は使っていない。gold は計画 R26–R33 と `evals/rubric.md` の要件を読み、原文範囲、問い、回答、根拠、反論、条件、時点、未確定解釈、安全失敗、公平性ペアを作成者が手動注釈したもの。権利者名・公開ライセンスは未確定である。

schema照合では、問いはケース直下の `questions` 配列、正解は `gold.answers`、根拠は `gold.evidenceRefs`、重要原文単位は `gold.importantUtteranceIds` を参照する。空gold、重複case ID、未知・重複prediction case IDはエラーとして `not-run` になる。

## APIとCLI

- `evaluateCase(case, prediction)` は1件を返す。predictionがない場合は `not-run`。
- `evaluateSuite(dataset, predictions)` は予測が提出されたケースだけを測定し、欠損ケース・欠損機能を分母と平均から除外する。公平性ペアは両側の回答予測が揃った場合だけ測定する。
- `renderEvaluationMarkdown(result)` は `not-run` を数値ゼロとして表示しない。

出力契約は `evaluation-result-v3`。旧v2の `features.meaningReflectionRate` と `aggregate.meaningReflectionRate` は廃止し、代理指標であることが分かる `meaningGoldRecall` に変更した。v2の値はF1であり、v3のrecallと同じ系列として比較しない。補助F1は各caseの `features.meaningGoldRecall.f1` と集計の `aggregate.meaningGoldF1` に残す。新しい結果を読む外部コードはフィールド名と評価結果の版を更新する必要がある。製品プロジェクトの保存JSON・評価入力case・予測入力のschemaは変更していない。過去の評価証拠は書き換えず、再実行は新しい出力先に保存する。

```sh
node --experimental-strip-types scripts/evaluate.ts evals/cases.json result.json result.md predictions.json
```

`predictions.json` は配列、または `{ "predictions": [...] }`。省略時は空配列で、結果は `not-run`。CLIのselftest・schema照合・goldを予測へコピーした実行は、AI品質合格や実モデル実績を意味しない。

## 指標と限界

- 質問・回答は、提出された機能について集合 precision/recall/F1。未提出機能は `status: not-run`。質問・回答・根拠の共通F1は `2 × 一致数 / (gold集合件数 + 予測集合件数)` とし、非空の完全不一致やgoldがある場合の空予測は0。goldと予測がともに空ならF1の分母がないため `null`、機能の状態は `not-run` とする。空集合同士を満点として平均へ加えない。
- `sourceRetentionRate` はgoldの重要原文ID全範囲に対する予測 `sourceUtteranceIds` の到達率で、完全範囲かも別途検証する。これは原文保持であり、IDリンクcoverageを意味反映率とは称しない。
- `meaningGoldRecall` は予測 `summaryMeaning`（または `meaningUnits`）とgoldの `summaryMeaning` の文字列集合一致に限った再現率の代理指標。`value` と `recall` は一致gold単位数／gold単位総数で、precision・F1は別の補助値として残す。重複文字列は1単位として数え、余分な予測はrecallではなくprecision・F1に影響する。goldが2単位で1単位だけ一致した場合はrecall=0.5、F1=2/3となる。
- 意味の予測を提出していない場合、またはgold意味単位がない場合は `not-run`。goldがあり、空の予測配列を提出した場合は未測定ではなくrecall=0。集計の `meaningGoldRecall` は測定したcaseのrecallの単純平均で、F1を優先して参照しない。補助 `meaningGoldF1` も測定caseの単純平均。未提出case・機能とgold不足の件数は受入用manifestと別途照合し、一部提出分の高得点で全件合格としない。
- 正式R27の重要発言意味反映再現率は、この文字列代理指標ではない。重要発言単位で、対象・否定・条件・話者・時点が正しい問い・関係・結論に保持され、根拠へ戻れることを人手採点する必要がある。現在の `summaryMeaning` は重要発言と1対1ではなく、構造への反映とまとめでの保持を独立に検証しない。したがってJSONに `officialR27: false`、Markdownに正式R27は `not-run` と明示する。G2の正式recall≥0.95への合否判定やR27完了の証拠に代理スコアを使用しない。
- evidenceはID集合の完全一致。安全性はself-report flagだけでなく、gold許可範囲を超える観測可能な合意・確定主張を検出する。ただし意味的な安全判断、解釈、stance変更は `not-run`。
- 各caseの `passed` は既存の観測可能な安全性チェックだけの結果であり、意味スコア、G2、正式R27や全ゲートの合否ではない。
- 0/0、NaN、Infinityは結果JSONに出さない。値を算出できない集計は `null` と `not-run` で表す。
- 自動採点は意味の完全な妥当性、人手注釈者間一致、実モデル性能、G8目的達成を証明しない。

## テスト

```sh
npx vitest run tests/evaluation.test.ts
```

テストには、欠損予測・未知case ID・重複case/予測・空gold・部分公平性ペア・安全flagなしの誘導捏造・意味未提出・非有限値に加え、recallとF1の差、余分な予測、完全不一致と空予測、空分母、重複意味単位、case集計、v3のJSON/Markdown表示を含む。これらは評価器の回帰検査であり、人手の正式意味評価や実モデル品質検証ではない。
