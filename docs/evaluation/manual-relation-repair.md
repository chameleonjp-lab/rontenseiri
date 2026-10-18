# P3：AIに依存しない応答・根拠の手動修復（限定ソフトウェア検証）

この変更はP3全体の完了ではない。既存の応答関係を、人が原文と照合して修正・解除し、Undoで戻せる範囲だけを扱う。AIを呼ばず、会話本文を外部送信せず、AIへのフォールバックも追加しない。

## mainで既にできたこと／足りなかったこと

編集前にGitHubのmainと新規cloneのHEADが、いずれも `2861c8e61fd885cdd9d8b2c90a4fc38c2400ee63` であることを確認した。このmainから `feat/p3-manual-relation-repair` を作成した。PR #7のコードは取り込んでいない。

| 観点 | mainの実装 | この変更で補ったこと |
|---|---|---|
| 問い版と応答 | `ReasoningPanel` は全版を明示選択でき、`linkResponse` は版IDをそのまま保持する | 修正時にも現行版へ移し替えず、保存済みの版を読み込む |
| 種別と充足 | 独立した欄・型・検証が既存 | 修正APIも独立したpatchを受け取り、種別から充足を推定しない |
| 根拠・反論先 | ドメインは複数IDを保持できるがUI登録時は空配列固定 | 新規登録と既存修正で複数のEvidence／意味項目を明示選択・解除できる |
| 既存応答の修復 | 修正・解除APIもUIもない | `updateResponse` / `removeResponse`、理由付きフォームを追加 |
| ID検証 | `validateReasoning` が参照・重複を検証する | 同じ検証を修正後にも通す。不明な対象応答、空の応答発言、空の理由も拒否し、元Projectは不変 |
| 履歴・Undo | `commit` のbefore/afterスナップショットと共通Undoが既存 | 1修正・1解除につき1つのProject revision。理由と変更前後を保持し、既存の共通Undoを利用 |
| 依存要約 | 問い版変更の依存伝播が既存 | 修正前後の応答発言IDから既存の明示依存伝播を使用し、依存要約だけを要再確認にする。解除でも回答状態・要約本文を自動書き換えしない |
| JSON・IndexedDB | graphを含むfull JSON／保存／再読込、限定出力の除外契約が既存 | 非空の応答・根拠・履歴と配列順、旧版ID、解除中のactive状態、Undo復元を回帰テスト |
| フォーカス | `Checks` が親コンポーネント内定義で、選択変更時に再マウントする | 外へ分離しチェック後もfocusを保持。編集開始／解除／キャンセルは同一フォームの問い版欄へfocusを移す |
| モバイル保存 | 390pxでは保存ボタンの文字spanが非表示となり名前がなくなる | `src/App.tsx` の保存ボタンに `aria-label` だけ追加。保存処理は変更なし |

応答の発言選択は議題外の既存対象も隠れないよう全発言を順序通り表示する。Evidence／意味項目そのものの破壊的削除・編集は追加せず、応答からの関連だけを編集する。既存の新規問い／根拠／意味項目登録や`linkResponse`の履歴契約は維持する。

## 判断したトレードオフ

**データ整合性：** ID・actor・対象／登録時刻を修正patchに開放しない。利用者が明示した問い版・発言・根拠・反論先・種別・充足のみを変更する。配列の選択順を維持し、旧版を最新へ暗黙変更しない。

**説明責任：** 解除は「関係がなくなった」という記録に留める。「未回答」「反論なし」「未充足」への自動判定にしない。元の根拠と意味項目は残り、Undoで同じIDと順序へ戻る。監査の一次記録は既存の `Project.revisions` であり、共通Undoではそれを追記保持する。graph内の軽量イベント列は既存Undoのスナップショット復元契約に従う。

**操作性：** 各応答の修正ボタンから同じフォームへ移り、理由を入力して適用／解除する。適用成功時だけフォームをリセットする。キーボード試験はfixtureのインポートを準備操作とし、その後の通常UIはTab・Enter・Space・矢印・文字入力のみ。`locator.focus/click/fill/selectOption` による経路短縮はしない。

