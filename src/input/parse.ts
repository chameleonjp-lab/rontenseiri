import type {
  InputItem,
  ParseResult,
  Source,
  SourceRole,
  Utterance,
} from "../domain/types";

export const LIMITS = {
  maxFiles: 10,
  maxInputBytes: 30 * 1024 * 1024,
  maxTextCodePoints: 50_000,
  maxUtterances: 5_000,
  maxTextFileBytes: 2 * 1024 * 1024,
} as const;
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const ext = (name: string) =>
  name.includes(".") ? (name.split(".").pop() || "").toLowerCase() : "";
const cpLength = (text: string) => {
  let count = 0;
  for (const _ of text) {
    count++;
    if (count > LIMITS.maxTextCodePoints) break;
  }
  return count;
};
function hashText(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++)
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return `fnv1a-${(h >>> 0).toString(16).padStart(8, "0")}`;
}
function timestamp(value: string): number | undefined {
  const m = value.match(/^(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})$/);
  if (
    !m ||
    Number(m[2]) >= 60 ||
    Number(m[3]) >= 60 ||
    !Number.isFinite(Number(m[1] || 0))
  )
    return undefined;
  const result =
    (Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000 +
    Number(m[4]);
  return Number.isFinite(result) ? result : undefined;
}
type Cue = {
  start: number;
  end: number;
  quote: string;
  line: number;
  time?: string;
};
function lineRecords(text: string) {
  const out: Array<{ text: string; start: number; end: number; line: number }> =
    [];
  const re = /([^\r\n]*)(\r\n|\n|\r|$)/g;
  let m: RegExpExecArray | null;
  let line = 1;
  while ((m = re.exec(text))) {
    if (m[0] === "") break;
    out.push({
      text: m[1],
      start: m.index,
      end: m.index + m[1].length,
      line: line++,
    });
    if (m.index + m[0].length >= text.length) break;
  }
  return out;
}
function cues(text: string, format: string): Cue[] {
  const lines = lineRecords(text);
  const out: Cue[] = [];
  if (format !== "srt" && format !== "vtt")
    return lines
      .filter((x) => x.text.trim())
      .map((x) => ({
        start: x.start,
        end: x.end,
        quote: x.text,
        line: x.line,
      }));
  const re =
    /^\s*((?:(?:\d+):)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*((?:(?:\d+):)?\d{2}:\d{2}[.,]\d{3})(?:\s+.*)?$/;
  let i =
    format === "vtt" && /^\uFEFF?WEBVTT(?:\s|$)/.test(lines[0]?.text || "")
      ? 1
      : 0;
  while (i < lines.length) {
    const line = lines[i];
    const match = line.text.match(re);
    if (!match) {
      if (line.text.includes("-->"))
        throw Error(`${format.toUpperCase()}の時刻形式が不正です`);
      i++;
      continue;
    }
    const begin = timestamp(match[1]);
    const finish = timestamp(match[2]);
    if (begin === undefined || finish === undefined || finish < begin)
      throw Error(`${format.toUpperCase()}の時刻範囲が不正です`);
    const time = `${match[1]} --> ${match[2]}`;
    i++;
    const endIndex = lines.slice(i).findIndex((x) => x.text.trim() === "");
    const body = endIndex < 0 ? lines.slice(i) : lines.slice(i, i + endIndex);
    if (!body.length || body.every((x) => !x.text.trim()))
      throw Error(`${format.toUpperCase()}に空字幕があります`);
    if (body.some((x) => x.text.includes("-->")))
      throw Error(`${format.toUpperCase()}の字幕区切りに空行が必要です`);
    const start = body[0].start;
    const end = body[body.length - 1].end;
    out.push({
      start,
      end,
      quote: text.slice(start, end),
      line: body[0].line,
      time,
    });
    i += endIndex < 0 ? lines.length : endIndex + 1;
  }
  if (!out.length)
    throw Error(`${format.toUpperCase()}の字幕キューが見つかりません`);
  return out;
}
export async function parseInputs(items: InputItem[]): Promise<ParseResult> {
  if (!Array.isArray(items) || !items.length) throw Error("入力がありません");
  if (items.length > LIMITS.maxFiles)
    throw Error(`入力は${LIMITS.maxFiles}ファイルまでです`);
  let bytes = 0;
  const names = new Set<string>();
  // Size the whole envelope before any format parsing or character allocation.
  for (const item of items) {
    if (
      !item ||
      typeof item.text !== "string" ||
      typeof item.name !== "string" ||
      !item.name ||
      typeof item.format !== "string" ||
      !["conversation", "reference", "later-explanation"].includes(item.role) ||
      names.has(item.name)
    )
      throw Error("入力項目が不正、または同じファイル名が重複しています");
    names.add(item.name);
    bytes += new TextEncoder().encode(item.text).byteLength;
    if (bytes > LIMITS.maxInputBytes) throw Error("入力合計30MiB超過");
  }
  let characters = 0;
  for (const item of items) {
    characters += cpLength(item.text);
    if (characters > LIMITS.maxTextCodePoints)
      throw Error("入力合計の文字数上限（50,000文字）を超えています");
  }
  const sources: Source[] = [];
  const utterances: Utterance[] = [];
  const warnings: string[] = [];
  for (const [index, item] of items.entries()) {
    const format = ext(item.name) || item.format.toLowerCase();
    if (!["txt", "md", "srt", "vtt", "text", "markdown"].includes(format))
      throw Error(`${item.name}: 未対応形式です（TXT/MD/SRT/VTTのみ）`);
    const id = `source-${crypto.randomUUID()}`;
    const versionId = `${id}-v1`;
    sources.push({
      id,
      versionId,
      name: item.name,
      text: item.text,
      role: item.role,
      format,
      createdAt: new Date().toISOString(),
      warnings: [],
      hash: hashText(item.text),
    });
    const parsed = cues(
      item.text,
      format === "text" || format === "markdown" ? "txt" : format,
    );
    for (const cue of parsed) {
      const order = utterances.length;
      utterances.push({
        id: `U${String(order + 1).padStart(2, "0")}`,
        sourceId: id,
        sourceVersionId: versionId,
        start: cue.start,
        end: cue.end,
        quote: cue.quote,
        speaker: `資料${index + 1}：話者不明`,
        order,
        line: cue.line,
        time: cue.time,
        classification: "unknown",
        coverage: "unorganized",
        important: false,
      });
      if (utterances.length > LIMITS.maxUtterances)
        throw Error(`発言数上限(${LIMITS.maxUtterances})超過`);
    }
    if (format === "md" || format === "markdown")
      warnings.push(
        `${item.name}: Markdownは実行せずプレーンテキストとして扱いました`,
      );
  }
  return { sources, utterances, warnings };
}
export async function readInputFile(
  file: File,
  role: SourceRole,
): Promise<InputItem> {
  const format = ext(file.name);
  if (!["txt", "md", "srt", "vtt"].includes(format))
    throw Error(`${file.name}: UTF-8のTXT/MD/SRT/VTTのみ対応しています`);
  if (file.size > LIMITS.maxTextFileBytes)
    throw Error(`${file.name}: 1ファイル2MiBの上限を超えています`);
  let text: string;
  try {
    text = decoder.decode(await file.arrayBuffer());
  } catch {
    throw Error(`${file.name}: UTF-8として読めません。UTF-8へ変換してください`);
  }
  if (cpLength(text) > LIMITS.maxTextCodePoints)
    throw Error(`${file.name}: 文字数上限を超えています`);
  return { name: file.name, text, format, role };
}
