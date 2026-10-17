# 500ノード操作の診断 — G5は未完了

## このハーネスの位置づけ

`e2e/performance.spec.ts`は**診断専用**であり、G5受入証拠としては不適格である。`diagnosticOnly:true`、`eligibleForG5:false`、`g5Passed:false`を必ず記録する。500ノードを表示したこと、各100回完走したこと、CIが成功したことを、性能またはG5全体の合格と呼ばない。

各操作の`withinDiagnosticThreshold`はp95≤200msかを示すだけで、CIの性能ゲートではない。超過値を消したり合格へ丸めたりしない。正式な性能ゲートを追加する場合は、下記の未充足条件を解消し、200ms超過でCIを失敗させる別の受入試験が必要になる。

## 診断手順と出力

case `canvas-500-v1`は合成TXT 50,000 code pointsから作るProject v1で、500ノード・派生／ずれを含む。入力TXTのSHA-256を保存し、JSONのUI import経路で読み込む。先頭から末尾まで分散した8 IDを使う。

1. 選択100回：対象を検索で表示し、議題選択でselectedIdを解除した後、実ポインタークリックを測る。選択classとInspectorのID一致、キャンバス内可視、位置の安定を確認する。準備検索は計測外である。
2. 検索100回：存在する異なるIDをtextboxへ入力しEnter。選択ID・Inspector・可視位置を確認する。
3. 折り畳み100回：開閉を交互に操作。fixtureから求めた期待ID集合・件数と、各ノードの相対配置をDOMで確認する。

1 session、warmup 0回、除外0回、選択→検索→折り畳みの順である。グループ間のcache状態は同条件に統制していない。選択準備には検索が含まれ、Vite module cacheや共有ホストの同時負荷も統制していない。**この非対称性が診断専用である主な理由である。**

`performance.mark`は実操作直前から、DOMの成功アサーションと次frameまでを含む。選択・検索はさらに3回連続の安定frameを確認する。Playwright RPC／assertion overhead込みの保守的な観測であり、paint測定、実機入力レイテンシ、本番build、モデル推論の測定ではない。巨大DOMのtrace snapshotを無効にし、代わりに操作ログを保存する。機能E2Eの失敗traceは維持する。

`artifacts/canvas-performance.json`には次を記録する。

- clean checkoutのSHAと、**新規起動した開発サーバーの起動時SHA**の一致。既存server再利用・dirty checkoutは拒否する。
- 開始／終了時刻、case/version、500ノード、入力hash、browser版、OS/kernel/CPU/memory、WebGL renderer、実GPUアダプター未取得、cache条件。
- 各操作のcount／p50／p95／max／raw values、完了時刻付き操作ログ。
- 途中失敗時の操作ID・対象ID・時刻・準備込み経過時間・例外。fixture／git等のpreflight失敗も未完了JSONにする。

最初の180秒timeoutは三操作未完成であり、性能合格の証拠ではなかった。現在の上限600秒は全300操作を完走または失敗記録するための試験上限で、操作durationから遅さを取り除く仕組みではない。

## 再実行

専用ポート4183を空け、新しいserverで実行する。4173は別checkoutが使用している場合があるので、この環境では使わない。オフライン試験も競合しない専用ポートを指定する。

```bash
PLAYWRIGHT_PORT=4183 \
PLAYWRIGHT_REPORT_PATH=artifacts/performance-e2e-results.json \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
npx playwright test e2e/performance.spec.ts --output=test-results-performance

PLAYWRIGHT_OFFLINE_PORT=4286 \
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:offline
```

CIは機能回帰・診断・offlineの結果を分離し、実際のSHAを`verified-sha.txt`へ記録する。後続SHAへ旧値を移植しない。CI artifactが匿名取得できない場合は、公開PRに同じSHAの診断値と限界を併記する。

## 正式G5に足りないもの

[`evals/rubric.md`](../../../evals/rubric.md)のG5は、統制されたwarmup／cache／独立sessionの性能試験、p95≤200msの失敗assert、キーボード主要導線、アクセシビリティ、取消・失敗・再読込・再解析・インポート・別タブの全復旧証跡を要求する。現在の機能試験が一部を覆っていても、全条件充足とはしない。

iPhone Safari／Mac／Windows、実GPU、実機資源は未完了。Linux Chromiumの診断では代替しない。AI品質・実推論も未検証で、AI開始は無効のままである。
