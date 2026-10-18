# R01–R33 実装・検証ステータス

更新日: 2026-10-18

## 判定の読み方

本表は `docs/requirements-and-development-plan.md` 第20章の追跡表を、現行の実コードと `tests/`・`e2e/`・`artifacts/`に照合したもの。**statusは実装の存在であり、品質ゲートの合格を意味しない。** テスト通過数も、対応するG0–G8の品質・実機・利用者評価を通過したことを意味しない。R01–R33とゲート表は削除せず、基盤追加後の状態へ更新している。

単体・回帰は計100件（文書実験10件を含む）がローカルで通過。ブラウザの固有結果は同一SHAのCI artifact（`verified-sha.txt`、`e2e-results.json`）を正本とする。500ノードの表示・パンは確認済みだが、選択・検索・折り畳み各100操作のp95と実機確認は別項目であり、機能試験でG5を代替しない。Node/Linuxの入出力ベンチマークもG4/G5合格証拠ではない。

| ID  | status   | 関連コード（現状）                                                                      | テスト有無              | 残ゲート／不足                                                           |
| --- | -------- | --------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------ |
| R01 | 部分実装 | `src/App.tsx`, `src/input/parse.ts`, `src/storage/projects.ts`, `src/export/project.ts` | core/ブラウザ           | G0・G8。実Mac/Windows/iPhone、端末×機能、AI開始は未確認（disabled）      |
| R02 | 部分実装 | `src/domain/types.ts`, `src/domain/coverage.ts`, `src/components/CoveragePanel.tsx`     | core                    | 全原文spanの確定率・欠落0件の固定品質評価は未実施                        |
| R03 | 部分実装 | `SourceRole`, `src/input/parse.ts`, coverage UI                                         | core/文書実験           | 本文・参考資料・後日説明の分析分離品質は未測定                           |
| R04 | 部分実装 | `parse.ts`, `Utterance.coverage`, `coverage.ts`（未確定spanを可視化）                   | core/文書実験           | 全形式の無断欠落0件、PDF/DOCX通常UIは未対応（fail closed）               |
| R05 | 部分実装 | `parse.ts`のSRT/VTT区間・時刻保持                                                       | core/文書実験           | 字幕重複と境界独立性の品質固定評価は未完了                               |
| R06 | 部分実装 | `reasoning.ts`, `reasoning-types.ts`の問いと問い版                                      | core/問いUI             | 問い0/複数、原文問いと指定問いの通常UI・品質評価が不足                   |
| R07 | 部分実装 | reasoningのquestion version/revision API                                                | core/問いUI             | 撤回・変更の全画面履歴と品質評価は未完了                                 |
| R08 | 部分実装 | reasoningの問い／応答関係、関連型                                                       | core/問いUI             | 多対多の通常UI統合・品質未測定                                           |
| R09 | 部分実装 | 応答種別、充足、複数根拠の型/API                                                        | core/問いUI             | UIと日本語意味品質が不足。R12/13/14/28と同様、型/APIだけを合格扱いしない |
| R10 | 部分実装 | `project.ts`, layout/canvas、復帰なし・未確定                                           | core/ブラウザ           | 意味上の関係・合流の品質評価未実施                                       |
| R11 | 部分実装 | `Relation.evidenceIds`、reasoning evidence                                              | core/問いUI             | 複合条件・反論対象・根拠付き応答の意味評価未実施                         |
| R12 | 部分実装 | `reasoning.ts/types`の排他的解釈候補・不確かさAPI                                       | core                    | UI不足、結論までの伝播・品質未測定                                       |
| R13 | 部分実装 | `SourceRole`、`Revision`、問い／応答時点API                                             | core                    | 発言時点／登録時点／後日説明の独立評価未完了                             |
| R14 | 部分実装 | agreement/verification/unresolved、条件・例外型                                         | core/問いUI             | 条件・例外・異論・時点のUIと日本語品質未測定                             |
| R15 | 部分実装 | revisions、snapshot Undo、invalidation                                                  | core/ブラウザ           | 再解析・複雑な依存伝播は未完了                                           |
| R16 | 部分実装 | `lineage-types.ts`, `lineage-validation.ts`, 分割／統合                                 | core/ブラウザ           | 適用済み・衝突・未確定移送の全UIと長期互換性未確認                       |
| R17 | 部分実装 | `utterance-editing.ts`, Inspector、lineageの明示関係移送                                | core/ブラウザ           | 任意の関係編集・本文分割・精密意味モデル未実装                           |
| R18 | 部分実装 | 許可DTO限定export、選択発言allowlist、manifest                                          | core/ブラウザ           | 全形式の長期互換性・外部運用未検証                                       |
| R19 | 部分実装 | `capacity.ts`（現行／履歴／revision／backupを別計数）                                   | core                    | 往復・全上限境界・実機容量未測定                                         |
| R20 | 部分実装 | layout/canvas、折り畳み、反対根拠表示の基盤                                             | core/ブラウザ           | 500node表示・パン確認済み。各100操作p95・実機・利用者理解は別評価        |
| R21 | 部分実装 | `App.tsx`, ReasoningPanel, ReadinessPanel、タッチ/キーボード                            | ブラウザCI              | iPhone Safari、日本語入力、読み上げ、回転・復帰未確認                    |
| R22 | 部分実装 | `analysis/session.ts`（停止・再開・checkpoint）                                         | core/分析               | 現Worker/UIへの完全統合、候補／照合UI、再利用未完了                      |
| R23 | 部分実装 | `artifacts/software-benchmark.json`, diagnostics metrics                                | Node/Linux20回          | モデル・合法最大入力・メモリ・実機p95は未測定                            |
| R24 | 部分実装 | `analysis/ownership.ts`（Web Locks必須、fail-closed）                                   | core                    | 複数タブ実機資源、同時推論、取消後再開の実経路未確認                     |
| R25 | 部分実装 | `storage/projects.ts`の保存namespace/scope                                              | core                    | 公開オリジンの完全隔離・別作品境界は未確認                               |
| R26 | 部分実装 | Worker構造化出力、原文保持、offline静的shellのhash/scope                                | core/production offline | 全通信、悪意入力、モデル取得の実行時検証未完了                           |
| R27 | 部分実装 | `Source.text`/`Utterance.quote`、evidence/coverage                                      | core/文書実験           | 原文保持率と意味反映率を別採点するが実モデル値なし                       |
| R28 | 部分実装 | reasoningの立場・解釈・まとめ・確認提案API                                              | core/問いUI             | UI／機能別採点未完了                                                     |
| R29 | 未実装   | 公平性比較の評価基盤のみ                                                                | 文書実験はnot-run       | 話者ラベル・丁寧さ・言いよどみの実予測比較未実施                         |
| R30 | 未実装   | 利用者比較機能なし                                                                      | 無                      | G8被験者の正答・時間・重大誤理解・訂正負担未測定                         |
| R31 | 部分実装 | 本表、第20章、評価ハーネス、artifacts                                                   | 証拠登録途中            | 各要件の環境・証拠・未達理由の継続更新が必要                             |
| R32 | 部分実装 | `analysis/client.ts`, session/checkpoint, ReadinessPanel                                | core/分析               | モデル単体・実アプリ・配信、取得量・中止条件の境界未完了                 |
| R33 | 未実装   | `evals/cases.json`と評価APIの固定基盤                                                   | 21ケースはnot-run       | 担当・実機・許諾・変更時再実行・G8計画未確保                             |

