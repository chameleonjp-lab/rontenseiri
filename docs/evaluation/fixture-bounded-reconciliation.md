# fixture-bounded reconciliation + partial-result contract

今回の対象は、決定的なfixtureに限った照合の予算停止と部分結果の契約です。**R22全体やP2全体の完了ではなく、AIの意味判断を行いません。** 公式v0.4の[資源制限](../requirements-and-development-plan.md#v04-照合の資源制限r15r22r24)とR22に対する限定的なソフトウェア実装です。

## 開始点と境界

編集前にGitHubのmainをキャッシュ無効で確認し、`764040b8513384dc08f3a3b498d37f87a06046e3`、OPEN PRは0件でした。PR #9の既存run／取消／checkpoint制御は置き換えません。関連する実装・テスト・この文書を1本のDraft PRにまとめます。自動マージは行いません。

既存のファイル取込上限やbackupの50 MiBを照合予算の根拠にはしません。数値は、このfixtureで停止契約を実行・試験するための内部ポリシーです。製品の安全上限、実機のメモリ上限、推論の時間保証ではありません。新しい利用者設定は追加しません。

## 部分結果を完了扱いしない

照合済みの関係候補・関係なし・保留と、まだ照合していない範囲は別の状態です。部分結果には停止理由と再開位置を残します。未照合を「関係なし」「未回答」に変換しません。人物や問いを表現の類似だけで自動統合せず、Projectへの結果適用もしません。

AnalysisSessionは明示的な部分結果を返し、保存済み部分結果から再びreconcileを呼べます。従来の輸送fixture UIはそのままです。このUIは新しい限定照合エンジンを呼ばず、部分結果を表示できない経路で完了を誤表示しない防御も置きます。新しいモデル開始、外部AI、ネットワーク送信は追加しません。

## 証拠の読み方

局所的なunit／contract試験と、既存の回帰試験・build・CIを区別します。最終検証の対象commitはDraft PR本文の完全SHAとCI artifactの `verified-sha.txt` で対応させます。CI artifactの `unit-results.json` はそのcommitの試験結果であり、この文書自身のcommit hashを自己参照で埋め込むことはしません。開発途中の試験を最終SHAの証拠に転用しません。

## まだ確かめていないこと

訂正依存関係による再利用、意味上の全再解析との比較、遠距離の関係の見落とし、実モデルの品質・推論・取消、実機の壁時計時間・メモリ・OS別の適合性は対象外です。G2–G8はこのfixture試験を理由に合格としません。特にG4の製品予算・端末別安全限界、G5のアクセシビリティ総合評価、支援技術による読み上げ、OS実機測定は未完了のままです。

## 内部予算の数え方

`src/analysis/bounded-reconcile.ts` の定数は製品判断ではなく、fixture契約の内部ポリシーです。小さい予算を関数へ注入でき、上限以上に広げることはできません。利用者向け設定ではありません。

| 対象 | 内部上限 | 数え方 |
| --- | --- | --- |
| 候補 | 10,000件 | 新しくadmitした候補。保存済みprefixを再admitしない |
| 比較 | 50,000回 | 辞書順のindex pairを1回処理するごとに1。全組合せ配列は作らない |
| 保持結果 | 50,000件 | 関係候補・関係なし・保留を各1件。関係なしも捨てない |
| 入力 | 8,388,608 bytes | キー順固定のcandidate JSONをUTF-8化した実バイト長の合計 |
| 出力 | 8,388,608 bytes | キー順固定のPairResult JSONをUTF-8化した実バイト長の合計 |
| 時間 | 30,000 ms | 注入した単調なelapsed clock。端数msを許容し、締切ちょうどで次操作を停止 |

呼出しごとの小さいpage予算は再開時にリセットします。一方、候補のadmit済みprefix、比較・保持結果・入出力bytes・elapsed msのcursor/countersは累積です。上記の内部総量上限は再開でもリセットしません。総量上限に達した場合は再開しても部分結果のまま進まないことがあります。上限を迂回して全件処理を保証する契約ではありません。

出力bytesは結果payloadのみであり、envelope/cursorを含むJSONファイル全体のサイズやヒープ量ではありません。envelope/cursorも次の別枠のhard capで有限にします。入力も原文全体やupload bytesではなく候補JSONの量です。上限に収まる1操作は許可し、次の操作で超える場合には実行しません。時間は `elapsed >= deadline` で新しい入力・比較を始めません。実行中の1操作を途中で切断する仕組みではなく、実時間の厳密な上限保証ではありません。

## 事前検査と根拠参照

静的なfixture manifestの検証は照合前の別枠です。候補10,000件、1候補の根拠64件、各識別子128 JSコード単位、canonical manifest全体8,388,608 UTF-8 bytesをhard capとし、予算0でもこの有限な事前検査は行います。admit/comparisonの観測hookと区別します。無制限のall-pairs/reportは作らず、未照合は次pair indexから末尾までの1つの半開区間 `[start,end)` で表します。

候補は本文を含まず、id・根拠span・fixtureのdispositionだけです。coreはschema、非空ID、重複ID／同一候補内の重複参照、整数の正の長さspanを検査します。**そのsource ID／版が現在のProjectに存在し、spanが原文範囲内かは、Sessionの文脈付きcandidate validatorの責務です。** 結合試験では現在のchunk manifestとの完全一致で検査します。任意のProjectに対してcoreだけで原文の妥当性を保証するものではありません。

cursorは版、完全なcanonical manifest identity、候補ID順、連続prefix、処理位置、累積入出力bytesを検査します。identityは衝突し得る短いhashではなく、上記hard cap内のcanonical文字列の完全比較です。参照以外の会話本文を含みません。累積出力bytesは全pairを再列挙せず、ID長・disposition別prefix集計から求めます。

## 再開と結果保持

coreの1回の戻り値はpageです。`pageStartPairIndex` とcursorの差が結果件数に完全一致しなければ拒否します。各結果は決定的なpair順・fixture dispositionに一致する必要があります。処理済みの結果と未照合suffixを混ぜません。

Sessionは部分結果から次pageを要求するとき、前cursorと次pageの開始位置・manifestが一致することを確認し、過去の結果を含む有界の累積結果をcheckpointに保存します。再開後に前pageを消したり、同じpairを二重保存したりしません。marker付き結果は文脈付き `validateReconciled` が必須で、検証の前後でstatusを消す／変えることも拒否します。markerなしの `status: partial` を汎用completeへ読み替えません。genericの従来complete結果は互換です。Session実装識別子はv5に更新し、旧設定のcheckpointは推測で移行しません。

失敗した永続checkpointのpreflightは保存前に拒否し、Projectや保存recordを書き換えません。この限定契約は、改ざん耐性を持つ署名付きcheckpointや、利用者への厳密な一度限り通知を実装するものではありません。

## 再現コマンド

```sh
npm ci
npm test -- tests/bounded-reconcile.test.ts tests/bounded-reconcile-session.test.ts tests/analysis-session-partial.test.ts
npm test
npm run check:format
npm run build
```

境界試験は各予算の0・直前・ちょうど・1超過、非ASCIIのUTF-8 bytes、停止後の入力／比較hook未呼出し、注入時計の途中失効、再開後の重複・欠落なし、保存前の不正schema／ID／span／重複／counter拒否を対象とします。実際の通過件数・最終SHAはPRと同一SHAのCI artifactを参照してください。

## 既存キーボードE2Eのreadiness競合

初回head `c7ac8a4465827744afac84307c3f2f8026ba7c3b` のpush CIは成功しましたが、[PR CI attempt 1](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39123503648/attempts/1)と[attempt 2](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39123503648/attempts/2)は、既存の1440px手動修復E2Eで失敗しました。両attemptのlog・trace・artifactは過去の失敗証拠として保持し、後続headの成功で読み替えません。

原因は、保存Projectの非同期再読込直後、`navigate` helperが「問い・根拠」ボタンの一度だけの不可視判定をmobile状態と誤認し、desktopではCSSで非表示の「メニュー」を待ったことです。両traceでは、その判定の約20–22ms後に正しい作業画面が記録されました。製品の画面切替や保存データを変更する修正ではなく、テストhelperの表示待ちを修正します。既存のキーボード操作、本文・履歴・保存・focusに関するassert、test timeoutは維持します。

共有helper `e2e/helpers/keyboard-navigation.ts` は、対象ボタンかメニューボタンのどちらかが実際にvisibleになるまでPlaywrightのassertで待ち、それから可視経路を選びます。固定delayやtimeout増加はありません。

`e2e/navigation-readiness.spec.ts` は、native IndexedDBのProject readそのものや保存値を変えず、success通知の配信だけを明示的なgateで保留します。reload後に両入口がまだ存在しない状態を作り、gate解放後の1440px desktop／390px mobileの実DOMとキーボード操作を、それぞれ2回のreloadで検査します。表示を模した代替DOMや時間待ちによる確率的なrace生成ではありません。これはbrowser fixtureのreadiness回帰であり、実機・支援技術・アクセシビリティ全体の測定にはしません。
