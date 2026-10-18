# R15：配列2番目の要求充足だけを訂正する限定回帰

## 今回の範囲

`e2e/r15-response-fulfillment-target-order.spec.ts`を独立ケースとして追加する。#41のkind訂正、#40の対象先頭の二応答ケース、既存の一応答ケースは変更しない。製品コード・依存の変更や外部AIの利用はない。

同じ二応答構造の順序を先頭の独立`response-venue`、2番目の対象`response-cost`のまま保つ。通常UIで対象IDを選び、要求充足だけを`fulfilled`から`partially-fulfilled`（表示「部分充足」）へ訂正する。独立応答は異なる`not-fulfilled`のままであり、全応答への一括上書きを検出できる。

厳密なIDをキーとした期待値map、全応答ID順序、対象の充足以外の全フィールド、独立応答の全オブジェクトを直接比較する。対象kindはanswer、問い版は旧版、回答発言はU02のまま。独立応答のkind/別問い版/U03/actor/時点/note/空根拠・反論先も保持する。初回・再開・Undo後の画面で先頭と2番目のIDを直接確認し、両応答の種別・充足・対象版・発言を検査する。

Aは所属U01/U02・依存U02、Bは所属/依存U03。対象問い版のsourceはU01、独立問い版のsourceはU03。全問い・版・current参照と応答参照を確認する。関係・根拠・意味項目・解釈・立場変更・排他群・不確実性伝播は空で、追加の応答や迂回依存は作らない。Aだけ要再確認になり、Bと両まとめの「回答あり」は保持される。

## 保存・再開・Undo

通常の完全バックアップ復元→初回明示保存→理由付きUI単一フィールド訂正→自動保存→native readonly IndexedDB観測→reload/最近の作業→UI/警告/完全JSON→通常UI Undo→自動保存→2回目reloadを通す。共有履歴before/afterのgraph/まとめ・理由・イベントID参照/時刻、保存世代、Undo後の元graph/監査prefix/targetも比較する。全体30秒、poll10秒、プレビュー前のDB選択議題・履歴件数と保存済み待機は緩めない。

## 検証証拠と初回失敗

証拠ルートは`/workspace/r15-fulfillment-target-order-evidence-20261019T0852/`。初回はテスト側の期待表示「一部充足」が実表示「部分充足」と一致せず失敗した。生ログ・JSON・trace・スクリーンショットを`initial/`に残す。`src/components/ReasoningPanel.tsx`の既存ラベルと観測を照合し、テストの表示期待と理由文だけを「部分充足」に直した。製品欠陥の証拠ではなく、assertやtimeoutの緩和もしない。確定コミットの実行結果・tested SHAは`exact-checks/`と`exact-head/`およびDraft PR本文に記録し、初回失敗と区別する。

## 限界

通常復元後のbaselineとの比較である。インポート前独立比較・最終JSON再インポート、問い/版/応答の作成UI、非空根拠/反論先、複雑/混合依存、既存履歴/多段Undo・Undo payload全体、保存失敗/競合、意味品質、性能、実機は未検証。R08/R15/G5/G0–G8全受入、CI/artifact内部、独立レビュー、実マージを主張しない。先行ケースのレビューをこのheadへ流用しない。CI/mergeを待たず#41のheadを計画上の基点とする別Draftとして提出し、self-merge/ready/rebase/force-pushは行わない。
