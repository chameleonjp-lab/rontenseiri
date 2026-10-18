# 16164918 のローカル最終整合性チェック — 非成功

元の実行は `/workspace/verify-r12-final.sh`、検証対象は `16164918c02afba0035829b5f0101dceb5c817d0`。記録先 `/workspace/r12-evidence/final-16164918-20261018-133300/` は変更せず保持しています。結論は **FINAL exit=1** です。個別コマンドの成功を理由に、このローカル実行全体を成功と再分類しません。

[`status.tsv`](status.tsv) にはformat・unit・build・audit・browser・offline・benchmark・evaluateの終了コードがすべて0と記録されています。しかしスクリプトが試験前に `artifacts/` 全体を移動したため、そこに以前から追跡されていた `artifacts/p1-provenance/` の12ファイルが作業ツリーからなくなりました。[`worktree-after.txt`](worktree-after.txt) がその削除一覧です。HEAD自体は対象SHAのままでしたが、終了時のclean tree検査で失敗しました。

アプリの実装がこの削除を行ったのではなく、証跡分離スクリプトの不備です。削除された追跡ファイルは `git restore -- artifacts` で復元しました。元の移動先 `/workspace/r12-evidence/pre-final-artifacts-20261018-133300/` と失敗レポートは残しています。後続の検証では追跡ファイルを移動せず、固有のPlaywright出力先・JSON報告先と、生成物の差分収集を使い、開始・終了時両方のclean treeを確認します。

同じSHAのGitHub push `39132066387` とPR `39132099373` のCIは成功していますが、それはこのローカル非成功の代替結果ではありません。また、このSHAには独立レビューで発見したまとめ再確認漏れがあり、別の修正・再検証が必要です。

## レビュー指摘の再現と修正

新規候補に外部の依存結論がなく、まとめが候補自身の根拠発言を `summaryDependencies` に明示登録している場合、候補作成・更新・撤回後も `needsReview` がfalseのままでした。旧実装は外部の依存結論のIDだけを無効化の対象にしていたためです。

[`../summary-negative-16164918/raw.txt`](../summary-negative-16164918/raw.txt) と同ディレクトリの再現試験は、旧コードに試験だけを追加して **1 failed / exit 1** を確認した証跡です。後続修正は候補自身の前提・結論IDを追加し、変更した側の旧・新根拠発言と明示された依存結論を参照するまとめだけを再確認にします。無関係なB・まとめはそのまま、1回のUndoで戻ることを試験します。

旧結果の成功化や上書きはしません。修正後のSHA、必要なローカル試験、push/PR CI、最終レビューは独立した結果としてDraft PRに同期します。
