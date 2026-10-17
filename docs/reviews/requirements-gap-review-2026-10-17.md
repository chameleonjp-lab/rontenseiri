# 論点整理ツール 要件レビューと追加要件一覧

> これはPR #1（v0.3）を対象とした2026-10-17の監査記録。採用要件の正本は統合要件v0.4の第19章、実装・検証への対応は第20章を参照してください。

確認日：2026年10月17日（日本時間）

## 1 このレビューの結論

目的に対して、追加・具体化・修正したい要件はある。原文の保持、問いと回答の対応、複数解釈、訂正履歴、端末内処理、保存・復元、日本語評価という基本方針はすでに計画に含まれている。主な不足は、複数の問いや変更があるときの動作、訂正の影響を結果へ反映する規則、目的達成を測る採点方法にある。

重複を整理した候補は33件。内訳は、追加する仕様4件、既存の方針を具体化する仕様26件、誤解の余地がある文言・指標の修正2件、対象利用者についての追加決定1件である。「新しい機能が33個欠落している」という意味ではない。いずれも採否を判断するための提案であり、実装済みではない。

特に先に検討したいのは、記録の欠落を扱うR02・R04、重要な内容の反映を測るR27・R28、訂正後の結果の有効性を扱うR15・R16、保存領域の境界を扱うR25である。R01の対象利用者の決定は、端末内AIの採用判断にも関わる。

## 2 確認した範囲