## 入力・配布の明示的な境界

- **通常UIで対応:** テキスト貼付、TXT/MD、SRT/VTTのP0範囲。
- **reject／未対応:** PDF、DOCX、OCR、音声、動画、URL/外部取得。PDFブラウザはfail closed。`src/input/documents.ts`／`docx.ts`は実験APIで通常UI未結線、docx streamingは同期処理のため正式採用前にWorker隔離が必要。同じDraft PR内の未結線実験として隔離で、通常入力対応を宣言しない。source input files unsupportedは継続。
- **モデル:** WebLLM依存／Worker adapterは存在するが取得量・空き容量・時間・日本語品質未確定。AI開始gateはdisabled。adapter単体をAI品質合格と扱わない。
- **オフライン:** 明示準備時のみ静的アセットをcontent hash/scope確認してprecache。本文・DB・モデルはcacheしない。production offlineは1件通過したが、完全なオフライン再起動や実機保証ではない。
- **未確認:** 実Mac/Windows/iPhone、GPUメモリ、モデル取得、日本語品質、G8被験者、LICENSE/権利者／配布承認。

## G0–G8 現時点 decision

| Gate | decision         | 根拠・残条件                                                                        |
| ---- | ---------------- | ----------------------------------------------------------------------------------- |
| G0   | **未達（部分）** | R01–R33表と21ケース基盤はあるが、担当・承認・全証拠が未登録                         |
| G1   | **未達**         | coverage可視化と単体検査はあるが、全形式100%、無断切捨て0件の固定証拠なし           |
| G2   | **未測定**       | reasoning型/APIと問いUIは一部あるが、問い・回答・関係・立場の日本語品質F1なし       |
| G3   | **未測定**       | 排他的解釈・根拠・捏造・条件等の実モデル品質未測定                                  |
| G4   | **未測定**       | Node/Linuxソフトウェアp95は参考値。モデル、GPUメモリ、実機、取得量は未測定          |
| G5   | **未達（部分）** | core83、文書10、ブラウザCI、offline1は通過。500node追加中、最大履歴・実機p95未確認  |
| G6   | **未達（部分）** | offline静的shell、scope/hash、許可DTO等は検査。モデル取得・全通信・完全隔離は未検証 |
| G7   | **未達**         | LICENSE、権利者、依存・モデル・サンプル再配布、公開承認未完了                       |
| G8   | **未測定**       | 被験者比較なし                                                                      |

