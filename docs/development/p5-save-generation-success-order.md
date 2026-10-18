# P5/G5：保存成功の逆順配送でBを巻き戻さない

主分類はP5/G5（保存世代とdurable snapshotのrollback防止）。Bは原文訂正を通るが、依存結果の再計算/needsReview、diagram/list/summary/exportの共通状態、無関係変更、undoをassertしないためR15は副次・受入未検証とする。R22の台帳ゲートも副次的な接続証拠に限定する。PR #19の「B保存失敗中にA成功で復旧表示を消さない」ケースとは別の逆順成功ケースであり、一方の成功から他方を推定しない。

## 同一Appでの実際の順序

Aを通常UIから保存し、native IndexedDBへのcommitとrevision増加を確認する。success callbackだけを保留したまま、同じPage/同じAppでヘッダーの明示的な破棄確認を通ってホームへ移動し、実durable Aを最近の作業から再オープンする。これは通常UI経路であり、ProjectやstorageRevisionをテストが合成して差し込むものではない。Aの通知を保留したまま直接BをCAS保存すると旧revisionで競合するため、この実再オープンを前提条件として明記する。

そのAppでBへ編集し、native B commitを確認する。B successを先に配送し、その後に低revisionのA successを配送する。A通知後にも画面本文B・復旧UIなし・台帳開始ゲート有効・durable revisionと本文Bを個別に確認する。未配送のautosave timerは勝手に再生しない。

reload前に内容を変えずBをもう一度通常保存する。これはin-memory revisionが古いAに戻っていればnative CASで失敗する対照であり、別内容Cへの編集やreloadによる状態回復で不具合を隠さない。その後reload→最近の作業から開き、B本文・同一保存レコード・有効な台帳ゲートを確認する。

## ケース別の証拠と組合せ

| ケース                      | 主な対応                   | 対象と限界                                                            |
| --------------------------- | -------------------------- | --------------------------------------------------------------------- |
| 同一App B成功→遅延A成功     | R15/G5、R22副次            | 下表4組合せ。通常UI、native commit、Bゲート、B再保存、B復元           |
| B自動保存の復旧成功         | R22保存/復旧表示の追加対照 | A通知後にB retryと実B successを明示配送。逆順成功matrixの代用ではない |
| 2ページでの逆順成功         | durable-storageの補助対照  | Bのdurable内容を確認。同一Appのメモリ/保存参照の根拠には数えない      |
| 既存manual/autosave A→B失敗 | PR #19の別条件             | 既存回帰を維持。逆順成功とは別ケース・別attachment                    |

| 保留する旧A通知の保存元 | 先に成功させるBの保存元 | 実行識別                         |
| ----------------------- | ----------------------- | -------------------------------- |
| manual                  | manual                  | `same-App … (manual/manual)`     |
| manual                  | autosave                | `same-App … (manual/autosave)`   |
| autosave                | manual                  | `same-App … (autosave/manual)`   |
| autosave                | autosave                | `same-App … (autosave/autosave)` |

表は試験対象を示す。各公開headの実行件数・成功/未完了はPR本文のexact SHAと新規JSONへ結び付け、旧headの成功を流用しない。

## 観測の境界

request success callbackと既存650ms autosave timerの配送だけを制御し、get/put/transaction commitとrevision比較は実IndexedDBで実行する。privateなReact保存refのidentityは直接読まない。B本文、保存gate、通常UIの未保存guard、後続native CAS保存での挙動による限定証拠であり、内部参照の直接観測とは区別する。

実quota枯渇、全ブラウザ、意味解析/モデル品質、全保存競合、production SW、P5/G5/R15/R22全体の受入は保証しない。性能操作・閾値・timeout・プロダクトsource・CI定義は変えない。先行の同一App1組合せ7件通過と、誤ったcwdでのnpx導入待ち（試験未実行）は別履歴として残す。

manual/autosave組合せの先行1件は、fixtureがtimerへ0を返しclearTimeoutを再現しなかったため古いtimerが残って失敗した。timer identityと取消を再現するfixtureへ修正し、assert/製品650ms/閾値を変更せず、新しい出力先で再検証する。失敗trace/consoleは保持する。
