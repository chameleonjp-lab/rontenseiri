# R15：2番目の部分充足から充足への訂正

## 今回の範囲

`e2e/r15-response-fulfillment-restore-target-order.spec.ts`は、二応答の対象2番目の要求充足を`partially-fulfilled`から`fulfilled`へ通常UIで訂正する別fixture/別テスト。先行#45までの全ケースを変更しない。充足単一フィールドという範囲を維持し、発言付替え・追加graph・製品コード・依存変更・外部AI利用は含めない。

先頭は独立`response-venue`（別問い版/answer/not-fulfilled/U03）、2番目は対象`response-cost`（旧問い版/answer/partially-fulfilled/U02）。対象の充足以外の全フィールド、独立応答のactor/時点/note/空根拠・反論先を含む全オブジェクトを保持する。厳密なID期待値map・全応答オブジェクト・全ID順序と画面順序を比較し、全件上書き/先頭誤更新/並び替えを検出する。

通常UIの表示は対象が「部分充足」から「充足」へ変わるだけで、双方の「回答」と独立応答の「未充足」を保持する。Aは所属U01/U02・依存U02、Bは所属/依存U03。問い版sourceはそれぞれU01/U03。Aだけ要再確認となり、B全体と両まとめの「回答あり」は不変。充足への訂正でもまとめを自動的に正しいと認定しない。

## 保存・再開・Undo

通常完全バックアップ復元→初回明示保存→理由付きUI単一フィールド訂正→自動保存→native readonly IndexedDB→reload/最近の作業→UI/警告/完全JSON→通常UI Undo→自動保存→2回目reloadを通す。Undoは対象を部分充足へ戻し、元graph/議題/応答順序・監査prefix・Undo targetを保持する。共有履歴before/after全graph/まとめ・理由/ID参照/時刻、保存世代も比較する。30秒全体/10秒poll、preview前DB選択議題/履歴件数/保存済み待機は維持する。

## 証拠と限界

証拠は`/workspace/r15-fulfillment-restore-target-order-evidence-20261019T0914/`。確定SHAと結果は`exact-checks/`、`exact-head/`、Draft本文に記録し、失敗時は生ログ・JSON・trace等を一意の場所へ保存する。先行結果や#44静的レビューを今回headへ流用しない。

復元後baseline比較であり、インポート前独立完全fixture oracle/最終JSON再インポート、作成UI、非空根拠/反論先、複雑/混合依存、既存履歴/多段Undo・Undo payload全体、保存失敗/競合、意味品質、性能、実機、UI全フィールド個別表示は未検証。R08/R15/G5/G0–G8全受入・CI合格・独立レビュー完了・実マージを主張しない。#45 headを計画上の基点とする別DraftとしCI/mergeは待たず、self-merge/ready/rebase/force-pushしない。
