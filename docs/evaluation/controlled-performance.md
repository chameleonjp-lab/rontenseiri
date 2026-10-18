# 本番ビルドの独立性能測定 — G5全体は未完了

## 何を確かめるか

従来の開発サーバーによる診断は残したまま、500ノードの選択・検索・枝の開閉を本番ビルドでも測る。各操作は**20回の固定ウォームアップ後に100回を測定し、各セッションのp95が200ms以下**でなければ失敗する。閾値、100回、操作直前のmark、成功確認と次frameまでの計測境界は既存ハーネスと同じである。選択・検索の3安定frame、折り畳みの全500ノードのID・座標・実CSS・inert・ARIA確認も省かない。

これは自動測定の再現性を改善する追加プロトコルであり、G5全体の合格ではない。`diagnosticOnly:true`、`eligibleForG5:false`、`g5Passed:false`を維持する。旧開発サーバーの値と混ぜた改善率も計算しない。

## 固定プロトコル

`npm run test:performance:controlled`で実行する。clean checkoutで本番ビルドを一度生成し、ビルドに埋め込んだSHAとdirty状態を各サーバーから取得して実行対象と照合する。dist全ファイルのSHA-256 manifestも残す。生成物を作業ツリーの変更後に流用して測定しない。

各群で測定前に、**実際のPlaywright baseURL**から`/__rontenseiri_build_identity`を取得する。HTTP 200、`sha`と`buildSha`がtested SHAと一致、`dirty:false`、`mode:production`でなければ、その場で失敗させ、warmupも測定も始めない。本番設定は開発設定をサーバー配列として継承せず、previewサーバー一つだけを起動する。

さらにHTMLのdev client／React Refresh注入、`/@vite/client`の実内容、ブラウザーの実際のscript/resource要求とReact Refresh状態、予期しないWebSocketを確認する。productionを名乗るhealth応答でもdev/HMR信号があれば失敗する。事前検査は`completed`と`passed`を分け、全probe完了前の部分成功では測定できない。実際のbaseURL、endpoint、HTTP status、応答本文、probe結果を成功・失敗の両方のJSONに残す。測定前後も信号を再検査し、遅れて発生したdev接続を許さない。追加検査による処理コストも測定から事後控除しない。

| ラウンド | 実行順序 |
| --- | --- |
| 1 | 選択 → 検索 → 開閉 |
| 2 | 検索 → 開閉 → 選択 |
| 3 | 開閉 → 選択 → 検索 |

9群は並列化せず順次実行する。**各群でPlaywright・ブラウザー・context・previewサーバーを新規起動**するため、群間でアプリ状態・IndexedDB・HTTP cacheを引き継がない。Service Workerもこの試験では無効にする。各操作で独立した3セッションが得られ、平均化や全セッションのpoolingで失敗セッションを隠さない。

各群はUIから同一の500ノード・50,000 code pointsのJSONを取り込む。対象は時系列全体から分散した同じ8 ID。選択には計測外の検索・議題選択による準備があることを明示し、検索や開閉と同一の事前キャッシュ状態とは主張しない。

最初の20回だけをウォームアップとして事前に除外し、負のindexと`warmup:true`付きで全件保存する。その後の100回は遅い値も含め全件採用する。再試行、外れ値除外、順序の事後選択はしない。warmupも同じ成功条件を確認する。100回の測定失敗やp95超過があっても残りの群は実行して失敗を残す。ビルド失敗・dirty checkoutでは古い生成物を測らず、未実行として終了する。

## 出力と再実行

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
  npm run test:performance:controlled
```

専用ポートは4193（`PLAYWRIGHT_PORT`で空いているポートを指定可能）。既存サーバーは再利用しない。出力先は`artifacts/controlled-performance/`で、各`round-N-operation/`にraw値・操作ログ・Playwright結果を残し、`summary.json`に全9群の合否、対象SHA、本番資産hash、各群前後のOS負荷と空きメモリーをまとめる。集約側でもraw値からp95を検算し、100回・固定20回warmup・SHA一致・成功フラグ・ログ欠落を検査する。

既存出力先に一つでもファイルがあれば、上書きせず失敗する。再実行する場合は、失敗・中断結果をSHAと理由付きの別ディレクトリに保存してから空の出力先を用意する。計測失敗だけを消して成功まで繰り返す運用はしない。

ローカル専用コミットで実行した証拠を公開HEADやCIの証拠とは呼ばない。**同じ変更を公開し、その正確なSHAを公開HEADとして確認するまでは、ローカル結果を公開PRの検証証拠に混ぜない。**公開リポジトリへのアクセスが許可されていない場合は、リモートHEAD未確認・未push・CI未実行を明記する。ローカルSHA・公開SHA・CIのtested SHAはそれぞれ別に記録し、古いSHAの合格を引き継がない。

## 残る限界

新規HTTP cacheと固定warmupは制御するが、OSのfile cacheは消去しない。共有ホストの他プロセスや負荷も統制できず、前後のload averageは記録に過ぎない。ブラウザー自動操作・RPC・DOM確認を含む時間で、実paintや物理入力の遅延ではない。SwiftShaderの結果を実GPU性能に代用しない。

G5にはキーボード主要導線、アクセシビリティと実支援技術、取消・失敗・再読込・再解析・import・別タブの全回復、実機、heapの別証拠が必要である。AI開始が無効な現状の取消・失敗・再解析を、stubだけで実AI成功として扱わない。実GPU・AI品質・iPhone/Mac/Windows実機は引き続き未検証である。
