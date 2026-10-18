# dev診断の遅延：分かったことと、まだ分からないこと

**元の失敗は失敗のままです。原因が環境だけだった、製品が直った、G5が完了した、とは結論していません。** 対象アプリは `5b0ac40129ded26a1cff844d7de5937c7f866b12`。後続コミットで追加したテストや文書の成功を、このSHAの失敗の取り消しに使いません。

## 元の100操作実験は再実行しない

selection p95 **249.9ms**、search **296.7ms** は不変の200msゲートを超過し、fold **185.0ms** のみゲート内でした。100件ずつのraw値、操作ログ、healthのSHA／development／dirty=false、実行ログ、失敗詳細を[同梱証拠](evidence/5b0ac40/manifest.json)へbyte単位で複製しました。`.raw`ファイルの内容は元のJSON／log／CPU profile／ハーネスそのものです。整形で書き換えず、manifestのSHA-256と単体テストで一致を検査します。

元実験は完走後の閾値assertで失敗しています。`complete=true`／`failure=null`は、ゲート合格を意味しません。同じSHAの本番preview 9群やGitHub CIが成功しても、元dev失敗の反証にはなりません。

## 計測値は製品のCPU時間だけではない

`e2e/performance.spec.ts`の`measure`は、ブラウザー内の開始mark、Playwright操作、可視性・Inspector選択・位置安定の確認、追加1 rAF、終了markまでの経過時間です。選択にはboundingBox取得とpointer操作、検索にはfillとEnter、各段階のブラウザーとの通信が入ります。

`settleNode`は最初の位置観測でstable=0となり、同一位置をあと3回観測して終了します。最低4回のrAF観測に、さらに1回のrAF待ちが続きます。したがってフレーム待ち・描画・操作通信を含む時間であり、純粋なReact処理時間やpaint完了時間とは同一ではありません。これらを除外して200ms判定をやり直す変更はしていません。

元実験ではtraceを無効にしており、当時のCPU profile・long task・rAF内訳は保存されていません。別SHAの古いprofileを原因証拠として代用しません。dev／本番／CIはwarmup、cache、操作順、ホスト条件も異なり、差をそのまま単一要因の効果とは解釈できません。

## 別プロトコルで8操作だけをprofileした

`diagnostic-cdp-short-v1`は各modeで選択4回・検索4回だけです。同じ500ノードfixture、同じアプリSHA、同じviewport・Chromium実行パスを使い、devと本番のサーバーを一つずつ逐次起動しました。元の100操作実験は呼び出していません。

[raw診断とCPU profile](evidence/5b0ac40/short-profile/)にはaction返却・安定待ち・追加frame・終了の時刻、CDP Script/Layout/Style/Task時間、rAF列、input時刻、long taskを残しました。devのCPUサンプルには`jsxDEV`／`createElement`が現れ、同じ短い診断の本番よりScriptDurationが多くなっています。安定待ちと追加フレームにも相当の時間がかかっており、「処理がすべて200msかかった」とは読めません。

ただし初回selection/searchにはCPU profilerの負荷があり、dev→本番の固定順、各mode8操作、ホストとOS cache非統制です。CDPカウンター取得とwall時間の窓も厳密には同じではなく、数値を足して因果分解はできません。**これは開発版の処理・観測待ちが交絡することの証拠であって、元の249.9／296.7msスパイクの原因特定や、新たなp95受入ではありません。**

## 次に残す判断

製品不具合は未確認なので、根拠のない性能修正は加えていません。元スパイクの単一原因は未特定です。必要な次の弁別は、短い新規診断でbuildだけを入れ替える交差順序比較、cache／warmup条件とホスト負荷の記録、React commit・描画の対応づけです。元失敗の再試行や遅い値の除外は行いません。

今回のソフトウェア受入補完は、折り畳み中のCSS／inert／ARIA状態と復帰先議題ID、モーダルが既存inert／ARIA値と起点フォーカスを保持することです。これらも実支援技術・全キーボード経路・実機・GPU／heap・AIの受入を代用しません。`diagnosticOnly=true`、`eligibleForG5=false`、`g5Passed=false`を維持します。
