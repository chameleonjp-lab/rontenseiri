# R15：先頭の充足から部分充足への訂正

## 今回の範囲

#56 exact head `913cc928db33a2d61c3cdf2cb31e3ec30bb139a6` を保持したまま、その次の統合テストとして追加する。既存#56の証拠・spec/docsは変更せず、新headで再検証する。既存#56はOPEN/Draft/未マージとして扱い、実マージとは扱わない。

`e2e/r15-response-fulfillment-partial-from-fulfilled-target-first.spec.ts` は、同じ二応答・同じgraphの統合追加ケース。対象A先頭・独立B2番目。両初期 `fulfilled` から、Aの要求充足だけを `partially-fulfilled` へ通常UIで訂正する。Bは `fulfilled` のまま全object不変なので、全件同値更新と対象ID選択を検出できる。既存#56の `e2e/r15-response-fulfillment-partial-from-fulfilled-target-order.spec.ts` は独立B先頭・対象A2番目であり、今回との差分は同じ契約を応答配列の順序反転でも検出することである。製品コード、既存spec、既存docs、依存は無変更。外部AI利用なし。

対象AはOLD_VERSION/answer/U02、独立BはINDEPENDENT_VERSION/answer/U03。厳密ID期待値map・全応答object・全ID/データ・画面順序で、全件更新、別応答誤更新、順序変化を検出する。対象Aは充足以外の全フィールドを保持し、独立Bはactor/時点/note/空根拠・反論先を含む全objectを保持する。応答・根拠・反論先・graphを追加しない。

Aは所属U01/U02・依存U02、Bは所属/依存U03。問い版sourceはU01/U03。初期・訂正後・Undo後の両まとめに「回答あり」を画面で検査し、訂正後はAだけ `needsReview` と要再確認警告、B全体不変とする。回答ありと要求充足は別記録する。

## 保存・再開・Undo

通常完全復元→初回明示保存→理由付きUI単一フィールド訂正→autosave→native readonly IndexedDB→reload/最近の作業→UI/警告/完全JSON→通常UI Undo→autosave→2回目reload。訂正イベントは共有履歴のbefore/after全graph/まとめ、理由/ID参照/時刻、保存世代を比較する。Undo後の現在graph/まとめがbaselineへ復元すること、共有履歴先頭の訂正1件がrevisedの同イベントと完全一致することを検査する。Undoイベントについても、全before/after semantic payload、targetId、独自ID、`kind: undo`、`reason: Undo: <訂正理由>`、`after.targetRevisionId`、ISO形式として解釈できる生成時刻、先行訂正イベントの不変性を検査する。生成時刻はDate.now()のwall clockに依存するため、形式のみを検査し、strictな単調性・前後関係は検証しない。JSON出力は通常UIでfull/history付きpreviewを作り、supportedな「JSONから復元」で別copyへimportする。fixture作成直後のbaselineとimport前に保持したoriginalを、project ID・更新時刻・saved・storageRevision以外の全フィールドで比較し、最終別copyも同じ契約で比較する。これはproductionのcreateProject/parseInputs等を使う限定fixtureの全比較であり、全生成処理から独立したoracleを主張しない。全体30秒/10秒poll、preview前DB選択議題/履歴件数/保存済み待機は維持し、状態注入しない。
## 証拠と限界

#51/#54の初回preview失敗と再実行成功は原因未確定で、実行間の不安定さは未解消である。再実行成功で初回失敗を消さず、今回の新規テスト結果とも混同しない。#55/#56の既存ローカル結果でも不安定さの解消は主張できない。失敗は一意pathへ保持する。新headのテスト生ログ・終了コード・JSONと独立静的レビューは実装担当の作業と分離し、統合後のPR本文に実績を記録する。通常pushのみ、self-merge/ready/rebase/force-pushは行わない。

Undoの全payloadと監査ID/理由/時刻形式、UI経由のfull JSON別copy往復、semantic stateと履歴IDの保持を検証する。時刻は形式のみで、Date.now()のwall clockによるstrictな単調性・前後関係は検証しない。importではproject ID・更新時刻・saved・storageRevisionだけを契約上の比較対象外とする。fixtureはproductionのcreateProject/parseInputs等を利用するため、今回の限定fixtureでimport前originalとbaselineを全比較するが、全生成処理から独立した完全fixture oracleとは主張しない。作成UI、非空根拠/反論先、複雑/混合依存、保存失敗/競合、多段Undo、意味品質、性能、実機、UI全フィールド個別表示、CI artifact内部は未検証。R08/R15/G5/G0–G8全受入、CI合格、独立レビュー完了、実マージを主張しない。
