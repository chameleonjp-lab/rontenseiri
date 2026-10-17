# 500ノード操作の診断 — G5は未完了

## このハーネスの位置づけ

`e2e/performance.spec.ts`は、各100操作の製品レイテンシ予算を**p95≤200ms**として検査する。超過は製品性能の失敗であり、今回から**一操作群でも超えればCIを失敗させる**。回数・閾値・成功アサーション・frame待機は緩和していない。

JSONの`latencyBudgetGate.passed`と`withinLatencyBudget`がこの部分ゲートを示す。完走やCI greenだけでG5全体を合格とはしない。warmup/cache/独立session・実機・アクセシビリティ・全復旧の正式条件はまだ不足しているため、`diagnosticOnly:true`、`eligibleForG5:false`、`g5Passed:false`を維持する。

3f21c87ではCI p95が選択266.7／検索522.1／開閉345.2msで全超過した。ハーネスだけの問題とせず、[プロファイルで原因を確認し、表示実装を改善](canvas-performance-profile.md)した。後続SHAの合否はそのSHA自身の100操作JSONで判断し、旧値を移植しない。

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
- 途中失敗時の操作ID・対象ID・時刻・準備込み経過時間・例外。レイテンシ予算失敗は`latencyBudgetGate.failedOperations`と各群のp95へ記録する。fixture／git等のpreflight失敗も未完了JSONにする。

旧ハーネスの最初の180秒timeoutは三操作未完成であり、性能合格の証拠ではなかった。現在の上限600秒は全300操作を完走または失敗記録するための試験上限で、操作durationから遅さを取り除く仕組みではない。

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

[`evals/rubric.md`](../../../evals/rubric.md)のG5は、統制されたwarmup／cache／独立sessionの性能試験、独立session等を含む正式プロトコル、キーボード主要導線、アクセシビリティ、取消・失敗・再読込・再解析・インポート・別タブの全復旧証跡を要求する。現在の機能試験が一部を覆っていても、全条件充足とはしない。

iPhone Safari／Mac／Windows、実GPU、実機資源は未完了。Linux Chromiumの診断では代替しない。AI品質・実推論も未検証で、AI開始は無効のままである。

## 3a98e47の中間結果と二段目の変更

3a98e47はunit115・機能E2E23＋専用offline1が成功したが、レイテンシ予算は失敗した。CI p95は151.5／159.5／229.3ms、ローカルは249.4／245.7／375.5ms（選択／検索／開閉順）。改善しても未達を合格にせず、CIを失敗のまま記録した。

独立レビューにより折り畳み中の選択でhidden edgeまで新規生成する漏れを確認し、immutableなfolded graph／selected nodeの派生キャッシュを追加した。加えてSpeechの不変dataに対応するReact要素をWeakMapで保持し、展開時に同じmarkupを再構築する負荷を抑えた。意味データ・座標・native event動作は変えない。

観測protocol v2では**計時開始／終了位置、100操作、200ms、成功条件を維持**し、DOM成功確認をブラウザー内のrAFへ集約する。従来の複数RPCと100/250ms刻みのassertion backoffを避け、選択class／Inspector ID／canvas可視／3 stable framesを同じframeで確認する。開閉は期待ID集合／件数／相対配置を3回連続で確認する（従来の単発assert後のframe待機より厳しい）。これは観測分解能の変更であり、旧方式の数値と混ぜて改善率を算出しない。製品自体の改善は同一CDP手順のprofileと別に確認する。

## ローカル残差への三段目の対処

a48c0e2のCI p95は117.3／128.4／130.9msで全て予算内だったが、ローカルは216.0／234.3／279.8msで失敗した。CI成功だけで全環境合格とせず改善を継続した。

