import { Unzip, UnzipInflate, UnzipPassThrough } from "fflate";
import {
  DOMParser,
  type Document,
  type Element,
  type Node,
} from "@xmldom/xmldom";
import type { DocumentReadResult } from "./documents";

const MAX_UNPACKED = 50 * 1024 * 1024;
const MAX_ENTRY = 10 * 1024 * 1024;
const MAX_ENTRIES = 2_000;
const MAX_CODE_POINTS = 50_000;
const TIME_LIMIT_MS = 10_000;
const decoder = new TextDecoder("utf-8", { fatal: true });
const cpLength = (value: string) => [...value].length;
const fail = (message: string): never => {
  throw new Error(`DOCX: ${message}`);
};

function u16(bytes: Uint8Array, at: number) {
  return bytes[at] | (bytes[at + 1] << 8);
}
function u32(bytes: Uint8Array, at: number) {
  return (
    (bytes[at] |
      (bytes[at + 1] << 8) |
      (bytes[at + 2] << 16) |
      (bytes[at + 3] << 24)) >>>
    0
  );
}
function findEnd(bytes: Uint8Array): number {
  for (
    let at = bytes.length - 22;
    at >= Math.max(0, bytes.length - 65_557);
    at--
  )
    if (u32(bytes, at) === 0x06054b50) return at;
  return fail("ZIP終端が見つかりません");
}
function safeEntries(bytes: Uint8Array) {
  const end = findEnd(bytes);
  const count = u16(bytes, end + 10);
  const directorySize = u32(bytes, end + 12);
  const directoryOffset = u32(bytes, end + 16);
  if (
    count === 0xffff ||
    directorySize === 0xffffffff ||
    directoryOffset === 0xffffffff
  )
    fail("ZIP64は非対応です");
  if (
    count < 1 ||
    count > MAX_ENTRIES ||
    directoryOffset + directorySize > bytes.length
  )
    fail("ZIP構造が不正です");
  const entries: Array<{
    name: string;
    compressed: number;
    uncompressed: number;
    method: number;
    offset: number;
  }> = [];
  let at = directoryOffset;
  let total = 0;
  for (let index = 0; index < count; index++) {
    if (u32(bytes, at) !== 0x02014b50) fail("ZIP中央ディレクトリが不正です");
    const flags = u16(bytes, at + 8);
    const method = u16(bytes, at + 10);
    const compressed = u32(bytes, at + 20);
    const uncompressed = u32(bytes, at + 24);
    const nameLength = u16(bytes, at + 28);
    const extraLength = u16(bytes, at + 30);
    const commentLength = u16(bytes, at + 32);
    const localOffset = u32(bytes, at + 42);
    if (flags & 1) fail("暗号化ZIPは非対応です");
    if (method !== 0 && method !== 8) fail("非対応のZIP圧縮方式です");
    if (
      compressed === 0xffffffff ||
      uncompressed === 0xffffffff ||
      localOffset === 0xffffffff
    )
      fail("ZIP64は非対応です");
    const nameBytes = bytes.subarray(at + 46, at + 46 + nameLength);
    let name = "";
    try {
      name = new TextDecoder("utf-8", { fatal: true }).decode(nameBytes);
    } catch {
      fail("ファイル名がUTF-8ではありません");
    }
    if (
      !name ||
      name.startsWith("/") ||
      /^[A-Za-z]:/.test(name) ||
      name.split("/").some((part) => part === "..")
    )
      fail("path traversalを含むZIPです");
    if (name.endsWith("/")) {
      at += 46 + nameLength + extraLength + commentLength;
      continue;
    }
    if (uncompressed > MAX_ENTRY) fail("1エントリ10MiBの上限を超えています");
    total += uncompressed;
    if (total > MAX_UNPACKED)
      fail("ZIP合計展開サイズ50MiBの上限を超えています（zip bombの疑い）");
    // A ZIP64 extra field is rejected even when the legacy fields happen to fit.
    let extraAt = at + 46 + nameLength;
    const extraEnd = extraAt + extraLength;
    while (extraAt + 4 <= extraEnd) {
      const id = u16(bytes, extraAt);
      const size = u16(bytes, extraAt + 2);
      if (id === 1) fail("ZIP64は非対応です");
      extraAt += 4 + size;
    }
    entries.push({
      name,
      compressed,
      uncompressed,
      method,
      offset: localOffset,
    });
    at += 46 + nameLength + extraLength + commentLength;
  }
  if (at > directoryOffset + directorySize)
    fail("ZIP中央ディレクトリ長が不正です");
  return entries;
}
function children(element: Node, localName: string) {
  const result: Element[] = [];
  for (let child = element.firstChild; child; child = child.nextSibling)
    if (child.nodeType === 1 && (child as Element).localName === localName)
      result.push(child as Element);
  return result;
}
function collectText(node: Node): string {
  let output = "";
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 3 || child.nodeType === 4)
      output += child.nodeValue || "";
    else if (child.nodeType === 1) {
      const name = (child as Element).localName;
      if (name === "tab") output += "\t";
      else if (name === "br" || name === "cr") output += "\n";
      else output += collectText(child);
    }
  }
  return output;
}
function extract(document: Document) {
  const body = document.getElementsByTagNameNS(
    "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "body",
  )[0];
  if (!body) fail("本文が見つかりません");
  const paragraphs: string[] = [];
  for (let child = body.firstChild; child; child = child.nextSibling) {
    if (child.nodeType !== 1) continue;
    const name = (child as Element).localName;
    if (name === "p")
      paragraphs.push(
        collectText(child)
          .replace(/[ \t]+/g, " ")
          .trim(),
      );
    else if (name === "tbl") {
      for (const row of children(child, "tr")) {
        const cells = children(row, "tc").map((cell) =>
          collectText(cell)
            .replace(/[ \t\n]+/g, " ")
            .trim(),
        );
        paragraphs.push(cells.join("\t"));
      }
    }
  }
  return paragraphs.filter((paragraph) => paragraph.length > 0).join("\n");
}

