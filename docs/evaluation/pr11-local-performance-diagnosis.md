# PR #11のローカル性能失敗と、証跡検証器の修正

**ローカルの200ms超過は未解決です。環境ノイズとして免責せず、失敗をそのまま残します。** 今回直したのは、raw測定列と操作ログの不一致を受理してしまう証跡検証器です。この欠陥が元の遅延を発生させた証拠はありません。

対象アプリは `7da450fd60dd8eb91ca686867c7dbcdaef944e53`。PR #11の外部マージでmainになった `7716c44b6c40bc47319c8d0d06b267ad20866d06` や本PRのheadとは区別します。元実験の再実行、失敗サンプルの除外、閾値・操作数・warmup数・assertion・timeout・報告定義の緩和はしていません。

## 残している失敗

各行は独立した100操作のnearest-rank p95です。丸めた表示値で再判定せず、[rawファイルのmanifest](evidence/7da450f/manifest.json)と[回帰検査](../../tests/pr11-performance-diagnosis.test.ts)は元の数値を使います。

| 系列 | selection p95 | search p95 | fold p95 | 元の判定 |
|---|---:|---:|---:|---|
| ローカルdev初回 | 199.700ms | **220.400ms** | 181.000ms | search失敗 |
| ローカルdev既約束の再実行 | **217.100ms** | **221.300ms** | 193.600ms | selection/search失敗 |
| ローカルproduction round 1 | 198.900ms | 156.300ms | 141.000ms | 3/3群ゲート内 |
| ローカルproduction round 2 | 184.500ms | 170.600ms | **200.500ms** | fold失敗 |
| ローカルproduction round 3 | 199.900ms | 170.500ms | 198.400ms | 3/3群ゲート内 |

根拠: [dev初回](evidence/7da450f/dev-attempt1.json.raw)、[dev再実行](evidence/7da450f/dev-attempt2.json.raw)、[production全9群のsummary](evidence/7da450f/local-production/summary.json.raw)。productionは**8/9群**です。失敗のround-2-foldは100値中6値が200msを超え、p50 154.9ms、max 230.3ms。0.5ms超過でも失敗です。devの200ms超の個数は初回selection/search/foldが4/11/2、再実行が18/18/4です。

`complete=true` / `failure=null` は全操作が終わったことを示すだけです。後段のp95 assert失敗は `latencyBudgetGate.passed=false` と元の実行ログに残っています。新しいheadのテストが成功しても、この履歴の失敗を取り消しません。

## CI成功と矛盾しない理由

同じ旧SHAの[push CI 39125745484](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39125745484)と[PR CI 39125750810](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39125750810)では、production独立9群がどちらも成功しています。[push production summary](evidence/7da450f/ci-39125745484/summary.json.raw)と[PR production summary](evidence/7da450f/ci-39125750810/summary.json.raw)を、全18群の元raw結果とともに保存しました。各群を修正後validatorで再検査しても9/9と9/9のままです。

トップレベルのCI `canvas-performance.json` はproductionではなくlegacy devです。[pushのdev](evidence/7da450f/ci-39125745484/legacy-development.json.raw)はselection/search/fold p95が116.9/113.7/96.4ms、[PRのdev](evidence/7da450f/ci-39125750810/legacy-development.json.raw)は133.6/129.6/128.1msでした。これをproduction9群の代用品にはしません。

ローカルはChromium **151.0.7922.34**、Intel Xeon @2.50GHz、8 logical cores、kernel 6.18.38+、SwiftShader。旧CIはChromium **156.0.8078.4**、4 logical cores、kernel 6.17.0-1022-azure。push CIのCPUはXeon Platinum 8573C、PR CIはAMD EPYC 7763です。ブラウザー版・CPU・core数・OS・メモリ・描画環境が同時に違うため、どれが差を生んだかは分かりません。ブラウザー版文字列は保存されていますが実行バイナリーのhash/launch引数一式までは記録されていません。

## 計測しているのは純粋なアプリCPU時間ではない

[e2e/performance.spec.ts](../../e2e/performance.spec.ts)の開始markから、Playwright操作、DOM/Inspector/可視性/位置の条件確認、追加1 rAF、終了markまでの経過時間です。selectionはboundingBox取得とpointer操作、searchはfillとEnter、foldはlocator clickの待ちを含みます。selection準備の検索・選択解除は計測外です。

