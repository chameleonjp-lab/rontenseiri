# R01–R33 実装・検証ステータス

更新: 2026-10-19 04:04 JST。main基点 `8d6faa09951c47594df7c671baf3e972487d4d69`。PR状態は03:48:46、CI APIは03:49:13、artifact取得は03:49:58、生値再検証は03:50:29、#17ローカル追記は03:52:14のsnapshot。後続変更へ自動追従する表ではない。

## 判定の読み方

**R別証拠の登録は未完了。** テスト分類のcore/browserやコードパスはファイルの存在を示すだけで、R単位のtested SHA・環境・test ID・実行証拠を同期した意味ではない。各行の4欄を確認し、未登録は個別に「未取得」とした。既知4行も限定sliceの対応付けであり要件全体の受入ではない。実装headをtested SHAと推定せず、R12の#13もR単位実行証拠未取得のままとする。

本表は `docs/requirements-and-development-plan.md` 第20章の追跡表を、現行の実コードと `tests/`・`e2e/`・`artifacts/`に照合したもの。**statusは実装の存在であり、品質ゲートの合格を意味しない。** テスト通過数も、対応するG0–G8の品質・実機・利用者評価を通過したことを意味しない。R01–R33とゲート表は削除せず、基盤追加後の状態へ更新している。

旧基盤時点の単体・回帰100件（文書実験10件含む）は履歴値であり、現在headの総数ではない。現在のSHA別結果は下の証拠表を参照し、件数を加算して完成率にしない。ブラウザの固有結果は同一SHAのCI artifact（`verified-sha.txt`、`e2e-results.json`）を正本とする。500ノードの表示・パンは確認済みだが、選択・検索・折り畳み各100操作のp95と実機確認は別項目であり、機能試験でG5を代替しない。Node/Linuxの入出力ベンチマークもG4/G5合格証拠ではない。

