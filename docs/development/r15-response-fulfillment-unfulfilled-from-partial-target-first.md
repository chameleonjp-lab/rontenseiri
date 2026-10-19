# R15：先頭の部分充足から未充足への訂正

## 今回の範囲

#52 exact head `ff24e6d3e2afff4c33b1ee3d76edcd4fc12ab96a`を計画上の基点とする別Draft。編集開始前の#52はOPEN/Draft/未マージ。CI/mergeを待たず同範囲の次ケースへ進めるが、実マージとは扱わない。

`e2e/r15-response-fulfillment-unfulfilled-from-partial-target-first.spec.ts`は、同じ二応答・同じgraphの独立ケース。対象A先頭・独立B2番目。両初期`partially-fulfilled`から、Aの要求充足だけを`not-fulfilled`へ通常UIで訂正する。Bは部分充足のままなので全件同値更新を検出できる。#52のB先頭/A2番目ケースを含む既存ケース・製品コード・依存は無変更。外部AI利用なし。

対象AはOLD_VERSION/answer/U02、独立BはINDEPENDENT_VERSION/answer/U03。厳密ID期待値map・全応答オブジェクト・全ID/データ・画面順序で全件更新・別応答誤更新・順序変化を検出する。対象の充足以外の全フィールド、独立Bのactor/時点/note/空根拠・反論先を含む全オブジェクトを保持する。応答・根拠・反論先・graphを追加しない。

Aは所属U01/U02・依存U02、Bは所属/依存U03。問い版sourceはU01/U03。初期/訂正後/Undo後の両まとめの「回答あり」を画面で検査し、訂正後はAだけ要再確認、B全体不変。回答ありと要求充足は別記録。

## 保存・再開・Undo

通常完全復元→初回明示保存→理由付きUI単一フィールド訂正→autosave→native readonly IndexedDB→reload/最近の作業→UI/警告/完全JSON→通常UI Undo→autosave→2回目reload。訂正イベントは共有履歴before/after全graph/まとめ、理由/ID参照/時刻を比較する。Undo後の現在graph/まとめがbaselineへ復元すること、共有履歴の先頭の訂正1件がrevisedの同イベントと完全一致すること、Undoイベントのkindとafter.targetRevisionIdを比較し、保存世代の増加を検査する。Undoイベント自身のbefore/after全payload・ID/理由/時刻の整合性は検査しない。Undoは対象を部分充足へ戻す。全体30秒/10秒poll、preview前DB選択議題/履歴件数/保存済み待機は維持し、状態注入しない。

## 証拠と限界

証拠は`/workspace/r15-fulfillment-unfulfilled-from-partial-target-first-evidence-20261019T1013/`。確定SHAの生ログ/終了コード/unit JSONは`exact-checks/`、関連browser結果/JSON添付は`exact-head/`へ保持する。失敗は一意の場所へ残し、過去headの検証やレビューを流用しない。#51では広い19件実行の初回に新規を含む18件pass/既存retarget preview待機1件fail、同一SHA・同条件・変更なし再実行19件と基点#50診断2件は通過したが、実行間の不安定さは未解消・原因未確定。初回生ログ/traceを保持し、再実行で失敗を消さない。その記録を今回の新規テスト失敗・成功とは混同しない。

復元後baseline比較。共有履歴before/afterはgraphとまとめを比較し監査snapshot全フィールドは比較していない。インポート前独立完全fixture oracle/最終JSON再インポート、作成UI、非空根拠/反論先、複雑/混合依存、既存履歴/多段Undo・Undo payload全体、保存失敗/競合、意味品質、性能、実機、UI全フィールド個別表示は未検証。R08/R15/G5/G0–G8全受入・CI合格・独立レビュー完了・実マージを主張しない。通常push/別Draftのみ、self-merge/ready/rebase/force-pushなし。