| 項目 | 確認結果 |
| --- | --- |
| 対象 | [rontenseiri PR #1](https://github.com/chameleonjp-lab/rontenseiri/pull/1) |
| 要件文書 | [統合要件・開発計画 v0.3 固定版](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md) 全468行・全18章 |
| PRの版 | 29b4161a1d48cea53356efb7e62a2aef210acad0 |
| 取り込み | 2026年10月17日19時31分22秒（日本時間）にマージ済み |
| 確認したmain | 27ddba477e9e175adcd1bf4891cd7de4343b1513。要件文書の内容はPRの版と同じ |
| ファイル構成 | [mainの固定版一覧](https://github.com/chameleonjp-lab/rontenseiri/tree/27ddba477e9e175adcd1bf4891cd7de4343b1513) ではREADME.mdと要件文書の2件。アプリコード・テストはまだない |
| 議論欄 | 確認時点のPRコメントは0件 |

このレビューは要件文書の内容と整合性を対象にしている。実装上の障害が発生したという報告ではない。実際の日本語精度、処理速度、iPhoneでの新規AI解析の成立性は、まだ実測結果がなく、わからない。

追加要件も、文字起こし済み文書・テキストを端末内で扱い、モデルの知識だけで事実を確認済みにしない既定方針に合わせている。

## 3 すでに要件にある内容

| 目的を支える要件 | 現在の記載 | 今回の扱い |
| --- | --- | --- |
| 根拠に戻れること | 第4・11章、16.3節。原文の不変性、根拠の引用一致、全発言の反映状態がある | 欠落と扱わず、発言化前の網羅性と意味の反映を補う |
| 断定と混同を避けること | 第5・7–10章、16.5節。回答・合意・解決・外部確認を分離する | 複数対象・変更・代替解釈の動作を具体化する |
| 人が訂正できること | 第7・11章、16.3・16.7節。訂正履歴、再解析との比較、元に戻す操作がある | 訂正の影響と、移し先が変わる場合を補う |
| データを持ち帰れること | 第12–13章、16.6節。端末内保存、完全復元JSON、限定出力、容量制限がある | 上限の数え方、限定出力の参照、配信先との隔離を具体化する |
| 品質を測ること | 16.8節。日本語資料60件以上、独立評価者2人、固定評価、長文・反復・安全・性能の基準がある | 意味の反映、機能別評価、利用者の目的達成を補う |

これらの記載は[要件書の第4–16章](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L60-L330)にある。対応表を作る要求もP0にすでにあり、今回必要なのは要件ごとの追跡単位と証拠欄の具体化である。

## 4 一覧の読み方

「設計前」は関連するデータや処理の設計を決める前に補う項目、「公開前」はその機能を初期版として提供する前に満たす項目、「対応時」は対応を表明した端末・機能に適用する項目を示す。これは提案する優先度であり、現行計画のP0–P6は実装の段階名である。すべての実装を一度に行うという意味ではない。

各項目は既存内容、未確定の部分、追加文案、完了条件、目的との関係をセットにしている。未実測の速度や精度の達成値を追加の事実として置いていない。

## 5 目的と入力記録の扱い

| 番号 | 項目 | 種類・時期 |
| --- | --- | --- |
| R01 | 初期版を使う人と、端末ごとの到達点を決める | 要決定・設計前 |
| R02 | 解析の完了と、会話記録がそろっていることを分ける | 具体化・設計前 |
| R03 | 会話、参考資料、後日の説明をデータ上でも分ける | 具体化・設計前 |
| R04 | 発言として切り出される前の文章の欠落を検出する | 具体化・設計前 |
| R05 | 字幕の正常な時間重複と、字幕区切りと発言の違いを扱う | 修正・設計前 |
| R06 | 大きい問いがない場合と、複数ある場合を定義する | 追加・設計前 |

### R01 初期版を使う人と、端末ごとの到達点を決める

**区分：** 要決定。**提案する時期：** 設計前。**対応する段階：** P0。

**現行の記載：** 一般利用者が端末内で解析する方針と、デスクトップを基準にiPhone Safariを実測する方針はある。iPhoneで成立しない場合は基本操作に限定するとしている。 [要件書11–33行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L11-L33)、[要件書220–229行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L220-L229)、[要件書367–378行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L367-L378)

**不足・曖昧な点：** デスクトップ向け公開を先行すれば目的達成とするのか、PCを使わない人が自分の会話を新規解析できることまで初期版の条件にするのかが、目的との対応として明文化されていない。

**追加要件案：** 初期対象者、代表的な利用場面、端末だけで終えるべき作業を決める。対応表は新規解析、原文閲覧、手動訂正、保存、復元、出力を別々に示す。iPhoneのAI対応を必須にする判断は、現時点で承認済みとは扱わず、P0の実測結果と必要性を照合して決める。

**完了条件：** 端末ごとの必要機能と合否が一覧で確認できる。iPhoneで既存結果を開けることだけを、iPhoneで新しい会話を解析できることと同じ達成として報告しない。

**目的との関係：** 利用者が実際に必要とする操作を完了できるかが、公開できることとは別の目的になるため。

### R02 解析の完了と、会話記録がそろっていることを分ける

**区分：** 具体化。**提案する時期：** 設計前。**対応する段階：** P1–P3・P5。

**現行の記載：** 記録範囲の不足、切り抜き不足の評価、未処理部分の表示、無断切捨ての禁止はある。 [要件書60–69行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L60-L69)、[要件書255–264行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L255-L264)、[要件書305–315行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L305-L315)

**不足・曖昧な点：** 入力がすべて解析済みでも、会話の前後が欠けている場合の未回答・合意・終了判定への適用規則が未定義。

**追加要件案：** 記録範囲を利用者申告による全文、一部抜粋、不明として保持し、既知の欠落箇所を付記できるようにする。入力全件の解析完了は入力範囲についての完了と表示する。入力の末尾を会話の終わりと自動で同一視せず、未回答等は提供記録の範囲に限定する。

**完了条件：** 途中で切れた記録を全件処理しても、会話全体で回答がなかったとは断定しない。図、まとめ、書き出し、復元後の画面に記録範囲の状態が残る。

**目的との関係：** 中心目的である置き去りの問いの発見を、記録されていない部分への断定に変えないため。

### R03 会話、参考資料、後日の説明をデータ上でも分ける

**区分：** 具体化。**提案する時期：** 設計前。**対応する段階：** P1・P3・P5。

**現行の記載：** 外部資料の本文を利用者が追加し、支持・反証候補と人の確認を分ける方針がある。 [要件書120–132行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L120-L132)、[要件書232–253行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L232-L253)、[要件書266–275行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L266-L275)、[要件書429–440行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L429-L440)

**不足・曖昧な点：** Sourceの最低限の項目には資料の役割が明示されていない。参考資料を会話の発言や参加者に混ぜない契約が未確定。

**追加要件案：** 会話記録、参考資料、事後説明等の役割を、入力や登録の時点で保持する。会話の順序・参加者・当時の合意を作る対象と、根拠の照合だけに使う対象を分ける。資料の筆者は自動で会話参加者にしない。役割の変更は履歴に残す。

**完了条件：** 参考資料を追加しても、元の会話の発言数・順序・参加者が勝手に変わらない。資料に書かれた合意の説明が、参加者本人の合意発言として採用されない。

**目的との関係：** 何が会話で述べられ、何が後から補われた情報かを守るため。

### R04 発言として切り出される前の文章の欠落を検出する

**区分：** 具体化。**提案する時期：** 設計前。**対応する段階：** P1・P4。

**現行の記載：** 作成された全発言の状態付与、原文範囲、未整理表示、引用一致、逆引きが定められている。 [要件書143–150行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L143-L150)、[要件書232–251行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L232-L251)、[要件書317–321行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L317-L321)、[要件書380–390行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L380-L390)

**不足・曖昧な点：** 発言データになる前に落ちた一文は、残った全発言への状態付与率を100%にしても検出できない。

**追加要件案：** 抽出済みテキストの全範囲を、発言、見出し・時刻等の非発言情報、対象外にした範囲、未確定のいずれかに対応付ける。理由なく行き先がない範囲を認めない。抽出文の範囲から発言等を経て分析結果へたどれるようにする。

**完了条件：** 話者ラベルのない段落や短い訂正を発言化前に意図的に落とすと、検査が不合格になる。対象外の範囲にも理由が残り、画面と復元ファイルから確認できる。

**目的との関係：** 原文を失わないという既存の合格条件を、発言の切り出し段階にも適用するため。

### R05 字幕の正常な時間重複と、字幕区切りと発言の違いを扱う

**区分：** 修正。**提案する時期：** 設計前。**対応する段階：** P1。

**現行の記載：** SRT・VTTの入力、時刻保持、時刻だけでファイル順を推測しない方針がある。P1には不正時刻・重複時刻の失敗テストと記載されている。 [要件書204–215行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L204-L215)、[要件書238–240行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L238-L240)、[要件書380–390行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L380-L390)

**不足・曖昧な点：** 重複時刻を一律に不正とする実装にも読める。また字幕の一つの表示区間と、一人の一発言の対応が未定義。

**追加要件案：** 不正な時刻と正常な重複を別の試験にする。WebVTTの合法な重複・同一時刻は拒否しない。字幕の区切りと発言は一対一に固定せず、複数の字幕にまたがる一発言や、一字幕内の複数話者を原文対応付きで扱う。反復表示と実際の繰り返し発言を断定で統合しない。

**完了条件：** 合法な重複、同一時刻の複数字幕、否定が字幕境界をまたぐ文章を処理でき、元の字幕と話者候補に戻れる。不正な終了時刻は別に検出する。入力時刻を実メディアと照合済みとは表示しない。

**目的との関係：** 正常な入力を拒否したり、話者・否定・発言回数を誤ることを防ぐため。

**外部の確認資料：** [W3C WebVTT 第4.1節と第1.4節](https://www.w3.org/TR/webvtt1/)。具体的な確認内容は次章に記載する。

### R06 大きい問いがない場合と、複数ある場合を定義する

**区分：** 追加。**提案する時期：** 設計前。**対応する段階：** P1–P3。

**現行の記載：** 最初の大きい問いの固定表示、小さい問い、分岐、着目する問いの切替がある。 [要件書71–96行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L71-L96)、[要件書232–243行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L232-L243)、[要件書295–298行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L295-L298)

**不足・曖昧な点：** 独立した議題が複数ある会話、途中からの記録、明示的な質問がない記録の最上位の扱いがない。

**追加要件案：** 最上位の問いは0個以上とし、原文に明示された問い、原文から推定した問い、利用者が設定した検討の問いを区別する。問いが特定できない場合は問い未特定で原文を整理する。画面で選んだ問いを会話全体で唯一優先される問いとは扱わない。

**完了条件：** 独立した複数議題を別々の最上位問いとして表示できる。質問のない記録に、発言者が尋ねたことになっている質問を作らない。

**目的との関係：** 会議や日常会話を一つの問いへ無理に押し込めず、想定する利用場面を扱うため。


## 6 問いと回答と議論の意味

| 番号 | 項目 | 種類・時期 |
| --- | --- | --- |
| R07 | 問いが変わったとき、回答がどの要求に対応するかを残す | 具体化・設計前 |
| R08 | 複数の問いと回答を結び、誰が答えたかを残す | 具体化・設計前 |
| R09 | 応答があることと、必要な答えがそろうことを分ける | 具体化・公開前 |
| R10 | 話題の復帰と、データ構造の異常を区別する | 具体化・設計前 |
| R11 | 反論の対象と、複数の根拠のつながりを区別する | 具体化・設計前 |
| R12 | 複数の解釈候補を混ぜず、不確かさを結論まで引き継ぐ | 具体化・設計前 |
| R13 | 当時の立場・合意と、後日の説明・撤回を分ける | 具体化・公開前 |
| R14 | 最終まとめに残す条件・異論・未確認を決める | 具体化・公開前 |

### R07 問いが変わったとき、回答がどの要求に対応するかを残す

**区分：** 具体化。**提案する時期：** 設計前。**対応する段階：** P1–P3。

**現行の記載：** 問いや考えの変化、対象・用語・条件の追跡、訂正履歴はある。 [要件書71–79行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L71-L79)、[要件書98–107行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L98-L107)、[要件書232–253行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L232-L253)、[要件書266–272行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L266-L272)

**不足・曖昧な点：** 変更前後のどちらへ回答を対応付けるか、撤回された要求を現在の未回答に含めるかが未定義。

**追加要件案：** 問いの対象・条件・要求要素が変わる場合は、変更前後、変更の根拠発言、承継・追加・撤回・関係未確定を保持する。回答を実際に対応する問いの版と要求要素へ結びつける。撤回済みの未回答要求は履歴に残し、現在も残る問いと区別する。

**完了条件：** 要求が一部撤回された後の回答を、変更前の全要求への不足として扱わない。変更前後の問いと対応する回答に戻れる。

**目的との関係：** 質問側の要求変更で、回答側に不当な未回答判定を付けないため。

### R08 複数の問いと回答を結び、誰が答えたかを残す

**区分：** 具体化。**提案する時期：** 設計前。**対応する段階：** P1–P3。

**現行の記載：** 誰が誰に応答したか、複数質問の分解、合意参加者の特定はある。 [要件書60–79行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L60-L79)、[要件書120–123行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L120-L123)、[要件書238–245行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L238-L245)、[要件書268–271行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L268-L271)

**不足・曖昧な点：** 一発言が複数の問いへ答える場合、一問へ複数人が答える場合、指定外の人が答える場合の対応数と集約規則が未定義。

**追加要件案：** 問いの要求要素と回答は、互いに複数へ対応できるようにする。話者、応答先、原文範囲を保持し、問いに何らかの回答があることと、指定された各人が答えたことを別に示す。他人の立場を説明した発言で、本人の立場・合意を確定しない。

**完了条件：** 一人だけが回答した場合に、他の参加者は回答済みにならない。一つの発言を複数の問いへ対応させても原文を重複作成しない。

**目的との関係：** 複数参加者の会議・討論で、回答や合意の主体を失わないため。

### R09 応答があることと、必要な答えがそろうことを分ける

**区分：** 具体化。**提案する時期：** 公開前。**対応する段階：** P2・P3。

**現行の記載：** 一部回答、保留、前提への異議、回答と解決の分離はある。 [要件書71–79行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L71-L79)、[要件書134–141行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L134-L141)、[要件書266–272行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L266-L272)

**不足・曖昧な点：** 知らない、答えられない、後日答える、質問の意味を確認したい等を、どの状態で表示するかが未定義。

**追加要件案：** 内容回答、情報不足、回答拒否、後日回答、確認質問、前提への異議、判定不能等を区別する。応答の存在と要求の充足を別々に持ち、一部回答では答えた要素と残った要素を示す。理由が明示されていなければ補わない。

**完了条件：** 応答した事実を残しながら、具体的な答えが未定の要素を回答済みにしない。確認質問を回答拒否や論点ずらしと一律に扱わない。

**目的との関係：** 次に何を確認すればよいかを適切に示し、意図を断定しないため。

### R10 話題の復帰と、データ構造の異常を区別する

**区分：** 具体化。**提案する時期：** 設計前。**対応する段階：** P1–P3。

**現行の記載：** 復帰・合流を表す関係と、循環・参照切れを試験する方針がある。 [要件書81–96行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L81-L96)、[要件書241–242行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L241-L242)、[要件書255–262行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L255-L262)、[要件書279–282行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L279-L282)

**不足・曖昧な点：** 親問の階層で禁止する循環と、話題が以前の問いへ戻る正当な関係が同じ循環という語で扱われる余地がある。

**追加要件案：** 包含する親子関係、時間順、応答、支持・反対、復帰・合流ごとに許される結び方を定義する。話題の復帰・相互参照を、親子関係の不正な循環や保存データそのものの異常と混同しない。表示の都合で正当な関係を削除しない。

**完了条件：** 別の問いを経て元の問いに戻る記録を表現できる一方、互いが互いの親になる不正な包含関係は検出する。図・一覧・保存で同じ関係が保たれる。

**目的との関係：** 分岐だけでなく復帰・合流も可視化するという目的を、データ検査が妨げないようにするため。

### R11 反論の対象と、複数の根拠のつながりを区別する

**区分：** 具体化。**提案する時期：** 設計前。**対応する段階：** P1–P3。

**現行の記載：** 主張、理由、根拠、前提の分離と、支持・反対の関係がある。 [要件書71–79行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L71-L79)、[要件書120–132行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L120-L132)、[要件書241–242行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L241-L242)、[要件書255–264行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L255-L264)

**不足・曖昧な点：** 主張への反対、根拠への異議、根拠から結論に進むつながりへの異議の区別と、複数条件を同時に必要とする場合の表現が未定義。

**追加要件案：** 反論が主張、根拠・前提、結論へのつながり、判断基準のどれを対象とするかを原文根拠付きで表す。複数条件が同時に必要な関係と、それぞれ独立した理由を区別する。述べられていない前提は確定して補わず、推定または未確定とする。

**完了条件：** 必要な条件が複数ある場合に、その一つだけで結論が支持されたとは扱わない。論理のつながりへの異議を、すべての前提への否定に置き換えない。

**目的との関係：** 内容・根拠・筋道を分けて確認するという中心目的に対応するため。

### R12 複数の解釈候補を混ぜず、不確かさを結論まで引き継ぐ

**区分：** 具体化。**提案する時期：** 設計前。**対応する段階：** P1–P3・P5。

**現行の記載：** 複数の読み方を残すこと、保留と理由を表示すること、意味を別に評価することはある。 [要件書98–107行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L98-L107)、[要件書232–253行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L232-L253)、[要件書255–264行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L255-L264)

**不足・曖昧な点：** 両立しない解釈候補のまとまりと、その候補に依存した回答・合意・因果の扱いがない。

**追加要件案：** 両立しない読みは同じ代替候補の組として保持し、それぞれの根拠と影響先を示す。候補を前提にした分析にも不確かさを引き継ぐ。採用が未確定の候補同士を、同時に成立した事実としてまとめない。

**完了条件：** 話者や指示語の対象が二通りある場合、両方へ確定した発言として計上しない。図、まとめ、出力のどこでも未確定が失われない。

**目的との関係：** 各箇所に推定表示があっても、全体の統合で誤断定に変わることを防ぐため。

### R13 当時の立場・合意と、後日の説明・撤回を分ける

**区分：** 具体化。**提案する時期：** 公開前。**対応する段階：** P3・P5。

**現行の記載：** 当時の発言を残し、後日の説明・訂正・撤回を履歴にする。本人説明としての登録にも身元未検証を示す。 [要件書98–107行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L98-L107)、[要件書120–132行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L120-L132)、[要件書243–253行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L243-L253)、[要件書404–415行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L404-L415)

**不足・曖昧な点：** 履歴が残っていても、まとめが当時と現在のどちらを示すか、後日説明を当時の意図の確定に使うかが未定義。

**追加要件案：** 原文の訂正、分析の修正、後日の本人説明、立場変更・撤回、第三者の異議を分ける。対象となる人物・主張・条件・時点と登録時点を保持し、当時の到達点と後日情報を含む現在の状態を区別する。後日説明を当時の意図の自動的な確定に使わない。

**完了条件：** 後日の立場変更が、当時からその立場だった記録に変わらない。身元未検証の説明だけで当時の原文や他者の合意が自動訂正されない。

**目的との関係：** 意見の変化を会話の成果として残し、編集者の解釈と元の記録を分けるため。

### R14 最終まとめに残す条件・異論・未確認を決める

**区分：** 具体化。**提案する時期：** 公開前。**対応する段階：** P2・P3・P5。

**現行の記載：** 問い、到達点、未回答、独立した状態、原文への参照、限定出力の反対根拠はある。 [要件書134–141行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L134-L141)、[要件書255–264行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L255-L264)、[要件書287–291行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L287-L291)、[要件書317–328行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L317-L328)

**不足・曖昧な点：** まとめ本文自体が、結論の意味を変える条件・例外・異議・撤回をどこまで保つかの条件が未具体化。

**追加要件案：** 結論・合意・立場をまとめるときは、その意味を変える対象範囲、条件、例外、重要な異議、撤回、未確認・推定を残す。誰のどの時点の到達点かを保持する。要約対象から外れた問いや範囲も表示する。

**完了条件：** 一部の合意が全員の合意に、条件付きの到達点が無条件の決定に変わる要約を不合格にする。まとめだけを読んでも重要な制約と不同意の存在が分かり、根拠に戻れる。

**目的との関係：** 原文へ戻れることに加え、全体像を確認するために読むまとめの内容も正しくするため。


## 7 訂正と保存と復元

| 番号 | 項目 | 種類・時期 |
| --- | --- | --- |
| R15 | 訂正の影響がある結論を更新するか、要再確認にする | 具体化・設計前 |
| R16 | 分割・統合・再解析の後も、人の訂正の行き先を追えるようにする | 具体化・設計前 |
| R17 | 見落としを人が補うための操作を具体的にそろえる | 具体化・公開前 |
| R18 | 完全バックアップと、論点を絞った持ち出しを別の形式契約にする | 具体化・設計前 |
| R19 | 入力と、履歴を含む保存データで上限の数え方を分ける | 具体化・設計前 |

### R15 訂正の影響がある結論を更新するか、要再確認にする

**区分：** 具体化。**提案する時期：** 設計前。**対応する段階：** P1–P3・P5。

**現行の記載：** 原文の版、訂正履歴、再解析を別runに保存すること、人の訂正を無断上書きしないことはある。 [要件書232–253行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L232-L253)、[要件書299–303行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L299-L303)、[要件書362–365行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L362-L365)、[要件書409–415行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L409-L415)

**不足・曖昧な点：** 訂正を保存した後、古くなった立場・合意・未回答・まとめをどこまで更新または失効させるかがない。旧版と引用が一致していても現在の結果としては古い場合がある。

**追加要件案：** 各分析が依存する原文版、話者割当、問い、関係、評価を追跡する。訂正時は影響する結果を再計算するか、訂正前の結果・要再確認として扱う。図、一覧、まとめ、出力で共通の有効状態を使い、無関係な訂正は保持する。

**完了条件：** 話者変更、否定の追加、問いの分割、回答関係の付替えで、依存する結果が更新または要再確認になる。未確認の古い結論を現在の確認済み結果として出力しない。訂正を取り消した場合も状態が整合する。

**目的との関係：** 訂正できるという機能を、訂正後の結果を信頼して使えることにつなげるため。

### R16 分割・統合・再解析の後も、人の訂正の行き先を追えるようにする

**区分：** 具体化。**提案する時期：** 設計前。**対応する段階：** P1–P3・P5。

**現行の記載：** IDを固定し、対象IDに訂正履歴を付け、再解析後の旧新差分を比較する方針がある。 [要件書238–253行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L238-L253)、[要件書362–365行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L362-L365)、[要件書404–415行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L404-L415)

**不足・曖昧な点：** 一つの問いが二つになった場合など、対象の単位が変わったときの同一性と訂正の移し先が未定義。

**追加要件案：** 分割・統合・置換・削除の前後で、旧IDから新IDへの対応と由来を残す。自動対応が不確かな訂正は移し先未確定として一覧化する。同じ文章という理由だけで別の発言へ移さず、訂正の元の対象を保持する。

**完了条件：** 再解析後、人の訂正が適用済み、衝突、移し先未確定のいずれかに必ず現れる。比較画面から無言で消えず、同文が複数ある記録でも誤った発言へ移らない。

**目的との関係：** 履歴が残るだけで、実際の新しい図には訂正が反映されない事態を防ぐため。

### R17 見落としを人が補うための操作を具体的にそろえる

**区分：** 具体化。**提案する時期：** 公開前。**対応する段階：** P3・P5。

**現行の記載：** 重要な一言の指定、話者・分岐・解釈の訂正、手動修正への縮退、取消操作がある。 [要件書143–150行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L143-L150)、[要件書224–229行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L224-L229)、[要件書247–253行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L247-L253)、[要件書404–415行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L404-L415)

**不足・曖昧な点：** 既存項目の編集だけでなく、抽出されなかった問い・主張・関係を追加できるか、分割・統合・誤関係の解除をどの範囲で行えるかが未定義。

**追加要件案：** 発言の区切り、人物対応、問い・主張、回答や根拠の関係について、追加、修正、分割、統合、関係解除の対応範囲を決める。追加した分析にも根拠を付け、原文に根拠がない利用者メモや検討の問いは別の出所として扱う。AIを起動できない場合にも、対応を表明する手動操作は使えるようにする。

**完了条件：** 重要な問いとその回答関係が自動抽出されなかった場合に、人が原文を選んで追加できる。誤った統合を分け、誤関係を解除でき、保存・復元・取消後も原文と履歴が整合する。

**目的との関係：** 見落としを発見して修正できるという設計を、実際に完了できる操作へ具体化するため。

### R18 完全バックアップと、論点を絞った持ち出しを別の形式契約にする

**区分：** 具体化。**提案する時期：** 設計前。**対応する段階：** P5。

**現行の記載：** 完全復元JSON、論点限定の出力、反対根拠、範囲外情報の漏れ検査、出力プレビューはある。 [要件書163–171行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L163-L171)、[要件書287–292行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L287-L292)、[要件書429–440行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L429-L440)

**不足・曖昧な点：** 根拠を残すためにSource全文を含めると範囲外の本文が出る一方、単に削ると引用位置がずれる。履歴や旧解析にも本文が残り得る。限定JSONが何を復元するか未定義。

**追加要件案：** 完全バックアップと論点限定パッケージを識別する。限定パッケージ内の参照は、その中の原文抜粋・資料・履歴だけで解決できるようにし、範囲外の内容を旧版や索引にも残さない。引用の位置対応を保持する形式を定める。反対根拠等のため範囲を広げる場合は、出力前に具体的な追加範囲を示す。

**完了条件：** 範囲外の本文、古い原文、履歴、人物名、ファイル名、資料URLに入れた識別文字列が、限定出力に混入しない。含めた引用の検査はすべて通り、復元後も一部抜粋であることが表示される。

**目的との関係：** 根拠へ戻れることと、選んだ範囲だけを渡せることを両立するため。

### R19 入力と、履歴を含む保存データで上限の数え方を分ける

**区分：** 具体化。**提案する時期：** 設計前。**対応する段階：** P1・P5。

**現行の記載：** 入力50,000文字・5,000発言、旧原文版の保持、完全JSON50 MiB、自己復元できる出力の検査がある。 [要件書211–215行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L211-L215)、[要件書247–249行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L247-L249)、[要件書284–290行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L284-L290)

**不足・曖昧な点：** 復元時の文字・発言上限が有効な現行版だけか、旧版・旧解析も合計するのか不明。上限に近い原文の通常の訂正だけで、復元条件を超える解釈が生まれる。

**追加要件案：** 現在解析する有効な入力版の文字・発言数と、全版・履歴・解析結果を含む保存容量の上限を区別する。旧版総量にも防御上限を設け、保存と復元に同じ計数規則を使う。通常の訂正が、現行入力の件数超過として扱われないようにする。

**完了条件：** 入力上限に近い会話を、現行文字数を増やさず複数回訂正しても、定めた履歴・保存容量の範囲内なら完全復元できる。上限に達した場合は既存の未保存表示と持ち出し手順へ進み、履歴を無断削除しない。

**目的との関係：** 正当な訂正と原文履歴の保持が、保存・復元の制約によって成立しなくなることを防ぐため。


## 8 図の使いやすさと端末の負荷

| 番号 | 項目 | 種類・時期 |
| --- | --- | --- |
| R20 | 分岐図の意味と、省略されている部分を誤読させない | 具体化・公開前 |
| R21 | スマホで入力から訂正・保存・復元まで完了できるかを確かめる | 具体化・対応時 |
| R22 | 全体照合の処理量を制限し、必要な部分から再利用する | 追加・設計前 |
| R23 | 解析以外の保存・差分・書き出しも速度とメモリを測る | 具体化・公開前 |
| R24 | 別の会話を複数タブで解析するときの資源競合を制御する | 具体化・公開前 |

### R20 分岐図の意味と、省略されている部分を誤読させない

**区分：** 具体化。**提案する時期：** 公開前。**対応する段階：** P3・P6。

**現行の記載：** 図の中心を正解と見せない、枝数を脱線の大きさとしない、折り畳み、一覧との同期、500ノードの読みやすさの試験はある。 [要件書81–96行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L81-L96)、[要件書295–298行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L295-L298)、[要件書324–324行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L324-L324)、[要件書409–415行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L409-L415)

**不足・曖昧な点：** 初見の人が線を因果・支持・脱線と取り違えないか、折り畳まれた論点を存在しないと誤解しないかの合格条件がない。

**追加要件案：** 問い・発言・主張と、線種・方向・時間順・推定の表示規則と凡例を決める。現在の着目点、表示範囲、隠れている論点数を示す。読みやすさは表示速度だけでなく、原文への到達と図の意味を説明する課題で評価する。

**完了条件：** 復帰・合流・反対根拠が混在した図から、利用者が元の問い、分岐の理由、未回答、推定を区別できる。折り畳みや検索によって、内容そのものを削除したとは誤解しない。

**目的との関係：** 図を表示できることを、会話の流れを理解できることにつなげるため。

### R21 スマホで入力から訂正・保存・復元まで完了できるかを確かめる

**区分：** 具体化。**提案する時期：** 対応時。**対応する段階：** P0・P3・P5・P6。

**現行の記載：** iPhone Safariの実機検証、WCAG 2.2 AA、読み上げ・拡大・復旧、基本操作のみの対応区分はある。 [要件書25–28行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L25-L28)、[要件書204–218行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L204-L218)、[要件書226–228行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L226-L228)、[要件書284–303行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L284-L303)、[要件書404–415行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L404-L415)

**不足・曖昧な点：** 公開対応する各機能を、iPhoneのタッチ操作と日本語入力で最後まで完了する具体的な課題がない。対応資料を用意する手順も含めて確認する必要がある。

**追加要件案：** 対応資料の選択・貼り付け、話者と順序の確認、図から原文への移動、日本語入力による訂正、端末への書き出し、再選択による復元、タブ復帰を実機課題にする。ドラッグに依存しない代替操作を設け、画面キーボード、読み上げ、文字拡大、画面回転を確認する。新規AI解析は、その端末で対応を表明する場合に含める。

**完了条件：** 公開対応とした機能を端末単体で完了できる。固定表示や画面キーボードによって操作に必要な部品へ到達できなくならず、スクロール等で確認・操作できる。図の移動・拡大と、文字を読む画面の操作を両立し、PCでの変換やGitHub操作を隠れた前提にしない。

**目的との関係：** スマホに画面が出ることと、スマホだけで役立つ作業を完了できることを分けて評価するため。

**外部の確認資料：** [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/)。具体的な確認内容は次章に記載する。

### R22 全体照合の処理量を制限し、必要な部分から再利用する

**区分：** 追加。**提案する時期：** 設計前。**対応する段階：** P0・P2。

**現行の記載：** 入力分割、索引、全体照合、再試行上限、一回の処理長、所要時間の目標はある。 [要件書255–264行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L255-L264)、[要件書299–302行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L299-L302)、[要件書321–323行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L321-L323)、[要件書392–402行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L392-L402)

**不足・曖昧な点：** 全体で何件の候補を作り、何回照合し、どれだけの結果を保持するかの上限と、訂正時の再処理範囲が未定義。

**追加要件案：** 人物・問い・関係の候補数、総照合回数、累積入出力量、保持する結果数、全体照合時間の上限と中断条件を決める。元文・処理設定・依存関係が同じ確認済み結果を再利用し、変更の影響がある範囲と必要な全体照合だけをやり直す。予算切れの未照合部分は明示する。

**完了条件：** 問いが多い入力や遠い枝への復帰が多い入力でも、定めた処理量で停止・再開できる。未照合を未回答や関係なしと確定しない。再利用ありと全再解析の意味上の結果を比較し、訂正保持と遠距離の見落としを評価する。

**目的との関係：** 端末内AIの成立性を、一回の短い推論だけで判断せず、長い会話全体と日常の訂正まで成立させるため。

### R23 解析以外の保存・差分・書き出しも速度とメモリを測る

**区分：** 具体化。**提案する時期：** 公開前。**対応する段階：** P1・P4・P5・P6。

**現行の記載：** パース・推論の別処理、推論時のメモリ目標、図操作の時間、保存容量上限はある。 [要件書222–228行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L222-L228)、[要件書284–290行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L284-L290)、[要件書323–330行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L323-L330)

**不足・曖昧な点：** 大きな履歴を持つ状態の訂正、サイズ検査、差分表示、保存、復元、出力の待ち時間と最大メモリが、どの合格条件に含まれるか不明。

**追加要件案：** 読み込みから保存・出力まで工程別の時間と最大メモリを測る。完全復元用JSONを持つことと、内部で毎回全文や全履歴を複製することを分ける。入力上限・履歴容量の近くでも、入力操作・進捗表示・取消を妨げない目標を決める。

**完了条件：** 合法な最大入力と上限に近い履歴で、訂正、保存、再読込み、差分表示、完全出力を実機測定する。未測定を合格扱いにせず、応答目標を超える場合は処理方法や対応範囲を見直す。履歴を無断で捨てて速くしない。

**目的との関係：** 分析が終わっても、訂正や持ち出しが重くて使えない状態を防ぐため。

**外部の確認資料：** [W3C Long Tasks API 草案](https://www.w3.org/TR/longtasks-1/)。具体的な確認内容は次章に記載する。

### R24 別の会話を複数タブで解析するときの資源競合を制御する

**区分：** 具体化。**提案する時期：** 公開前。**対応する段階：** P2・P5・P6。

**現行の記載：** 同一プロジェクトの書込み競合対策、取消、GPU喪失、メモリ上限がある。 [要件書224–230行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L224-L230)、[要件書299–303行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L299-L303)、[要件書323–324行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L323-L324)

**不足・曖昧な点：** 異なるプロジェクトを別タブで解析した場合の、モデルや推論に使うメモリの合計負荷と実行権の管理がない。

**追加要件案：** 保存の書込み競合とは別に、同じアプリで同時に解析できる数とモデル資源の所有者を決める。初期版は同時推論一つと待機でもよい。取消・タブ終了・異常停止・モデル切替で資源と実行権を回収し、他の待機処理が進めるようにする。

**完了条件：** 別プロジェクトを二つのタブで開いても、無制限にモデルが追加されない。一つ目の終了や取消後に二つ目が開始でき、旧runの結果が混ざらない。採用方式の対応環境で確認する。

**目的との関係：** 一つの会話では動くのに、別の会話を開くと端末の負荷が急に増える設計を避けるため。

**外部の確認資料：** [W3C Web Locks API](https://www.w3.org/TR/web-locks/)。具体的な確認内容は次章に記載する。


## 9 品質評価と安全性と実行計画

| 番号 | 項目 | 種類・時期 |
| --- | --- | --- |
| R25 | 他の公開作品と会話データの保存領域を隔離する | 追加・設計前 |
| R26 | 文書内の命令で分析の結論が変えられないかを検証する | 具体化・公開前 |
| R27 | 原文が残ることと、重要な意味が整理に反映されることを別に採点する | 修正・設計前 |
| R28 | 解釈・立場変化・まとめ・確認提案を、それぞれ意味で評価する | 具体化・設計前 |
| R29 | 話し方や話者のラベルだけで判定が偏らないかを比較する | 具体化・公開前 |
| R30 | 利用者が会話をより正確に理解できるかを評価する | 追加・公開前 |
| R31 | 章単位ではなく、個別要件から実装と検証証拠へたどれるようにする | 具体化・設計前 |
| R32 | 最初の試作で何を確認し、何を後で再確認するかを決める | 具体化・設計前 |
| R33 | 実機・評価者・時間を確保し、変更に応じた検証方法を決める | 具体化・設計前 |

### R25 他の公開作品と会話データの保存領域を隔離する

**区分：** 追加。**提案する時期：** 設計前。**対応する段階：** P0・P6。

**現行の記載：** 会話を外部送信しない、ブラウザ内に保存する、GitHub Pagesの配信条件を確認する方針がある。 [要件書21–30行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L21-L30)、[要件書277–293行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L277-L293)、[要件書332–339行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L332-L339)

**不足・曖昧な点：** 同じ公開ホストの別プロジェクトのコードを、会話データと同じ信頼範囲に含めるかが未定義。フォルダ名やデータベース名を分けるだけでは、ブラウザのアクセス隔離にならない。

**追加要件案：** 保存データへアクセスできるサイトの範囲を決める。標準のGitHub PagesのプロジェクトURLを使う場合は、同一ホストの別作品と保存領域を共有する境界になることを確認する。他の作品を同じ信頼範囲に含めない方針なら、専用ホスト名等で隔離する配信構成をP0で選ぶ。フォルダ分けだけを隔離の証拠にしない。

**完了条件：** 公開候補の構成で、別作品からこのツールの保存データを読めないことを検証する。同じホスト全体を信頼する選択なら、その範囲と制約を明示し、独立した隔離があるとは表示しない。

**目的との関係：** 端末内処理という約束を、同じ配信先の別アプリを含めた実際の保存境界に一致させるため。現時点で漏えいが発生したという指摘ではない。

**外部の確認資料：** [GitHub公式 GitHub Pagesの種類と標準URL](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)、[MDN 保存データのアクセスを分ける単位](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy)。具体的な確認内容は次章に記載する。

### R26 文書内の命令で分析の結論が変えられないかを検証する

**区分：** 具体化。**提案する時期：** 公開前。**対応する段階：** P0・P2・P6。

**現行の記載：** 入力内のプロンプトインジェクションを試験し、モデルに外部操作の道具を与えず、外部要求・コード実行を防ぐ方針がある。 [要件書228–230行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L228-L230)、[要件書279–283行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L279-L283)、[要件書311–325行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L311-L325)

**不足・曖昧な点：** 安全ゲートの明示的な成功条件は主に外部要求・実行ゼロであり、本文中の命令による結論・回答対応・合意の書換えをどう測るかが未具体化。

**追加要件案：** 本文中の命令や役割を装う記述は解析対象の発言として扱い、解析規則や出力結果を支配する命令として扱わない。通信やコード実行だけでなく、人物の有利不利、反対意見の削除、合意の捏造等につながる出力の変化を評価する。原文自体は削除しない。

**完了条件：** 悪意ある指示を含む固定ケースで、形式上は正しい根拠IDを使いながら結論を誘導する結果も検出できる。重大な誤断定が出る場合は該当AI機能を合格扱いにせず、未確定や失敗を明示する。

**目的との関係：** このツールでは、外部操作がなくても分析内容を曲げられることが目的に直接影響するため。

**外部の確認資料：** [OWASP 文書中の指示による出力の操作](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)。具体的な確認内容は次章に記載する。

### R27 原文が残ることと、重要な意味が整理に反映されることを別に採点する

**区分：** 修正。**提案する時期：** 設計前。**対応する段階：** P0・P2・P6。

**現行の記載：** G1で原文完全性、G2で重要発言再現率95%以上を求める。再現率の定義には図・一覧・まとめのいずれかから根拠付きでたどれることが含まれる。 [要件書143–150行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L143-L150)、[要件書249–251行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L249-L251)、[要件書317–328行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L317-L328)

**不足・曖昧な点：** 一覧を原文一覧と読めるため、発言を保持するだけで意味上の反映として数える余地がある。重要な条件・反論・撤回が整理から抜けても高得点になり得る定義。

**追加要件案：** 原文への到達性はG1で測り、G2は重要な発言が対応する問い・主張・条件・反論・変化へ意味を保って結びついているかを測る。最終まとめに残るべき内容の保持も別に測る。評価用の一覧が何を指すか明記し、原文にあるだけでは加点しない。

**完了条件：** 重要な条件を図やまとめから意図的に落として、原文一覧だけに残した結果が、意味の反映として不合格になる採点規則を用意する。原文保持、構造への反映、まとめでの保持を別々に報告する。

**目的との関係：** ツールの目的に届かない結果でも評価上は合格できる曖昧さを解消するため。

### R28 解釈・立場変化・まとめ・確認提案を、それぞれ意味で評価する

**区分：** 具体化。**提案する時期：** 設計前。**対応する段階：** P0・P2・P3・P6。

**現行の記載：** 意味評価、重大な捏造の検査、問い・回答・関係・立場の数値指標がある。 [要件書98–141行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L98-L141)、[要件書249–250行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L249-L250)、[要件書305–330行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L305-L330)、[要件書397–415行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L397-L415)

**不足・曖昧な点：** 複数解釈、変化のきっかけ、まとめ、次の確認提案は、独立した採点規則と合格条件が未具体化。全体の平均で未測定機能を見逃す余地がある。

**追加要件案：** 表示する分析機能ごとに、正しい場合、誤り、保留すべき場合を定義する。まとめは条件・対象・時点・異論の保持を、確認提案は未回答・不足情報との対応と、原文にない前提の押しつけがないことを評価する。

**完了条件：** 第7–10章の各表示機能に、固定ケース、必須の失敗例、採点規則、合格条件が対応している。一機能が未測定・不合格なら、他の平均点だけでその機能を合格扱いにしない。

**目的との関係：** 引用が実在するだけで、解釈やまとめまで正しいと判断しないため。

### R29 話し方や話者のラベルだけで判定が偏らないかを比較する

**区分：** 具体化。**提案する時期：** 公開前。**対応する段階：** P0・P2・P6。

**現行の記載：** 話すうまさと内容を分ける方針、日本語の難例、分野の偏り、独立した評価者が定められている。 [要件書13–19行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L13-L19)、[要件書109–117行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L109-L117)、[要件書120–130行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L120-L130)、[要件書309–315行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L309-L315)

**不足・曖昧な点：** 本ツールの中心目的である話し方への公平さを、意味をそろえた比較例で直接検証する要件がない。

**追加要件案：** 人が意味の同等性を確認した会話の組で、話者ラベル、丁寧さ、言いよどみ等を変えた際の回答有無・論点ずれ・根拠不足・立場の判定差を測る。意味が変わる表現変更には同じ結果を要求しない。関連する言い換えを開発用と固定評価用に分けて混入させない。

**完了条件：** 特定の話し方だけに不利な誤判定が増えていないか、会話の組ごとの差分と失敗例を報告する。人物間の判定を一律に同じにする採点にはしない。

**目的との関係：** 話し方に引っ張られず内容を確認するという目的を、測定できる品質条件にするため。

### R30 利用者が会話をより正確に理解できるかを評価する

**区分：** 追加。**提案する時期：** 公開前。**対応する段階：** P0・P3・P6。

**現行の記載：** 抽出精度、根拠の妥当性、操作応答、主要導線を評価する。 [要件書11–19行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L11-L19)、[要件書305–330行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L305-L330)、[要件書404–415行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L404-L415)

**不足・曖昧な点：** 利用者が会話の流れを理解できたか、原文だけの場合より確認が楽になったか、誤分析を直す負担が許容できるかの合格条件がない。

**追加要件案：** 対象利用者が元の問い、変化した発言、残った問い、結論の条件と根拠を見つけ、誤分析を訂正する課題を設ける。原文のみの場合と比較し、正答、所要時間、重大な誤理解、訂正負担を測る。人数・資料数・比較順序・合格値は評価前に決める。

**完了条件：** 介助なしで実施できた結果を残す。初期の合格案は、原文だけの場合より確認精度を落とさず時間を短くし、試験内で重大な誤理解を生まないこととする。この案の数値化と採用はP0で決め、未実測の有用性を達成済みとしない。

**目的との関係：** 機能が動くことと、問いや根拠を理解する助けになることを別々に確認するため。

### R31 章単位ではなく、個別要件から実装と検証証拠へたどれるようにする

**区分：** 具体化。**提案する時期：** 設計前。**対応する段階：** P0以降の全段階。

**現行の記載：** 全18章の要件をP0–P6の試験へ対応付ける表を作ることは、すでにP0の必須事項。 [要件書317–320行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L317-L320)、[要件書367–378行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L367-L378)、[要件書413–415行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L413-L415)、[要件書442–453行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L442-L453)

**不足・曖昧な点：** 表の追跡単位・列・完了判定が未定で、章と段階を結ぶだけの粗い対応でも済ませられる。

**追加要件案：** 要件ごとにIDを付け、目的、必須・条件付き・後続、対象段階、実装箇所、試験ID、合格証拠、対応環境、未達理由を記録する。仕様を変えたら対応表も更新する。各段階の成果物には対象要件と残要件を示す。

**完了条件：** 試験がない必須要件、実機未測定の対応機能、後続へ移した要件を一覧にできる。章全体の完了表示で、個別の未達を隠せない。

**目的との関係：** 多くの要件を並行実装しても、目的と完成条件が途中で抜けないようにするため。

### R32 最初の試作で何を確認し、何を後で再確認するかを決める

**区分：** 具体化。**提案する時期：** 設計前。**対応する段階：** P0・P2・P6。

**現行の記載：** P0は予備測定で本番合格と分ける。配信条件はP0で調査し、公開配備は承認後のP6とする。 [要件書220–230行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L220-L230)、[要件書279–283行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L279-L283)、[要件書338–339行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L338-L339)、[要件書367–378行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L367-L378)、[要件書442–453行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L442-L453)

**不足・曖昧な点：** P0の最小試作と配信検証の範囲が未具体化。モデル単体の結果を分割・全体照合込みの成立性に読み替えたり、配信先でしか分からない点の確認が遅れたりする余地がある。

**追加要件案：** P0で作る最小試作、モデル取得、分割・全体照合の試し方、必要な配信条件、測定項目を明記する。予備測定で確認したこと、実アプリで再確認すること、未確認の配信条件を分け、構成の再検討や中止の条件を残す。必要な検証用配信の範囲は一般公開と区別して具体化する。

**完了条件：** P0の報告に確認範囲と残る不確実性が記載され、採用した構成を後で変える可能性がある条件を把握できる。モデル単体の動作を、完成アプリの性能・公開環境の成功と扱わない。

**目的との関係：** 成立性が分からない部分を残したまま、後続の実装をすべて完成させる手戻りを避けるため。

### R33 実機・評価者・時間を確保し、変更に応じた検証方法を決める

**区分：** 具体化。**提案する時期：** 設計前。**対応する段階：** P0以降の全段階。

**現行の記載：** Mac・Windows・iPhoneの実機、2人の独立評価者、複数候補、長文・反復・メモリ測定、更新時の回帰評価を求める。 [要件書224–229行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L224-L229)、[要件書309–330行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L309-L330)、[要件書336–345行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L336-L345)、[要件書367–378行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L367-L378)、[要件書442–457行](https://github.com/chameleonjp-lab/rontenseiri/blob/29b4161a1d48cea53356efb7e62a2aef210acad0/docs/requirements-and-development-plan.md#L442-L457)

**不足・曖昧な点：** 誰が実機と評価者を確保し、採点・測定・更新時の試験を行うか、必要な工数・継続負担が具体化されていない。

**追加要件案：** 各評価の担当役割、端末へのアクセス方法、資料の許諾と作成、採点と実行に必要な時間、初期・継続費用の負担元を明記する。日常の変更確認、モデル・指示文・抽出方法等の変更時の精度評価、公開前の実機評価を分け、どの変更でどの検査を再実行するかを決める。

**完了条件：** P0に必要な測定手段が確保でき、未確保事項と中止・範囲見直し条件が分かる。必要な検証を省かず、変更と関係のない全モデル・全端末の重い試験を理由なく繰り返す計画にもならない。利用者がPCを購入することを暗黙の前提にしない。

**目的との関係：** 要求水準を落とさず、実際に実施し続けられる開発計画にするため。

## 10 外部仕様を照合して確認した点

### 字幕の時間重複

WebVTTの第4.1節は異なる字幕の時間区間の重複を認め、第1.4節には開始・終了時刻が同じ字幕の例もある。したがって、P1の重複時刻の試験は、一律拒否ではなく正常ケースと異常ケースを分ける必要がある。これはWebVTTについて公式文書で確認した事実であり、SRT全般に同一の規則があると断定するものではない。[W3C WebVTT](https://www.w3.org/TR/webvtt1/)

### 同じ配信先にある別作品との保存領域

ブラウザは、接続方式・ホスト名・ポートの組合せで保存データへのアクセスを区切る。この単位をオリジンという。URLのフォルダ部分だけが異なる場合は同じ単位になる。IndexedDBもこの単位で隔離される。GitHub Pagesの標準プロジェクトURLは同一ownerのホスト配下にリポジトリ名を付ける形式である。そのため標準構成を使う場合は、同じホストの別作品との独立した保存隔離をフォルダ分けだけで保証できない、という設計上の推論になる。計画書では配信先は候補の段階であり、漏えいの発生を確認したものではない。[MDN](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy)、[GitHub公式](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)

### 入力に紛れた命令による出力の操作

文書中の命令がAIの振る舞いや出力を変える問題は、外部操作の禁止だけでは評価しきれない。OWASPは影響として、内容の操作による誤った出力・偏った出力も挙げている。R26は、この問題を本ツールの回答・合意・反対根拠の分析に適用した提案である。攻撃を完全に防げると保証する提案ではない。[OWASP](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)

### タッチ操作と文字を読む画面

WCAG 2.2には、原則としてドラッグを必要としない代替操作を求める2.5.7、操作対象の大きさまたは間隔等を扱う2.5.8、狭い幅での文字の再配置を扱う1.4.10がある。図のように二次元の配置が必要な部分には例外もあるため、図まで一律に横移動不能にすることを求めるものではない。現行案のWCAG方針に、実際のiPhone操作課題を結び付けるのがR21である。[WCAG 2.2](https://www.w3.org/TR/WCAG22/)

### 保存や複数タブも含めた応答性

W3CのLong Tasks API草案は、長時間の処理が入力への応答や描画を妨げる問題を説明している。R23は測定対象を解析以外へ広げる提案であり、この測定APIの採用や全ブラウザ対応を約束するものではない。Web Locksの仕様は、同じ保存境界の複数タブ等で資源の競合を制御する仕組みを扱う。R24でも方式は固定せず、採用環境で実測して決める。[Long Tasks API草案](https://www.w3.org/TR/longtasks-1/)、[Web Locks](https://www.w3.org/TR/web-locks/)

## 11 要件書へ反映する順序の提案

| 順序 | 先に確定する内容 | 関連番号 |
| --- | --- | --- |
| 1 | 対象利用者、記録範囲、正しい整理の合格条件、試作の範囲と実施体制 | R01–R04、R27–R33 |
| 2 | 問い・回答・解釈の単位、変更の扱い、原文との対応、保存・復元の契約 | R05–R19 |
| 3 | 必要な部分だけを処理する方法、資源上限、配信先の保存隔離、出力操作への耐性 | R22–R26 |
| 4 | 図とタッチ操作の具体化、各機能の統合評価 | R20–R21と各項目の完了条件 |

相互に独立した定義の検討は並行してよい。実装順を決めるときは、R31の対応表で依存関係を示す。例えばR15の変更影響を追う仕組みは、R22の安全な部分再解析・再利用の前提になる。R18の限定出力は、R02の範囲表示、R03の資料区分、R16の由来、R19の復元規則と整合させる。

## 12 この段階での判断の限界

この一覧は、公開リポジトリの要件文書に基づく設計レビューである。モデルの日本語品質、速度、メモリ、iPhone Safariでの解析成立性を実証するものではない。数値目標の達成可否は、P0以降の実測がないためわからない。要求水準を満たさない場合の対応は、現行案にある範囲の見直しと未達の明示を維持する。

上記の補足を行えば、何を作り、何をもって完成と判断するかを、実装者・評価者・利用者が同じ条件で確認しやすくなる。音声・動画や外部検索を追加することを、これらの不足の解消策にはしていない。
