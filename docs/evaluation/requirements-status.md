# R01–R33 実装・検証ステータス

更新日: 2026-10-18

## 判定の読み方

本表は `docs/requirements-and-development-plan.md` 第20章の追跡表を、現在の設計検証版のコードと `tests/`・`e2e/`に照合したもの。**status は実装の存在であり、品質ゲートの合格を意味しない。** テストが通ることも、対応する G0–G8 の品質・実機・利用者評価を通過したことを意味しない。

現状は、入力・データモデル・手動訂正・ローカル保存・JSON出力・Worker adapter・統合UIの **設計検証版（P0未合格）**。モデル取得量、品質、性能、端末、配布条件は未確定であり、**AI開始 gate は disabled（開始不可条件を表示するだけ）**。PDF/DOCX/OCR/音声は対象外として reject する。Mac/Windows/iPhone、G8利用者比較、日本語品質、p95 は未実測。`LICENSE` の権利者確認も未了。

| ID | status | 関連コード（現状） | テスト有無 | 残ゲート／不足 |
|---|---|---|---|---|
| R01 | 部分実装 | `src/App.tsx`（端末別対応の表示、AI開始不可）、`src/input/parse.ts`、`src/storage/projects.ts`、`src/export/project.ts` | 部分: `tests/core.test.ts`, `tests/security.test.ts` | G0・G8。端末×機能の決定、iPhone新規AI可否、実機未測定 |
| R02 | 部分実装 | `src/domain/types.ts`（`Extent`）、`src/input/parse.ts`、`src/domain/project.ts` | 部分: `tests/core.test.ts`, `tests/security.test.ts` | G1・G3。全文/抜粋/不明の運用、欠落検出、全範囲検証 |
| R03 | 部分実装 | `SourceRole` と `src/input/parse.ts` | 部分: `tests/core.test.ts` | G1・G3。会話本文/参考資料/後日説明のUI・分析分離と固定評価 |
| R04 | 部分実装 | `src/input/parse.ts` の行/span・字幕抽出、`Utterance.coverage` | 部分: `tests/security.test.ts` | G1。非発言・未整理を含む全範囲の無断欠落0件、PDF/DOCX抽出はreject |
| R05 | 部分実装 | `src/input/parse.ts` のSRT/VTT処理（区間・時刻保持） | 有: `tests/security.test.ts` | G1。合法な字幕重複、字幕境界と発言境界の独立性を追加検証 |
| R06 | 未実装 | 型に単一 `Agenda` はあるが、原文/分析用の問いの版管理なし | 無 | G2・G3。問い0/複数、原文問いと指定問いの分離 |
| R07 | 未実装 | `Agenda` の単一タイトルのみ | 無 | G2・G3。問いの変更・撤回履歴 |
| R08 | 未実装 | `Agenda.utteranceIds` の単純所属のみ | 無 | G2・G3。複数問い・複数回答者の多対多 |
| R09 | 未実装 | `Agenda.answer` は単一状態のみ | 無 | G2・G3。応答種別と要求充足の分離、反論/複数根拠 |
| R10 | 部分実装 | 発言順に従う関係、復帰なし/未確定、A→B→Aの再登場区間 | 有: `tests/acceptance.test.ts`, `tests/canvas.test.ts`, `e2e/app.spec.ts` | G1・G2。意味上の関係・合流の品質評価は未実施 |
| R11 | 部分実装 | `Relation.evidenceIds`、`Agenda` の関連IDはある | 部分: `tests/core.test.ts` | G2・G3。複合条件、反論対象、根拠付き応答の意味評価 |
| R12 | 未実装 | `Agenda.needsReview` は器のみ | 無 | G3。排他的な解釈候補と不確かさの結論までの伝播 |
| R13 | 部分実装 | `SourceRole` に `later-explanation`、`Revision` | 部分: `tests/core.test.ts` | G3。発言時点/登録時点、撤回・後日説明の独立評価 |
| R14 | 部分実装 | `Agenda` の `agreement`/`verification`/`unresolved` | 部分: `tests/core.test.ts` | G3・G8。条件・例外・異論・時点をまとめに保持する実装と評価 |
| R15 | 部分実装 | 分類/原文の訂正・旧版保持・影響先要再確認・履歴付きUndo | 有: `tests/acceptance.test.ts`, `tests/revisions.test.ts`, `e2e/app.spec.ts` | G1・G5。再解析・複雑な依存伝播は未実装 |
| R16 | 未実装 | `Revision` はあるが分割/統合の旧ID→新ID移送契約なし | 無 | G1・G5。適用済み/衝突/移し先未確定の永続化 |
| R17 | 部分実装 | `Inspector.tsx`、分類と独立した所属移動/議題分割・結合、理由とUndo | 有: `tests/acceptance.test.ts`, `tests/revisions.test.ts`, `e2e/app.spec.ts` | G5。問い/主張の精密モデル・本文分割・任意の関係編集は未実装 |
| R18 | 部分実装 | 全体JSONと発言許可リスト必須の限定JSON/MD/SVG、manifest照合 | 有: `tests/export-scope.test.ts`, `tests/acceptance.test.ts`, `e2e/app.spec.ts` | G1・G5・G6。選択本文の含有と未選択/他議題/履歴等の除外は確認。外部運用・全形式の長期互換性は未検証 |
| R19 | 部分実装 | `src/input/parse.ts` の入力上限、`src/storage/projects.ts` の50 MiB保存上限 | 有: `tests/security.test.ts`, `tests/regressions.test.ts` | G1・G5。現行入力と履歴容量の計数分離、往復・上限境界 |
| R20 | 部分実装 | 安定座標のキャンバス、下向き分岐、折り畳み件数、パン/ズーム、時系列と再登場 | 有: `tests/canvas.test.ts`, `tests/acceptance.test.ts`, `e2e/app.spec.ts` | G5・G8。反対根拠や合流の表現、利用者の理解評価は未実施 |
| R21 | 部分実装 | `src/App.tsx` の入力・訂正・保存・出力導線、タッチ/キーボード案内 | 有: `e2e/app.spec.ts`（スマホ幅のタッチエミュレーションを含む） | G4・G5・G8。iPhone Safari実機、日本語入力、回転/拡大/読み上げ/タブ復帰 |
| R22 | 未実装 | `src/analysis/client.ts` の単発suggestion adapterのみ | 部分: `tests/analysis.test.ts` | G2・G4。候補/照合/累積量・再利用・停止再開・未照合表示 |
| R23 | 未実装 | 保存/出力APIはあるが工程別計測なし | 無 | G4・G5。合法最大入力・履歴で時間/最大メモリ/p95 |
| R24 | 部分実装 | `src/workers/analysis.worker.ts` と `src/analysis/client.ts` | 有: `tests/analysis.test.ts`（abort/worker境界） | G4・G5。複数タブ資源所有、同時推論制限、取消後の再開 |
| R25 | 未実装 | `src/storage/projects.ts` は IndexedDB `rontenseiri` のみ | 無 | G6。公開オリジン/別作品との保存隔離を設計・検証 |
| R26 | 部分実装 | Workerへの構造化出力、原文保持のデータ契約 | 部分: `tests/analysis.test.ts`, `tests/security.test.ts` | G3・G6。prompt injection固定ケース、誘導結論/合意捏造の検出 |
| R27 | 部分実装 | `Source.text` と `Utterance.quote` を分離、`Relation`/`Agenda` | 部分: `tests/core.test.ts`, `tests/regressions.test.ts` | G1・G2。原文保持率と重要意味反映率を別採点（未測定） |
| R28 | 未実装 | `Agenda.unresolved`/`nextAction` の器のみ | 無 | G2・G3。解釈・立場変化・まとめ・確認提案を機能別に採点 |
| R29 | 未実装 | 該当する比較実装なし | 無 | G3・G8。話者ラベル/丁寧さ/言いよどみを変えた公平性比較 |
| R30 | 未実装 | UIはあるが利用者比較機能・試験なし | 無 | G8。原文のみとの正答、時間、重大誤理解、訂正負担 |
| R31 | 部分実装 | 本表と第20章のID追跡表 | 無（本表は証拠登録の途中） | G0。各要件の試験ID、証拠、環境、未達理由の継続更新 |
| R32 | 部分実装 | `docs/evaluation/implementation-review.md` にP0範囲/限界、`src/analysis/client.ts` | 部分: `tests/analysis.test.ts` | G0・G4。モデル単体/実アプリ/配信の境界、取得量・中止条件 |
| R33 | 未実装 | 固定評価の運用計画・担当/端末確保なし | 無 | G0・G7。評価者・実機・時間・許諾・変更時の再実行計画 |

