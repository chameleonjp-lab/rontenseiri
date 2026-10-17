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

## 二段目の改善

3a98e47のCIは選択・検索が200ms以内になったが、開閉は229.3msで失敗した。ローカルの開閉は特に展開側へ偏った（collapse p95 208.3ms、expand p95 390.7ms）。そこでfolded graphとselected nodeのimmutable派生をcacheし、選択してもhidden edgeを再生成しないよう修正した。SpeechDataに対応する不変React要素もWeakMapで再利用する。初期importで表示済みの枝を再展開するときのJSX再生成を削減するためで、viewportやnode数を減らす最適化ではない。

後続の100操作測定はprotocol v2のframe単位確認を明記する。marker位置・閾値・回数は維持し、成功条件は同等以上。旧方式との数値比較を、全て製品コードだけの改善だと扱わない。

[二段目raw JSON](profiles/candidate-variant-cache.json)も同じ8操作×3のCDP手順で記録した。test-driverのrole探索等もCPUに含まれるため、profile wall値をp95として扱わない。最終観測ではfold buttonのrole探索を同じcanvas-tools内にscopeし、無関係な500ノードのaccessible name走査を避ける。計時開始位置・実クリック・成功条件は維持する。

## ローカル残差への三段目の対処

a48c0e2のCI p95は117.3／128.4／130.9msで全て予算内だったが、ローカルは216.0／234.3／279.8msで失敗した。CI成功だけで全環境合格とせず改善を継続した。

- ReactFlowの`hidden`は枝node/Handle/edgeをunmountするため、展開時の再mountコストが残った。folded variantではDOMを保持し、nodeのCSS visibility:hidden・pointer-events:none・native inert・aria-hiddenで視覚/操作/AXから除外する。非main辺に加え、隠れた端点へ接続するmain辺もSVG group単位で隠す。MiniMapのfill/strokeを透過し、全体表示の対象も可視集合へ限定する。data/座標/寸法は保持し、Semantic Projectには新しいUI属性を保存しない。
- `onMove`とBackground/MiniMapのReact elementsを安定化し、検索入力や倍率表示だけで親からReactFlow subtreeを再描画しないようにする。
- protocol 2.1は100回・200ms・marker位置を維持する。選択前のsearch/議題clickは従来から準備であり、その後も3 stable frames待って閉じたInspectorのresize処理を計時へ混入させない。検索textbox roleもcanvas-search内にscopeし、無関係な全DOM走査を避ける。これら観測条件の変化を明記し、旧値との純粋な改善率は主張しない。
- 成功確認は可視ID/件数/座標に加え、**全500 retained nodeのID/座標、隠れた枝の実CSS visibility・inert・AX非表示を3回連続で確認**する。DOM総数ではなく可視集合を確認するのは実装方式の変更に対応するもので、隠れていない枝をARIAだけで除外して測ることは許さない。

追加E2Eは同一DOM・座標の再利用、隠れた枝のfocus拒否/role除外、隠すべき辺の全IDとCSS/AX、可視ID集合を検査する。DOMを保持するので折り畳みによるDOM総数削減はしないが、初期500ノードの数を増やさず各操作でも総ID/件数を固定する。heap全体や実機メモリ合格までは称しない。

三段目の専用CDP比較は未実施。前段のCPU表を三段目sourceの値へ読み替えない。三段目の100操作は公開HEAD自身のartifactへ記録する。追加キーボード回帰ではTab/Shift+Tabを各24回、折り畳み中のパン・ズーム、選択した枝への自動展開・復帰も検証する。