**プライバシー：** full JSONは既存どおり原文・graph・履歴を含む。限定JSONではgraphと全revisionを除外し、範囲外の要約・原文も出さない。修復理由・解除された応答ID・非公開マーカーが漏れないことを確認する。AI品質の代用にはしない。

## PR #7との境界

PR #7はopen/Draft・未マージ、確認したheadは `675c2a432168d56f0641069719e0b0f0baecc9fc`。P5のquota/abort救済、現在未保存版のr2退避、保存状態表示の再設計、draft guard、保存競合や保存エラーの追加処理をこの枝に持ち込まない。

ファイル単位では `src/App.tsx` が重なる。このPRの変更は保存ボタンの`aria-label`の1行だけ。PR #7は同じheader付近の保存状態表示とAppの状態遷移等を変更しているため、後日の統合時にラベルを保持すること。この枝では保存関数、`src/storage/projects.ts`、`src/export/project.ts`、Undo本体、JSONスキーマを一切変更しない。PR #7の`draft-guard`等は未導入であり、この新しい応答編集フォームの下書き保護との統合はPR #7マージ後の別判断になる。

## テストと再現

固定fixtureは `tests/fixtures/manual-repair.ts`。2つの問い、3発言、Q1の旧版／現行版、Q2の現行版、3つのEvidence、3つの意味項目、旧版を指す応答、無関係な応答、非空の登録履歴を持つ。関連要約はU02、無関係要約はU03を明示依存とする。

- `tests/manual-repair.test.ts`：複数関連先の追加・変更・全解除、種別と充足の独立変更、問い版／発言の明示変更、不正IDと重複の無変更拒否、before/after＋理由、1操作1Undo、無関係要約の完全一致、full JSON、限定出力。
- `e2e/manual-repair.spec.ts`：1440px／390pxの通常UIで原文検査→旧版の明示選択→種別・複数関連先修正→応答解除→共通Undo→保存→reload／保存Project再開。各チェック・編集開始・適用・解除・Undo・保存でfocusを検証。画面横スクロールと各フォームコントロールの横はみ出しがないことも検証。外部HTTP要求は遮断し、試行もゼロであることをassert。
- 同E2Eの別ケース：実ブラウザIndexedDB save/load→full JSON往復→解除状態をsave→ページreload→2回のUndo→再save/load。非空のgraph・履歴の内容、ID、配列順とactive状態を比較する。JSON importによるProject IDの別コピー化は既存仕様であり、graphと履歴IDは比較対象から除外しない。

```sh
npm ci
npm run check:format
npm test
npm run build
npm audit --audit-level=moderate
npx playwright install --with-deps chromium
npx playwright test e2e/manual-repair.spec.ts
npm run test:e2e -- --grep-invert '各100操作で観測する'
npm run test:offline
```

ローカルでシステムChromiumを使う場合は `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium` を設定する。速度閾値・既存assertion・CIの除外条件は変更しない。

正確に検証したhead SHAと実行結果はDraft PR本文に記録する。CIは既存workflowがcheckoutしたHEADを `artifacts/verified-sha.txt` に記録し、同じSHAのunit／browser／offline／性能等の結果を`browser-evidence` artifactに保存する。ローカル画面証跡は `artifacts/p3-manual-repair-1440.png` と `artifacts/p3-manual-repair-390.png`。commit前の実行は診断であり、最終headの合格根拠には数えない。

## 完了としないもの

P2、P3全体、G5全体、実機・実OSのマトリクス、支援技術による実測、実AIの日本語品質は未完・未検証のまま。390pxのheadless Chromiumは実スマートフォンでもスクリーンリーダー検証でもない。quota/abort/r2救済はPR #7マージ前には要求も合格主張もしない。このPRはDraftのままmain向けに提出し、自己マージ・rebase・force-pushはしない。