export function readDocx(
  bytes: Uint8Array,
  started = Date.now(),
): DocumentReadResult {
  if (Date.now() - started > TIME_LIMIT_MS)
    fail("読み取り時間上限を超えました");
  if (bytes.length < 4 || u32(bytes, 0) !== 0x04034b50)
    fail("DOCX ZIPヘッダーが不正です");
  const entries = safeEntries(bytes);
  const wanted = new Set(
    entries
      .filter(
        (entry) =>
          entry.name === "word/document.xml" || entry.name.endsWith(".rels"),
      )
      .map((entry) => entry.name),
  );
  if (!wanted.has("word/document.xml")) fail("本文XMLがありません");
  const extracted = new Map<string, Uint8Array>();
  let totalOutput = 0;
  let activeName = "";
  let activeChunks: Uint8Array[] = [];
  let activeOutput = 0;
  const unzip = new Unzip((file) => {
    // Do not call start() for media, settings, styles, or any other unneeded entry.
    if (!wanted.has(file.name)) return;
    activeName = file.name;
    activeChunks = [];
    activeOutput = 0;
    file.ondata = (error, chunk, final) => {
      if (error) fail("ZIPが破損しているか展開できません");
      activeOutput += chunk.length;
      totalOutput += chunk.length;
      // These are actual bytes emitted by the decoder, not central-directory metadata.
      if (activeOutput > MAX_ENTRY)
        fail("1エントリ10MiBの実展開上限を超えています");
      if (totalOutput > MAX_UNPACKED)
        fail("ZIP合計の実展開上限50MiBを超えています（zip bombの疑い）");
      activeChunks.push(chunk);
      if (final) {
        const value = new Uint8Array(activeOutput);
        let at = 0;
        for (const part of activeChunks) {
          value.set(part, at);
          at += part.length;
        }
        extracted.set(activeName, value);
        activeName = "";
        activeChunks = [];
      }
    };
    try {
      file.start();
    } catch {
      fail("ZIPが破損しているか展開できません");
    }
  });
  unzip.register(UnzipPassThrough);
  unzip.register(UnzipInflate);
  try {
    unzip.push(bytes, true);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("DOCX:"))
      throw error;
    fail("ZIPが破損しているか展開できません");
  }
  const documentBytes = extracted.get("word/document.xml");
  if (!documentBytes) fail("本文XMLがありません");
  for (const [name, value] of extracted) {
    if (!name.endsWith(".rels")) continue;
    let rels = "";
    try {
      rels = decoder.decode(value);
    } catch {
      fail("関連ファイルがUTF-8ではありません");
    }
    if (
      /<Relationship\b[^>]*(?:TargetMode\s*=\s*["']External|Target\s*=\s*["'][^"']*(?:https?:|file:|\\\\))/i.test(
        rels,
      )
    )
      fail("外部参照を含むDOCXです");
  }
  let xml = "";
  try {
    xml = decoder.decode(documentBytes);
  } catch {
    fail("本文XMLがUTF-8ではありません");
  }
  if (/<!(?:DOCTYPE|ENTITY)\b/i.test(xml) || /<!\[CDATA\[/i.test(xml))
    fail("DTD/entity/CDATAは非対応です");
  const parsed = new DOMParser().parseFromString(xml, "text/xml");
  if (!parsed || parsed.getElementsByTagName("parsererror").length)
    fail("本文XMLが破損しています");
  const text = extract(parsed);
  if (!text.trim()) fail("本文に抽出可能なテキストがありません");
  if (cpLength(text) > MAX_CODE_POINTS)
    fail("抽出結果の文字数上限（50,000文字）を超えています");
  if (Date.now() - started > TIME_LIMIT_MS)
    fail("読み取り時間上限を超えました");
  const warnings = [
    "DOCXは本文の段落・表だけを抽出しました。見出し、脚注、脚部、コメント等の未抽出範囲を含む完全抽出は保証しません",
  ];
  return { text, warnings, format: "docx" };
}
