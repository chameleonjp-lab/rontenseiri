# アーキテクチャ判断記録（P0）

- 対象リポジトリ: `chameleonjp-lab/rontenseiri`
- 対象計画: `docs/requirements-and-development-plan.md` v0.4
- 状態: **手動操作と基盤の設計検証版を一部実装。モデル採用・P0合格・品質合格・公開完了を意味しない。**
- 更新日: 2026-10-18

## 判断の要約

| ID | 判断 | 状態 | 根拠／未解決 |
|---|---|---|---|
| ADR-001 | 静的Webアプリを基本にし、UI・ドメイン・入力・解析Worker・保存／出力を分離 | 部分実装 | `src/`で分離。AI実推論と全UI統合は未検証 |
| ADR-002 | モデルランタイムは抽象アダプター越しに接続し、特定AI APIを前提にしない | 採用 | 遠隔推論・有料APIへの自動フォールバックは禁止 |
| ADR-003 | WebLLM＋WebGPUを第一候補、Transformers.js＋ONNX Runtime Webを比較候補 | 候補adapterのみ | 日本語品質、容量、性能、ライセンス、端末別成立性未確認。AI disabled |
| ADR-004 | 会話データは原則ローカル。明示した静的資産／モデル取得以外の通信をしない | 部分実装 | production offlineは静的アセットのみ。モデル取得全通信は未検証 |
| ADR-005 | 原文・推定・訂正を不変性／版／根拠参照で分離 | 部分実装 | coverage、reasoning、revision、Undoは実装。意味品質と全依存伝播は未測定 |
| ADR-006 | 保存namespaceを持ち、公開オリジンの完全隔離は別途検証 | 部分実装 | DB名／namespaceだけを隔離の証拠にしない |
| ADR-007 | UIは解析ランタイム固有APIを直接呼ばず、`analyzeProject`相当契約で差替え | 部分実装 | client／Worker／session checkpoint境界あり。Worker/UI完全統合未了 |
| ADR-008 | P0予備測定、完成版ゲート、マージ／公開承認を別イベント | 採用 | 未測定を合格としない |
| ADR-009 | 全原文span coverageを可視化し、未確定をfail-visibleにする | 部分実装 | `domain/coverage.ts`, `CoveragePanel.tsx`。全形式100%品質は未評価 |
| ADR-010 | 現行容量と履歴・revision・full backup容量を別に計数 | 採用 | `domain/capacity.ts`。実機容量・全境界は未測定 |
| ADR-011 | reasoningは問い版、応答種別／充足、複数根拠、条件等、排他的解釈、立場を独立型/APIにする | 部分実装 | `reasoning.ts/types`と一部ReasoningPanel。通常UI全体・品質未完了 |
| ADR-012 | 分割／統合はlineageと明示関係移送を保存し、Undoは共通snapshotにする | 部分実装 | lineage validation、snapshot Undo、integration testあり。全衝突UI未完了 |
| ADR-013 | 混合依存の無効化はfixed pointまで反復し、許可DTOだけをexportする | 部分実装 | invalidation／export allowlistあり。長期互換性・全依存品質未検証 |
| ADR-014 | 解析sessionは停止・再開とsource hash付きcheckpointを持つ | 部分実装 | `analysis/session.ts`。現Worker/UIへの完全統合、実機復旧未了 |
| ADR-015 | 解析所有権はWeb Locks必須、取得不能はfail-closed | 部分実装 | `analysis/ownership.ts`。期限切れ／取消は作業signalをAbortするが、実作業のcleanupと`release()`完了前にLockをhandoffしない。複数タブ実機と資源上限は未検証 |
| ADR-016 | オフライン準備は明示操作時のみ、静的アセットをcontent hash／scope確認してcache | 部分実装 | ReadinessPanel、production offline 1件。本文・DB・モデルはcacheしない |
| ADR-017 | 21架空日本語ケースを固定し、実モデル予測0件はnot-runとして分母から除外 | 採用 | `evals/cases.json`, `evaluation-empty.*`。品質・公平性・G8は未測定 |

## 採用しない前提

