# R24：保留中の所有権取得の取消

`acquireAnalysisOwnership()` は、ネイティブ Web Locks の標準形 `request(name, { signal }, callback)` を使い、取得待ちの間だけ内部の取得用 `AbortController` を有効にする。呼出側の `signal` は、取得前なら待ち行列からの取消と `AbortError`、取得後なら lease の `signal` の失効として扱う。タイムアウトは `OwnershipTimeoutError` のまま保つ。

取得待ちが取消・タイムアウト・`null` lock・request failure になった場合は、取得タイマー、呼出側 abort listener、ネイティブ request の pending entry を片付ける。既に abort 済みの signal は request を発行せず、lock callback も呼ばれない。lock が付与された時点で取得タイマーを必ず解除し、lease timer と abort listener は明示的な `release()` 後に解除する。

lease の期限切れまたは外部取消は lease の `signal` だけを abort する。作業が停止して `release()` が呼ばれるまで、ネイティブ lock は保持され、別の所有者へ早期に引き継がれない。`withAnalysisOwnership()` は通常どおり `finally` で release する。

この限定スライスは pending acquisition の cleanup を対象とする。R24 全体、G4/G5、実機負荷・性能・実モデル品質の完了を意味しない。
