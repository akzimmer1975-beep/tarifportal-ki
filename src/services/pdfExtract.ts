import fs from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { replaceDocumentParagraphs } from "../db.js";

export type ExtractedParagraph = {
  documentId: number;
  itemId: string;
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

/**
 * 🔥 NEU: Tarifstruktur erkennen
 */
function splitTarifStructure(text: string): string[] {
  const normalized = normalizeText(text);

  if (!normalized) return [];

  // 🔑 Strukturmarker im Tarif
  const markers = [
    /\(\d+\)/g,     // (1)
    /[a-z]\)/g,     // a)
    /[a-z]{2}\)/g,  // aa)
    /–/g            // Aufzählung
  ];

  // Marker positionen sammeln
  const positions: number[] = [];

  markers.forEach((regex) => {
    let match;
    while ((match = regex.exec(normalized)) !== null) {
      positions.push(match.index);
    }
  });

  // sortieren
  const sorted = [...new Set(positions)].sort((a, b) => a - b);

  if (sorted.length === 0) {
    return [normalized];
  }

  const parts: string[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i];
    const end = sorted[i + 1] || normalized.length;

    const chunk = normalized.slice(start, end).trim();

    if (chunk.length > 10) {
      parts.push(chunk);
    }
  }

  return parts.length > 0 ? parts : [normalized];
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

    // 🔥 NEU: Tarifstruktur statt Satzsplit
    const parts = splitTarifStructure(pages[p]);

    for (const part of parts) {
      paragraphs.push({
        documentId,
        itemId,
        pageNumber,
        paragraphIndex,
        chunkText: part
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