| ID  | status   | 関連コード（現状）                                                                      | テスト有無              | 残ゲート／不足                                                           | テスト済みSHA（部分証拠） | 環境 | テストID（部分証拠） | 証拠リンク |
| --- | -------- | --------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------ | --- | --- | --- | --- |
| R01 | 部分実装 | `src/App.tsx`, `src/input/parse.ts`, `src/storage/projects.ts`, `src/export/project.ts` | core/ブラウザ | G0・G8。実Mac/Windows/iPhone、端末×機能、AI開始は未確認（disabled） | 未取得 | 未取得 | 未取得 | 未取得（追跡リンク/ファイル存在をR単位の実行証拠としない） |
| R02 | 部分実装 | `src/domain/types.ts`, `src/domain/coverage.ts`, `src/components/CoveragePanel.tsx` | core | 全原文spanの確定率・欠落0件の固定品質評価は未実施 | 未取得 | 未取得 | 未取得 | 未取得（追跡リンク/ファイル存在をR単位の実行証拠としない） |
| R03 | 部分実装 | `SourceRole`, `src/input/parse.ts`, coverage UI | core/文書実験 | 本文・参考資料・後日説明の分析分離品質は未測定 | 未取得 | 未取得 | 未取得 | 未取得（追跡リンク/ファイル存在をR単位の実行証拠としない） |
| R04 | 部分実装 | `parse.ts`, `Utterance.coverage`, `coverage.ts`（未確定spanを可視化） | core/文書実験 | 全形式の無断欠落0件、PDF/DOCX通常UIは未対応（fail closed） | 未取得 | 未取得 | 未取得 | 未取得（追跡リンク/ファイル存在をR単位の実行証拠としない） |
| R05 | 部分実装 | `parse.ts`のSRT/VTT区間・時刻保持 | core/文書実験 | 字幕重複と境界独立性の品質固定評価は未完了 | 未取得 | 未取得 | 未取得 | 未取得（追跡リンク/ファイル存在をR単位の実行証拠としない） |
| R06 | 部分実装 | `reasoning.ts`, `reasoning-types.ts`の問いと問い版 | core/問いUI | 問い0/複数、原文問いと指定問いの通常UI・品質評価が不足 | 未取得 | 未取得 | 未取得 | 未取得（追跡リンク/ファイル存在をR単位の実行証拠としない） |
| R07 | 部分実装 | reasoningのquestion version/revision API | core/問いUI | 撤回・変更の全画面履歴と品質評価は未完了 | 未取得 | 未取得 | 未取得 | 未取得（追跡リンク/ファイル存在をR単位の実行証拠としない） |
| R08 | 部分実装 | reasoningの問い／応答関係、関連型 | core/問いUI | 多対多の通常UI統合・品質未測定 | 未取得 | 未取得 | 未取得 | 未取得（追跡リンク/ファイル存在をR単位の実行証拠としない） |
| R09 | 部分実装 | 応答種別、充足、複数根拠の型/API | core/問いUI | UIと日本語意味品質が不足。R12/13/14/28と同様、型/APIだけを合格扱いしない | 未取得 | 未取得 | 未取得 | 未取得（追跡リンク/ファイル存在をR単位の実行証拠としない） |
| R10 | 部分実装 | `project.ts`, layout/canvas、復帰なし・未確定 | core/ブラウザ | 意味上の関係・合流の品質評価未実施 | 未取得 | 未取得 | 未取得 | 未取得（追跡リンク/ファイル存在をR単位の実行証拠としない） |
| R11 | 部分実装 | `Relation.evidenceIds`、reasoning evidence | core/問いUI | 複合条件・反論対象・根拠付き応答の意味評価未実施 | 未取得 | 未取得 | 未取得 | 未取得（追跡リンク/ファイル存在をR単位の実行証拠としない） |
| R12 | 部分実装 | reasoning型/APIと[PR #13の手動A/B解釈UI](https://github.com/chameleonjp-lab/rontenseiri/pull/13) | unit/通常UI回帰（該当PRの範囲） | 同時成立を強制しない手動sliceのみ。結論までの伝播・意味品質・G3未受入 | 未取得 | 未取得 | 未取得 | 未取得（追跡リンク/ファイル存在をR単位の実行証拠としない） |
| R13 | 部分実装 | `SourceRole`、`Revision`、問い／応答時点API | core | 発言時点／登録時点／後日説明の独立評価未完了 | 未取得 | 未取得 | 未取得 | 未取得（追跡リンク/ファイル存在をR単位の実行証拠としない） |
| R14 | 部分実装 | agreement/verification/unresolved、条件・例外型 | core/問いUI | 条件・例外・異論・時点のUIと日本語品質未測定 | 未取得 | 未取得 | 未取得 | 未取得（追跡リンク/ファイル存在をR単位の実行証拠としない） |
| R15 | 部分実装 | revisions、snapshot Undo、invalidation | core/ブラウザ | 再解析・複雑な依存伝播は未完了 | 未取得 | 未取得 | 未取得 | 未取得（追跡リンク/ファイル存在をR単位の実行証拠としない） |
| R16 | 部分実装 | `lineage-types.ts`, `lineage-validation.ts`, 分割／統合 | core/ブラウザ | 適用済み・衝突・未確定移送の全UIと長期互換性未確認 | 未取得 | 未取得 | 未取得 | 未取得（追跡リンク/ファイル存在をR単位の実行証拠としない） |
| R17 | 部分実装 | `utterance-editing.ts`, Inspector、lineageの明示関係移送 | core/ブラウザ | 任意の関係編集・本文分割・精密意味モデル未実装 | 未取得 | 未取得 | 未取得 | 未取得（追跡リンク/ファイル存在をR単位の実行証拠としない） |
| R18 | 部分実装 | 許可DTO限定export、選択発言allowlist、manifest | core/ブラウザ | 全形式の長期互換性・外部運用未検証 | 未取得 | 未取得 | 未取得 | 未取得（追跡リンク/ファイル存在をR単位の実行証拠としない） |
| R19 | 部分実装 | `capacity.ts`（現行／履歴／revision／backupを別計数） | core | 往復・全上限境界・実機容量未測定 | 未取得 | 未取得 | 未取得 | 未取得（追跡リンク/ファイル存在をR単位の実行証拠としない） |
| R20 | 部分実装 | layout/canvas、折り畳み、反対根拠表示の基盤 | core/ブラウザ | 500node表示・パン確認済み。各100操作p95・実機・利用者理解は別評価 | `b78c7f2cc759ceab3bc35f446284c6ecd2776051`（限定UI診断） | Linux/headless Chromium151.0.7922.34/Vite dev | `e2e/performance.spec.ts:277`（各100操作） | [R20/G5来歴](#r20g517固有の500-node-ui速度失敗の来歴)（原raw未公開、保持先/hash記載） |
| R21 | 部分実装 | `App.tsx`, ReasoningPanel, ReadinessPanel、タッチ/キーボード | ブラウザCI | iPhone Safari、日本語入力、読み上げ、回転・復帰未確認 | `2552a9efadcafe75f227f09a4095b99500616889`（限定viewport slice） | 開発Chromium、650/651/900/901px（版のR別来歴未取得） | `e2e/span-inventory-responsive.spec.ts:119`「実Worker台帳の保存・再開は{650/651/900/901}pxで厳密なprefixを維持する」 | [Draft #18 push 39155079297](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39155079297) / [PR 39155082556](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39155082556)（要件全体でない） |
| R22 | 部分実装 | `analysis/session.ts`、`analysis/inventory-run.ts`、`SpanInventoryPanel`（main #14/#15） | deterministic inventoryの通常UI/実Worker/実IDB | meaning unadjudicated。AI解析・訂正依存再利用・意味上の全照合・P2/R22全体は未完 | `563715de2df26a910643af04490aec7bf8d4216d`（Draft #16限定） | GitHub Actions/Playwright Chromium（OS/版のR別来歴未取得） | `e2e/span-inventory.spec.ts:112`「実Workerの原文範囲台帳…」/ `e2e/save-generation.spec.ts:211`「同一内容・同一版の手動保存と自動保存…」 | [Draft #16 push 39153514686](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39153514686) / [PR 39153562013](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39153562013)（mainと別、full R22でない） |
| R23 | 部分実装 | 訂正差分・保存・限定/完全出力・再読込/復元の基盤。Node/Linux benchmarkは参考値のみ | R23工程ごとの固定証拠は未取得 | 履歴増大に伴う各工程時間とピークメモリ、合法最大入力・履歴上限近傍の実機条件は未測定 | 未取得 | 未取得 | 未取得 | 未取得（追跡リンク/ファイル存在をR単位の実行証拠としない） |
| R24 | 部分実装 | mainの`analysis/ownership.ts`、Web Locks必須/fail-closed基盤 | core。追加停止/待機取消は未マージ#17/#20の別証拠 | main実装とDraftを分離。実機GPU/同時推論/全クラッシュ組合せ未測定 | `3acf2f1958359852b33ae7b34bc0ec259d14dd4d`（Draft #20限定） | 開発headless Chromium（OS/版のR別来歴未取得、model/GPUなし） | `e2e/ownership-pending.spec.ts:14`「待機中の{cancel/timeout}はnative queueを除去…」/ `ownership-lease.spec.ts:4`「所有権{expiry/cancel}は旧Workerを停止…」/ `ownership-fencing.spec.ts:314`「tab close…」 | [Draft #20 push 39155416740](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39155416740) / [PR 39155470947](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39155470947)（model-free限定、full R24でない） |
| R25 | 部分実装 | `storage/projects.ts`の保存namespace/scope | core | 公開オリジンの完全隔離・別作品境界は未確認 | 未取得 | 未取得 | 未取得 | 未取得（追跡リンク/ファイル存在をR単位の実行証拠としない） |
| R26 | 部分実装 | Worker構造化出力、原文保持、offline静的shellのhash/scope | core/production offline | 全通信、悪意入力、モデル取得の実行時検証未完了 | 未取得 | 未取得 | 未取得 | 未取得（追跡リンク/ファイル存在をR単位の実行証拠としない） |
| R27 | 部分実装 | `Source.text`/`Utterance.quote`、evidence/coverage | core/文書実験 | 原文保持率と意味反映率を別採点するが実モデル値なし | 未取得 | 未取得 | 未取得 | 未取得（追跡リンク/ファイル存在をR単位の実行証拠としない） |
| R28 | 部分実装 | reasoningの立場・解釈・まとめ・確認提案API | core/問いUI | UI／機能別採点未完了 | 未取得 | 未取得 | 未取得 | 未取得（追跡リンク/ファイル存在をR単位の実行証拠としない） |
| R29 | 未着手（評価実行） | 公平性比較の評価基盤のみ | 文書実験はnot-run | 話者ラベル・丁寧さ・言いよどみの実予測比較未実施 | 未取得 | 未取得 | 未取得 | 未取得（追跡リンク/ファイル存在をR単位の実行証拠としない） |
| R30 | 未着手（評価実行） | 利用者比較機能なし | 無 | G8被験者の正答・時間・重大誤理解・訂正負担未測定 | 未取得 | 未取得 | 未取得 | 未取得（追跡リンク/ファイル存在をR単位の実行証拠としない） |
| R31 | 部分実装 | 本表・計画§20・SHA別証拠台帳 | snapshot整合検査。担当/実機/全証拠登録は未完 | 追跡ずれ修正はG0合格や実装完成ではない | 未取得 | 未取得 | 未取得 | 未取得（追跡リンク/ファイル存在をR単位の実行証拠としない） |
| R32 | 部分実装 | `analysis/client.ts`, session/checkpoint, ReadinessPanel | core/分析 | モデル単体・実アプリ・配信、取得量・中止条件の境界未完了 | 未取得 | 未取得 | 未取得 | 未取得（追跡リンク/ファイル存在をR単位の実行証拠としない） |
| R33 | 未着手（評価実行） | `evals/cases.json`と評価APIの固定基盤 | 21ケースはnot-run | 担当・実機・許諾・変更時再実行・G8計画未確保 | 未取得 | 未取得 | 未取得 | 未取得（追跡リンク/ファイル存在をR単位の実行証拠としない） |

## 実装の追加と受入は別の状態

mainには手動A/B解釈と、モデルを使わない候補台帳が増えた。しかし**G0–G8の総合合格は一つも宣言しない**。実装の有無、同一SHAの検証、ゲート受入を分ける。R29/R30/R33は評価用の型・ケース基盤があっても、実評価・被験者比較・担当/実機/許諾の確保は未着手のまま。全体の完成率は算出しない。

詳細要件は[計画§20](../requirements-and-development-plan.md#20-個別要件の実装検証追跡表)。この更新はG0/R31の追跡ずれを直す文書変更で、コード・ゲート値・CI・モデル・配布承認は変更しない。

## マージ済みmainの限定slice

| PR | 公開head → merge commit | 実装された範囲 / 受入との区別 |
|---|---|---|
| [#13](https://github.com/chameleonjp-lab/rontenseiri/pull/13) | `805e794b1dd9f1f4f31ae266d8125d62b4649ae6` → `7abc56d9203c11cc514f9168c958fead59706f44` | R12の手動A/B解釈候補UI。手動の排他的候補を扱う部分sliceで、AI判断・日本語意味品質・G3全体ではない。 |
| [#14](https://github.com/chameleonjp-lab/rontenseiri/pull/14) | `13112eef95682b9945a20b6e9caeab0c9628b68c` → `1f64f42b821c94fb6e28747c41df0cdc0d874ec1` | Project由来の決定的inventoryを通常UI→実Worker→IndexedDBへ接続。meaning unadjudicated/all-holdで、議題/関係を自動変更しない。 |
| [#15](https://github.com/chameleonjp-lab/rontenseiri/pull/15) | `64d8830abe1b1efa628dbea10456638bbac4fae9` → `8d6faa09951c47594df7c671baf3e972487d4d69` | inventoryの保存済み開始・ページ上限・訂正版資料等の追補。P2/R22全体・AI・意味上の再利用は未完。 |

上記は外部でマージされた履歴であり、この文書作業によるマージとは扱わない。特に#15は2026-10-18 18:07:40 UTCに外部マージされた時点で最終ローカル検証・本文・artifact内部照合が未完了だった。head `64d8830abe1b1efa628dbea10456638bbac4fae9` の[push 39151777368](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39151777368) / [PR 39151808684](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39151808684) のAPI successを内部照合・全受入に読み替えない。旧収集器はartifact階層不一致で内部検証未完。archive ID 12146115520 / 12145473811とdigestは[#16本文の履歴記録](https://github.com/chameleonjp-lab/rontenseiri/pull/16)に保持される。

#15の最終ローカル結果は作業者報告で総合不合格：500-node各100操作p95 selection233.30ms/search232.40ms/fold215.90ms（上限200ms）、controlled round-3 selection200.10msも不合格。raw logは作業環境に保持された報告であり、この文書作業が第三者の実機再測定を行ったものではない。失敗を後続headのCI成功で取り消さない。

レビュー者による独立確認は保存済み#16–#20 ZIPのdigest/内部SHA照合で、新しいarchive downloadではない。タスク側のdownload/内部検査/生値再計算と、外部の新規fetchは区別し、後者を行ったとは記載しない。

## 未マージの独立Draft：実装・検証・受入を分離

次の5件はPR状態取得時点で全て**OPEN / Draft / unmerged**。mainへの実装済み項目に合算しない。baseも計画依存で、マージ済みとは扱わない。各headは公開head兼記載した検証の対象であり、異なるSHAへ結果を流用しない。

| PR / 責任範囲 | exact head | base branch / SHA | push / PR CI（03:49:13 JST） |
|---|---|---|---|
| [#16 同内容成功後の古い失敗降格防止](https://github.com/chameleonjp-lab/rontenseiri/pull/16) | `563715de2df26a910643af04490aec7bf8d4216d` | `main` / `8d6faa09951c47594df7c671baf3e972487d4d69` | [push 39153514686](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39153514686) completed/success; [pull_request 39153562013](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39153562013) completed/success |
| [#17 取得済みlease停止/cleanup保持・実completed通知フェンス](https://github.com/chameleonjp-lab/rontenseiri/pull/17) | `b78c7f2cc759ceab3bc35f446284c6ecd2776051` | `fix/r22-save-generation-regression` / `563715de2df26a910643af04490aec7bf8d4216d` | [push 39154936849](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39154936849) completed/success; [pull_request 39154940318](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39154940318) completed/success |
| [#18 4境界幅の実Worker再開・厳密suffix・read-only操作観測](https://github.com/chameleonjp-lab/rontenseiri/pull/18) | `2552a9efadcafe75f227f09a4095b99500616889` | `fix/r22-save-generation-regression` / `563715de2df26a910643af04490aec7bf8d4216d` | [push 39155079297](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39155079297) completed/success; [pull_request 39155082556](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39155082556) completed/success |
| [#19 古い保存成功から新しい失敗/復旧UIを保護](https://github.com/chameleonjp-lab/rontenseiri/pull/19) | `1a21fa2d08726ccfbb1bbfe52ffe0304e4089a03` | `fix/r22-save-generation-regression` / `563715de2df26a910643af04490aec7bf8d4216d` | [push 39155353794](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39155353794) in_progress/未確定; [pull_request 39155428748](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39155428748) in_progress/未確定 |
| [#20 native待機要求の取消/timeout cleanup](https://github.com/chameleonjp-lab/rontenseiri/pull/20) | `3acf2f1958359852b33ae7b34bc0ec259d14dd4d` | `fix/r24-ownership-lease-cancellation` / `b78c7f2cc759ceab3bc35f446284c6ecd2776051` | [push 39155416740](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39155416740) in_progress/未確定; [pull_request 39155470947](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39155470947) in_progress/未確定 |

### 取得済みartifact：API結論だけとの区別

#16/#17/#18は各archiveをdownloadしAPI digestとの再計算一致、内部verified-shaの上表exact head一致、unit/browser/通常性能/controlled JSONを確認した。さらに各runのcontrolled9群の生canvas JSONをvalidateResultで再検証。これは各CI環境の検証であり実機や全ゲート合格ではない。

| PR / run | artifact（内部verified-shaは上表head） | 再計算一致したAPI SHA-256 |
|---|---|---|
| #16 / 39153514686 | [12146580571](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39153514686/artifacts/12146580571) | `sha256:b06a838682062b42fdf2a14aceb2c33b4731f40d3fd6b3a230c349aff527fd56` |
| #16 / 39153562013 | [12146087121](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39153562013/artifacts/12146087121) | `sha256:d36b1cd3a0cbfa163e2fa057c9a261cd648a25e3c7da49816bde8b6cafdc1f27` |
| #17 / 39154936849 | [12147071923](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39154936849/artifacts/12147071923) | `sha256:8b3bdc559a0e60277478b03067bd723d685abefb1bcf7c83aeca4f7eafc72d78` |
| #17 / 39154940318 | [12146887788](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39154940318/artifacts/12146887788) | `sha256:eedd93c2041b04e019c1bb9580eca219cc4ab782950e55bff9f1ff43952c4547` |
| #18 / 39155079297 | [12146938034](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39155079297/artifacts/12146938034) | `sha256:6e44eafe12498bb5ec2cd75c5d9cbbcded04a8ea0ffe283393f1f9317fbda8dc` |
| #18 / 39155082556 | [12146288217](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39155082556/artifacts/12146288217) | `sha256:465a8ac204d14a78129c2cc588e2c4cb168036a2b3f212fbcf9714913c44238f` |

#16のCIはunit410/browser105 passed・offline専用1/通常性能1/controlled9群が各runで通過。通常browserのoffline1 skippedは専用production configで別実行する意図的除外。新headの全ローカルはunit410/browser105/専用offline1等通過、通常性能がselection243.30ms/search223.40msで200ms超過、controlled9群は通過でも**総合不合格**。Node/Linux benchmarkとempty evaluationは実モデル品質ではない。

#17のCIはunit416/browser111 passed、#18はunit410/browser109 passed。両方とも各runの通常性能1/controlled9群は通過、unexpected/flaky0、通常browserのoffline1 skippedと専用production offline1通過を分離する。#17の全ローカルは03:52:14に終了し総合不合格。通常性能はselection228.40ms/search206.60msで200ms超過、controlled9群は通過。unit416/browser111 passed・offline専用1、format/build/audit/benchmark/empty evaluationは通過したが、CI成功でこのローカル失敗を取り消さない。#18の公開headローカル対象4件は通過したが、ローカル全検証完了ではない。

#18旧head `ae323f579b1561d0c6b9d0b6a48b42572df7d0ef` は[push 39154194939](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39154194939) / [PR 39154227041](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39154227041) ともBrowser acceptanceで不合格。job 117753897663 / 117753995810のstep11が最初の失敗。保存したe2e-results.jsonは650px reload後の可視入口待機失敗を示す。後続性能artifact未生成で、単なる収集不具合ではない。外部job-log取得は403「Must have admin rights to Repository」で独立確認不可だった。新headは03:46にはCI進行中、03:49にはAPI success・内部照合完了へ変化した履歴で、旧失敗を消さない。

#18は製品inventoryManifestを共有した上で独立二重ループにより期待ペアを列挙するため、manifest自体の候補欠落は独立検証できない。reload観測はpage-realmのDB操作試行であり、Worker/別タブ・DB削除/schema変更・commit完了・遅延書込全体は証明しない。Promise.all通知完了はtransaction完了ではない。browser request/Worker/WebSocket観測も実送信・production SW・全通信の不存在を証明しない。Head欄は03:45:15/03:46の公開body3行目で新full SHA一致を確認した。

#19/#20は03:49:13時点でCI進行中、03:46:30時点で各push/PR runの公開artifact数0、内部verified-sha未取得。公開headのローカル対象結果は#19 unit410/保存世代4件、#20 unit420/所有権9件通過で、published full validationとは別。#19の実IDB赤緑は旧563715dで手動/自動Aの2件失敗→新2件通過。最新B成功対照は手動のみで、autosave-B成功とB成功後の低revision A成功は未検証。#20はgrant-vs-cancel/timeout race、null-lock cleanup、release後listenerの直接計数が未検証。FixtureLocksはabort時にrejectするが内部signal listener除去をnative同様に再現しないため、その計数からnative cleanup完了を推論できない。native Web Locksでの直接cleanup証明も未取得。どちらもコード欠陥確定ではなくcoverage残余。合成Workerやfixture公開counter、旧envelope再送を実モデル/実onRecord/死んだWorker再開と混同しない。

### 03:53:58以降の追記：#19/#20のCI完了

03:49のpending表は当時のsnapshotとして残す。その後、次の同一headのpush/PR CIはcompleted/successとなった。archiveを取得してAPI digest・内部verified-sha・unit/browser/通常性能/controlled JSONを照合し、03:55:20までに両run各9群の生値も独立再検証した。ローカル対象4件/9件だけから推測した完了ではない。全ゲート受入や残余coverageの解消ではない。

| PR / exact head | run / result | artifact / 内部SHA一致 | ZIP SHA-256再計算一致 |
|---|---|---|---|
| #19 / `1a21fa2d08726ccfbb1bbfe52ffe0304e4089a03` | [push 39155353794](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39155353794) completed/success | [12146399999](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39155353794/artifacts/12146399999) / verified-sha一致 | `sha256:ba5dd1086e8da26874786b2ad01be948f8da991b919063c2c6d0375ddec22cce` |
| #19 / `1a21fa2d08726ccfbb1bbfe52ffe0304e4089a03` | [pull_request 39155428748](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39155428748) completed/success | [12147097623](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39155428748/artifacts/12147097623) / verified-sha一致 | `sha256:2d8c7d052bd3374e749c36f10501ebbc6cc6f8ca63f9ce1a93d07ba466ecefd5` |
| #20 / `3acf2f1958359852b33ae7b34bc0ec259d14dd4d` | [push 39155416740](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39155416740) completed/success | [12147206912](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39155416740/artifacts/12147206912) / verified-sha一致 | `sha256:ba4e4afa6c2895871dafad63201422815be4dd29cd0bbb0e59ce8482cdf66f2d` |
| #20 / `3acf2f1958359852b33ae7b34bc0ec259d14dd4d` | [pull_request 39155470947](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39155470947) completed/success | [12146534636](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39155470947/artifacts/12146534636) / verified-sha一致 | `sha256:75eb4ba559be1ebb913c26156c65864e847d9496c10126506265127895fa53cc` |

各runで#19はunit410/browser107 passed、#20はunit420/browser114 passed、unexpected/flaky0。通常browserのoffline1 skipped、専用production offline1、通常性能1、controlled9群をそれぞれ確認した。#19/#20の全ローカル検証を実施したという意味ではなく、上記のpublished CIと対象ローカルを分離する。

### R20/G5：#17固有の500-node UI速度失敗の来歴

測定実装は [b78c7f2固定のperformance.spec.ts](https://github.com/chameleonjp-lab/rontenseiri/blob/b78c7f2cc759ceab3bc35f446284c6ecd2776051/e2e/performance.spec.ts)。

**系列は `b78c7f2cc759ceab3bc35f446284c6ecd2776051` のみ。** selection p95 228.40ms、search206.60msで200ms上限に不合格。#11 `7da450fd60dd8eb91ca686867c7dbcdaef944e53`、#15 `64d8830abe1b1efa628dbea10456638bbac4fae9`、#16 `563715de2df26a910643af04490aec7bf8d4216d` の値・環境・系列と統合しない。controlled-production9群とCI成功は別測定で、この失敗を取り消さない。原因は未解決、G5未受入。R23の保存/訂正/限定出力/復元・履歴増大時メモリは別の未測定項目で、このUI速度値をR23の測定にしない。

| 測定契約 / 来歴 | 保存済みrawから確認できる内容 |
|---|---|
| 対象 / SHA | `canvas-500-v1`、Project v1、500nodes/50,000codepoints。servedIdentityと開始終了HEADは上記SHA、dirty=false、前後worktree空。rawのpublicPrHeadVerified=falseは公開PR照合を測定単独で証明しない旨で、公開head/CI API照合は別に行った。 |
| 時刻 / 種別 | 2026-10-18 18:45:04.469–18:46:39.972 UTC。local-only / legacy-development-v2.1、diagnosticOnly=true、eligibleForG5=false。製品予算超過の診断記録であって正式production/実機G5計測ではない。 |
| 環境 / browser / build | Linux kernel6.18.38+、Intel Xeon @2.50GHz、8 logical cores、memoryBytes25383874560。headless `/usr/bin/chromium` 151.0.7922.34、Playwright1.64.1、1440×980。WebGLはSwiftShader、WebGPU実機未取得。Vite development server（production timingではない）、health応答とdev client/HMRも一致。 |
| 操作 / 件数 | selection→search→foldの順、1 session、各100観測、warmup0、除外0。8つの時系列分散IDを使用。selectionは検索/焦点準備を計測外にし、選択解除後の実pointer click。searchはtextbox fill+Enter。foldは交互toggleだが、上記2件の失敗値へ混ぜない。 |
| p95算法 / 時間定義 | 各操作の100個を昇順sortし `sorted[max(0, ceil(n*0.95)-1)]`、補間なし。performance.mark直前→DOM条件確認と次frameまで。selection/searchは3 stable framesも要求。Playwright RPC/action/readiness overheadを含み、paint/実機input latencyではない。 |
| 再現用の実行条件 | exact SHAのclean checkoutと依存導入後、`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium PLAYWRIGHT_PORT=4254 PLAYWRIGHT_REPORT_PATH=<new-output>/performance-e2e-results.json npx playwright test e2e/performance.spec.ts --output=<new-output>/performance`。実際はdefault `playwright.config.ts`、workers1/retries0、`npm run dev -- --port 4254 --strictPort`で新規server。先行buildは通過したが測定対象はpreviewではない。未実行の再現手順であり、失敗値が再現する保証や今回の再測定ではない。 |
| 未制御 / 不明 | operation群間cache隔離なし（selection準備にsearchを含む）、Vite module/OS cacheはwarmの可能性、同時host負荷は未制御。温度/clock・負荷時系列・Node/npm版・heap・実GPUはこのrawに記録がなく不明。環境差を原因と断定せず、免責しない。 |
| 失敗証拠 / trace境界 | 下記環境内保持先のraw JSONに300操作のvalues/operationLog、performance.logとreportに200ms assertion失敗。failure画像/error-contextあり。full DOM traceは測定汚染を避けoffで、trace.zip存在を主張しない。失敗データを変更・再実行していない。 |

環境内保持先（リポジトリ未収録、GitHub CI runではない）：
`/workspace/r22-followup-20261019-FpncwY/r24-final-b78c7f2cc759ceab3bc35f446284c6ecd2776051/`

| 証拠ファイル | SHA-256 |
|---|---|
| `artifacts-generated/canvas-performance.json` | `dd30d962cce0484fde9714209c38519a7bdae34e2ae2bd387547ca4d848b0e3a` |
| `performance.log` | `3fab7648caaf7f1aabaa1159042410208404e0e956a7e2aa73d5ff1cc77724b0` |
| `performance-e2e-results.json` | `2a8f42cb34b4e5c2d0c55e4fa2c33015ae045f27c5d67d4cc062924579998c9a` |

元の`verified-sha.txt`、`head-after.txt`、前後worktree、`SHA256SUMS`も同じ保持先に残す。上の再計算は保存rawの照合であり性能測定の再実行ではない。

## P2の限定的な経路追加

[ローカル解析経路の取消・再開](local-analysis-run.md)で、R22/R24/R26/R32のうち固定入力・設定、検証済みcheckpoint、取消・厳密再開・旧run排除を通常UI→実Worker→IndexedDBで検査する。これは明示的なモデルなしfixtureであり、実モデル経路の完成やAI品質の証拠ではない。上表の部分実装判定とG0–G8の総合判定は変更しない。今回の実測値・件数はPR headと一致するCI artifactを正本とし、上記の過去の件数へ加算してゲートを合格扱いしない。

追加の [fixture-bounded reconciliation + partial-result contract](fixture-bounded-reconciliation.md) は、内部予算で停止する決定的な照合と、未照合を完了扱いしないSession契約だけを対象とする。通常UIの輸送fixtureとは分離し、R22全体、訂正依存の再利用、実モデル品質、G4の端末別資源上限は未完了。G2–G8、実機、アクセシビリティ、OSの判定は変更しない。

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
| G5 | **未達（部分）** | SHA別の機能/専用offline/CI成功はあるが、旧#15および#16通常ローカル500-node p95不合格を保持。実機・最大履歴も未受入 |
| G6   | **未達（部分）** | offline静的shell、scope/hash、許可DTO等は検査。モデル取得・全通信・完全隔離は未検証 |
| G7   | **未達**         | LICENSE、権利者、依存・モデル・サンプル再配布、公開承認未完了                       |
| G8   | **未測定**       | 被験者比較なし                                                                      |

## 評価・性能とPR #12までの履歴（現在headの実績ではない）

21件の架空日本語評価ハーネスは固定されていますが、実モデル予測は0件、結果は**not-run**です。未実行分を合格数へ算入しません。`software-benchmark.json`はNode/Linuxのみ、50,000文字・500node・20回の入力／検証／layout／出力／restore p95で、G4/G5品質合格ではありません。

PR #11の旧head `7da450f` には、ローカルdev検索の220.4ms／再実行221.3msと選択217.1ms、production round-2-foldの200.5msという200ms超過が残っています。[診断と証跡検証器の修正](pr11-local-performance-diagnosis.md)では、元の失敗を再実行・免責せず、別browser/hostでのCI成功と分離して保存しました。logとraw値の不一致を拒否する修正は証拠整合性の改善であり、遅延原因の解決・G5合格・全P2/R22完了を意味しません。

### PR #12のSHA別CI記録

本追補の親である実装head `f6cbd6a1743385b179d06f47a95329aa19cc41e2` のexact-head CIは、[push 39127695793](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39127695793)と[PR 39127732821](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39127732821)です。本追補時点では両方進行中で、成功とは記載しません。旧head `7da450fd60dd8eb91ca686867c7dbcdaef944e53` の成功run `39125745484`／`39125750810`とは別の結果です。

この文書追補も新しいheadを作るため、上記runを追補後headの実行と読み替えません。最終headとそのpush/PR run ID・完了結果・verified SHAは[PR #12本文](https://github.com/chameleonjp-lab/rontenseiri/pull/12)に別途記録し、各artifactのSHAと照合します。Sapo／Kamekameの確認は `f6cbd6a` に対する静的レビューであり、テスト・計測実行の証拠ではありません。

#### `af8e9309951b29d501ceb564c3f8176a200c7a03` の完了記録（新しい追補headの実績ではない）

上記の進行中記録は初回文書追補時のsnapshotです。その後 `f6cbd6a` の両runはcompleted/successとなり、両artifact内部のverified SHAもf6cbd6aの完全SHAと一致しました。文書追補後の検証対象 `af8e9309951b29d501ceb564c3f8176a200c7a03` は次のとおりです。

| 種別 | run／API結論 | 取得したartifact | artifact内部のverified SHA |
|---|---|---|---|
| push | [39127993263](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39127993263)／completed・success | [12137446125](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39127993263/artifacts/12137446125) | `af8e9309951b29d501ceb564c3f8176a200c7a03` |
| PR | [39127997341](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39127997341)／completed・success | [12137371278](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39127997341/artifacts/12137371278) | `af8e9309951b29d501ceb564c3f8176a200c7a03` |

両artifactを取得して内容を確認し、それぞれunit374/374、browser88 passed＋1 intended skip、production9/9群、旧dev gate成功を確認しました。全18 production群を修正後validatorで再検査しています。メタデータだけの確認とは区別します。

配布ZIPのSHA-256もAPI digestと一致しました。pushは `2f66db8e5abe6069f5e4f82baaa9529cdedcacb32701a0fe35a18d5c56786058`、PRは `ceee370d028ed5e3ead6378a32e8ef90dd97177313603a3f2862cfeafdf09f6e`。両ZIPのCRCは正常で、各52ファイルが展開取得したartifactとbyte一致しました。これは今回取得したaf8e930 artifactの確認であり、旧PR #11の外部原ZIPの独立認証や、validatorのrun/round/session identity保証には拡張しません。

旧失敗の[診断](https://github.com/chameleonjp-lab/rontenseiri/blob/af8e9309951b29d501ceb564c3f8176a200c7a03/docs/evaluation/pr11-local-performance-diagnosis.md)と[保存raw manifest](https://github.com/chameleonjp-lab/rontenseiri/blob/af8e9309951b29d501ceb564c3f8176a200c7a03/docs/evaluation/evidence/7da450f/manifest.json)はaf8e930固定で参照できます。ローカル遅延原因は未解決であり、今回のCI成功は旧失敗の解決、G4/G5合格、全P2/R22完了を意味しません。

Sapoの最終確認はno-cacheのrun/stateメタデータで、artifact内容未検査です。Kamekameのaf8e930確認は静的レビューで、新たなcode findingなし。作業者による上記artifact取得・内部SHA/digest照合とは別の証拠です。この完了記録の追補自体も新しいheadを作るため、そのheadのCIをaf8e930へ読み替えず、最新結果はPR本文に追記します。旧ローカル性能失敗、G5、全P2/R22の未完了判定は不変です。

## 本質ブロッカーと計画分離

1. モデル成立性（取得量・GPUメモリ・日本語品質、AI disabled）。
2. 意味品質証拠（問い／応答／立場／根拠／不確かさ、公平性、G8）。
3. 公開成立性（実機、p95、復旧、保存隔離、権利・配布承認）。

PR #3は基盤（coverage、capacity、reasoning型/API、lineage、Undo、fixed point、所有権、session checkpoint、namespace、ReadinessPanel、offline境界）、未結線の文書実験APIも同じPR内に隔離。G0–G8はいずれも総合合格へ変更していない。

## 基盤時点に固定した失敗再現と境界（履歴）

- `public-review-fixtures.test.ts`: 復帰なしの保存復元、復帰先の分類変更、別議題の要約依存だけへの再確認伝播、未割当原文の位置と非完了manifest。分割後の要約依存移送とA→B→Aの意味表示も検査。
- `review-blockers.test.ts`: A→B→Cの複数段依存、無関係Dの不変、Undo、循環入力の拒否。限定出力は全階層の未知キー、reasoning/runs/lineage、旧原文版、履歴ダミーを除外。
- `storage-conflict.spec.ts`: IndexedDB readwrite transaction内のstorageRevision比較で旧版上書きを拒否。原文・履歴・Undoを保持。
- 復帰線を跨ぐ議題境界では、意味上の復帰ラベルを時系列の切替ラベルより優先する。
- テストのポートを可変化しstrictPortを使用。旧checkoutのプレビューを誤検証しない。CIはPRのhead SHAを明示checkoutし、検証SHAをartifactへ記録する。
