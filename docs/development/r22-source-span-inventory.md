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
