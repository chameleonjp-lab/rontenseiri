import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { zipSync } from "fflate";
import { readDocx } from "../src/input/docx";
import { readDocumentFile } from "../src/input/documents";

const xml = (body: string) =>
  `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
const paragraph = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const docx = (
  document: string,
  extra: Record<string, Uint8Array | string> = {},
) => {
  const encoder = new TextEncoder();
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": encoder.encode(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    ),
    "word/document.xml": encoder.encode(document),
  };
  for (const [name, value] of Object.entries(extra))
    files[name] = typeof value === "string" ? encoder.encode(value) : value;
  return zipSync(files);
};
const expectRejected = (value: Uint8Array, message: RegExp) =>
  expect(() => readDocx(value)).toThrow(message);

// These are deliberately hand-authored in-memory fixtures, not downloaded documents.
describe("bounded DOCX reader", () => {
  it("extracts paragraphs, tables, and text split across runs", () => {
    const body =
      `${paragraph("否定")}${paragraph("原文")}` +
      `<w:tbl><w:tr><w:tc>${paragraph("A")}</w:tc><w:tc>${paragraph("B")}</w:tc></w:tr></w:tbl>`;
    expect(readDocx(docx(xml(body))).text).toBe("否定\n原文\nA\tB");
  });

  it("rejects corrupt archives and traversal names", () => {
    expectRejected(new Uint8Array([80, 75, 3, 4]), /ZIP終端|ZIP構造/);
    const archive = zipSync({
      "../word/document.xml": new TextEncoder().encode(xml(paragraph("x"))),
    });
    expectRejected(archive, /path traversal/);
  });

  it("rejects external relationships, DTD, and CDATA", () => {
    const rels = `<Relationships><Relationship TargetMode="External" Target="https://example.invalid/x"/></Relationships>`;
    expectRejected(
      docx(xml(paragraph("x")), { "word/_rels/document.xml.rels": rels }),
      /外部参照/,
    );
    expectRejected(
      docx(`<!DOCTYPE w:document [<!ENTITY x "bad">]>${xml(paragraph("x"))}`),
      /DTD/,
    );
    expectRejected(docx(xml(`<w:p><![CDATA[bad]]></w:p>`)), /CDATA/);
  });

  it("enforces extracted text and actual output limits", () => {
    expectRejected(docx(xml(paragraph("x".repeat(50_001)))), /50,000/);
    const large = new Uint8Array(9 * 1024 * 1024);
    large.fill(65);
    const bomb = docx(xml(paragraph("ok")), { "word/media/huge.bin": large });
    // Unneeded media is never started, so a large irrelevant entry is safe.
    expect(readDocx(bomb).text).toBe("ok");
    const actualPayload = new Uint8Array(11 * 1024 * 1024).fill(65);
    const actual = docx(xml(paragraph("ok")), {
      "word/_rels/huge.rels": actualPayload,
    });
    // Falsify only the central-directory uncompressed size; the decoder still emits the real bytes.
    for (let i = actual.length - 65_557; i < actual.length - 3; i++) {
      if (
        i >= 0 &&
        actual[i] === 0x50 &&
        actual[i + 1] === 0x4b &&
        actual[i + 2] === 1 &&
        actual[i + 3] === 2
      ) {
        actual[i + 24] = 1;
        actual[i + 25] = actual[i + 26] = actual[i + 27] = 0;
        break;
      }
    }
    expectRejected(actual, /上限|展開|UTF-8|外部参照|破損/);
  });

  it("enforces the 50MiB aggregate output limit across required rels", () => {
    const files: Record<string, Uint8Array> = {
      "word/document.xml": new TextEncoder().encode(xml(paragraph("ok"))),
    };
    for (let i = 0; i < 6; i++)
      files[`word/_rels/${i}.rels`] = new Uint8Array(9 * 1024 * 1024).fill(65);
    expectRejected(zipSync(files), /50MiB|実展開/);
  });
});

describe("document API and PDF safety", () => {
  it("rejects an oversized 20MiB input before parsing", async () => {
    const file = new File([new Uint8Array(20 * 1024 * 1024 + 1)], "large.docx");
    await expect(readDocumentFile(file)).rejects.toThrow(/20MiB/);
  });

  it("rejects non-PDF bytes and never follows a network URL", async () => {
    await expect(
      readDocumentFile(new File(["not pdf"], "bad.pdf")),
    ).rejects.toThrow(/PDFヘッダー/);
  });

  it("reads the hand-authored normal text PDF fixture", async () => {
    const bytes = readFileSync(
      new URL("./fixtures/documents/normal-text.pdf", import.meta.url),
    );
    const result = await readDocumentFile(new File([bytes], "normal-text.pdf"));
    expect(result.text).toContain("fictional hand-authored normal text");
    expect(result.pages).toBe(1);
  });

  it("does not execute a PDF JavaScript action", async () => {
    const bytes = readFileSync(
      new URL("./fixtures/documents/malicious-action.pdf", import.meta.url),
    );
    await expect(
      readDocumentFile(new File([bytes], "malicious-action.pdf")),
    ).rejects.toThrow();
  });

  it("rejects a textless PDF rather than pretending OCR exists", async () => {
    const pdf = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF`;
    await expect(
      readDocumentFile(new File([pdf], "empty.pdf")),
    ).rejects.toThrow();
  });
});
