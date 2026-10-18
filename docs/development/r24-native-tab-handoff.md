# R24：ネイティブ3ページ handoff

## 目的

`e2e/ownership-native-handoff.spec.ts` は、同一BrowserContext内の3つの実ページ（A/B/C）で、実ブラウザの `navigator.locks` とプロダクトの `acquireAnalysisOwnership`／`withAnalysisOwnership` を接続した受入れテストである。fixture lock、UI mock、`locks`差し替えは使わず、プロダクトの既定の取得・lease設定を使う。

## 決定的な順序

1. Aが既定設定でlockを取得して保持する。
2. Bが同じlockを要求し、native `pending` queueに入る。Bのworkはまだ開始しない。
3. Aをreleaseすると、Bがnative grantされ、実際のwork callbackが開始する。Bのworkは明示的なPromise gateで停止する。
4. Bのwork中にCが要求する。Cはnative queueで待機し、`workStarts`は0のままである。
5. Bの実際の `AbortController` をabortする。Bのlease signalはabortされるが、Bのwork／`finally` が終わるまではnative lockはheld、Cはpendingのままである。
6. Bのgateを解放し、workから遅いpayloadを返す。wrapperはleaseの `AbortError` をrejectし、Bの `.then` publicationは0件となる。
7. Bのrelease後にだけCがgrantされ、Cのworkと `.then` publicationは各1件となる。最後にnative `held`／`pending` はともに0件である。

テストのattachment `r24-native-handoff-pre.json` には、上記のstage順、lease abort、Cの未完了時点のpending／work 0、Bのwork return／publication 0、Cのwork 1／publication 1、最終queue状態を記録する。

## 観測の境界

- native状態は各ページから同一BrowserContextの `navigator.locks.query()` で観測する。Bがgateで停止中に `held: 1, pending: 1`、終了時に `held: 0, pending: 0` であることをassertする。
- `Bのpublication 0` と `Cのpublication 1` は、wrapper Promiseの `.then` 側のカウンタである。Bのwork callbackが遅いpayloadを返したこと自体は別に記録する。
- このケースで検証する「stale publishなし」は上記wrapper Promiseの結果に限定する。実Worker、`onRecord`、IndexedDBの永続化については、このテストでは実行・主張しない。
- 既存の3タブ待機・取消ケースは `ownership-pending.spec.ts` に残し、本テストでは重複しない。

## 実行制約

Chromium（`/usr/bin/chromium`）をport `4321`で単独実行し、新規のreport／outputDirへ証拠を出力する。既存のtimeoutとexpectationは緩和しない。G5相当の追加latency主張、CI・プロダクトコード変更、fixtureによるexpiration raceの主張は行わない。

内部AbortSignal/native C++ listener数は測定していない。公開Web Locks状態とwrapper結果の限定証拠であり、R24/G5全体は未受入。最初の試験はleaseAbortedを開始時snapshotだけで観測して失敗し、abort eventを観測するfixtureへ修正した。最初のfailure consoleは保持したが、担当のoutputDir再利用でその回のtrace/screenshotは保持できていない。以後は新しい証拠先を使い、最終headへ旧結果を流用しない。
