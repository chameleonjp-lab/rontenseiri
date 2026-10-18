# RTK Safe Execution 試験導入（rontenseiri）

## 目的と範囲

既存のテストを短縮・削除するのではなく、**AIが読むコマンド出力だけ**を短くします。実行したコマンドの完全な標準出力・標準エラーと元の終了コードは別に保持します。

このPRはSkillと作業指示を導入するだけです。アプリ、`package.json`、既存の`.github/workflows/ci.yml`、テスト定義、監査処理、測定基準、公開判定は変更しません。

配布元：`chameleonjp-lab/skill--Safe-Execution`、固定した参照コミット `ddd0b3c4ae5f91f670ff41341ba84e9e93133a79`（PR #2、取り込み時点ではDraft）。Skill更新時はこのリポジトリに差分PRを作成し、変更内容を確認します。

## 第1段階：限定して使用する

**既存の作業で必要になったときだけ**、同じコマンドを1回実行します。RTKがない場合、勝手にインストールしません。RTKなしでも完全ログは保存できます。

```bash
SKILL_DIR=.agents/skills/rtk-safe-execution
python3 -m unittest discover -s "$SKILL_DIR/tests" -v
python3 "$SKILL_DIR/scripts/run.py" --kind test --label vitest -- npm test
python3 "$SKILL_DIR/scripts/run.py" --kind list --label tracked-tests -- git ls-files tests e2e
```

最初の動作確認では、通常の`npm test`と成功・失敗の判定が一致すること、元の`raw.log`が完全であること、`metadata.json`の終了コードとSHA-256が正しいこと、RTK有無が明示されることを確認します。**比較のためにテストを重複して実行する場合は、明示的に計測するときだけ**に限定してください。

```bash
python3 "$SKILL_DIR/scripts/verify.py" /保存済みの実行ディレクトリ/metadata.json
```

`--kind test`では、RTKの一般ログ要約がVitest/Playwrightの件数を省いたときに備え、完全ログの末尾24行・最大4,000文字を参考表示します。これだけでは異常の原因を判断できません。失敗・疑義がある場合は元ログ全体から該当箇所を確認します。

## 第2段階：効果を確かめる

1. 正式テスト結果と終了コードが一致するか確認する。
2. 表示文字数を実測して短縮効果を記録する（費用の削減率とは区別する）。
3. 異常時に元ログだけで原因調査できることを確認する。
4. ここまで成功したら、必要に応じて通常のブラウザテスト（`npm run test:e2e`）にも適用範囲を拡張する。**性能測定や監査には適用しない**。

## 証拠・機密・ロールバック

既存CIでは`npm test -- --reporter=default --reporter=json --outputFile=artifacts/unit-results.json`、`npm audit`、Playwrightブラウザ検査、性能計測、`actions/upload-artifact`が動いています。この正式な証拠とゲートは変えません。

補助ログはデフォルトでGit作業ツリー外（`~/.local/state/rtk-safe-execution`等）に保存します。クラウドの作業終了後も残るとは限りません。GitHubへ生ログを自動的にアップロードしないでください。公開前に個人情報や機密の有無を確認してください。

問題が発生したら、`run.py`を使わず従来の`npm test`に戻すだけで、既存CIや品質基準はそのままです。RTK自動フックの導入、環境セットアップの変更、他リポジトリへの展開は別途検討します。

## 現時点の検証限界

- 共通Skillの単体テストは模擬RTKで確認されています。
- RTK本体による削減量の実測、Codex CloudでのRTK稼働、iPhone実機での開発操作は**このPRでは検証していません**。
- 上記未確認事項を合格と扱わず、GitHub Actionsのアプリ検証と区別して報告します。
