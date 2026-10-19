# R15：2番目の部分充足から未充足への訂正

## 今回の範囲

#51 exact head `0a0e2587ca49a08b2866e18900f7aa87891547cd`を計画上の基点とする別Draft。編集開始前の#51はOPEN/Draft/未マージ。CI/mergeを待たず同範囲の次ケースへ進めるが、実マージとは扱わない。

`e2e/r15-response-fulfillment-unfulfilled-from-partial-target-order.spec.ts`は、同じ二応答・同じgraphの独立ケース。独立B先頭・対象A2番目。両初期`partially-fulfilled`から、Aの要求充足だけを`not-fulfilled`へ通常UIで訂正する。Bは部分充足のままなので全件同値更新を検出できる。#51までの全ケース・製品コード・依存は無変更。外部AI利用なし。

対象AはOLD_VERSION/answer/U02、独立BはINDEPENDENT_VERSION/answer/U03。厳密ID期待値map・全応答オブジェクト・全ID/データ・画面順序で全件更新・先頭誤更新・順序変化を検出する。対象の充足以外の全フィールド、独立Bのactor/時点/note/空根拠・反論先を含む全オブジェクトを保持する。応答・根拠・反論先・graphを追加しない。

Aは所属U01/U02・依存U02、Bは所属/依存U03。問い版sourceはU01/U03。初期/訂正後/Undo後の両まとめの「回答あり」を画面で検査し、訂正後はAだけ要再確認、B全体不変。回答ありと要求充足は別記録。

## 保存・再開・Undo

通常完全復元→初回明示保存→理由付きUI単一フィールド訂正→autosave→native readonly IndexedDB→reload/最近の作業→UI/警告/完全JSON→通常UI Undo→autosave→2回目reload。訂正イベントは共有履歴before/after全graph/まとめ、理由/ID参照/時刻を比較する。Undo後の現在graph/まとめがbaselineへ復元すること、共有履歴の先頭の訂正1件がrevisedの同イベントと完全一致すること、Undoイベントのkindとafter.targetRevisionIdを比較し、保存世代の増加を検査する。Undoイベント自身のbefore/after全payload・ID/理由/時刻の整合性は検査しない。Undoは対象を部分充足へ戻す。全体30秒/10秒poll、preview前DB選択議題/履歴件数/保存済み待機は維持し、状態注入しない。

## 証拠と限界

証拠は`/workspace/r15-fulfillment-unfulfilled-from-partial-target-order-evidence-20261019T0959/`。確定SHAの生ログ/終了コード/unit JSONは`exact-checks/`、関連browser結果/JSON添付は`exact-head/`へ保持する。失敗は一意の場所へ残し、過去headの検証やレビューを流用しない。基点#51では広い19件実行の初回既存retarget preview待機が1回失敗し、同条件再実行19件と基点#50診断2件は通過したが、実行間の不安定さは未解消。その記録を今回の新規テスト失敗・成功とは混同しない。

復元後baseline比較。共有履歴before/afterはgraphとまとめを比較し監査snapshot全フィールドは比較していない。インポート前独立完全fixture oracle/最終JSON再インポート、作成UI、非空根拠/反論先、複雑/混合依存、既存履歴/多段Undo・Undo payload全体、保存失敗/競合、意味品質、性能、実機、UI全フィールド個別表示は未検証。R08/R15/G5/G0–G8全受入・CI合格・独立レビュー完了・実マージを主張しない。通常push/別Draftのみ、self-merge/ready/rebase/force-pushなし。
