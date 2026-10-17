# Canvas performance evaluation (G5)

## 判定条件

500ノードを表示できること、またはパンできることだけでは **G5合格とはしない**。実際の500ノードJSONをUIからimportした同一SHAの実行で、次の各操作を**100回**計測し、p95を比較する。

- ノード選択（複数IDを交互に実ポインタークリック）
- ノード検索（存在する異なるIDを検索textboxへ入力してEnter）
- 折り畳み（derived/drift枝を含むfixtureで開閉を交互）

各操作について `count: 100`、`p50`、`p95`、`max`、`thresholdMs: 200`、`pass: p95 <= 200` を `artifacts/canvas-performance.json` に記録する。選択はselected classとInspectorの同一ID、検索はselectedかつcanvas内可視、折り畳みは対象表示数がDOMへ反映された後の次frameまで確認する。

計測は `performance.mark` を実際のpointer/keyboard action直前に開始し、対象UI状態が反映され、位置が3回連続の `requestAnimationFrame` で安定した後の次frameまで終了しない。markはPlaywrightのaction/assertion awaitもまたぐ保守的なRPC-inclusive観測値であり、paint計測・実機レイテンシではない。固定waitを大量に使わず、DOM状態とframeを待つ。

> `g5Passed: false` または計測未実施・100回未満・p95超過はG5未合格（部分対応または未検証）として扱う。p95超過は観測試験そのものを失敗扱いにしない。500ノード表示だけの結果を通過と呼ばない。

JSONには `testedSha`（`git rev-parse HEAD`）、timestamp、Chromium、viewport、OS、500 nodes/50,000 code points、duration定義、`observational: true`、およびG5全体未合格（実機未測定）を必ず残す。親変更を含む最終SHAで再実行して、JSONのSHAとテスト対象SHAを一致させる。

## 再実行

専用port **4183** を使う。4173は別checkoutのため使用しない。

```bash
PLAYWRIGHT_PORT=4183 \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
npx playwright test e2e/performance.spec.ts \
  --output=test-results-performance
```

CIまたは親変更後に、全CI完了後の**同一SHA**で再実行し、`artifacts/canvas-performance.json` をGitHub Actions artifactとして保存する。JSONの数値を別SHAの実行結果へ手作業で移植してはならない。

## 証跡と未完了条件

case `canvas-500-v1`（Project v1、合成TXTのSHA-256付き）。先頭から末尾まで分散した8 IDを使用し、選択準備の検索と選択解除は選択の計測外とする。新しいbrowser contextを使用するがVite開発serverのmodule cacheは温まり得る。本番build・モデル処理・実機入力レイテンシの測定ではない。

JSONには実行開始・終了、OS/kernel/CPU/memory、browser版、WebGL renderer、GPUアダプター未取得、cache条件、手順、各100個のraw values、300操作ログ、失敗理由も残す。閾値超過を成功へ丸めず、途中失敗でも完了数と部分分布を記録する。性能試験だけfull-DOM traceを無効にし、操作ログを証跡にする。機能試験の失敗traceは維持する。

初回の180秒timeoutでは三操作が揃わず証拠未完成だった。ハーネスの上限は600秒とし、各操作のdurationから待機を除去するためではなく、全300操作を完走または失敗記録するための上限とする。

G5全体はキーボード主要導線、アクセシビリティ、および取消・失敗・再読込・再解析・インポート・別タブの復旧証跡も必要。[`evals/rubric.md`](../../../evals/rubric.md)を参照。iPhone Safari／Mac／Windowsは未完了で、Linux Chromiumでは代替しない。現時点の`g5Passed`は常にfalseとし、性能三操作のpassとは分離する。
