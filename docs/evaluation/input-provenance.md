# 入力範囲と字幕の来歴を失わないためのP1補完

PR #4の最終HEAD `0c4b58f25fa1f0d7d66b66007a5070bea312f731` を基点にした別の作業束。PR #4の実装・検証証拠は変更しない。G5完了を意味するものではない。

## 実際に再現した不足

同じ基点の独立worktreeで二つの診断試験を実行し、**2件失敗・4つのassertion失敗・終了コード1**を確認した。各単独発言のraw source sliceは一致していたが、VTT二cueの統合では引用にNOTE・入力cue ID・時刻行が入り、先頭cueの`time`だけが残った。cue台帳は存在しなかった。また、妥当な`omissions`をProjectへ付けても完全JSON往復で消えた。

負例の[試験ソース](../../artifacts/p1-provenance/baseline-0c4b58f25fa1f0d7d66b66007a5070bea312f731/p1-negative-diagnostic.test.ts.txt)、[全ログ](../../artifacts/p1-provenance/baseline-0c4b58f25fa1f0d7d66b66007a5070bea312f731/p1-negative-diagnostic.test.log)、[SHA・終了コード・ファイルhash](../../artifacts/p1-provenance/baseline-0c4b58f25fa1f0d7d66b66007a5070bea312f731/metadata.json)を保存する。負例は成功試験に数えず、通常suiteの探索対象から分離した。

## 会話全体の範囲と、入力内の範囲は別

既存のProject-level `extent`（全文／抜粋／不明）を維持する。新しい`omissions`は利用者が報告する「提供された入力の外で欠けている部分」で、`id`・内容・理由・任意の自由記述位置だけを持つ。存在しない原文offsetやSource別extentは作らない。`undefined`の未申告を空配列へ正規化せず、未申告は欠落なしの証明ではないと表示する。

原文対応画面で下書きを編集し、明示適用すると通常の訂正履歴へ記録する。専用のUndo復元でextentとomissionsの存在有無を戻し、既存の履歴件数・バックアップ容量制限を使う。一般的な意味スナップショットへSourceやProject全体を無差別に加えない。別の原文訂正など、欠落申告と無関係な更新では未適用の申告下書きをリセットしない。

## UTF-16位置の契約

原文はBOM、CRLF、単独CR、LFを含めて保持する。位置はJavaScriptのUTF-16 code unitによる半開区間`[start,end)`。BOM除去を仮定した試験は誤った期待であり、製品不具合として数えない。

通常の単一範囲発言では`source.text.slice(start,end) === quote`を維持する。日本語、astral emoji、結合文字、ZWJ、混在改行についてparse、原文訂正、後続位置rebase、Undo、訂正前後の完全JSON往復を直接検証する。既存TXTの統合は従来どおり連続範囲の原文gapを含み、期待値を変更しない。

## 字幕cueは話者発言そのものではない

Sourceの任意の`cueLedger`は入力順を保持し、Source version内で一意の内部IDと、未指定・重複を許す入力IDを分ける。本文のUTF-16範囲・行・開始終了時刻・参照時刻文字列を保持する。cueと話者の発言境界を自動で同一視しない。合法的な重なり・同じ開始時刻を禁止しない。

字幕発言の`cueSpans`はcue本文の実在範囲を指す。単独cueの複数行本文はraw CRLF等をそのまま一つの範囲に保つ。利用者が複数cueを統合した場合、`quote`は**本文spanを表示用LFで結んだ値**であり、トップレベルの`start/end`は包絡範囲となる。ここで連続source sliceと同一だと偽らず、各本文spanとcueの範囲・順序・quote再構成を検証する。cue間の表示用改行には原文位置を捏造しない。複数cueへ単一の先頭`time`を付けず、各cueの時刻を参照できるようにする。

範囲分類も本文span単位で再構築し、間の時刻・ID・NOTEを発言に含めない。分割は表示位置を本文spanへ写像し、合成改行を原文へ割り当てない。同じcue内の隣接fragmentを再統合すると元のraw本文範囲へまとめる。

