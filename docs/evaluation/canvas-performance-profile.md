# 500ノード操作のプロファイルと性能修正

## 原因と修正

3f21c87の全3操作p95が200msを超過したため、閾値を緩めずに実装を調べた。CDP CPU profilerにはReactのjsxDEV、ReactElement、NodeWrapper、GCの負荷が現れ、操作別のScriptDurationがlayout時間を大きく上回った。

- **選択・開閉のたびに全グラフを作り直していた。** 選択IDやcollapsedだけの更新でもlayout、全node/data、全edge/marker/styleを再生成し、memo化されたSpeechにも新しいdataが渡っていた。geometry/contentを`buildCanvasGraph`へ分離し、`projectCanvasState`は変更のあるnode/data/edgeだけを更新する。配置は再計算せず保持する。参照同一性と座標を単体回帰で固定した。
- **同じ議題の選択でもprojectをcloneしていた。** 同値なら既存projectを返す。visible IDsも内容が同じなら親stateを更新しない。MiniMapの色callbackと固定propsを安定させる。
- **検索に固定30ms待機＋250msアニメーションがあった。** 操作完了を待つ予算200msに対し、この経路は構造的に不利だった。検索・選択ノードへの明示jumpを次のframeで即時fitへ変更。zoom/pan等の一般操作は変えない。検索成功の可視・選択ID・Inspector・3 stable frames確認は保持する。
- **閉じた詳細編集欄でも後続候補を全DOM生成していた。** native detailsのsummaryはそのままに、初回openまで候補生成を遅延。一度開けば閉じてもmountとdraftを保持する。候補の全件性・順番・ラベル・入力方法は変えない。
- **固定寸法を初期値として渡していなかった。** CSSと一致する225×96のspeech初期寸法、既存agenda寸法をReactFlowへ渡す。座標、表示サイズ、hit領域は従来どおりである。

## 切り分け用CDP比較

同じLinux Chromium 151で各操作8サンプル。下表はScriptDuration差分の算術平均で、**100操作p95やG5合格値ではない**。プロファイラー自体のoverheadを含む。検索には旧アニメーション完了のため両側とも追加300msの同期待機を入れたので、wall値を製品レイテンシとして扱わない。

| 操作 | 変更前JS平均 ms | 候補JS平均 ms |
|---|---:|---:|
| selection | 462.6 | 60.4 |
| search | 713.5 | 81.3 |
| fold | 587.5 | 147.5 |

[変更前raw JSON](profiles/baseline-3f21c87.json)・[候補raw JSON](profiles/candidate-render-cache.json)に24操作ずつのscript/layout/style/task、source hash、環境、日時を記録する。変更前は独立worktreeの3f21c87。node_modules symlinkのためdirty=trueであることを隠さず、4つの対象source hashが公開3f21c87のblobと一致することを確認した。候補も未commit時点のためdirty=true。追加モジュールは変更終了時刻を確認してhashを補記している。これらは切り分けの証拠であり、正式測定のclean checkout条件を満たすと称さない。

## 再現と受入

```bash
# Playwright Chromiumをinstall済みの環境で。Linuxで必要なら下記envを指定。
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium \
node scripts/profile-canvas.mjs candidate
# 別worktreeを測る場合は PROFILE_ROOT=/absolute/worktree を追加する。
```

生CPU profileとJSONは`artifacts/profiles`へ保存する。記録fixtureは架空テキストのみで、外部サービスへ送信しない。

受入は別途、新規server・clean checkout・served SHA一致の100操作を同じ公開SHAで再実行する。選択・検索・折り畳みのp95≤200msをCIでassertし、超過なら失敗のまま改善する。unit、keyboard/focus、mouse/touch hit、保存/再開/Undo、遅延detailsのdraft保持も回帰する。正式G5の統制プロトコル・アクセシビリティ・全復旧・実機、AI品質は別未完了である。
