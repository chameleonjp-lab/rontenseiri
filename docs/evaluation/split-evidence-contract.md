# 発言分割時の根拠を失わないための契約

旧実装では、回答と根拠が分割前の発言を参照していると、その参照を左片に寄せ、回答の`fulfilled`を残していた。根拠が両片をまたぐ場合や右片にある場合でも、成立を過大に示すことになる。この挙動は旧HEADの単体試験で再現した。

## 左・右・両方・未確定を区別する

分割時、問い版・回答・根拠・意味項目のそれぞれに移し先を指定できる。APIでは`SplitUtteranceOptions.reasoningDestinations[recordId]`に`left`、`right`、`both`、`unresolved`を指定し、UIにも同じ4つの選択肢を出す。

既定は`unresolved`で、両片のIDを保存して原根拠を失わず、noteと系譜台帳に未確定であることを記録する。単に`both`を確認した場合とは区別する。元のevidence ID・source ID・原文は変えない。根拠範囲が未確定なら、以前のconfirmed根拠をuncertainにする。

分割で直接参照が変わる回答、または影響する根拠に依存する回答は、従来の`fulfilled`を`unassessed`へ戻す。`evidenceIds:[]`の直接回答も例外にしない。左右の移し先を確認する操作は、回答が問いを満たすかどうかの再認定とは別であり、明示選択だけでfulfilledへ戻さない。

分割と無関係な根拠・問い・回答は変更しない。統合は単一の新IDへの移送であり、分割の左右未確定という注記を付けない。

## 保存・復元・Undo

移送先と状態は既存のProject・reasoning・lineage形式で保存する。完全JSONはこれらとUndo用の旧スナップショットを保持する。限定JSONへは高度な推論・系譜・履歴を持ち出さない。

後から系譜の移送先を確認するときも、選択したIDをそのまま適用する。「未確定」へ戻すときは生存する全候補を保持し、一片だけを残して両片保持と表示しない。衝突と未確定は別状態である。Undoは根拠・回答・原文参照を元の状態に戻し、取り消した経緯も残す。

回帰試験は`tests/split-response-evidence.test.ts`、`tests/split-transfer-locality.test.ts`と`e2e/split-evidence.spec.ts`。この手動整理の正しさを、実AIの推論品質やG5全体の合格とは呼ばない。
