# R24：所有権失効時の停止と安全な引継ぎ

## この修正の範囲

公式計画R24の限定スライス。初期ブランチはR22台帳の4件修正PR #15の公開head `64d8830abe1b1efa628dbea10456638bbac4fae9` を基点とした。PR #15は外部でマージされ、mainは `8d6faa09951c47594df7c671baf3e972487d4d69` となった。本修正は保存競合の追補とは別のPRにし、最新の依存headを通常mergeで取り込む。外部のマージを本作業の実施とは扱わず、マージ済みPRの本文・履歴も変更しない。

所有権の期限だけが先に切れてWeb Lockを解放すると、旧Workerが稼働したまま別タブへ資源を渡すおそれがある。期限切れと呼出側の取消は、まず所有権の `signal` をAbortする。実作業がWorker停止・保存取消・後処理を終え、`withAnalysisOwnership` の `finally` が `release()` してから次の所有者へ渡す。

モデルWorker、輸送検証用Worker、原文範囲台帳Workerの既存呼出を同じsignalへ接続する。期限切れ後に作業callbackが遅れて成功値を返しても、ラッパーは成功として公開しない。終了・失効後のモデルWorkerの遅延進捗・結果も無視する。新たなモデル実行、外部AI、モデル取得、OCR、URL取得、自動議題・関係変更は追加しない。

## 安全側に停止する条件

Web Locksのない環境は従来どおり開始しない。取消に協調せず終了しないcallbackは、ロックを保持したままとなる。タイマーだけでロックを奪って同時実行するfallbackは設けない。強制停止不能な任意コードの自動回復や、一定時間内の利用可能性を保証する修正ではない。

低水準の `acquireAnalysisOwnership()` を直接使う呼出側は、`signal` を監視して実資源を片付けた後、明示的に `release()` する責任を持つ。通常実行経路は `withAnalysisOwnership()` を使用する。タブ終了時のネイティブWeb Locksの解放は別のブラウザ回帰で確認する。

## 回帰テスト

- `tests/ownership.test.ts`：fake timerで期限切れ後もロックを保持すること、明示解放後だけ次所有者が取得すること、失効後の遅延成功を拒否すること。
- `tests/analysis.test.ts`：モデルWorkerをモックし、期限切れ時のterminate、AbortError、遅延進捗・結果の抑止、外部fetchゼロを確認する。実モデル品質の検証ではない。
- `tests/inventory-completed-notify.test.ts`：実`runSpanInventory`のcompleted読込における検査awaitを止め、取消・lease失効後に検査を再開する。実`onRecord` callbackが0回で、claim/write/Worker生成なしで拒否すること、失効しない対照は1回通知することを検証する。保存読込とLock提供者はfixtureであり、実IDB・実モデルの検証ではない。fingerprint検査後もclaim前にsignalを再確認する。
- `e2e/ownership-lease.spec.ts`：同じブラウザcontextの2タブ、実Web Locks、実Blob Workerで、期限切れと手動取消の両方についてWorker停止・非同期cleanup中のロック保持・cleanup後の引継ぎ・旧成功の拒否を確認する。所有タブを閉じた後の引継ぎも別テストにする。
- `e2e/ownership-fencing.spec.ts`：期限・取消では合成Blob Workerをcommit直前で止め、失効後も意図的に存続させて遅延応答を再開する。実IDBの保存APIがAbortErrorを返してsnapshotとfixture内の公開counterゼロを保持すること、cleanup後に新所有者だけが保存・fixture公開できること、旧tokenをsignalなしで再送しても所有者フェンスで拒否されることをassertする。これは実`runSpanInventory.onRecord`経路を通る公開検証ではない。タブ終了では死んだWorkerの再開は不可能なため、終了直前の正確なenvelopeを残存タブから再送して保存世代フェンスだけを確認する。死んだWorkerの遅延発火を実行したとは扱わない。旧／新owner・generation・runId・fingerprint・保存前後・fixture公開回数をJSON添付する。

```sh
npm run check:format
npm test
npm run build
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npx playwright test e2e/ownership-lease.spec.ts
npx playwright test e2e/ownership-fencing.spec.ts
npm run test:e2e -- --grep-invert '各100操作で観測する'
npm run test:offline
```

最終公開SHAの全検証とpush/PR CIは、独立した新規証拠ディレクトリへ保存する。実装途中の先行ブラウザ失敗は、その時点の失敗として保持し、後の成功に読み替えない。閾値・assertion・timeout・性能サンプル数・CIは緩和しない。

## 残るゲート

R24全体、R22/P2全体、G2–G8の完了ではない。実機・SR/支援技術・実モデル/GPUメモリとモデル切替・実運用の多タブ負荷・クラッシュ組合せ・production SW上の新経路・性能/G4/G5・残るa11y/export/offlineゲートは未完または未測定。合成Workerの停止とネイティブロックの引継ぎを、実モデル資源の全回収や意味品質の合格に読み替えない。
