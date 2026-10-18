# R15 原文依存状態の回帰確認

## 今回確認すること

この変更は既存実装に対する **1 本の Playwright 回帰テスト**であり、製品コードの変更でも R15/G5 の受入れ判定でもない。原文訂正後に明示された 2-hop の到達先を要再確認にする経路を、通常 UI と完全 JSON で確認する。関係配列は上流順のため、固定点の反復が必要な順序を検査した証拠ではない。

fixture は製品の parser と `createProject` で作り、通常の JSON 復元 UI から別コピーとして読み込む。有効な原文範囲と parser 由来の source ID を使い、引用不一致や未割当発言を製品側で黙認する変更は加えない。

- Root R は `U01` と `U02`、Agenda A は `U03` のみ、Agenda B は無関係な `U04` のみを持つ。
- `U01` は SA、`U02/U03` は別ソース SX、`U04` は SB に属する。
- 明示依存は `U01 → U02 → U03` の 2-hop。A の要約根拠は `summaryDependencies: ["U03"]` のみで、A は U01/U02 を直接含まない。
- U01 の「この案は採用する。」を、Inspector の「発言・原文」タブで「この案は採用しない。」へ訂正し、変更理由を記録する。意味判断や原文の正しさを AI が判定するものではない。

## UI と出力で検査する状態

1. B の分類だけを `main` から `derived` へ訂正する。B 自身は要再確認となり、R/A は false のままである。通常の「訂正履歴 → 直前の訂正を元に戻す」で B を戻す。これは非依存の**分類訂正**の負の対照であり、非依存の原文訂正の試験ではない。
2. U01 を通常 Inspector で訂正する。「議題の流れ」で R/A の「訂正の影響：要再確認」を確認し、B には表示されないことを確認する。
3. U03 の原文 Inspector を開く。さらに実際の「発言と原文」画面で R/A/B を切り替え、訂正済み U01 と、不変の U02/U03/U04 の引用を確認する。図に残る非表示要素を原文画面の証拠にしない。
4. 実際の「振り返り」で A、R、B を順に選択する。A/R の警告と到達点、B の到達点と警告の不在を、それぞれ振り返りの表示領域で確認する。
5. 「出力 → 出力内容をプレビュー」で完全 JSON を取得する。`scope: full` と manifest の `limited: false`、`fullBackup: true`、`historyIncluded: true`、`schemaVersion: 1` を検査する。
6. 訂正前後で SA の version ID が異なり、旧版に旧引用、新版に新引用が残ることを確認する。SX の U02/U03 は引用・版とも不変で、無関係な B は発言・議題を深い比較で保持する。この訂正直後の関係検査は 2 個の relation ID の保持のみであり、全フィールド同一性ではない。訂正理由も確認する。
7. 原文訂正を通常の履歴スタック Undo で戻し、U01 の旧引用・旧版参照、全発言・議題・関係が訂正直前の意味状態へ戻ることを確認する。古い訂正を選択的に戻す操作ではない。

`r15-before.json` は **UI 復元前の fixture を `exportProject` から直接出力した envelope** であり、UI 復元後の出力ではない。`r15-after-B.json`、`r15-after-undo-B.json`、`r15-after-A.json`、`r15-after-undo-A.json` は、各操作後に実際の UI の出力プレビューから取得した完全 JSON envelope を構造化添付する。

関連実装は [依存失効](../../src/domain/invalidation.ts)、[原文訂正](../../src/domain/project.ts)、[通常 Undo 実装（226–250 行）](../../src/domain/revisions.ts#L226-L250)、[回帰テスト](../../e2e/r15-source-dependency-state.spec.ts) を参照。

## 実行履歴を混同しない

2026-10-19 JST の未コミット開発試行では、v1 は U02 の引用不一致、v2 は当時の U10 の引用不一致、v3 は会話発言の未割当で失敗した。v4 は B 分類訂正後の B 自身まで false とした誤った期待値、v5 は議題ボタンの番号を含む accessible name の不一致、v6 は非表示の図と振り返りの同名到達点を区別しなかった strict selector で失敗した。これらは fixture／検査側の失敗として残し、製品不具合の再現や成功へ読み替えない。

修正後の v7 は通常 UI の focused test 1/1 が成功した。これは **未コミット作業ツリーの局所結果**であり、公開 head の全検証ではない。v1–v7 の各ログ・結果 JSON・browser 出力は実行ごとに固有名で保存した。公開 SHA に対する CI と artifact の検査結果は PR 本文に別記し、この開発結果を新 SHA の証拠へ流用しない。

## 未確認・未受入

この試験は一時作業の復元 UI と JSON プレビューを使う。IndexedDB 保存、reload/restore の永続性、遅延保存応答、manual/autosave の組合せ、所有権 lease、Worker、モデル品質の証拠ではない。別の保存競合スライスの成功も、この意味依存試験の成功とは区別する。

単一の 2-hop と単一の無関係議題だけを扱う。関係の配列は `U01→U02`、`U02→U03` の上流順で、単一 pass でも到達する。反復固定点の必要性を検出する逆順の試験はない。A の所属と `summaryDependencies` はともに U03 なので、所属とは別の summary-only 経路の回帰検出でもない。循環・分岐、複数の要約根拠、非依存関係、同一ソース内の訂正前後の offset 再計算、coverage 競合などは未確認。発言単位の authoritative な `needsReview` を新設・検証したとは主張しない。

B の分類 Undo は、U04 の分類、A/B の flag、source の ID/version/name/text、および関係を比較する部分検査であり、全発言・全議題の deep-equal ではない。原文訂正の Undo は全発言・議題・関係を deep-equal するが、Undo 後の 4 面の再巡回と、訂正済み JSON の再インポートは未検証である。

Undo 後も監査履歴や新しい原文版が残り得るため、全プロジェクト JSON、source catalog、coverage、保存 revision が過去と同一とは主張しない。原文訂正が否定の意味を正しく解釈できるという意味品質評価でもない。

R15/G5 全体、G0–G8、R20/G5 の性能受入れは未達のまま。過去の 500-node selection/search/fold の 200ms 超過を、この小さい fixture の成功で解消した扱いにしない。

## 静的レビューの来歴

Kamekame の静的レビュー対象は旧公開 head `669dcd3dd9f335eb6d82e37666488846504de168`。製品不具合や test false positive の確定所見はなく、reviewer はテスト・CI・build を実行していない。上記の添付 provenance、Undo リンクと残余範囲の明示は、このレビューに基づく文書修正である。旧 SHA の所見・実行結果を新 head の検証済み証拠とは扱わない。
