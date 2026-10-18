# 証跡出力先が衝突した実行 — 非成功・置換禁止

この実行の結論は **失敗（exit 1）** です。成功証跡として扱いません。後続の再実行結果で、この記録を上書き・合算・成功扱いに変更しません。

- 実行コマンド: `PLAYWRIGHT_PORT=4208 PLAYWRIGHT_REPORT_PATH=artifacts/r12-full-regression-e2e-results.json npx playwright test --grep-invert '各100操作で観測する|手動の排他解釈'`
- 原ログの結果: **5 failed / 83 passed / 1 skipped**、`browserContext.close: ENOENT`。
- 同じ作業ツリーで手動A/B試験を並行実行し、どちらも既定の `test-results` を使用しました。片方による削除でtraceファイルが見つからなくなりました。各試験の成功やアプリの正常性を、この失敗結果から推定しません。
- 実行開始時の作業ツリーは未コミットの編集を含みます。HEADは `7716c44b6c40bc47319c8d0d06b267ad20866d06` でしたが、そのSHAそのものの検証結果ではありません。実行中にも編集があり、正確なtested treeを再構成できるとは主張しません。

## 原データ（そのまま複製）

- [`raw.txt`](raw.txt): 元ファイル `/workspace/r12-full-browser.log`。SHA-256 `3b9aa20343ac14df2d05aee78597839a9d53661b2b16523961f2d10a2bacf91e`。
- [`results.json`](results.json): 元ファイル `/workspace/rontenseiri-r12-manual/artifacts/r12-full-regression-e2e-results.json`。SHA-256 `d8370e5d71896162828cb4b2af016627a27f714dc7f7f494b415ae6e96628ee5`。
- 残存するスクリーンショット・trace等は `/workspace/r12-evidence/collision-20261018-132332/test-results-surviving/` に複製しました。元の欠落traceは復元できず、捏造・再生成しません。
- 全残存ファイルの保全時ハッシュ: `/workspace/r12-evidence/collision-20261018-132332.sha256`。

最終コミットSHAの再検証は、実行ごとに固有の証跡ディレクトリを割り当て、独立した結果としてDraft PRに記録します。
