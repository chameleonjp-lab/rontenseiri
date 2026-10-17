> この文書は段階ごとの実装・検証履歴です。各段落の数値はその段階の結果であり、現HEADの合否は[PR #3の最新検証表](https://github.com/chameleonjp-lab/rontenseiri/pull/3)と同SHAのartifactを参照してください。Draft維持、G5全体・実機・AI品質は未完了です。

# 実装検証結果と公開条件

## 結論

議題キャンバス・原文訂正・振り返り・端末内保存・明示選択した発言の出力に加え、原文span coverage可視化、現行／履歴容量の分離、reasoning基盤、lineageと関係移送、共通snapshot Undo、fixed point依存無効化、許可DTO export、解析session checkpoint、Web Locks所有権、保存namespace、ReadinessPanel、明示的な静的オフライン準備を実装した**設計検証版**である。**計画書全体の完成、検証完了、P0合格、AI品質合格、正式公開の承認を意味しない。**

AIはdisabled（開始不可）である。この環境のChromiumではWebGPU APIは存在したが、`requestAdapter()`は実行デバイスを返さなかった。日本語AIの実推論、モデル取得量、GPUメモリ、実Mac/Windows/iPhoneは未確認で、外部AIフォールバックやサンプルの実解析表示はない。

## 実装上の確認範囲

- 全原文spanをcoverageとして追跡し、未確定を可視化。未確定を確定済みと表示しない。
- `capacity.ts`で現行入力、履歴本文、revision、project、full backupを別計数。
- `reasoning.ts`／`reasoning-types.ts`で問い版、応答種別、充足、複数根拠、条件・例外、排他的解釈候補、立場APIを分離。一部フォームをReasoningPanelへ統合したが、UI全体・品質は未完了。
- 分割／統合のlineageと明示した関係移送、共通snapshot Undo、混合依存のfixed point再計算を実装。
- 限定出力は許可DTOと発言allowlistに限定。
- `analysis/session.ts`は停止・再開・checkpoint・source hash照合を持つ。ただし現Worker/UI経路への完全統合は未了。
- `analysis/ownership.ts`はWeb Locksを必須とし、非対応／取得不能時にfail-closed。保存namespaceも導入。
- ReadinessPanelは容量・工程・明示オフライン準備を表示。production Service Workerは静的アセットだけをcontent hashとscope確認後にprecacheし、本文・DB・モデルをcacheしない。

## 検証した固有数

| 検証                  |                            結果 | 証拠・限界                                                                            |
| --------------------- | ------------------------------: | ------------------------------------------------------------------------------------- |
| 単体・回帰合計        | 116件通過（文書実験10件を含む） | 追加修正のローカル確認。公開版の正本は同一SHAのCI artifact                                      |
| 文書実験テスト        |                        10件通過 | `documents.test.ts`等。通常UI対応を意味しない                                         |
| ブラウザE2E           |           同一SHAのCI結果を参照 | Linux Chromium。iPhone Safari実機ではない                                             |
| 500node表示・パン     |                ローカル確認済み | 50,000文字。選択・検索・折り畳み各100回のp95とは別                                    |
| production offline    |                         1件通過 | 静的shellの明示準備。完全なオフライン再起動保証ではない                               |
| 架空日本語評価        |      21ケース、実予測0、not-run | `artifacts/evaluation-empty.*`。品質合格値なし                                        |
| ソフトウェアbenchmark |         50,000字・500node・20回 | `artifacts/software-benchmark.json`。Node/Linuxのみの入出力p95、G4/G5品質合格ではない |

## 合格扱いにしないこと

1. **AIと意味品質:** 日本語の問い・応答・複数根拠・条件・立場変化・排他的解釈・捏造・公平性・prompt injectionの実モデル評価は未実施。型/APIやnot-runハーネスを品質合格としない。
2. **実機と資源:** Mac／Windows／iPhone、GPUメモリ、モデル取得、合法最大入力、取消・停止再開の実Worker/UI、500node操作p95、最大履歴は未測定。
3. **入力境界:** PDF／DOCXは通常UI未結線。PDFブラウザはfail closed。`src/input/documents.ts`／`docx.ts`は実験API、docx streamingは同期処理で正式採用前のWorker隔離が必要。同じDraft PR内の未結線実験として隔離で通常入力対応を宣言しない。
4. **保存・配布:** namespaceはあるが公開オリジンの完全隔離、暗号化、権利者・LICENSE・モデル配布条件、公開承認は未確認。offlineは静的アセット限定。
5. **利用者評価:** G8被験者比較は未実施。

G0–G8のdecisionは [R01–R33実装状況](requirements-status.md) に登録する。**いずれも総合合格へ変更していない。**

## 主要な未実装・未統合

- AI開始の有効化、モデル取得・日本語品質・GPUメモリの実証。
- reasoningの全画面UI、質問／応答／立場の精密な多対多品質、再解析・解釈候補の完全伝播。
- checkpointとWeb Locksの現Worker/UI完全統合、実機複数タブの停止再開。
- 各100回の操作p95測定・比較、最大履歴・実機p95、G8被験者試験。
- PDF/DOCX通常入力、OCR等。docx streamingのWorker隔離。
- LICENSE／権利者／配布承認、公開オリジン隔離。

同じDraft PR #3に基盤と未結線の文書実験をまとめる。`test:offline`、`benchmark`、`evaluate`はpackage scriptsとCIに登録済み。未達ゲートを総合合格へ変更しない。

## 公開HEADと証拠の対応

ローカル検証と公開HEADは区別する。GitHub CIはPR headをcheckoutし、`artifacts/verified-sha.txt`へ実際の`git rev-parse HEAD`を記録。ブラウザJSON、性能JSON、オフライン復元画像、Node入出力ベンチマークを同じrunのartifactに保存する。チェック通過と計測条件を添えず「完成」と呼ばない。

追加した失敗再現は `public-review-fixtures.test.ts` と `review-blockers.test.ts`、永続化・復帰・保存競合の実ブラウザ経路は `e2e/` にある。各100操作のp95≤200ms判定は `canvas-performance.json` を正本とし、G5全体（実機を含む）は引き続き未合格。

### 追加保存試験の初回誤検出

手入力から問いv1を登録した後の応答候補は実DOMに存在した。初回の追加試験は、選択肢を内包するラベルに`getByLabel("対象問い版", {exact:true})`を使ったためlocatorが一致せず、候補0件と誤判定した。実アクセシブル名の`getByRole("combobox", {name:"対象問い版", exact:true})`へ変更し、アプリの候補生成は変更せず解決した。

`rich-persistence.spec.ts`は、手入力→原文改版→問いv1と応答→問いv2→r1(main)保存→分類r2(derived)自動保存→同一タブ再開→メタデータ更新→2回Undoでr1のmain／重要フラグ／原文版／問い版／旧v1応答を保持する経路を検証する。`focus.spec.ts`は、詳細を閉じた元nodeへのfocusと、パン後の「図へ戻る」による可視化・focusを独立した2件として固定する。公開SHAのCI結果を確認するまでローカル通過を完了とは呼ばない。

## ドメインAPIブロッカーの追加回帰

`dd0a674`で独立再現した2件を修正。`returnStatus:none`を明示更新すると同じrevisionで起点return edgeを削除し、手作りのnone＋edge payloadはvalidationと保存で拒否する。旧形式のstatus未指定＋根拠付きedgeは保持する。

問いの改版・撤回は旧版から応答・根拠を辿り、さらに`Relation.dependency:true`を通る別議題も含め、到達したsummaryDependenciesだけを要再確認にする。旧版応答・要約本文・無関係議題は保持し、新版に応答を自動移送しない。最小TXT fixtureの単体回帰、議題間明示依存の改版／撤回回帰、および実IndexedDBで保存・再読込・Undoする2件を追加した。

各100操作の観測は機能E2EとCI step・JSONを分離する。巨大DOMのtrace snapshotによる観測負荷を避け、代わりに300操作のログ、未完了時の部分分布と失敗理由を保存する。操作ハーネスの通過はG5全体の合格ではない。正本は同一公開SHAの`canvas-performance.json`とCI runであり、旧SHAの値を移植しない。

### 解釈経路とJSON往復の補強

問い版→解釈→前提／結論の意味項目、および意味項目→解釈→他方の意味項目も固定点へ追加した。応答リンク無しでの改版・撤回を回帰し、旧graph・無関係要約とUndoを確認する。復帰矛盾JSONのimport拒否、改版／撤回→二段の議題間明示依存→完全JSON往復→Undoも固定した。

性能ハーネスは正式G5受入から切り離した**診断専用**（eligibleForG5:false）である。warmup／cache／独立sessionが統制されておらず、閾値超過でCIを失敗させる正式ゲートではない。CI greenをG5合格としない。期待ID集合・件数・相対配置、失敗操作時刻、preflight失敗JSON、clean checkoutと新規server起動時SHAの照合を補強したが、正式ゲート未完了は変わらない。

旧4cd3d64の公開CIは成功したが、p95診断値は選択251ms／検索576ms／折り畳み307.8msで全て200ms超過。同SHAの親側ローカルは機能E2E22件成功・1件skipの後、offline専用port4274が別checkoutに使われていたため、その段階ではofflineと後続診断を実行できなかった。製品失敗や未実行を成功数へ混ぜない。後続SHAは競合しないportの新規serverで再検証する。

### 性能超過への継続対応

3f21c87の全3操作の200ms超過を製品性能問題として扱い、ScriptDuration/CPU profileで全node/data/edge再生成・閉じた候補DOMのeager構築・固定検索アニメーションを切り分けた。base geometryとUI差分の分離、同値state更新抑止、MiniMap callback安定化、詳細候補の初回遅延、即時検索jumpを実装。根拠は`canvas-performance-profile.md`とraw JSONに記録した。後続ハーネスでは100回・200ms・成功アサーションを維持し、一操作群でもp95超過でCIを失敗させる。過去の「診断超過ではCI失敗にしない」は3f21c87時点の記録で、後続には適用しない。G5全体の未完了は別である。

### 二段目の性能修正

3a98e47では機能回帰は成功したが、CI開閉229.3ms、ローカル全群で200msを超過し、性能ゲートは正しく失敗した。折り畳み中のhidden edge identity漏れを独立レビューで修正し、folded graph/selected nodeとSpeech markupをcacheした。参照再利用の回帰を追加。観測protocol v2は計時位置・回数・閾値を変えず、同等以上の成功条件をframe単位で確認し、無関係500ノードのrole走査やcoarse assertion backoffを回避する。旧観測との改善率を製品コードだけへ帰属させず、同じCDP手順の切り分け証拠と分離した。

### ローカル200ms超過への三段目

CIだけ成功したa48c0e2でもlocal全群が未達だったため、枝DOMをunmountせずCSS/inert/AXで保持する方式と、ReactFlowのonMove/装飾要素安定化を実装した。非main辺・隠れた端点のmain辺、MiniMap、全体表示を可視状態へ揃え、意味・原文・履歴・DTOにUI属性を持ち込まない。protocol2.1の準備完了barrier/局所role走査を明示し、500全nodeのID/配置と可視/非可視CSS/inert/AXを確認してから計時終了する。直前の機能E2Eは24成功・標準offline1skip（専用offlineで別実行）。

### 四段目の根本対策

d737927 localは選択198.8msだけ成功し、検索200.8msと開閉238.7msは失敗。CPU診断で残った大量JSX更新を、static branch class・constant store/Provider・小さいBranchVisibilityBoundaryとroot CSSに分離し、foldでReactFlowのgraph propsを更新しなくした。検索queryもform内へ分離。source classification/Undoでの枝classとinert/ARIA復帰、辺class変更時の一時ARIA属性の復元を回帰へ追加。計測protocol2.1と200msのassertは変更しない。
