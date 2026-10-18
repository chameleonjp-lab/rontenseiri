# R22：通常UIとWorkerをつなぐ原文範囲台帳

## できることと、意味しないこと

通常画面の「原文範囲台帳」から、最初の会話資料の原文範囲を列挙し、実Workerで候補ペアをページ処理する。部分結果をIndexedDBへ保存し、画面の再読込後に保存済みペアの次から再開できる。AI評価用の輸送fixtureとは別の操作・別のrun ID・別のWorkerである。

候補源は既存の `makeAnalysisChunks(project, firstConversation, 160, 0)` が返す資料ID・版・UTF-16原文位置だけ。本文から意味・類似度・分類・議題・関係を推定しない。候補IDはchunk ID、各候補・各ペアのdispositionは必ず `hold`（意味未判定）。モデル生成物でもAIの代用品でもない。候補・応答がこの決定論的manifestと違えば保存前に拒否する。

「列挙完了」はこのmanifest内の全ペアを列挙したことだけを示す。関係不存在、内容の理解、全会話解析、合意、正しさ、解決の判定ではない。`fixture-bounded-reconciliation` v1は改名せずそのまま利用し、fixture-bounded契約を通常UIへ接続した限定スライスであることをUIにも表示する。既存の議題・関係・分類・原文へ結果を適用しない。

## 対象と上限

- 最初の会話資料だけが対象。追加会話・参考資料は対象外IDを表示する。対象資料ID・版、全候補の位置、候補に含まれない原文の隙間を別途表示する。話者接頭辞・改行なども含め、隙間を黙って解析済みにしない。
- ペア順は候補順の辞書式。位置と未処理範囲は0始まり・終端を含まない。意味は処理済み・未処理とも未判定。
- 候補は1〜256件。候補数・識別子・参照・manifest容量上限を事前検証し、超過は切り捨てず停止する。既存coreの上限・assertion・timeout・サンプル数は変更していない。
- 1ページ上限は候補256件、比較8件、保持8件、入力256KiB、出力64KiB、単調時計50ms。既存coreの累積上限も維持する。これはこの台帳の工学的ポリシーであって、実機の安全限界や性能合格ではない。
- 部分結果では停止理由・保存済みペア数・次位置・未処理範囲を表示する。累積上限等で次ページが進まない場合もpartialのまま。自動再試行、上限緩和、外部fallbackはない。
- UIのペア詳細は先頭32件を表示し、保存件数との差を明記する。保存・検証は全確定ペアを対象とする。

## 保存と再開

`span-inventory:<project.id>` を既存の専用run DBに保存する。通常の作業JSONには含まれず、同じブラウザの保存領域に限定する。作業本体は先に端末保存する必要がある。ポータブルな台帳export/importやブラウザ領域消去からの復元は未提供。

既存 `AnalysisSession` のfingerprint・checkpoint検証・連続prefix連結、既存の所有権ロックとgeneration/owner fenceを再利用する。候補とペア集約・cursorはcheckpointとして同一IDBトランザクションで確定する。確定前の応答は結果として表示しない。新しい所有者のclaimは比較交換で行い、古い所有者の遅延書込みは拒否する。

`partial` をrun状態として追加し、partial結果をcompletedに昇格する書込みを拒否する。UIは保存結果を読んだだけでは書き換えず、現在の資料・版・原文ハッシュ・発言・訂正ID・設定・schema・参照・ペア順・counter・cursorとの一致を確認してから表示する。変更・破損した結果は表示・再開を止め、自動修復・削除しない。明示的な破棄操作は所有権ロックの下で行う。

1回の開始・再開は照合1ページで止まる。取消・保存失敗後も既存確定prefixは保持する。次回は永続化済みcursorから再開し、保存済みchunkを再抽出しない。completeレコードへの直接再実行は事前検証後のno-opであり、所有者・checkpointも書き換えない。

## PR #14後の4件の回帰修正

PR #14は外部でマージ済みであり、その履歴・過去の検証結果は変更しない。追補は `main@1f64f42b821c94fb6e28747c41df0cdc0d874ec1` を基点とする別の限定修正である。

- Workerから受け取る各生ページは、保存前に比較・保持の差分8件上限を検証する。一般形として正しい9件ページも拒否し、確定済みprefixを変更しない。保存済み複数ページの累積結果には8件上限を適用しない。
- 訂正後のmanifestとSessionのchunkは、発言が参照する現行資料版を使用する。旧版の履歴を保持したまま、旧checkpointの明示破棄後は現行版だけで新規列挙する。
- `project.saved` だけでは開始を許可しない。UIの現在版の保存完了と、実行直前のIndexedDB保存内容との一致を確認し、未保存・保存待ち・保存失敗ではcheckpointを作らない。
- 台帳入口をサイドバーの主要操作へ移し、中間幅で下部操作だけが非表示になる問題を避ける。650/651/900/901pxを含む境界幅で実際のクリック到達を確認する。

ページ上限の独立unit回帰と、実Worker/IndexedDBの訂正→破棄→新規開始、保存トランザクション保留・失敗、レスポンシブ入口のE2Eを追加する。各実行のSHAと合否は追補PRの証拠に記録し、過去SHAの成功を新SHAの合格とは扱わない。

## PR #15後の保存競合と統合回帰

PR #15も外部でマージされ、追加追補は `main@8d6faa09951c47594df7c671baf3e972487d4d69` を基点にする。マージ済みPRの本文・履歴を変更せず、R24の所有権修正もこの保存競合追補には混ぜない。旧headのCI成功と、ローカル性能不合格は別の証拠として保持する。

