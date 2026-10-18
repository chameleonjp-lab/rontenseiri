# R24：保留中の所有権取得の取消

取得済みleaseの停止・引継ぎとcompleted通知フェンスのPR #17（`b78c7f2cc759ceab3bc35f446284c6ecd2776051`）を未マージの計画依存として通常mergeした、別の限定追補である。PR #17のheadへ待機取消を混ぜない。

`acquireAnalysisOwnership()` は、ネイティブ Web Locks の標準形 `request(name, { signal }, callback)` を使い、取得待ちの間だけ内部の取得用 `AbortController` を有効にする。呼出側の `signal` は、取得前なら待ち行列からの取消と `AbortError`、取得後なら lease の `signal` の失効として扱う。タイムアウトは `OwnershipTimeoutError` のまま保つ。

取得待ちが取消・タイムアウト・`null` lock・request failure になった場合は、取得タイマー、呼出側 abort listener、ネイティブ request の pending entry を片付ける。既に abort 済みの signal は request を発行せず、lock callback も呼ばれない。lock が付与された時点で取得タイマーを必ず解除し、lease timer と abort listener は明示的な `release()` 後に解除する。

lease の期限切れまたは外部取消は lease の `signal` だけを abort する。作業が停止して `release()` が呼ばれるまで、ネイティブ lock は保持され、別の所有者へ早期に引き継がれない。`withAnalysisOwnership()` は通常どおり `finally` で release する。

unitは取得前取消・timeout・同期/非同期request失敗・取得timer解除と全timer後処理を確認する。取得後のcaller取消でもlease signalはabortし、明示releaseまでは後続を保持する。新しい注入Lock提供者は標準3引数に準拠させ、既存モデルWorker fixtureとcompleted通知fixtureも同じ形へ更新する。2引数だけの独自提供者を暗黙に推測してfallbackしない。

`e2e/ownership-pending.spec.ts`は実Web Locksの3タブで、取消/timeout後に待機者のpromiseがrejectするだけでなく、先行所有者が保持中でもnative pending countが0、caller listenerが0、旧work開始0となることを確認する。その後の第3タブだけがrelease後に開始する。既にabort済みの要求もqueue/実作業ゼロを確認する。取得済みleaseの停止/世代フェンス6件と併せて検証し、単独の3件だけで退行なしとは扱わない。

この限定スライスは pending acquisition の cleanup を対象とする。R24 全体、G4/G5、実機負荷・性能・実モデル品質の完了を意味しない。
