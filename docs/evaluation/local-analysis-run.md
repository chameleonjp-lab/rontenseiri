# ローカル解析経路の取消・再開（P2の限定的な縦切り）

通常UIから既存の `analysis.worker.ts` と `AnalysisSession` を通り、検証済みchunkをIndexedDBへ保存して再読込・再開する経路を追加する。**この経路は決定的な動作確認fixtureであり、AI解析ではない。** 原文・議題・訂正へ結果を適用しない。実モデルの開始無効化は維持する。

## mainで確認した不足

開始点は `6e65a9c43571f030287b7e1067b526ce472d70b2`。既存sessionにはsource ID・版・hashの検査があった一方、解析設定・発言切出しの固定識別、連続prefixの検査、永続checkpoint store、通常UIからのsession経路がなかった。従来のAIダイアログは `analyzeLocally` の一括Worker経路を使い、モデルの固定取得条件が未確認のため開始不可だった。

sessionは取消を無視するadapterの応答を待ち続け、checkpoint読込中はrunning状態にならず、保存失敗より前にメモリ上の確定位置を進めていた。今回の回帰試験はこれらの境界を対象にする。既存の試験assert・時間上限は変更しない。

## 今回の契約

- run開始時にProjectをコピーし、source ID・版・hashと入力構造の完全一致識別子を固定する。識別子はsource・対象発言・訂正IDをローカルでSHA-256化した値で、識別用に原文をcheckpointへ重複保存しない。外部に送信しない。
- 設定識別子にfixture版・chunk長・overlapを含める。fixtureは160文字、overlap 0、400ms/要求。故障シナリオは結果の意味を変えないfault injectionとして扱い、再開時には通常シナリオへ戻せる。
- 保存済みの `nextChunk = k` と候補の長さ・順序・chunk IDを厳密に照合する。source・入力・設定・sessionが違うcheckpoint、未検証候補、偽の完了prefixは再開を拒否する。旧形式で入力／設定識別子を持たないcheckpointも推測で移行しない。
- chunk結果をschema検証し、永続化の成功後だけ確定位置を進める。再開はk+1番目からで、確定済みprefixを再処理しない。fixtureの最終照合も全chunk IDの順序付き完全一致を要求する。
- session世代とAbortSignal、Workerのowner/request ID、IndexedDB readwrite transactionのowner比較で旧runを排除する。取消時はWorkerをterminateする。checkpoint書込中の取消はtransactionをabortする。モデル等の協調的な取消を仮定しないsession試験もある。
- UIは取消・失敗・未完了・完了を分ける。永続状態runningを再読込した場合は「未完了」と表示する。全chunkと照合結果の保存後だけ完了状態を記録する。「完了」は動作確認のみでAI解析未実施と表示する。
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

E2EはWorkerを置換せず、native `Worker.prototype.postMessage` を観測するだけで送信chunk IDを記録する。UI開始→取消→reload→再開で、再開要求の全IDと最終候補のk以降が完全一致し、先行chunkとの重複0件を別assertする。networkについてもBrowserContextの実行時request観測とWebSocket origin観測を別assertする。HTTP外部要求0、GET以外0、本文送信0を観測する。通信をrouteで遮断して成功を作らない。

証拠はCIの `browser-evidence` artifact内の `verified-sha.txt`、`unit-results.json`、`e2e-results.json`、`test-results/**/attachments/` のnetwork観測JSON、`artifacts/p2-completed-run.png`。PR本文には検証対象head SHAと同じheadのCI run/artifactを対応させる。開発中の診断実行は最終SHAの証拠と混同しない。

## 合格としない範囲

今回の3秒assertは当該fixture経路の局所受入条件に限る。G4の端末・モデル全体の取消性能やG5総合合格を表さない。

P2全体、実モデル／日本語品質（G2・G3）、GPU喪失・モデル取得中断・再試行／照合資源上限、重要発言再解析、実モデルからの議題候補適用、従来 `analyzeLocally` との一本化は未完了。G5の全操作・実機復旧、Mac／Windows／iPhoneのOS matrix、支援技術／スクリーンリーダー、G8の利用者比較も未検証。ここで観測した通信0件はfixtureだけの結果であり、実モデル取得時のG6合格ではない。外部AIフォールバックは追加しない。

Web Locksが利用できなければこの経路もfail closedとする。複数タブ・長時間バックグラウンド・最大入力の実機資源評価は別に残す。Project削除とは独立したcheckpointの寿命管理／完全JSONへのcheckpoint統合も今回の対象外とする。