追加の統合回帰では、一般契約上は有効な9件のWorker応答を通常runへ注入し、実IndexedDBに不正な候補・ペア・cursorが一切commitされないことを確認する。所有者/stateと、claimに対応するcheckpointのgeneration fenceは正常な実行開始として更新され得るが、それ以外のcheckpoint本体と確定prefixは厳密に保持する。再読込後には正常ページで同じ次位置から再開する。

自動保存と手動保存が同じ版で重なった場合も、既に永続化された同じ内容に対する古い失敗で保存状態を降格させない。一方、durable版にない新しい編集の失敗を成功扱いしない。これらは保存完了後の開始可否と、失敗→復旧→開始→再読込→再開の回帰で検証する。

`e2e/save-generation.spec.ts` は実IDBの同じ保存内容・版の手動保存と自動保存を重ね、勝者成功→競合した敗者の順にcallbackを配信する。同じfixtureは旧コードで開始ボタンが無効になって失敗し、修正後は有効のままとなる。別の対照テストで新しい編集の容量不足を実際に発生させ、保存DB不変・checkpointゼロ・開始不可を確認し、復旧保存後に8ペア→read-only再読込→16ペアへ厳密なprefixを保って再開する。未保存Project単独もUI／直接APIの両方でWorker・checkpointを作らず拒否する。

## 境界幅での実Workerライフサイクル回帰

R21/R22の次の限定テストスライスは、保存競合PR #16を未マージの計画依存として通常mergeし、別のPRへ分離する。`e2e/span-inventory-responsive.spec.ts` は650/651/900/901pxそれぞれでメニュー／台帳入口に到達し、実inventory Workerの8ペアpartial保存、reloadから再表示までのレコード厳密不変と同DBのreadwrite transaction／put・add・delete・clear観測ゼロ、16ペアへの再開を確認する。実際の保存Projectのmanifestを独立した二重ループで列挙した期待値に対し、先頭8ペアと再開suffix（index 8–15）のID・hold・順序、および全16ペアの完全一致と未検査範囲をassertする。prefix保持・重複なしだけで無欠落とは扱わない。Project保存DBも不変で、入口がクリックできるだけの回帰とは区別する。

各幅で実Worker URLと全requestを採取し、inventory Worker以外・外部origin・非GET・外部WebSocketを拒否する。開発Chromiumの可変viewportの証拠であり、スマホ実機・画面キーボード・SR・実ネットワーク／production SW・G4/G5・R21/R22全体の合格とは扱わない。意味判定や自動議題／関係変更を追加する実装ではない。

## テスト証拠と再現

追加テストは候補の全hold・厳密な原文参照・対象外資料と隙間・上限の正確な境界・偽造候補の拒否、Workerのrun/generation/request別フェンスと取消を確認する。

`e2e/span-inventory.spec.ts` は実Workerと実IndexedDBを使い、以下を独立にassertする。

1. サンプルの8ペアpartial保存、read-only再読込、全ペアの厳密な順序・集合・prefix一致。再開時の候補Worker要求ゼロと次cursorの厳密一致。
2. 作業DB全体が処理前後で厳密に不変。completeの再読込・直接再実行もレコード不変。
3. 重複ペア・古い版・偽のcomplete状態・設定不一致は表示前に拒否し、保存内容は変更しない。
4. 次ページのIDB putにQuotaExceededErrorを注入して、確定prefixの保持と再読込後の同じ次位置からの再開を確認する。
5. 実Workerへ次ページ要求を送った直後、同一main-thread turn内でUI取消する。応答配信前の取消後もprefixを保持し、再読込後の同じ次位置からの続行を確認する。
6. dev-server上のHTTP要求・method・WebSocket・Worker URLを観測し、外部originなし、非GETなし、台帳専用Workerだけであることを確認する。production Service Workerや実機の網羅的ネットワーク証明ではない。

```sh
npm run check:format
npm test
npm run build
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npx playwright test e2e/span-inventory.spec.ts
npm run test:e2e -- --grep-invert '各100操作で観測する'
npm run test:offline
npm run benchmark
npm run evaluate
```

公開後の最終SHAでローカルの全検証を再実行し、そのSHA・終了コード・JSON結果・画像・ログを保存する。push/PRのCIにも既存の全ステップをそのまま実行させる。最終公開SHA、CI run、artifact内の `verified-sha.txt` の同一性、各結果はPR本文に記録する。CIの成功をP2/R22/G2–G8全体の合格に読み替えない。

## 残るゲート

**R22/P2全体、意味を持つ信頼できる候補源、モデルの日本語品質・関係抽出・複数資料照合、AI品質、R12全体、G2–G8は未完。** この台帳はモデル結果を議題の真実にする接続を追加していない。

実機（iPhoneを含む）・支援技術・実利用でのメモリ/長時間/多タブ/大規模性能・production SW環境の新経路の通信/再開・全ページ境界でのクラッシュ/障害組合せ・他ブラウザ・バックアップ可搬性は未測定または未完。既存の一般的なロック/保存テストは再利用するが、新スライスの全組合せを実機で確認したことにはしない。既存性能失敗・過去の証拠は変更せず、診断と合否を区別する。

このセッションで既存チームへの連絡機能が利用できなかったため、新メンバーは作成せず、独立したKamekame/Sapoレビューは未実施。自動テスト・自己レビューは独立レビューの代替合格ではない。
