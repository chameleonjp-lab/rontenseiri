# R15：先頭の未充足から部分充足への訂正

## 今回の範囲

#50 exact head `cbe5eae776beca39550b0ec6852a97a7ec6b9916`を計画上の基点とする別Draft。開始時の#50はOPEN/Draft/未マージで、CI/mergeを待たず進めるが、実マージとは扱わない。

`e2e/r15-response-fulfillment-partial-from-unfulfilled-target-first.spec.ts`は、同じ二応答・同じgraphの独立ケース。対象A先頭・独立B2番目で、対象の要求充足だけを`not-fulfilled`から`partially-fulfilled`へ通常UIで訂正する。#50までの全ケースは無変更。製品コード・依存変更・外部AI利用なし。

先頭`response-cost`はOLD_VERSION/answer/not-fulfilled/U02、2番目`response-venue`はINDEPENDENT_VERSION/answer/not-fulfilled/U03。初期の充足値が同じでも、対象だけを部分充足へ変え、独立応答は未充足のまま。厳密ID期待値map・全応答オブジェクト・全ID順序・画面順序で全件更新・独立応答誤更新・順序変化を検出する。対象の充足以外の全フィールドと独立応答のactor/時点/note/空根拠・反論先を含む全オブジェクトを保持する。

Aは所属U01/U02・依存U02、Bは所属/依存U03。問い版sourceはU01/U03。初期/訂正後/Undo後の両まとめの「回答あり」を画面で検査し、訂正後はAだけ要再確認、B全体不変。回答ありと要求充足は別記録であり、部分充足への訂正でも要再確認は自動解除しない。応答・根拠・反論先・graph追加なし。

## 保存・再開・Undo

通常完全復元→初回明示保存→理由付きUI単一フィールド訂正→autosave→native readonly IndexedDB→reload/最近の作業→UI/警告/完全JSON→通常UI Undo→autosave→2回目reload。共有履歴before/after全graph/まとめ、理由/ID参照/時刻、保存世代、Undo元graph/監査prefix/targetを比較する。Undoは対象を未充足へ戻す。全体30秒/10秒poll、preview前DB選択議題/履歴件数/保存済み待機は維持し、状態注入しない。

## 証拠と限界

証拠は`/workspace/r15-fulfillment-partial-from-unfulfilled-target-first-evidence-20261019T0948/`。確定SHAの生ログ/終了コード/unit JSONは`exact-checks/`、関連browser結果/JSON添付は`exact-head/`へ保持する。失敗時は一意の場所へ残し、既存headの検証やレビューを流用しない。

復元後baseline比較。共有履歴before/afterはgraphとまとめを比較し、監査snapshot全フィールドは比較していない。インポート前独立完全fixture oracle/最終JSON再インポート、作成UI、非空根拠/反論先、複雑/混合依存、既存履歴/多段Undo・Undo payload全体、保存失敗/競合、意味品質、性能、実機、UI全フィールド個別表示は未検証。R08/R15/G5/G0–G8全受入・CI合格・独立レビュー完了・実マージを主張しない。通常push/別Draftのみで、self-merge/ready/rebase/force-pushしない。
