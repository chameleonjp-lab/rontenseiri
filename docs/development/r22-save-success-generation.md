# R22：古い保存成功から新しい編集の復旧UIを守る

## 守る条件

保存成功callbackが現在版の`saveFailed`・保存error・成功通知を更新できるのは、その要求が提出した内容と現在Projectの内容が一致するときだけとする。比較は`persistenceKey`を用い、`saved`・`updatedAt`・`storageRevision`という保存metadataだけを除外する。同じ内容の保存成功は引き続き有効だが、古い内容Aの成功を、新しい内容Bの成功と扱わない。

最後のdurable refはstorageRevisionが低い成功で巻き戻さない。既存どおり、Aのcommitが確定したら新しいBへ基底storageRevisionを引き継ぎ、次のB保存を可能にする。このmetadata引継ぎでBの内容をdurableと表示しない。Bの失敗・復旧UIを保持し、台帳ゲートは`project === savedProjectRef.current && !saveFailed`が成立するまで閉じる。内容の自動マージ、外部保存、議題・関係の自動変更は追加しない。

## 実IDBの逆順回帰

`e2e/save-success-generation.spec.ts`は手動A保存・自動A保存それぞれで、native IDBのA putがcommitした後もsuccess callbackを保留する。その間に意味内容Bへ編集し、Bの保存を実際のCAS conflictで失敗させる。A callbackを解放してReact反映を待っても、B本文・error・保存と復旧領域・開始不可とdurable Aの厳密不変をassertする。

armed後の650ms timerをfixtureで保留し、autosave A/Bだけを明示的に1回ずつ実行する。後続B retryが再度失敗して古い成功のUI消失を覆い隠す偽合格を防ぐ。同じケース内の正常対照として最新Bを本当に保存し、storageRevision更新・B本文のdurable一致・復旧UI解除・台帳開始可能を確認する。保留した古いtimerを再生して成功を作らない。

同じ最終fixtureは旧`563715d`で2件とも、A成功解放後の保存と復旧領域消失により不合格。修正候補は2件通過した。初期fixtureの文言・rows呼出・close locator不整合による失敗も別の失敗証拠として保持する。これを初回から通過したとは扱わない。先行targeted結果は新published headの全検証を代替しない。

## 他の証拠との区別

PR #16の同内容成功→古い失敗の2件はこの逆順P2の検証ではない。本追補は独立したPR／headとする。既存の容量不足対照はput時の例外注入であり、実容量枯渇やtransaction-complete時のabortを再現したものではない。不正9件のsuffix回帰も実IDBは使うがWorker eventを注入する試験で、実Workerが不正な9件を生成した証拠ではない。

開発Chromiumと実IDBでの保存UI世代フェンスの限定検証であり、実機・実quota枯渇・全ブラウザのtransaction abort・G4/G5・実モデル品質・G2–G8・R22/P2全体の合格を意味しない。閾値・assertion・既定timeout・100操作・CIは変更しない。
