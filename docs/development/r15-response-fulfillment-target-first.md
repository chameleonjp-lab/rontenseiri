# R15：配列先頭の要求充足だけを訂正する限定回帰

## 今回の範囲

`e2e/r15-response-fulfillment-target-first.spec.ts`を#42の対称順序の独立ケースとして追加する。既存#41〜44、対象先頭kind、一応答ケースは変更しない。製品コード・依存の変更や外部AIの利用はない。

同じ二応答を先頭の対象`response-cost`、2番目の独立`response-venue`に置く。通常UIで厳密な対象IDを選び、要求充足だけを`fulfilled`から`partially-fulfilled`（表示「部分充足」）へ訂正する。対象の旧問い版/answer/U02、独立応答の別問い版/answer/not-fulfilled/U03を保持する。全応答一括上書きや末尾誤更新、並び替えをID期待値map・全オブジェクト・全ID順序比較で検出する。

対象の充足以外の全フィールド、独立応答のactor/時点/note/空根拠・反論先を含む全オブジェクトを直接比較する。初回・再開・Undo後の画面で先頭と2番目のID、両応答の種別・充足・対象版・発言も検査する。

Aは所属U01/U02・依存U02、Bは所属/依存U03。対象問い版のsourceはU01、独立問い版のsourceはU03。全問い・版・current参照と応答参照を確認する。関係・根拠・意味項目・解釈・立場変更・排他群・不確実性伝播は空で、追加の応答や迂回依存は作らない。Aだけ要再確認になり、B全体と両まとめの「回答あり」は保持される。

## 保存・再開・Undo

通常の完全バックアップ復元→初回明示保存→理由付きUI単一フィールド訂正→自動保存→native readonly IndexedDB観測→reload/最近の作業→UI/警告/完全JSON→通常UI Undo→自動保存→2回目reloadを通す。共有履歴before/afterの全graph/まとめ・理由・イベントID参照/時刻、保存世代、Undo後の元graph/監査prefix/targetも比較する。全体30秒、poll10秒、プレビュー前のDB選択議題・履歴件数と保存済み待機は緩めない。

## 検証証拠

証拠ルートは`/workspace/r15-fulfillment-target-first-evidence-20261019T0909/`。確定コミットの実行結果・tested SHAは`exact-checks/`と`exact-head/`およびDraft PR本文に記録する。失敗があれば一意のディレクトリに生ログ・JSON・trace等を保存し、成功結果と区別する。先行ケースの結果・レビューを今回headへの結果として流用しない。

## 限界

通常復元後のbaselineとの比較である。インポート前独立完全fixture oracle・最終JSON再インポート、問い/版/応答の作成UI、非空根拠/反論先、複雑/混合依存、既存履歴/多段Undo・Undo payload全体、保存失敗/競合、意味品質、性能、実機、UI全フィールド個別表示は未検証。R08/R15/G5/G0–G8全受入、CI/artifact内部、独立レビュー、実マージを主張しない。CI/mergeを待たず#44のheadを計画上の基点とする別Draftとして提出し、self-merge/ready/rebase/force-pushは行わない。
