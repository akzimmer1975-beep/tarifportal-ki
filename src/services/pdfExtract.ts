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

type PdfTextItem = {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
  dir?: string;
  fontName?: string;
};

type LineItem = {
  text: string;
  x: number;
  y: number;
  width: number;
  hasEOL: boolean;
};

type ReconstructedLine = {
  y: number;
  text: string;
};

function normalizeInlineText(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([(\[])\s+/g, "$1")
    .replace(/\s+([)\]])/g, "$1")
    .trim();
}

function normalizeBlockText(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\r/g, "")
    .replace(/[ ]*\n[ ]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/-\n(?=[a-zäöü])/g, "")
    .replace(/\b([A-Za-zÄÖÜäöüß]{2,})-\s+([A-Za-zÄÖÜäöüß]{2,})\b/g, "$1$2")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
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

function getItemX(item: PdfTextItem): number {
  if (!Array.isArray(item.transform) || item.transform.length < 6) return 0;
  return Number(item.transform[4] ?? 0);
}

function getItemY(item: PdfTextItem): number {
  if (!Array.isArray(item.transform) || item.transform.length < 6) return 0;
  return Number(item.transform[5] ?? 0);
}

function getItemWidth(item: PdfTextItem): number {
  return Number(item.width ?? 0);
}

function toLineItems(items: PdfTextItem[]): LineItem[] {
  return items
    .map((item) => {
      const rawText = typeof item.str === "string" ? item.str : "";
      const text = rawText.replace(/\u00a0/g, " ").trim();

      return {
        text,
        x: getItemX(item),
        y: getItemY(item),
        width: getItemWidth(item),
        hasEOL: Boolean(item.hasEOL)
      };
    })
    .filter((item) => item.text.length > 0);
}

function clusterItemsToLines(items: LineItem[]): ReconstructedLine[] {
  if (items.length === 0) return [];

  const sorted = [...items].sort((a, b) => {
    const yDiff = Math.abs(b.y - a.y);
    if (yDiff > 1.5) return b.y - a.y;
    return a.x - b.x;
  });

  const lines: Array<{ y: number; items: LineItem[] }> = [];
  const yTolerance = 2.5;

  for (const item of sorted) {
    const existing = lines.find((line) => Math.abs(line.y - item.y) <= yTolerance);

    if (existing) {
      existing.items.push(item);
      existing.y = (existing.y + item.y) / 2;
    } else {
      lines.push({
        y: item.y,
        items: [item]
      });
    }
  }

  return lines
    .map((line) => {
      const sortedItems = [...line.items].sort((a, b) => a.x - b.x);

      let text = "";
      let previous: LineItem | null = null;

      for (const item of sortedItems) {
        if (!previous) {
          text += item.text;
          previous = item;
          continue;
        }

        const prevEndX = previous.x + previous.width;
        const gap = item.x - prevEndX;

        const needsSpace =
          gap > 3 &&
          !text.endsWith("-") &&
          !/^[,.;:!?)]/.test(item.text) &&
          !/[(]$/.test(text);

        if (needsSpace) {
          text += " ";
        }

        text += item.text;
        previous = item;
      }

      return {
        y: line.y,
        text: normalizeInlineText(text)
      };
    })
    .filter((line) => line.text.length > 0)
    .sort((a, b) => b.y - a.y);
}

function isPageFooter(line: string): boolean {
  const text = line.trim();

  return (
    /^Seite\s+\d+\s+von\s+\d+$/i.test(text) ||
    /^-\s*\d+\s*-$/i.test(text) ||
    /^\d+\s*\/\s*\d+$/.test(text)
  );
}

function isSectionHeader(line: string): boolean {
  return /^Abschnitt\s+[IVXLC0-9]+$/i.test(line.trim());
}

function isParagraphHeader(line: string): boolean {
  return /^§\s*\d+[a-zA-Z]*$/.test(line.trim());
}

