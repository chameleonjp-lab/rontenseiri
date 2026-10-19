# R15：配列2番目の応答の問い版だけを付け替える限定回帰

## 今回の範囲

`e2e/r15-response-version-target-order.spec.ts`を別fixture/別テストとして追加する。#41のkind、#42のfulfillment、対象先頭の二応答ケース、既存の一応答retargetケースは変更しない。製品コード・依存変更・外部AI利用はない。

先頭の独立`response-venue`、2番目の対象`response-cost`の順序を保ち、通常UIで対象の厳密IDを選び、`questionVersionId`だけを同一問い内の旧版`question-version-original`から現行版`question-version-tax`へ付け替える。独立応答はどちらとも異なる`question-version-venue`を保持するため、全応答一括付け替えも検出できる。

全応答ID順序、IDをキーとした期待値map、対象の版以外の全フィールド、独立応答全オブジェクトを比較する。対象kind=answer・fulfillment=fulfilled・U02と、独立answer/not-fulfilled・別問い版・U03・actor・時点・note・空根拠/反論先は不変。初回・再開・Undo後の画面でも先頭/2番目の厳密ID、対象版・発言・種別・要求充足を直接検査する。

Aは所属U01/U02・依存U02、Bは所属/依存U03。対象版source U01・独立版source U03、全問い/版/current参照を明示assertし、関係・根拠・意味項目・解釈・立場変更・排他群・不確実性伝播は空に保つ。Aだけ要再確認、B完全不変、両まとめの「回答あり」を保持する。応答・根拠・反論先・graphの追加は行わない。

## 保存・再開・Undo

通常完全復元→初回明示保存→理由付きUI単一フィールド編集→自動保存→native readonly IndexedDB観測→reload/最近の作業→UI/警告/完全JSON→通常UI Undo→自動保存→2回目reload。共有履歴before/afterの全graph/まとめ、理由、イベントID参照/時刻、保存世代、Undo後の元graph/監査prefix/targetを比較する。全体30秒/poll10秒、プレビュー前のDB選択議題・履歴件数・保存済み待機は維持する。

証拠ルートは`/workspace/r15-version-target-order-evidence-20261019T0857/`。確定headのローカル検証は`exact-checks/`と`exact-head/`の生ログ・tested-sha・JSON添付、およびDraft PR本文に記録する。失敗があれば固有パスへ保存し、成功結果と区別する。

## 限界

通常復元後baselineとの比較であり、インポート前独立完全fixture oracle・最終JSON再インポート、問い/版/応答作成UI、非空根拠/反論先、複雑/混合依存、既存履歴/多段Undo・Undo payload全体、保存失敗/競合、意味品質、性能、実機は未検証。R08/R15/G5/G0–G8全受入、CI/artifact内部、独立レビュー、実マージを主張しない。先行headのレビューを流用しない。#42のexact headを計画上の基点とし、CI/mergeを待たず別Draftで提出する。self-merge/ready/rebase/force-pushは行わない。
