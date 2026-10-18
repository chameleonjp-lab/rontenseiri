# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: source-draft-navigation.spec.ts >> 未適用の字幕原文と理由は別の発言を選んで戻っても保持され、Projectへ勝手に適用されない
- Location: e2e/source-draft-navigation.spec.ts:41:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.press: Test timeout of 30000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: '直前の訂正を元に戻す', exact: true })

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - button "論点整理." [ref=e5] [cursor=pointer]
    - generic [ref=e11]:
      - generic [ref=e14]: 字幕原文draft
      - generic [ref=e15]: 設計検証版
    - generic [ref=e16]:
      - generic [ref=e17]:
        - generic [ref=e18]: 現在版は保存済み
        - generic [ref=e19]: 最後の保存：6:46:58
      - button "この端末に保存" [ref=e20] [cursor=pointer]
      - button "出力" [ref=e26] [cursor=pointer]
  - generic [ref=e30]:
    - navigation "作業画面" [ref=e31]:
      - generic [ref=e32]: WORKSPACE
      - button "議題の流れ" [ref=e33] [cursor=pointer]
      - button "発言と原文" [ref=e39] [cursor=pointer]
      - button "振り返り" [ref=e44] [cursor=pointer]
      - button "問い・根拠" [ref=e51] [cursor=pointer]
      - button "原文対応" [ref=e55] [cursor=pointer]
      - button "端末・保存" [ref=e60] [cursor=pointer]
      - button "訂正履歴" [ref=e65] [cursor=pointer]
      - generic [ref=e71]:
        - generic [ref=e72]: 議題ブロック
        - button "01 字幕原文draft" [ref=e73] [cursor=pointer]:
          - generic [ref=e74]: "01"
          - generic [ref=e75]: 字幕原文draft
      - generic [ref=e76]:
        - button "端末内AIの評価" [ref=e77] [cursor=pointer]
        - button "使い方・制約" [ref=e81] [cursor=pointer]
        - generic [ref=e84]: この端末で作業一時作業は閉じると失われます
    - main [ref=e89]:
      - generic [ref=e90]: 設計検証版 · 日本語AI品質・対応端末・実機アクセシビリティは未検証です。公開版ではありません。
      - region "議題キャンバス" [ref=e93]:
        - generic [ref=e94]:
          - generic [ref=e95]:
            - heading "議題の流れ" [level=1] [ref=e96]
            - paragraph [ref=e97]: 時間は右へ。派生・ずれは下へ広がる。
          - generic [ref=e98]:
            - button "発言を検索" [ref=e99] [cursor=pointer]
            - generic [ref=e103]:
              - button "縮小" [ref=e104] [cursor=pointer]
              - generic "表示倍率" [ref=e106]: 80%
              - button "拡大" [ref=e107] [cursor=pointer]
            - button "全体表示" [ref=e109] [cursor=pointer]
            - button "選択ノードへ戻る" [ref=e116] [cursor=pointer]:
              - generic [ref=e120]: 選択ノードへ
            - button "枝を折りたたむ" [ref=e121] [cursor=pointer]
        - generic [ref=e125]:
          - generic [ref=e126]: クリック・タップ：詳細
          - generic [ref=e127]: 空白ドラッグ：表示位置を移動
          - generic [ref=e128]: ピンチ・＋／−：拡大縮小
          - group [ref=e129]:
            - generic "キーボード操作" [ref=e130] [cursor=pointer]
        - generic "キャンバス。矢印キーで表示位置を移動。プラス・マイナスで拡大縮小" [ref=e131]:
          - application "議題の発言関係図" [ref=e132]:
            - generic [ref=e134]:
              - generic:
                - generic:
                  - generic:
                    - generic:
                      - button "議題01 字幕原文draft 議題を選択" [ref=e135] [cursor=pointer]:
                        - generic [ref=e136]: 議題01
                        - strong [ref=e137]: 字幕原文draft
                        - generic [ref=e138]: 未決
                      - generic:
                        - generic: 2発言 · 境界は候補・変更できます
                        - generic: 発言順 →
                      - generic: 訂正の影響：要再確認
                  - button "U01 資料1：話者不明 最初の未適用draft😀 詳細を開く" [ref=e139] [cursor=pointer]:
                    - generic [ref=e140]:
                      - generic [ref=e141]: U01
                      - generic [ref=e142]: 資料1：話者不明
                    - generic [ref=e143]: 最初の未適用draft😀
                    - generic [ref=e144]:
                      - generic [ref=e145]: 未整理
                      - generic [ref=e146]: 原文 ↗
                    - generic [ref=e147]: 00:00:01.000 --> 00:00:02.000
                  - button "U02 資料1：話者不明 次の字幕 詳細を開く" [ref=e148] [cursor=pointer]:
                    - generic [ref=e149]:
                      - generic [ref=e150]: U02
                      - generic [ref=e151]: 資料1：話者不明
                    - generic [ref=e152]: 次の字幕
                    - generic [ref=e153]:
                      - generic [ref=e154]: 未整理
                      - generic [ref=e155]: 原文 ↗
                    - generic [ref=e156]: 00:00:02.000 --> 00:00:03.000
            - img "全体のミニマップ。ドラッグで表示位置を移動" [ref=e158]
          - generic: 空白を掴んで自由に移動
          - generic "ボタンでキャンバスを移動" [ref=e163]:
            - button "表示位置を左へ" [ref=e164] [cursor=pointer]
            - button "表示位置を上へ" [ref=e167] [cursor=pointer]
            - button "表示位置を下へ" [ref=e170] [cursor=pointer]
            - button "表示位置を右へ" [ref=e173] [cursor=pointer]
        - generic [ref=e176]:
          - generic [ref=e177]:
            - generic [ref=e178]: ━━ 本筋
            - generic [ref=e179]: ━ 派生
            - generic [ref=e180]: ┄ ずれ候補
            - generic [ref=e181]: ↗ 復帰
          - generic [ref=e182]: 枝の深さは、ずれの大きさを示しません
    - complementary "選択した発言の詳細" [ref=e183]:
      - generic [ref=e184]:
        - generic [ref=e185]: 選択中：議題01 → U02
        - button "詳細を閉じる" [active] [ref=e186] [cursor=pointer]
      - generic [ref=e190]:
        - generic [ref=e191]:
          - generic [ref=e192]: 原文 · U02
          - strong [ref=e193]: 資料1：話者不明
          - blockquote [ref=e194]: 次の字幕
          - generic [ref=e195]: draft.vtt · 7行 · source-b1359feb-1bb7-4f2f-b001-a05834cdf460-v-mvdgq6oh-dm5m55 · 00:00:02.000 --> 00:00:03.000
          - button "発言一覧で見る" [ref=e196] [cursor=pointer]
        - generic [ref=e199]:
          - text: 所属する議題
          - strong [ref=e200]: 議題01｜字幕原文draft
          - generic [ref=e201]:
            - generic [ref=e202]: 分類の来歴
            - generic [ref=e203]: 未整理・AI未実行
          - generic [ref=e204]:
            - generic [ref=e205]: 決定状況
            - generic [ref=e206]: 未決
          - generic [ref=e207]:
            - generic [ref=e208]: 外部確認
            - generic [ref=e209]: 未確認
          - paragraph [ref=e210]: 訂正の影響：振り返りは要再確認
        - group [ref=e211]:
          - generic "字幕cueの出典対応" [ref=e212]
        - generic [ref=e213]:
          - heading "議題内の発言を訂正" [level=3] [ref=e214]
          - generic [ref=e215]:
            - button "分類・関係" [ref=e216] [cursor=pointer]
            - button "発言・原文" [pressed] [ref=e217] [cursor=pointer]
          - generic [ref=e218]:
            - text: 訂正後の原文
            - generic [ref=e219]: 未適用の原文と理由は、この作業を開いている間、発言・字幕本文ごとに保持します。適用前の下書きは端末保存・JSONに含みません。
            - textbox "訂正後の原文" [ref=e220]: 次の未適用draft
          - button "この本文の下書きを破棄" [ref=e221] [cursor=pointer]
          - paragraph [ref=e222]: 原文は新しい版として追加し、旧版・変更前後・理由を残します。本文を別の発言へ分割する操作とは異なります。
          - button "入力中の原文をテキストで退避" [ref=e223] [cursor=pointer]
          - generic [ref=e224]:
            - text: 変更理由
            - textbox "変更理由" [ref=e225]:
              - /placeholder: なぜ訂正するかを記録
              - text: 第2draftの理由
          - button "訂正を保存" [ref=e226] [cursor=pointer]
          - paragraph [ref=e229]: 分類だけの変更では原文・発言順・議題所属・他の発言を変えません。影響するまとめだけ要再確認にします。
        - group [ref=e230]:
          - generic "議題の所属・境界を別に変更" [ref=e231] [cursor=pointer]
        - group [ref=e232]:
          - generic "発言本文の区切りを編集" [ref=e233] [cursor=pointer]
        - group [ref=e234]:
          - generic "意味上の依存関係を指定" [ref=e235] [cursor=pointer]
        - generic [ref=e236]:
          - button "選択した発言の図へ戻る" [ref=e237] [cursor=pointer]
          - button "この議題の振り返りへ" [ref=e238] [cursor=pointer]
        - paragraph [ref=e241]: 原文・AI推定・利用者の訂正を分けて保存します。
  - status [ref=e242]:
    - generic [ref=e245]: このブラウザに保存しました。復旧用JSONも保管してください。
    - button "通知を閉じる" [ref=e246] [cursor=pointer]