function isLikelyTitleLine(line: string): boolean {
  const text = line.trim();

  if (!text) return false;
  if (text.length > 120) return false;
  if (/[.:;]$/.test(text)) return false;
  if (/^\(\d+\)/.test(text)) return false;
  if (/^[a-z]\)/.test(text)) return false;
  if (/^[a-z]{2}\)/.test(text)) return false;
  if (/^[a-z]{3}\)/.test(text)) return false;
  if (/^[–-]\s+/.test(text)) return false;
  if (/^§\s*\d+/.test(text)) return false;
  if (/^Abschnitt\s+[IVXLC0-9]+/i.test(text)) return false;

  return true;
}

function shouldStartNewBlock(line: string): boolean {
  const text = line.trim();

  return (
    isParagraphHeader(text) ||
    isSectionHeader(text) ||
    /^\(\d+\)/.test(text) ||
    /^[a-z]\)/.test(text) ||
    /^[a-z]{2}\)/.test(text) ||
    /^[a-z]{3}\)/.test(text) ||
    /^[–-]\s+/.test(text)
  );
}

function linesToBlocks(lines: ReconstructedLine[]): string[] {
  if (lines.length === 0) return [];

  const filteredLines = lines
    .map((line) => ({ ...line, text: line.text.trim() }))
    .filter((line) => line.text.length > 0)
    .filter((line) => !isPageFooter(line.text));

  if (filteredLines.length === 0) return [];

  const blocks: string[] = [];
  let currentBlock: string[] = [];
  let previousY: number | null = null;

  for (let i = 0; i < filteredLines.length; i += 1) {
    const line = filteredLines[i];
    const prevText = currentBlock[currentBlock.length - 1] ?? "";
    const yGap = previousY !== null ? Math.abs(previousY - line.y) : 0;

    const newStructure = shouldStartNewBlock(line.text);

    const shouldBreak =
      currentBlock.length > 0 &&
      (yGap > 16 || (newStructure && yGap > 7));

    if (shouldBreak) {
      blocks.push(normalizeBlockText(currentBlock.join("\n")));
      currentBlock = [line.text];
    } else {
      if (
        currentBlock.length > 0 &&
        prevText.endsWith("-") &&
        /^[a-zäöü]/.test(line.text)
      ) {
        currentBlock[currentBlock.length - 1] =
          prevText.slice(0, -1) + line.text;
      } else {
        currentBlock.push(line.text);
      }
    }

    previousY = line.y;
  }

  if (currentBlock.length > 0) {
    blocks.push(normalizeBlockText(currentBlock.join("\n")));
  }

  return blocks.filter(Boolean);
}

function mergeHeadingBlocks(blocks: string[]): string[] {
  const merged: string[] = [];

  for (let i = 0; i < blocks.length; i += 1) {
    const current = normalizeBlockText(blocks[i]);
    const next = normalizeBlockText(blocks[i + 1] ?? "");

    if (!current) continue;

    if (isParagraphHeader(current) && next && isLikelyTitleLine(next)) {
      const combined = normalizeBlockText(`${current} ${next}`);
      merged.push(combined);
      i += 1;
      continue;
    }

    if (isSectionHeader(current) && next && isLikelyTitleLine(next)) {
      const combined = normalizeBlockText(`${current} ${next}`);
      merged.push(combined);
      i += 1;
      continue;
    }

    merged.push(current);
  }

  return merged;
}

function mergeHeadingWithBody(blocks: string[]): string[] {
  const merged: string[] = [];

  for (let i = 0; i < blocks.length; i += 1) {
    const current = normalizeBlockText(blocks[i]);
    const next = normalizeBlockText(blocks[i + 1] ?? "");

    if (!current) continue;

    const currentIsHeading =
      /^§\s*\d+[a-zA-Z]*(\s+.+)?$/.test(current) ||
      /^Abschnitt\s+[IVXLC0-9]+(\s+.+)?$/i.test(current);

    const nextStartsStructure = shouldStartNewBlock(next);
    const nextLooksBody =
      next.length > 0 &&
      !nextStartsStructure &&
      !isPageFooter(next);

    if (currentIsHeading && nextLooksBody) {
      merged.push(normalizeBlockText(`${current}\n${next}`));
      i += 1;
      continue;
    }

    merged.push(current);
  }

  return merged;
}

