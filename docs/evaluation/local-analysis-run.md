# ローカル解析経路の取消・再開（P2の限定的な縦切り）

通常UIから既存の `analysis.worker.ts` と `AnalysisSession` を通り、検証済みchunkをIndexedDBへ保存して再読込・再開する経路を追加する。**この経路は決定的な動作確認fixtureであり、AI解析ではない。** 原文・議題・訂正へ結果を適用しない。実モデルの開始無効化は維持する。

## mainで確認した不足

開始点は `6e65a9c43571f030287b7e1067b526ce472d70b2`。既存sessionにはsource ID・版・hashの検査があった一方、解析設定・発言切出しの固定識別、連続prefixの検査、永続checkpoint store、通常UIからのsession経路がなかった。従来のAIダイアログは `analyzeLocally` の一括Worker経路を使い、モデルの固定取得条件が未確認のため開始不可だった。

sessionは取消を無視するadapterの応答を待ち続け、checkpoint読込中はrunning状態にならず、保存失敗より前にメモリ上の確定位置を進めていた。今回の回帰試験はこれらの境界を対象にする。既存の試験assert・時間上限は変更しない。

## 今回の契約

- run開始時にProjectをコピーする。保存原文 `Source.text` のUTF-8 bytes SHA-256、source ID／版、発言構造／訂正ID、parser契約版、Project／checkpoint／出力schema版、Session実装版（adapter指定で上書きしない）と解析adapter実装版、キー順を正規化した全解析設定をfingerprintに束ねる。元のアップロードファイルの生bytes保存を主張しない。原文を識別用にcheckpointへ重複保存せず、hash計算も外部へ送信しない。
- 設定識別子にfixture版・chunk長・overlap・モデルなし／promptなし／推論なし・応答待ち時間を含める。fixtureは160文字、overlap 0、400ms/要求。故障シナリオは結果の意味を変えないfault injectionとして扱い、再開時には通常シナリオへ戻せる。
- 保存済みの `nextChunk = k` と候補の長さ・順序・chunk IDを厳密に照合する。source・入力・設定・sessionが違うcheckpoint、未検証候補、偽の完了prefixは再開を拒否する。引用spanは現在のsource範囲内で、現在のchunk manifestに厳密一致しなければ拒否する。旧形式checkpointも推測で移行しない。owner claim前にread-only preflightし、不一致／破損時はDBレコード全体を変更しない。
- 新しいrunはUUIDを持ち、同じcheckpointの再開ではrun IDを維持する。開始／再開試行ごとにgeneration IDを更新する。作業単位のDB logical keyとrun IDは別概念で、明示破棄後の新規開始は別run IDとなる。
- chunk結果をschema検証し、候補・次cursor・最後の確定chunk index（空は-1）・run／generation／fingerprintを同一recordの同一IndexedDB readwrite transactionでcommitする。永続化の成功後だけ表示件数とメモリ確定位置を進める。再開はk+1番目からで、確定済みprefixを再処理しない。fixtureの最終照合も全chunk IDの順序付き完全一致を要求する。
- session世代とAbortSignal、全Worker messageのrun／generation／request ID、IndexedDBのrun／generation／fingerprint比較で旧runを排除する。取消はsession generationを同期失効してからWorkerをterminateする。commitの線形化点はtransaction.completeで、取消がactive transactionをabortした場合は候補もcursorも残らない。completeが先に勝ったchunkだけ保存済みprefixに入る。取消状態の保存完了後に取消済みを表示し、その後は旧generationによる追加chunk commitを認めない。モデルの協調的な取消を仮定しないsession試験もある。
- UIは取消・失敗・未完了・完了を分ける。永続状態runningを再読込した場合は「未完了（この画面では実行していません）」と表示する。別タブが実行中かもしれず、勝手に中断済みとは断定しない。全chunkと照合結果の保存後だけ完了状態を記録する。「完了」は動作確認のみでAI解析未実施と表示する。
- checkpointは `rontenseiri-analysis-runs-v1` DBに作業単位で保存する。既存Project DBのschema／storageRevisionは変えない。作業のJSON backupにはcheckpointを含めず、UI内の明示ボタンで破棄できる。作業自体の保存を先に必要とする。

## 再現

1. `npm ci`、`npm run dev`。サンプルを開き「この端末に保存」。
2. 「端末内AIの評価」から「ローカル解析経路の動作確認（AIではありません）」を開く。
3. 通常シナリオで開始し、いくつか確定したら取り消す。取消済み表示を確認する。
4. 再読込して最近の作業を開き、同じパネルから再開する。保存済みchunkの次から処理し、完了（動作確認のみ）となる。
5. checkpointを破棄し、2件目失敗シナリオを実行すると1件だけ確定して失敗する。通常シナリオで再開できる。

自動再現:

```sh
npm test -- tests/analysis-session.test.ts tests/analysis-run-safety.test.ts tests/local-worker-adapter.test.ts
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npx playwright test e2e/local-analysis-run.spec.ts
```

追加E2Eは完了済みreload、checkpointなし、同一runのresume／新規run ID、cursorだけ先行／resultだけ残る／source外spanの故障注入とDB不変、A取消→B所有→A旧保存拒否、active transaction取消も検査する。狭いfocus試験は進捗でfocusを動かさないこと、取消／再開、Tab／Shift+Tab、Escape／×、背景inertと起点への復元を検査するが、支援技術の読み上げ実測ではない。