複合字幕の原文訂正では対象spanを明示選択する。指定なしの全包絡範囲置換は拒否し、選んだ本文のみを新Source versionへ訂正する。後続cue・span・行番号をrebaseし、raw時刻・入力ID・元Source versionを保持する。訂正履歴とneeds-reviewは既存の経路を使う。

## 完全JSONと限定JSON

schemaVersion 1の旧単一`time`・cue台帳なしJSONはそのまま読み込み可能で、importだけで台帳やomissionsを捏造しない。旧字幕を利用者が明示統合するときだけ、変更していないraw字幕からcue台帳を回復する。引用本文と各時刻を失わず統合し、Undoで元の発言へ戻せる。

完全JSONの明示DTOへomissions、cue台帳、cueSpansを追加し、通常の検証・保存・別コピー復元へ通す。限定JSONは選択quoteだけから作る既存の別経路を維持し、Project全体の欠落申告、未選択cue台帳・本文・時刻を流出させない。限定JSONを完全な来歴復元とは呼ばない。

## 証拠と未完了の区別

追加した単体回帰とUI回帰は、保存、既存履歴ボタンのEnter操作によるUndo、完全JSONの別コピー復元まで確認する。新規UI試験の初稿は未提供のCtrl+Zを仮定して失敗したため、実装のショートカットを増やすのではなく既存のキーボード操作経路に訂正した。待機時間やassertionは緩めない。

最終コミットの全suite・監査・build・benchmark・production性能・CI結果は、その完全SHAに対応するPR本文とartifactを証拠とする。静的レビューは実行証拠ではない。OS共有キャッシュ、実機/GPU/heap、支援技術を含むアクセシビリティ、残る復旧経路、AI品質・キャンセル・失敗・再解析などの未達項目は別ゲートとして残し、`eligibleForG5=false`を維持する。

## 読込前入力と、未適用原文draftの追補

初版`a36385c`でも読込後の原文対応画面から欠落申告を入力でき、実UIで保存・Undo・JSON別コピーを確認済みだった。不足は読込前の入力・引渡しであり、「利用者が一切入力できなかった」とは扱わない。InputFormへ共通の複数申告フォームを追加し、`undefined`（未申告）、`[]`（明示的に項目なし）、複数報告を区別する。変更時にpreviewを無効化し、parse後に通常の`reviseCompleteness`で明示記録するため、Undoは読込時申告を未申告へ戻せる。Source別extentや入力外offsetは追加しない。

字幕原文draftの消失は実UIで再現した。発言を閉じて別の字幕を選び、戻ると未適用quoteが元へ戻る失敗は、`a36385c`上の対象InspectorだけでなくPR #4基準版`0c4b58f`でも発生した。PR #5で新規導入したとは主張しない。複合字幕ではcue切替時に別cueの理由も共有されていた。負例の[原ログ・report・試験ソース・SHA/hashメタデータ](../../artifacts/p1-provenance/draft-navigation-negative/metadata.json)を保持する。作業中treeでの負例をclean-final-SHAの受入証拠に数えない。

未適用の原文と理由はProject外のセッション内cacheで、Project・発言・Source・cue本文fragment・元本文の一致に結び付ける。別cueの訂正で位置やSource versionだけが変わっても、同じ本文の下書きは保持する。元本文が変われば新しい文脈になり、古い下書きを誤って適用しない。分類の理由と原文の理由を分け、適用成功後か「この本文の下書きを破棄」の明示操作だけで該当draftを消す。他の本文draftは消さない。

このcacheは新しい作業を開くと区切られ、端末保存・完全JSONの対象ではない。保存可能なProject適用済みの訂正と、フォーム内の未適用draftを混同しない。発言／cue往復、別cue適用後の保持、適用後Undo、明示破棄、端末保存に未適用draftが混入しないことをUI回帰で確認する。初回の追補検証ではAppの外部cache prop接続が未適用だったため発言間の1件が失敗し、既存の`key={selected.id}`を維持した正しい接続へ訂正した。assertionや待機時間は緩めていない。

`a36385c`のlocal unit218・機能E2E60 pass/1 skip・offline・監査/format/build/benchmarkと、同SHAの両CI・artifact digest一致は中間証拠として保持する。local本番9群はこの追補のため途中中断したので完了とは呼ばず、新しい最終SHAですべて再実行する。