function splitLargeBlockByStructure(block: string): string[] {
  const text = normalizeBlockText(block);

  if (!text) return [];

  const markerRegex =
    /(?=^\(\d+\))|(?=^[a-z]\))|(?=^[a-z]{2}\))|(?=^[a-z]{3}\))|(?=^[–-]\s+)/gm;

  const indices = Array.from(text.matchAll(markerRegex))
    .map((match) => match.index ?? 0)
    .filter((value, index, arr) => arr.indexOf(value) === index)
    .sort((a, b) => a - b);

  if (indices.length <= 1) {
    return [text];
  }

  const parts: string[] = [];

  for (let i = 0; i < indices.length; i += 1) {
    const start = indices[i];
    const end = indices[i + 1] ?? text.length;
    const part = normalizeBlockText(text.slice(start, end));

    if (part) {
      parts.push(part);
    }
  }

  return parts.length > 0 ? parts : [text];
}

function buildStructuredParagraphsFromPage(pageText: string): string[] {
  const normalized = normalizeBlockText(pageText);

  if (!normalized) return [];

  const rawLines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isPageFooter(line));

  if (rawLines.length === 0) return [];

  const preliminaryBlocks: string[] = [];
  let current: string[] = [];

  for (const line of rawLines) {
    const startsStructuralUnit = shouldStartNewBlock(line);

    if (startsStructuralUnit && current.length > 0) {
      preliminaryBlocks.push(normalizeBlockText(current.join("\n")));
      current = [line];
    } else {
      if (
        current.length > 0 &&
        current[current.length - 1].endsWith("-") &&
        /^[a-zäöü]/.test(line)
      ) {
        current[current.length - 1] =
          current[current.length - 1].slice(0, -1) + line;
      } else {
        current.push(line);
      }
    }
  }

  if (current.length > 0) {
    preliminaryBlocks.push(normalizeBlockText(current.join("\n")));
  }

  const afterHeadingMerge = mergeHeadingBlocks(preliminaryBlocks);
  const afterBodyMerge = mergeHeadingWithBody(afterHeadingMerge);

  const finalBlocks = afterBodyMerge.flatMap((block) => {
    const isHeading =
      /^§\s*\d+[a-zA-Z]*(\s+.+)?$/.test(block) ||
      /^Abschnitt\s+[IVXLC0-9]+(\s+.+)?$/i.test(block);

    if (isHeading) {
      return [block];
    }

    return splitLargeBlockByStructure(block);
  });

  return finalBlocks
    .map((block) => normalizeBlockText(block))
    .filter((block) => block.length > 0)
    .filter((block) => !isPageFooter(block));
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

  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber);
    const content = await page.getTextContent();

    const textItems = toLineItems(content.items as PdfTextItem[]);
    const lines = clusterItemsToLines(textItems);
    const blocks = linesToBlocks(lines);

    const pageText = normalizeBlockText(blocks.join("\n\n"));
    pages.push(pageText);
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

  for (let p = 0; p < pages.length; p += 1) {
    const pageNumber = p + 1;
    const parts = buildStructuredParagraphsFromPage(pages[p]);

    for (const chunkText of parts) {
      const normalizedChunk = normalizeBlockText(chunkText);

      if (!normalizedChunk) continue;
      if (isPageFooter(normalizedChunk)) continue;

      paragraphs.push({
        documentId,
        itemId,
        pageNumber,
        paragraphIndex,
        chunkText: normalizedChunk
      });

      paragraphIndex += 1;
    }
  }

  const result = await replaceDocumentParagraphs(
    documentId,
    itemId,
    paragraphs
  );

  return result.written;
}