network・k+1再開E2EはWorkerを置換せず、native `Worker.prototype.postMessage` の観測で送信chunk IDを記録する。UI開始→取消→reload→再開で、再開要求の全IDと最終候補のk以降が完全一致し、先行chunkとの重複0件を別assertする。networkについても開始前から取消→reload→resume→完了済みreloadまでBrowserContextの実行時request試行とrequestfinished／requestfailed、WebSocket originを記録し、外部要求0・GET以外0・sample原文の先頭30文字probeのURL／body混入0を別assertする。same-origin assetのGETは許容し、失敗や遮断があれば試行から除外しない。通信をrouteで遮断して成功を作らない。開発配信にはactive Service Workerがないため、production SW cache missの要求試行・実送信やOSのpacket観測は未検証とする。既存offline試験だけで今回のWorker経路を代替しない。

証拠はCIの `browser-evidence` artifact内の `verified-sha.txt`、`unit-results.json`、`e2e-results.json`、`test-results/**/attachments/` のnetwork観測JSON、`artifacts/p2-completed-run.png`。PR本文には検証対象head SHAと同じheadのCI run/artifactを対応させる。開発中の診断実行は最終SHAの証拠と混同しない。

## 合格としない範囲

今回の3秒assertは当該fixture経路の局所受入条件に限る。G4の端末・モデル全体の取消性能やG5総合合格を表さない。

P2全体、実モデル／日本語品質（G2・G3）、GPU喪失・モデル取得中断・再試行／照合資源上限、重要発言再解析、実モデルからの議題候補適用、従来 `analyzeLocally` との一本化は未完了。G5の全操作・実機復旧、Mac／Windows／iPhoneのOS matrix、支援技術／スクリーンリーダー、G8の利用者比較も未検証。ここで観測した通信0件はfixtureだけの結果であり、実モデル取得時のG6合格ではない。外部AIフォールバックは追加しない。

Web Locksが利用できなければこの経路もfail closedとする。複数タブ・長時間バックグラウンド・最大入力の実機資源評価は別に残す。Project削除とは独立したcheckpointの寿命管理／完全JSONへのcheckpoint統合も今回の対象外とする。

## 初回CIで見つけた配信側の原因修正

初回head `01a462a` のCIは1件失敗した。traceでは最初の実Worker開始時にVite依存最適化のversionが変わり、UIがホームへ再読込され、1chunkで止まっていた。モデルライブラリを `optimizeDeps.include` に明示して初回Workerで依存グラフを変えない修正を加えた。pollの上限や3秒assertを緩和して通す対処は行わない。旧headの試験を最終headの証拠として扱わない。

## 通常UIでの保存中取消fixture

DB module直接呼出だけではUIの取消との接続を代替しない。追加の1本では、native `IDBObjectStore.put` を実行した2番目chunkのtransactionを、同じtransaction内の実read要求でactiveに保つ。Workerもputも置換せず、transaction.completeのみを競合可能な状態に保つ。native putのsuccessとtransaction未completeを観測してから、通常UIの取消ボタンでabortさせ、held putのabortイベント・complete未発生・確定prefixが1chunkのままを確認する。取消後に有効形式の遅延replyを実adapterのmessage handlerへ再送し、DB不変、reload後も取消済みかつ同一checkpointをassertする。3秒assertは維持する。実モデルの遅延応答を測定したという主張ではない。

## 今回なお検証していないこと

通信probeはsample原文先頭30文字に限定される。WebSocket payload全体、会話の任意断片・変換済み表現の網羅的な検出、production Service Worker cache miss、OS packet、実モデル通信は未測定であり、G6を合格としない。要求試行0と成功／失敗の記録は、これら全経路の送信ゼロ証明ではない。

focus試験は開始・進捗・取消・再開、Tab／Shift+Tabの局所往復、Escape／×、header inertと起点復元まで。今回固有のdialog Tab全周trap、完了・失敗時focus、全背景inertの網羅、読み上げ通知の支援技術実測、OS実機は未測定。G5総合の合格とはしない。

## 追加静的レビューから再現・修正した境界

同一Sessionのcancel→resumeでは、durable commit成功直後・memory checkpoint更新前に取消すと、旧memoryを優先して確定prefixを巻き戻すことをunit fixtureで再現した。永続storeを設定したSessionは、同一instanceのresumeを含む毎回、durable loadを優先する。保存済みchunkの処理回数1回、cursor非退行、先行prefix完全一致をassertする。通常UIは新Sessionで読み込んでいたため、この件を通常UIで再現した不具合とは断定しない。

外側recordのfingerprintだけ改変した場合、従来は内部checkpointが正しければclaimで外側値を上書きできた。通常UIの故障注入でDB変更を再現し、純粋な外側／内側metadata整合検査をpreflightとtransaction内claimで共用するよう修正した。外側fingerprintのみ改変した再開はWorker要求0、owner／stateを含むrecord全体不変で拒否する。

run／generation／request IDを一つずつ独立に崩す6ケースはcandidate／reconcile双方のadapter unit fixtureで検査する。これを両phaseの全ID組合せを通常UI＋DBで測った結果に置き換えて主張しない。通常UIの保存中取消fixtureは別の証拠である。
