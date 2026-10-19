# R15 応答種別だけの訂正を保存・再開・Undoまで確認

Draft #38のhead `51683a3f1815f1bc37641145a95fd770a8c5092a`を計画上の基点に、1応答の種別だけをanswerからcounterargumentへ訂正する独立ケースを追加する。実マージとは区別し、test/docs-onlyで製品コードは変更しない。

## 種別と要求充足は独立

`e2e/r15-same-question-version-retarget.spec.ts`のretarget・fulfillmentケースは残し、新しいkindケースを独立したプロジェクトとブラウザcontextで実行する。通常UIで「応答種別」だけを反論に変更し、要求充足fulfilled、対象superseded旧版、回答発言U02、actor・time・note・空の根拠/反論先を含む他の全応答フィールドを完全オブジェクト比較で保持する。種別変更から未充足や未回答を推定しない。

Aの依存はU02だけ、独立BはU03だけ。根拠・関係・意味項目等の迂回経路なし、追加応答なし、非空の反論先なし。Aだけ要再確認となり、Bと両議題のanswer=present、問い・版・currentVersionIdを保持する。UIの種別ラベル・対象版・要求充足と完全JSONを確認する。

## 保存とUndoの比較

完全JSONの通常復元UI→初回明示保存→理由付きの種別訂正→自動保存→native readonly IndexedDB→reload/最近の作業→UI警告・graph・完全JSON→通常UI Undo→自動保存→2回目reload/完全JSON。テスト30秒、poll 10秒、プレビュー前の選択議題/履歴件数のDB反映と保存済み待機を維持する。

共有履歴before/afterの全graph・まとめ、理由、推論/共有イベントID参照と時刻、保存世代、Undo後の元graph・監査prefix・Undo targetを比較する。添付JSONはモード名で区別する。fixture生成以外にdomain/storage書込みAPIやstate注入を使わない。

## 今回の限界

復元後baselineとの比較であり、独立したインポート前比較や最終JSON再インポートは行わない。問い/版/応答の作成UI、追加応答保持、非空反論先、既存履歴・多段Undo・Undo payload全体、混合/多段依存、保存失敗/競合、意味品質、性能、実機は未検証。R08/R15/G5/G0–G8の全受入とは扱わない。先行ケースの失敗証拠は保持し、CI・artifact内部・独立レビュー・実マージをローカル成功から推定しない。外部AIや追加サービス依存は導入しない。
