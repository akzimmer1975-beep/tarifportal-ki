import fs from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { replaceDocumentParagraphs } from "../db.js";

export type ExtractedParagraph = {
  pageNumber: number;
  paragraphIndex: number;
  chunkText: string;
};

function normalizeText(text: string) {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitIntoParagraphs(text: string): string[] {
  const normalized = normalizeText(text);

  if (!normalized) return [];

  const parts = normalized
    .split(/\n\s*\n|(?<=[.!?;:])\s+(?=[A-ZÄÖÜ0-9§])/g)
    .map((p) => p.trim())
    .filter(Boolean);

  return parts;
}

function getStandardFontDataUrl() {
  const fontsPath = path.resolve(
    process.cwd(),
    "node_modules",
    "pdfjs-dist",
    "standard_fonts"
  );

  let href = pathToFileURL(fontsPath).href;

  if (!href.endsWith("/")) {
    href += "/";
  }

  return href;
}

export async function extractPdf(pdfPath: string): Promise<string[]> {
  const data = await fs.readFile(pdfPath);

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(data),
    standardFontDataUrl: getStandardFontDataUrl(),
    useSystemFonts: true,
    isEvalSupported: false,
    verbosity: 0
  });

  const doc = await loadingTask.promise;
  const pages: string[] = [];

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();

    const text = content.items
      .map((item: any) => ("str" in item ? item.str : ""))
      .join(" ");

    pages.push(normalizeText(text));
  }

  return pages;
}

export async function saveParagraphs(
  documentId: number,
  itemId: string,
  pages: string[]
) {
  const paragraphs: ExtractedParagraph[] = [];
  let paragraphIndex = 1;

  for (let p = 0; p < pages.length; p++) {
    const pageNumber = p + 1;
    const split = splitIntoParagraphs(pages[p]);

    for (const chunkText of split) {
      paragraphs.push({
        pageNumber,
        paragraphIndex,
        chunkText
      });

      paragraphIndex++;
    }
  }

  const result = await replaceDocumentParagraphs(
    documentId,
    itemId,
    paragraphs
  );

  return result.written;
}