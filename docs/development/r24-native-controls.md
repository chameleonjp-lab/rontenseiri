# R24：ネイティブ制御受入れコントロール

## 目的

`e2e/ownership-native-controls.spec.ts` は、実ブラウザの `navigator.locks.request` を使い、所有権ラッパーの境界条件を受入れレベルで確認するテスト専用スライスである。プロダクトコードは変更していない。

確認する制御は次のとおり。

- ネイティブ側のgrant後、ラッパーへのcallback配送を制御して呼出側取消または取得タイムアウトを先に確定する競合。
- grant後の呼出側abortがleaseのsignalだけをabortし、`release()`／`finally` までネイティブロックを保持すること。
- `ifAvailable: true` で意図的に `null` lock を得る非通常経路のcleanup。通常のblocking requestがnullを返すとは扱わない。
- プロダクト所有のcaller `abort` listenerが、同一listener identityでrelease後に0件になること。
- 取得timerとlease timerがrelease後に残らないこと（ブラウザtimer APIをテスト中だけ計測）。

## controlled delivery の範囲

競合を決定的にするため、テスト内の薄い `controlledLocks` manager は、実 `navigator.locks.request` を呼び出した後、callbackを一時的なPromise gateの後に配送する。このmanagerはテスト専用の配送制御であり、native Web Locksのgrant・held・pending状態を置き換えない。JSON evidenceには `controlledDelivery: true` を明記する。

従って、grant-vs-caller-cancelおよびgrant-vs-timeoutのテストは「native callbackへ到達した後、プロダクトcallbackへ届く前に競合を確定した」ことを示す。これは全てのOS／ブラウザ内部スケジューリング順序を証明するものではない。timeout競合は20msという設定値を変えず、取得timer callbackだけを捕捉してnative grant到達後に明示配送する。wall-clockで20ms経過した順序の証明ではなく、controlled acquisition-timeout deliveryとしてattachmentにも明記する。

## 観測と限界

`navigator.locks.query()` の `held`／`pending`、公開lease signal、取得結果、listener identity集合、timer集合だけをassertする。fixture lockのabort rejectや単独のcounterからnative queue除去を推論しない。

Web Locks実装内部のC++ signal algorithmや、JSから見えないnative内部listenerの物理的な登録・解除はspyできない。このテストのlistener assertionは、post-grant caller abort→lease abort→native held維持→releaseという同一ケースで、プロダクトがcaller signalへ追加・削除したJS listenerのidentityだけであり、native内部listenerの証明ではない。

`ifAvailable: true` のnull-lockテストはnull callbackのcleanupを確認するための明示的な補助経路であり、通常のblocking ownership callの挙動を代表しない。

G5（実機・本番SW・クラッシュ・複数タブ負荷を含む完全なnative内部制御保証）は、このテストスライスでは完了しない。JS公開APIからnative内部signal algorithmを直接検査できないため、G5の物理的listener証明は明示的にブロッカーとして残す。

## 実行と証拠

指定されたChromium実行では、`PLAYWRIGHT_REPORT_PATH` と `outputDir` を新規の証拠ディレクトリへ向ける。各テストは次のJSON attachmentを生成する。

- `grant-vs-caller-cancel.json`
- `grant-vs-timeout.json`
- `post-grant-caller-abort.json`
- `null-lock-cleanup.json`
- `caller-listener-timer-cleanup.json`

既存のownership 9ケースと本ファイルを同一Chromium実行で確認する。先行失敗を後続成功に読み替えず、raw log・report・attachmentの実パスを親へ報告する。timeoutやassertionを緩和せず、CI設定も変更しない。