- 特定ベンダーのクラウドAI、個人APIキー、有料API、外部AI自動送信を利用前提にしない。
- 型/API、fixture、benchmark、単体テスト、not-run評価を日本語品質・G4/G5/G8合格と呼ばない。
- モデル名、ブラウザ名、端末名から品質・速度・GPUメモリ安全性を推定しない。
- iPhone Safari、Mac、Windows、GPUメモリ、G8を未実測のまま対応済み／合格と表示しない。
- PDF/DOCX実験APIの存在から通常UI入力対応を宣言しない。PDFはfail closed。docx streamingは同期処理で、正式採用前にWorker隔離する。
- 端末内処理をアクセス制御、暗号化、完全匿名化、データ消失防止の代替と説明しない。
- UIや基盤が完成してもG1–G8の未達を補えたことにしない。

## P0で固定すべき境界とインターフェース

1. **入力境界:** UTF-8テキスト・Markdown・字幕を優先し、本文全範囲を発言／非発言／未整理へ対応付ける。DOCX/PDFは安全な抽出検証後のみ、通常UIでは未対応。
2. **解析境界:** Worker内で分割、抽出、構造検証、全体照合を行う。入力文書の命令はデータとして扱い、実行しない。モデル出力は未信頼データとしてスキーマ・根拠一致を検証する。session checkpointはsource hashを照合する。
3. **意味境界:** 問い版・応答種別・充足・複数根拠・条件等・排他的解釈・立場を別フィールド／APIにし、単一summaryへ潰さない。UIと品質は未完了。
4. **lineage境界:** 分割／統合で旧IDから新IDへのlineageを保存し、関係移送は明示レコードのみ。衝突・移送先未確定を成功扱いしない。
5. **依存／出力境界:** 混合依存はfixed pointまで無効化を反復する。完全復元JSONと論点限定Markdown/SVGを分け、限定出力は許可DTOと発言allowlistだけから生成する。
6. **保存／所有権境界:** 既定は一時作業、明示保存時のみIndexedDB。namespaceを付ける。Web Locksがない／取れない場合は解析開始せずfail-closed。保存失敗は成功表示しない。
7. **オフライン境界:** 明示準備時のみproduction静的manifestをcontent hashとscopeで検査してprecache。会話本文、IndexedDB、JSON/API、AIモデルはCacheしない。
8. **通信境界:** 静的資産、明示的モデル取得、許可された配布元だけ。会話本文、名前、ファイル名、ハッシュ、分析結果をネットワーク・ログ・URLクエリへ送らない。

## 採用ゲート

P0で「候補が動いた」ことは本番採用ではない。候補ごとにモデル／重み／Tokenizer／量子化／ランタイム／ブラウザ／OS／GPU／設定／プロンプトの組を固定し、同じデータで比較する。以下のいずれかが欠ければ採用保留とする。

- G1原文完全性、G2構造品質、G3根拠・誤断定、G4性能・資源、G6通信・安全、G7権利。
- P0で未実施の実Mac、Windows、iPhone、GPUメモリ、初回取得、オフライン、G8を未完了として明記する。
- 全候補が不合格なら、AI解析を公開機能にせず、手動整理を含む範囲を再レビューする。遠隔推論へ切替えない。

## 承認の分離

1. **実装着手承認:** P0の計画・評価基盤・範囲をレビューしてから着手。
2. **マージ承認:** 実装とテスト、差分、権利・安全証拠を別レビュー。
3. **公開承認:** P6の全ゲート、配布先、公開範囲、Pages実URLスモークテストを確認後に別承認。承認前は「公開不可（評価・承認未完了）」を表示する。

## 今回の結論

現時点は入力からキャンバス・手動訂正・保存／出力と、基盤の一部を実装した設計検証版である。core83、文書10、ブラウザ11、production offline1は現在確認できる固有数で、500node E2E追加分や未実行評価を合格へ算入しない。21架空日本語ケースは実モデル予測0でnot-run。したがって、**P0成立性は未成立（未検証）であり、計画書全体の実装完了・検証完了・公開可能・AI採用済みとは報告しない。** PR3は基盤、PR #3（未結線の実験API）は文書実験へ分離予定。