## 評価・性能の現在値

21件の架空日本語評価ハーネスは固定されていますが、実モデル予測は0件、結果は**not-run**です。未実行分を合格数へ算入しません。`software-benchmark.json`はNode/Linuxのみ、50,000文字・500node・20回の入力／検証／layout／出力／restore p95で、G4/G5品質合格ではありません。

## 本質ブロッカーと計画分離

1. モデル成立性（取得量・GPUメモリ・日本語品質、AI disabled）。
2. 意味品質証拠（問い／応答／立場／根拠／不確かさ、公平性、G8）。
3. 公開成立性（実機、p95、復旧、保存隔離、権利・配布承認）。

PR #3は基盤（coverage、capacity、reasoning型/API、lineage、Undo、fixed point、所有権、session checkpoint、namespace、ReadinessPanel、offline境界）、未結線の文書実験APIも同じPR内に隔離。G0–G8はいずれも総合合格へ変更していない。

## 今回固定した失敗再現と境界

- `public-review-fixtures.test.ts`: 復帰なしの保存復元、復帰先の分類変更、別議題の要約依存だけへの再確認伝播、未割当原文の位置と非完了manifest。分割後の要約依存移送とA→B→Aの意味表示も検査。
- `review-blockers.test.ts`: A→B→Cの複数段依存、無関係Dの不変、Undo、循環入力の拒否。限定出力は全階層の未知キー、reasoning/runs/lineage、旧原文版、履歴ダミーを除外。
- `storage-conflict.spec.ts`: IndexedDB readwrite transaction内のstorageRevision比較で旧版上書きを拒否。原文・履歴・Undoを保持。
- 復帰線を跨ぐ議題境界では、意味上の復帰ラベルを時系列の切替ラベルより優先する。
- テストのポートを可変化しstrictPortを使用。旧checkoutのプレビューを誤検証しない。CIはPRのhead SHAを明示checkoutし、検証SHAをartifactへ記録する。