- ReactFlowの`hidden`は枝node/Handle/edgeをunmountするため、展開時の再mountコストが残った。folded variantではDOMを保持し、nodeのCSS visibility:hidden・pointer-events:none・native inert・aria-hiddenで視覚/操作/AXから除外する。非main辺に加え、隠れた端点へ接続するmain辺もSVG group単位で隠す。MiniMapのfill/strokeを透過し、全体表示の対象も可視集合へ限定する。data/座標/寸法は保持し、Semantic Projectには新しいUI属性を保存しない。
- `onMove`とBackground/MiniMapのReact elementsを安定化し、検索入力や倍率表示だけで親からReactFlow subtreeを再描画しないようにする。
- protocol 2.1は100回・200ms・marker位置を維持する。選択前のsearch/議題clickは従来から準備であり、その後も3 stable frames待って閉じたInspectorのresize処理を計時へ混入させない。検索textbox roleもcanvas-search内にscopeし、無関係な全DOM走査を避ける。これら観測条件の変化を明記し、旧値との純粋な改善率は主張しない。
- 成功確認は可視ID/件数/座標に加え、**全500 retained nodeのID/座標、隠れた枝の実CSS visibility・inert・AX非表示を3回連続で確認**する。DOM総数ではなく可視集合を確認するのは実装方式の変更に対応するもので、隠れていない枝をARIAだけで除外して測ることは許さない。

追加E2Eは同一DOM・座標の再利用、隠れた枝のfocus拒否/role除外、隠すべき辺の全IDとCSS/AX、可視ID集合を検査する。DOMを保持するので折り畳みによるDOM総数削減はしないが、初期500ノードの数を増やさず各操作でも総ID/件数を固定する。heap全体や実機メモリ合格までは称しない。

## 四段目：可視性更新をReactFlowのgraph更新から切り離す

d737927ではlocal p95が選択198.8／検索200.8／開閉238.7msで、検索と開閉がなお失敗した（CIは136.2／134.1／157.0ms）。短いCDP診断でもfoldの平均script144.869ms、task209.186msが残った。これは100操作のformal値ではなく8操作のCPU診断である。

枝DOM保持だけでは、折り畳みごとにnode/edge propsを変えるReactFlow内部のJSX更新負荷が残る。そこで枝の所属をstatic classへ移し、**foldではnode/edge配列を一切変えず**、root CSSとbranchだけ購読する小さなexternal-store Boundaryで可視性・native inert・ARIAを同期する。NodeWrapperのinline visibilityに勝つCSS指定が必要なのでhidden!importantを対象classに限って使う。非main辺・隠れた端点のmain辺・MiniMapもstatic classで隠す。辺ARIAはclass/ARIA/DOM変化を監視し、mainへ変わった辺の一時属性を復元する。cleanupも自分の設定値が残る場合だけ元値を復元して他writerの変更を消さない。

検索queryも小さなformのlocal stateへ移し、入力だけでCanvasContentを再描画しない。formはhiddenで保持するので閉じてもqueryを失わず、開くとfocusする。分類の派生→本筋→派生と2回Undo、履歴往復時に保持されたfold state、CSS/inert/AX/元座標も追加E2Eで確認する。

**protocol2.1・100回・200ms・marker・3安定frame・全500のID/座標/実CSS/inert/AX条件はこの段では変更しない。** formalなwarmup/独立session条件、実GPU・実機・支援技術・全recovery・heap検証は引き続き別の未完了事項。fitはbranch speechを除外するがagenda frameの全寸法を維持するので、折り畳み後に枝相当の余白が残る点は既存動作として記録する（tight bounds合格は主張しない）。

## 五段目：選択時の復帰候補JSXを再利用

4e12ee5ではlocalの検索192.2ms・開閉156.6msは予算内になったが、選択215.5msが残った（CIは150.3／145.2／128.6ms）。Inspectorは常時表示する復帰先selectで、対象より後のmain候補のoptionを選択のたびに生成していた。

候補のeligibility/filter/order・表示文・操作は一切変えず、不変Utterance objectをkeyにするWeakMapでoption ReactElementだけを再利用する。これは遅延表示や候補省略ではなく、候補は最初から全件select内に存在する。同一IDでも訂正/import/Undoで新objectになれば古い文は再利用されず、原文抜粋を保持することを単体で確認する。変更は表示要素だけで、意味・ID・履歴・DTOは変えない。

protocol2.1・100回・200ms・成功条件・marker位置は四段目から変更しない。短いCPU診断をこの段の確定SHAのp95と混同せず、最新公開HEAD自身で再計測する。
