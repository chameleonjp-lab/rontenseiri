import { readDocx } from "./docx";

export type DocumentFormat = "pdf" | "docx";
export type DocumentReadResult = {
  text: string;
  warnings: string[];
  format: DocumentFormat;
  pages?: number;
};

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_PAGES = 200;
const MAX_CODE_POINTS = 50_000;
const TIME_LIMIT_MS = 10_000;
const cpLength = (value: string) => [...value].length;
const formatOf = (name: string): DocumentFormat | undefined => {
  const extension = name.toLowerCase().split(".").pop();
  return extension === "pdf" || extension === "docx" ? extension : undefined;
};

export async function readDocumentFile(
  file: File,
): Promise<DocumentReadResult> {
  const format = formatOf(file.name);
  if (!format) throw new Error(`${file.name}: PDF/DOCXのみ対応しています`);
  if (file.size > MAX_BYTES)
    throw new Error(`${file.name}: 20MiBの上限を超えています`);
  const started = Date.now();
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (Date.now() - started > TIME_LIMIT_MS)
    throw new Error(`${file.name}: 読み取り時間上限を超えました`);
  if (format === "pdf") return readPdf(bytes, started);
  return readDocx(bytes, started);
}

async function readPdf(
  bytes: Uint8Array,
  started: number,
): Promise<DocumentReadResult> {
  if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-")
    throw new Error("PDFヘッダーが不正です");
  // PDF.js 6 has no supported disableWorker option. Node uses its local legacy build;
  // browser PDF parsing remains explicitly unsupported until a bundled local worker is wired.
  if (typeof window !== "undefined")
    throw new Error("ブラウザのPDF読み取りはローカルWorker検証後に対応します");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loading = pdfjs.getDocument({
    data: bytes,
    disableAutoFetch: true,
    disableStream: true,
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: true,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  });
  try {
    const document = await loading.promise;
    if (document.numPages < 1 || document.numPages > MAX_PAGES)
      throw new Error("PDFのページ数上限（200ページ）を超えています");
    const chunks: string[] = [];
    const warnings: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      if (Date.now() - started > TIME_LIMIT_MS)
        throw new Error("PDF読み取り時間上限を超えました");
      const page = await document.getPage(pageNumber);
      const operators = await page.getOperatorList();
      const imageOps = new Set<number>([
        pdfjs.OPS.paintImageMaskXObject,
        pdfjs.OPS.paintImageMaskXObjectRepeat,
        pdfjs.OPS.paintImageXObject,
        pdfjs.OPS.paintInlineImageXObject,
        pdfjs.OPS.paintSolidColorImageMask,
      ]);
      if (operators.fnArray.some((operation) => imageOps.has(operation))) {
        throw new Error(
          `PDF ${pageNumber}ページ: 画像PDFは扱えません（OCRなし）`,
        );
      }
      const content = await page.getTextContent({
        includeMarkedContent: false,
      });
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/[ \t]+/g, " ")
        .trim();
      if (!text)
        throw new Error(
          `PDF ${pageNumber}ページ: テキストがありません（OCRなし）`,
        );
      chunks.push(text);
      if (cpLength(chunks.join("\n")) > MAX_CODE_POINTS)
        throw new Error("PDF抽出結果の文字数上限（50,000文字）を超えています");
    }
    const text = chunks.join("\n\n");
    if (!text.trim()) throw new Error("PDFに抽出可能なテキストがありません");
    warnings.push(
      "PDFはテキスト層のみ抽出しました。読順、注釈、フォーム、埋込み画像、外部フォント等の完全抽出は保証しません",
    );
    return { text, warnings, format: "pdf", pages: document.numPages };
  } finally {
    await loading.destroy();
  }
}