`settleNode`は最初の位置観測でstable=0となり、同位置をさらに3回観測します。最低4回のrAF観測と追加1 rAFがあります。`settleFold`はDOM全体のID・count・transform・hidden/inert/ARIAを3連続観測します。これらの待ち、ブラウザー通信、スケジューリングと製品処理が混在するため、数値をそのままReact CPU時間や実機input-to-paintと読めません。ただし、それらを引いて200msゲートを合格にする変更もしません。

devはwarmup 0でselection→search→foldの同一session。productionは各群20 warmup＋100測定、群ごとに新しいbrowser/context/server、3ラウンドの順序交代です。build modeだけでなくwarmup、cache、順序、アプリ状態も変わるため、devとproductionの差は単一要因の効果ではありません。

## 何が分かれば原因を切り分けられるか

元の100操作には、CPU profile、long task、React commitとpaintの対応、各rAF間隔、action/RPC/settle別の時刻、操作ごとのOS scheduling/CPU throttlingがありません。traceも意図的にoffです。別SHAのprofileや後日の負荷値を当時の証拠として代用しません。

production round-2-foldのhost snapshotはloadavg `[1.07,1.45,1.54]`→`[1.15,1.44,1.54]`、free memory 19,669,848,064→19,701,792,768 bytesでした。これは群の前後の値であって、失敗操作のCPU負荷、rAF遅延、cgroup制限、GPU負荷の特定には使えません。低いloadavgだけで環境ノイズと断定せず、逆に製品CPUの問題と断定もしません。dev試行には同等の前後host snapshotがなく、さらに切り分けが限定されます。

したがって残る交絡は、browser/host差、devとproductionの実行経路、cache/warmup/順序、Playwright actionabilityとRPC、フレーム/描画/React処理、操作時のホストschedulingです。元の閾値試験を合格まで繰り返しません。将来追加するなら、旧結果を上書きしない短い診断で、browser/buildを固定し、交差順序と工程別時刻を事前に決めて切り分ける必要があります。これは今回実行した受入測定ではありません。

## 今回の修正と回帰

`validateResult`はraw列のp95を再計算し、操作logのindexと件数を検査していましたが、logの`durationMs`をraw列と照合していませんでした。measured index 7のlogだけを999msへ書き換えても、修正前はエラー`[]`として受理されます。[修正前の失敗再現](evidence/performance-validator/validator-before.log.raw)を保存しています。

修正では、measured logの各値がfinite・非負で、同indexのraw値と厳密一致することを検査します。warmupのdurationもfinite・非負である必要があります。これは結果の整合性検査だけで、計測開始/終了、統計、閾値や報告semanticsは変えていません。warmupの非有限/負値、measured不一致の回帰を追加しました。旧raw結果は全27 production群でlogとの不一致がなく、元失敗を引き起こした／隠したという主張はありません。

[保存証跡の回帰検査](../../tests/pr11-performance-diagnosis.test.ts)は39ファイルのbyte数/SHA-256、旧SHA、2 dev失敗、local production 8/9、CI production 9/9と9/9、CI dev別系列を検査します。初回アーカイブ検査で34件期待に対し39件となったのは、後からCI dev2件と元ログ3件を追加したためです。元の失敗ログも保持し、期待件数を追加後の39件に整合させました。性能の閾値変更ではありません。

新headのCIが通常workflowとして計測する場合は、そのSHA固有の修正検証として旧結果と分けます。今回のローカル検証では元の性能ベンチマークを再実行しません。

## 未達のままにするゲート

G5全体、全P2/R22、G2–G8の実モデル・日本語意味品質・実Mac/Windows/iPhone・支援技術・GPU/heap・OS条件・権利/配布・利用者評価は未完了です。証跡検証器の修正やCI greenをそれらの代用にしません。次のP2/R22実装は[fixture-bounded契約](fixture-bounded-reconciliation.md)に残る通常UI/Worker統合、候補照合表示、訂正依存の再利用であり、今回それを完了扱いにはしていません。
