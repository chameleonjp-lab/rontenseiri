import type { Project, Classification, Relation } from "../domain/types";

/** A deliberately authored fixture, never presented as a model evaluation. */
export function sampleProject(): Project {
  const sourceId = "sample-source";
  const versionId = "sample-source-v1";
  const lines: Array<[string, string, string, Classification]> = [
    ["U01", "Aさん", "週1日の在宅勤務を試してみたいです。", "main"],
    [
      "U03",
      "Cさん",
      "効果はどう測りますか。応答速度と満足度を記録する案があります。",
      "derived",
    ],
    [
      "U07",
      "Bさん",
      "新人の相談対応を、試行の条件として考えたいです。",
      "main",
    ],
    ["U08", "Aさん", "採用や育成の制度全体も考えたいですね。", "drift"],
    ["U09", "Cさん", "育成制度の担当や研修の仕組みはどうしますか。", "drift"],
    [
      "U10",
      "Bさん",
      "在宅勤務の試行の話に戻ると、相談先を決めるなら試せると思います。",
      "main",
    ],
    [
      "U13",
      "Aさん",
      "次に、次回会議の日程を決めます。来月第1金曜はどうですか。",
      "main",
    ],
    [
      "U16",
      "Bさん",
      "日程はそれで合意です。次回会議は来月第1金曜に決めましょう。",
      "main",
    ],
  ];
  const text = lines
    .map(([, speaker, quote]) => `${speaker}：${quote}`)
    .join("\n");
  let cursor = 0;
  const utterances = lines.map(
    ([id, speaker, quote, classification], index) => {
      const start = text.indexOf(quote, cursor);
      const end = start + quote.length;
      cursor = end;
      return {
        id,
        sourceId,
        sourceVersionId: versionId,
        start,
        end,
        quote,
        speaker,
        order: index,
        line: index + 1,
        classification,
        coverage: "mapped" as const,
        important: id === "U07",
      };
    },
  );
  const links: Array<[string, string, Relation["kind"]]> = [
    ["U01", "U07", "main"],
    ["U07", "U10", "main"],
    ["U01", "U03", "derived"],
    ["U03", "U07", "derived"],
    ["U07", "U08", "drift"],
    ["U08", "U09", "drift"],
    ["U09", "U10", "return"],
    ["U10", "U13", "main"],
    ["U13", "U16", "main"],
  ];
  const at = "2026-10-17T12:00:00.000Z";
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    title: "在宅勤務の試行会議（架空サンプル）",
    createdAt: at,
    updatedAt: at,
    extent: "excerpt",
    selectedAgendaId: "議題01",
    saved: false,
    sources: [
      {
        id: sourceId,
        versionId,
        name: "架空の会話.txt",
        text,
        role: "conversation",
        format: "txt",
        createdAt: at,
        warnings: [
          "説明用に選んだ8発言の架空サンプルです。省略した発言番号は元資料の存在を意味しません。",
        ],
        hash: "authored-sample-v1",
      },
    ],
    utterances,
    agendas: [
      {
        id: "議題01",
        title: "週1日の在宅勤務を試すか",
        utteranceIds: ["U01", "U03", "U07", "U08", "U09", "U10"],
        boundary: "candidate",
        decision: "undecided",
        answer: "partial",
        agreement: "unknown",
        verification: "unverified",
        arrival:
          "相談先を決めるなら試せる、という条件付きの意見まで進みました。決定や全員の合意は記録されていません。",
        unresolved: ["新人の相談先を誰にするか", "評価方法と試行後の判断基準"],
        nextAction: "新人の相談先と評価方法の案を用意し、次回確認する。",
        needsReview: false,
      },
      {
        id: "議題02",
        title: "次回会議の日程",
        utteranceIds: ["U13", "U16"],
        boundary: "candidate",
        decision: "decided",
        answer: "present",
        agreement: "explicit",
        verification: "unverified",
        arrival:
          "この抜粋の発言では、来月第1金曜にすることが明示されています。",
        unresolved: ["具体的な開始時刻"],
        nextAction: "開始時刻と参加者の予定を確認する。",
        needsReview: false,
      },
    ],
    relations: links.map(([from, to, kind], index) => ({
      id: `sample-edge-${index}`,
      from,
      to,
      kind,
      evidenceIds: [from, to],
    })),
    revisions: [],
    runs: [
      {
        id: "authored-sample-run",
        at,
        engine: "sample",
        model: "none",
        status: "complete",
        note: "人が作成した架空サンプルです。AI解析の結果や品質評価ではありません。",
      },
    ],
  };
}
