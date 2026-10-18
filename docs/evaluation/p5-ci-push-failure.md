# P5：成功したPR CIとは別に、push CIが失敗していた理由

**判定は、製品側のタイミング依存のフォーカス競合です。** CI環境の故障として片付けず修正します。同じSHAでPR runが成功していても、この不具合がないことの証明にはなりません。以前のPR本文と報告は、成功したPR runだけを示し、push runの失敗を区別していませんでした。

## 同じコードでも結果が分かれていた

対象の旧SHAは`417993abc687a3385c19ed7c14010a4bfc20b83a`です。両runとも、artifactの`verified-sha.txt`がこのSHAと一致します。

| run | 起動契機 | 結果 | 通常ブラウザ試験 |
| --- | --- | --- | --- |
| [39105084865](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39105084865) | push | **failure** | 75通過・1失敗・1 skip |
| [39105118727](https://github.com/chameleonjp-lab/rontenseiri/actions/runs/39105118727) | pull_request | success | 76通過・0失敗・1 skip |

通常設定でskipする1件はproduction専用のオフライン試験です。成功したPR runでは後続の専用設定も通過しましたが、失敗したpush runの後続工程まで通過したとは扱いません。原本のPlaywright集計上は両runとも`flaky: 0`です。これはrunnerが再試行をflakyとして記録していないという意味であり、今回の製品競合を否定しません。

## 止まったのは保存ではなく、その後の履歴操作

失敗は`e2e/source-draft-navigation.spec.ts:41`の試験で、113行目の「直前の訂正を元に戻す」ボタンを待つ間に、既存の30秒制限へ達しました。保存内容と下書き保持に関する前段のアサーションは通過しています。

traceでは、Escape終了から約2ms後に「訂正履歴」へのEnter操作を開始しています。履歴ボタンそのものは解決できていますが、その後も画面はキャンバスとU02の詳細のままで、Undoボタンが現れません。ブラウザのクラッシュやインストール失敗を示すものではありません。

`closeDetails`は、詳細を閉じた後の次フレームで元ノードにフォーカスを戻します。しかし利用者が既に別ボタンへフォーカスを移したかを確認していませんでした。履歴ボタンへ移動した直後に古い復帰処理が走ると、Enterが元ノード側へ渡り、履歴操作ではなく詳細の再表示になります。同じ無条件の非同期復帰は基点mainにもあり、P5の保存処理だけが新規に導入した不具合とは断定しません。

## 原因を固定して再現し、復帰処理を修正

追加した[`focus-recovery-race.spec.ts`](../../e2e/focus-recovery-race.spec.ts)では、閉鎖時のフレームを一つだけ保持し、履歴ボタンへフォーカスした後・Enterを押す前に実行します。待ち時間の追加で競合を隠すのではなく、失敗する実行順そのものを固定します。

旧SHAの製品コードと追加試験を組み合わせた変更前の実行では、履歴ボタンのフォーカス保持アサーションが失敗しました。再現ログと結果JSONも、以下の証跡に保全しています。この変更前試験は新規テストが未コミットの状態であり、旧SHAの既存CI runそのものとは区別します。

修正では、閉鎖時のフォーカスを記録し、復帰フレームが走る時点で別の要素へ移っていたら、古いフォーカス復帰を行いません。何も新しく操作していない場合の元ノードへの復帰は維持します。元の字幕下書き試験、Escape、Undo、所属変更、保存復旧の既存アサーションは変更しません。時間制限・容量・性能閾値、CIの手順も変更しません。

修正後のローカル重点確認では、新規1件と元の字幕下書き3件を各5回実行し、20件すべて通過、失敗0・flaky 0でした。[結果JSON](evidence/p5-push-39105084865/focus-race-fixed-results.json)を保全しています。これは全CIの代用ではなく、新SHAに対する全検証は別に行います。

## 失敗の原本を残す

[保全manifest](evidence/p5-push-39105084865/manifest.json)には、各ファイルのSHA-256とサイズを記録しています。ダウンロードした原本とバイト単位で照合しています。

- [失敗ステップのログ](evidence/p5-push-39105084865/failed-step.txt)、[run metadata](evidence/p5-push-39105084865/run.json)、[ブラウザ結果JSON](evidence/p5-push-39105084865/e2e-results.json)、[検証SHA](evidence/p5-push-39105084865/verified-sha.txt)
- [失敗画面](evidence/p5-push-39105084865/test-failed-1.png)、[画面のテキスト](evidence/p5-push-39105084865/error-context.md)、[Playwright trace](evidence/p5-push-39105084865/trace.zip)
- [決定的再現の変更前ログ](evidence/p5-push-39105084865/focus-race-baseline.txt)、[その結果JSON](evidence/p5-push-39105084865/focus-race-baseline-results.json)

元runの再実行で失敗を上書きせず、新しい通常pushで新SHAのpush runとPR runを作ります。再検証のSHAと両runの確定結果は[PR #7](https://github.com/chameleonjp-lab/rontenseiri/pull/7)本文で、上の旧runと別に記録します。実機・支援技術・AI品質・OSなどの未計測項目は残り、**G5は引き続き未完了**です。
