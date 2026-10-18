# R15: 同一sourceの訂正とoffset再base

## テスト範囲

`tests/revise-source-offsets.test.ts` は、parser と `createProject` で作った同一 `txt` source の U01/U02 を対象にする。U01 の訂正について、文字数の**増加**と**減少**を `test.each` の2ケースで検証する。

- U02 の引用文字列が維持され、訂正差分（delta）だけ `start`/`end` が移動する
- U01/U02 が同じ新しい `sourceVersionId` に再baseされる
- 実 source の `text.slice(start, end)` が各引用と一致する
- source coverage の audit が `complete` になる（範囲の構造整合・網羅であり、意味反映や整理完了ではない）
- 通常の Undo で、U01/U02 の旧 source version、offset、quote が復元される

fixture の source ID、source version、offset は手動生成しない。発言間の改行は parser が coverage の metadata として扱う。

## 未受入・対象外

- coverage Undo の仕様に合わせ、source history 全体（訂正版sourceの追加・履歴を含む）の完全一致は要求しない。Undo 後の旧版参照・引用・原文位置だけを検査し、意味品質の評価とはしない。
- 保存競合、同時編集、AI の提案・適用フローはこのテストの対象外である。
- 製品コードの source 変更は行わない。

## 実行結果の扱い

ローカルの targeted Vitest 結果と、公開された commit SHA の検証結果は別物として記録する。公開 head には通常 CI を新規実行し、run ID、artifact 内 SHA と digest の照合を別途記録する。この局所テストの成功で R15/G5、G0–G8 や過去の R20/G5 性能失敗を受入れ済みとはしない。