## 入力・配布の明示的な境界

- **reject:** PDF、DOCX、OCR、音声、動画、URL/外部取得。入力はテキスト貼付、TXT/MD、SRT/VTTのP0範囲に限定する。
- **モデル:** WebLLM依存とWorker adapterは存在するが、モデル実体の取得量・空き容量・時間・品質は未確定。したがってAI開始 gate は disabled であり、adapterの単体テストをAI品質合格と扱わない。
- **未実測:** Mac/Windows/iPhone実機、G8、G2/G3日本語品質、初回取得、追加メモリ、p95（特に500ノード操作、10,000文字解析）。
- **権利:** `LICENSE`/NOTICEおよび依存・モデル・サンプルの権利者確認は未了。G7を合格扱いにしない。

## G0–G8 現時点 decision

| Gate | decision | 根拠・残条件 |
|---|---|---|
| G0 | **未達（部分）** | R01–R33の対応表は本書で整備したが、担当・固定評価版・全証拠リンク・承認境界が未登録 |
| G1 | **未達** | 原文保持/JSON検証の単体テストはあるが、全範囲100%、全形式、無断切捨て0件、PDF/DOCX境界の固定証拠なし |
| G2 | **未測定** | 問い/回答/関係/立場/重要意味のF1と日本語品質を測っていない |
| G3 | **未測定** | 根拠妥当率・捏造0件・prompt injection固定ケースを未測定 |
| G4 | **未測定** | モデル取得量、10,000文字p95、50,000文字、追加メモリ≤6 GiB、取消≤3秒、Mac/Windows/iPhone未測定 |
| G5 | **未達（部分）** | 単体35件・ブラウザ8件が通過。取消/復旧/別タブ、最大入力、実機p95≤200msは未確認 |
| G6 | **未達（部分）** | 起動/架空サンプルの外部通信0、限定出力、SVGエスケープ、指定外Host拒否は確認。モデル取得全通信・悪意入力全件・オフライン再起動は未検証 |
| G7 | **未達** | `LICENSE`/権利者・依存/モデル/サンプルの再配布条件、脆弱性対応、公開承認が未完了 |
| G8 | **未測定** | 原文のみとの利用者比較、元の問い/立場変化/残疑問の正答・時間・訂正負担を未測定 |

## 計画全完了を妨げる3つの本質ブロッカー

1. **モデル成立性:** モデル取得量・端末メモリ/時間と日本語の構造品質（G2/G3/G4）が未確定で、AI開始 gate を有効化できない。
2. **意味の品質証拠:** 原文保持と意味反映を分離した固定評価、G8利用者比較、prompt injection/公平性の実測がない。
3. **公開成立性:** Mac/Windows/iPhoneの実機・p95・長期復旧・保存隔離、PDF/DOCX等の境界、LICENSE権利確認とG6/G7承認が未完了。

## この版の検証結果

単体・回帰・受入契約35件、ブラウザE2E8件、厳格型検査とビルドが通過。依存監査は脆弱性0件。詳細と検証の限界は [実装検証結果](implementation-review.md) を参照。CIにも同じ検査とブラウザ証拠の保存を登録した。G0–G8はいずれも自動的に合格へ変更していない。