```

# Test source

```ts
  13  |         role: "conversation",
  14  |         text: "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n最初の字幕\n\n00:00:02.000 --> 00:00:03.000\n次の字幕\n",
  15  |       },
  16  |     ]),
  17  |     "字幕原文draft",
  18  |     "unknown",
  19  |   );
  20  |   if (merged) p = mergeUtterances(p, ["U01", "U02"], "同じ話者と利用者が確認");
  21  |   await page.goto("/");
  22  |   await page.locator("input[type=file]").setInputFiles({
  23  |     name: "draft.rontenseiri.json",
  24  |     mimeType: "application/json",
  25  |     buffer: Buffer.from(exportProject(p, "json", undefined, false)),
  26  |   });
  27  |   await expect(
  28  |     page.getByRole("status").filter({ hasText: "別コピーとして復元" }),
  29  |   ).toBeVisible();
  30  |   return p;
  31  | }
  32  | async function source(page: Page, id: string) {
  33  |   const hit = page.locator(`[data-id="${id}"] .speech-hit`);
  34  |   await hit.focus();
  35  |   await hit.press("Enter");
  36  |   const panel = page.getByRole("complementary", { name: "選択した発言の詳細" });
  37  |   await panel.getByRole("button", { name: "発言・原文", exact: true }).click();
  38  |   return panel;
  39  | }
  40  | 
  41  | test("未適用の字幕原文と理由は別の発言を選んで戻っても保持され、Projectへ勝手に適用されない", async ({
  42  |   page,
  43  | }) => {
  44  |   const p = await open(page);
  45  |   let panel = await source(page, "U01");
  46  |   await panel
  47  |     .getByLabel("訂正後の原文", { exact: true })
  48  |     .fill("最初の未適用draft😀");
  49  |   await panel.getByLabel("変更理由", { exact: true }).fill("第1draftの理由");
  50  |   await page.keyboard.press("Escape");
  51  |   panel = await source(page, "U02");
  52  |   await expect(panel.getByLabel("訂正後の原文", { exact: true })).toHaveValue(
  53  |     "次の字幕",
  54  |   );
  55  |   await panel
  56  |     .getByLabel("訂正後の原文", { exact: true })
  57  |     .fill("次の未適用draft");
  58  |   await panel.getByLabel("変更理由", { exact: true }).fill("第2draftの理由");
  59  |   await page.keyboard.press("Escape");
  60  |   panel = await source(page, "U01");
  61  |   await expect(panel.getByLabel("訂正後の原文", { exact: true })).toHaveValue(
  62  |     "最初の未適用draft😀",
  63  |   );
  64  |   await expect(panel.getByLabel("変更理由", { exact: true })).toHaveValue(
  65  |     "第1draftの理由",
  66  |   );
  67  |   await panel
  68  |     .getByRole("button", { name: "訂正を保存", exact: true })
  69  |     .press("Enter");
  70  |   await page.keyboard.press("Escape");
  71  |   panel = await source(page, "U02");
  72  |   await expect(panel.getByLabel("訂正後の原文", { exact: true })).toHaveValue(
  73  |     "次の未適用draft",
  74  |   );
  75  |   await expect(panel.getByLabel("変更理由", { exact: true })).toHaveValue(
  76  |     "第2draftの理由",
  77  |   );
  78  |   await page
  79  |     .getByRole("button", { name: "この端末に保存", exact: true })
  80  |     .press("Enter");
  81  |   await expect(
  82  |     page.getByRole("status").filter({ hasText: "このブラウザに保存しました" }),
  83  |   ).toBeVisible();
  84  |   const stored = await page.evaluate(async () => {
  85  |     const db = await new Promise<IDBDatabase>((resolve, reject) => {
  86  |       const r = indexedDB.open("rontenseiri-projects-v1", 1);
  87  |       r.onsuccess = () => resolve(r.result);
  88  |       r.onerror = () => reject(r.error);
  89  |     });
  90  |     try {
  91  |       return await new Promise<unknown[]>((resolve, reject) => {
  92  |         const tx = db.transaction("projects", "readonly");
  93  |         const r = tx.objectStore("projects").getAll();
  94  |         tx.oncomplete = () => resolve(r.result);
  95  |         tx.onerror = () => reject(tx.error);
  96  |       });
  97  |     } finally {
  98  |       db.close();
  99  |     }
  100 |   });
  101 |   expect(JSON.stringify(stored)).toContain("最初の未適用draft😀");
  102 |   expect(JSON.stringify(stored)).not.toContain("次の未適用draft");
  103 |   expect(JSON.stringify(stored)).not.toContain("第2draftの理由");
  104 |   await expect(panel.getByLabel("訂正後の原文", { exact: true })).toHaveValue(
  105 |     "次の未適用draft",
  106 |   );
  107 |   await page.keyboard.press("Escape");
  108 |   await page
  109 |     .getByRole("button", { name: "訂正履歴", exact: true })
  110 |     .press("Enter");
  111 |   await page
  112 |     .getByRole("button", { name: "直前の訂正を元に戻す", exact: true })
> 113 |     .press("Enter");
      |      ^ Error: locator.press: Test timeout of 30000ms exceeded.
  114 |   await page
  115 |     .getByRole("button", { name: "議題の流れ", exact: true })
  116 |     .press("Enter");
  117 |   panel = await source(page, "U01");
  118 |   await expect(panel.getByLabel("訂正後の原文", { exact: true })).toHaveValue(
  119 |     p.utterances[0].quote,
  120 |   );
  121 |   await expect(panel.getByLabel("変更理由", { exact: true })).toHaveValue("");
  122 | });
  123 | 
  124 | test("複合字幕の各本文draftを独立保持し、明示適用したcueだけを訂正する", async ({
  125 |   page,
  126 | }) => {
  127 |   const p = await open(page, true);
  128 |   const panel = await source(page, p.utterances[0].id);
  129 |   const choice = panel.getByLabel("訂正する字幕本文", { exact: true });
  130 |   await panel.getByLabel("訂正後の原文", { exact: true }).fill("第1cueのdraft");
  131 |   await panel.getByLabel("変更理由", { exact: true }).fill("第1cue理由");
  132 |   await choice.selectOption("1");
  133 |   await expect(panel.getByLabel("訂正後の原文", { exact: true })).toHaveValue(
  134 |     "次の字幕",
  135 |   );
  136 |   await expect(panel.getByLabel("変更理由", { exact: true })).toHaveValue("");
  137 |   await panel.getByLabel("訂正後の原文", { exact: true }).fill("第2cueのdraft");
  138 |   await panel.getByLabel("変更理由", { exact: true }).fill("第2cue理由");
  139 |   await choice.selectOption("0");
  140 |   await expect(panel.getByLabel("訂正後の原文", { exact: true })).toHaveValue(
  141 |     "第1cueのdraft",
  142 |   );
  143 |   await expect(panel.getByLabel("変更理由", { exact: true })).toHaveValue(
  144 |     "第1cue理由",
  145 |   );
  146 |   await panel
  147 |     .getByRole("button", { name: "訂正を保存", exact: true })
  148 |     .press("Enter");
  149 |   await expect(panel.getByLabel("訂正後の原文", { exact: true })).toHaveValue(
  150 |     "第1cueのdraft",
  151 |   );
  152 |   await expect(panel.getByLabel("変更理由", { exact: true })).toHaveValue("");
  153 |   await choice.selectOption("1");
  154 |   // New source version after the first cue apply must retain the other cue's
  155 |   // draft only if its exact cue body context still matches.
  156 |   await expect(panel.getByLabel("訂正後の原文", { exact: true })).toHaveValue(
  157 |     "第2cueのdraft",
  158 |   );
  159 |   await expect(panel.getByLabel("変更理由", { exact: true })).toHaveValue(
  160 |     "第2cue理由",
  161 |   );
  162 | });
  163 | 
  164 | test("明示破棄は選んだ字幕本文の原文と理由だけを戻す", async ({ page }) => {
  165 |   const p = await open(page, true);
  166 |   const panel = await source(page, p.utterances[0].id);
  167 |   await panel.getByLabel("訂正後の原文", { exact: true }).fill("第1保持draft");
  168 |   await panel.getByLabel("変更理由", { exact: true }).fill("第1保持理由");
  169 |   await panel.getByLabel("訂正する字幕本文", { exact: true }).selectOption("1");
  170 |   await panel.getByLabel("訂正後の原文", { exact: true }).fill("第2破棄draft");
  171 |   await panel.getByLabel("変更理由", { exact: true }).fill("第2破棄理由");
  172 |   await panel
  173 |     .getByRole("button", { name: "この本文の下書きを破棄", exact: true })
  174 |     .press("Enter");
  175 |   await expect(panel.getByLabel("訂正後の原文", { exact: true })).toHaveValue(
  176 |     "次の字幕",
  177 |   );
  178 |   await expect(panel.getByLabel("変更理由", { exact: true })).toHaveValue("");
  179 |   await panel.getByLabel("訂正する字幕本文", { exact: true }).selectOption("0");
  180 |   await expect(panel.getByLabel("訂正後の原文", { exact: true })).toHaveValue(
  181 |     "第1保持draft",
  182 |   );
  183 |   await expect(panel.getByLabel("変更理由", { exact: true })).toHaveValue(
  184 |     "第1保持理由",
  185 |   );
  186 | });
  187 | 
```