# R15 種別だけの訂正で独立した追加応答を保持する

Draft #39のhead `9fd5e8931e6673ef9dd64ec7ddd40865646dc9c1`を計画上の基点として、別fixture・別テストを追加する。#39の実マージは前提にせず、CIやマージを待たない積み上げである。既存の一応答kind/fulfillment/retargetケースは変更しない。test/docs-onlyで製品コード・依存関係を変更せず、外部AIを利用しない。

## 二つの応答をIDで分離する

`e2e/r15-response-kind-independent-response.spec.ts`は対象`response-cost`と追加`response-venue`の二応答だけを含む。対象はAのU02、superseded旧問い版、kind=answer、fulfillment=fulfilled。追加応答は独立BのU03と別の問い/現行版だけに結び、kind=answer、fulfillment=not-fulfilled、異なるactor・時刻・noteを持つ。回答ありと要求充足は別記録であり、追加応答が他の応答の充足を変えるとは扱わない。

通常UIの理由付き編集で対象のkindだけをcounterargumentにする。期待値mapは厳密な対象IDにだけkindの変更を適用し、応答のID・順序・全フィールドを比較する。追加応答の完全一致をさらに直接確認する。対象のfulfilled、旧版、U02、来歴・noteも保持する。

## 迂回経路を持たない独立性

Aの所属はU01/U02、summaryDependenciesはU02だけ。Bの所属と依存はU03だけ。対象の旧版/現行版のsourceはU01だけ、独立問い版のsourceはU03だけとし、全問い・版・current ref・応答ID/参照を検証する。関係・根拠・意味項目・解釈・立場変更・排他群・不確実性伝播はすべて空を明示確認する。非空反論先や追加の枝は導入しない。

このため、対象の更新を誤って追加応答へ適用しても同じ結果になる迂回経路を作らない。正しい変更後はAだけが要再確認になり、Bと両まとめのanswer=presentは不変。追加応答を誤更新すれば全応答比較で検出し、U03の失効まで起こせばB不変比較でも検出する。

## 通常保存・再開・Undo

完全JSONの通常復元UI→初回明示保存→理由付きkind訂正→自動保存→native readonly IndexedDB→reload/最近の作業→UI・警告・完全JSON→通常UI Undo→自動保存→2回目reload/完全JSONを確認する。再開後/Undo後に厳密な応答IDの編集ボタンでカードを識別し、両応答の種別、要求充足、対象版と発言、追加応答の登録/対象時刻、両まとめの「回答あり」を直接観測する。noteはカードに表示されないため、保存値・完全JSON・履歴snapshotの全オブジェクト比較で確認する。

共有履歴before/afterの全graph・まとめ、理由、推論/共有イベントID参照と時刻、保存世代、Undo後の元graph・監査prefix・Undo targetを比較する。テスト全体30秒、poll10秒を維持する。プレビュー前にDB選択議題A/履歴件数と保存済み表示を待つ。fixture以外のdomain/storage書込みやstate注入は使わない。

## 残る境界

比較基準は通常復元後のbaselineであり、独立したインポート前比較や最終JSON再インポートは行わない。問い/版/応答作成UI、非空反論先・根拠、複雑/混合依存、既存履歴・多段Undo・Undo payload全体、保存失敗/競合、意味品質、性能、実機は未検証。R08/R15/G5/G0–G8の全受入とは扱わない。先行ケースおよび今回の失敗証拠は保持し、ローカル成功からCI・artifact内部・独立レビュー・実マージを推定しない。
