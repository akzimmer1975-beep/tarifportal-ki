import { Router, type Request, type Response } from "express";
import { asyncHandler } from "../lib/asyncHandler.js";
import {
  getDocumentByItemId,
  getDocuments,
  getDocumentsMeta,
  pool
} from "../db.js";

const router = Router();

type ParagraphRow = {
  id: number;
  page_number: number | null;
  paragraph_index: number | null;
  chunk_text: string;
};

type ApiParagraphSection = {
  id: string;
  label: string;
  text: string;
  level: number;
  start_offset: number;
  end_offset: number;
};

type ApiParagraph = {
  page_number: number | null;
  paragraph_index: number | null;
  title: string | null;
  full_text: string;
  sections: ApiParagraphSection[];
};

type WorkingBlock = {
  page_number: number | null;
  paragraph_index: number | null;
  title: string | null;
  lines: string[];
};

function normalizeWhitespace(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[ \u00A0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeLine(value: string | null | undefined): string {
  return normalizeWhitespace(value).replace(/\n+/g, " ").trim();
}

function isSectionHeader(line: string): boolean {
  return /^Abschnitt\s+[IVXLC0-9]+(?:\s+.+)?$/i.test(line.trim());
}

function isParagraphHeader(line: string): boolean {
  return /^§\s*\d+[a-zA-Z]*(?:\s+.+)?$/.test(line.trim());
}

function isPureParagraphHeader(line: string): boolean {
  return /^§\s*\d+[a-zA-Z]*$/.test(line.trim());
}

function isPureSectionHeader(line: string): boolean {
  return /^Abschnitt\s+[IVXLC0-9]+$/i.test(line.trim());
}

function isLikelyTitleLine(line: string): boolean {
  const text = line.trim();

  if (!text) return false;
  if (text.length > 140) return false;
  if (/[.;:]$/.test(text)) return false;
  if (/^\(\d+\)/.test(text)) return false;
  if (/^[a-z]\)/.test(text)) return false;
  if (/^[a-z]{2}\)/.test(text)) return false;
  if (/^[a-z]{3}\)/.test(text)) return false;
  if (/^[–-]\s+/.test(text)) return false;
  if (isParagraphHeader(text)) return false;
  if (isSectionHeader(text)) return false;

  return true;
}

function startsStructuralUnit(line: string): boolean {
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

function getSectionLevel(label: string): number {
  if (/^\(\d+\)$/.test(label)) return 1;
  if (/^[a-z]\)$/.test(label)) return 2;
  if (/^[a-z]{2}\)$/.test(label)) return 3;
  if (/^[a-z]{3}\)$/.test(label)) return 4;
  if (/^[–-]$/.test(label)) return 5;
  return 9;
}

function splitChunkToLines(chunk: string): string[] {
  return normalizeWhitespace(chunk)
    .split("\n")
    .map((line) => normalizeLine(line))
    .filter(Boolean);
}

function mergeHeaderLines(lines: string[]): string[] {
  const result: string[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const current = lines[i];
    const next = lines[i + 1] ?? "";

    if (isPureParagraphHeader(current) && next && isLikelyTitleLine(next)) {
      result.push(`${current} ${next}`.trim());
      i += 1;
      continue;
    }

    if (isPureSectionHeader(current) && next && isLikelyTitleLine(next)) {
      result.push(`${current} ${next}`.trim());
      i += 1;
      continue;
    }

    result.push(current);
  }

  return result;
}

function extractStructuredSections(fullText: string): ApiParagraphSection[] {
  const text = normalizeWhitespace(fullText);

  if (!text) return [];

  const markerRegex =
    /(^|\n)(\(\d+\)|[a-z]\)|[a-z]{2}\)|[a-z]{3}\)|[–-])(?=\s)/gm;

  const matches = Array.from(text.matchAll(markerRegex));

  if (matches.length === 0) {
    return [];
  }

  const sections: ApiParagraphSection[] = [];

  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    const label = match[2];
    const rawIndex = match.index ?? 0;
    const labelStart = rawIndex + match[0].lastIndexOf(label);
    const nextMatch = matches[i + 1];
    const sectionEnd = nextMatch ? (nextMatch.index ?? text.length) : text.length;
    const sectionText = text.slice(labelStart, sectionEnd).trim();

    if (!sectionText) continue;

    sections.push({
      id: `${label}-${i + 1}`,
      label,
      text: sectionText,
      level: getSectionLevel(label),
      start_offset: labelStart,
      end_offset: sectionEnd
    });
  }

  return sections;
}

function buildTariffBlocks(rows: ParagraphRow[]): ApiParagraph[] {
  const blocks: WorkingBlock[] = [];
  let currentBlock: WorkingBlock | null = null;

  function flushCurrentBlock() {
    if (!currentBlock) return;

    const mergedLines = mergeHeaderLines(currentBlock.lines);
    const fullText = normalizeWhitespace(mergedLines.join("\n"));

    if (!fullText) {
      currentBlock = null;
      return;
    }

    const title =
      currentBlock.title ??
      (isParagraphHeader(mergedLines[0] ?? "")
        ? mergedLines[0]
        : isSectionHeader(mergedLines[0] ?? "")
          ? mergedLines[0]
          : null);

    blocks.push({
      page_number: currentBlock.page_number,
      paragraph_index: currentBlock.paragraph_index,
      title,
      lines: mergedLines
    });

    currentBlock = null;
  }

  for (const row of rows) {
    const lines = splitChunkToLines(row.chunk_text);

    if (lines.length === 0) {
      continue;
    }

    const mergedLines = mergeHeaderLines(lines);
    const firstLine = mergedLines[0] ?? "";
    const firstLineStartsStructure = startsStructuralUnit(firstLine);
    const firstLineIsHeader = isParagraphHeader(firstLine) || isSectionHeader(firstLine);

    if (!currentBlock) {
      currentBlock = {
        page_number: row.page_number,
        paragraph_index: row.paragraph_index,
        title: firstLineIsHeader ? firstLine : null,
        lines: [...mergedLines]
      };
      continue;
    }

    const currentStartsWithHeader =
      currentBlock.lines.length > 0 &&
      (isParagraphHeader(currentBlock.lines[0]) || isSectionHeader(currentBlock.lines[0]));

    const shouldStartNewBlock =
      firstLineIsHeader ||
      (firstLineStartsStructure && !currentStartsWithHeader) ||
      (firstLineStartsStructure &&
        currentBlock.lines.length > 0 &&
        /[.;:]$/.test(currentBlock.lines[currentBlock.lines.length - 1] ?? ""));

    if (shouldStartNewBlock) {
      flushCurrentBlock();

      currentBlock = {
        page_number: row.page_number,
        paragraph_index: row.paragraph_index,
        title: firstLineIsHeader ? firstLine : null,
        lines: [...mergedLines]
      };

      continue;
    }

    currentBlock.lines.push(...mergedLines);
  }

  flushCurrentBlock();

  const mergedBlocks: ApiParagraph[] = [];
  let pendingSectionHeader: WorkingBlock | null = null;

  for (const block of blocks) {
    const fullText = normalizeWhitespace(block.lines.join("\n"));
    const title = block.title ?? null;

    if (!fullText) continue;

    const blockIsSectionHeader =
      title !== null &&
      isSectionHeader(title) &&
      block.lines.length <= 2 &&
      !extractStructuredSections(fullText).length;

    const blockIsParagraphHeader =
      title !== null && isParagraphHeader(title);

    if (blockIsSectionHeader) {
      pendingSectionHeader = block;
      continue;
    }

    if (pendingSectionHeader && blockIsParagraphHeader) {
      const combinedLines = [...pendingSectionHeader.lines, ...block.lines];
      const combinedFullText = normalizeWhitespace(combinedLines.join("\n"));

      mergedBlocks.push({
        page_number: pendingSectionHeader.page_number ?? block.page_number,
        paragraph_index: pendingSectionHeader.paragraph_index ?? block.paragraph_index,
        title: normalizeLine(
          `${pendingSectionHeader.title ?? ""} ${block.title ?? ""}`.trim()
        ),
        full_text: combinedFullText,
        sections: extractStructuredSections(combinedFullText)
      });

      pendingSectionHeader = null;
      continue;
    }

    if (pendingSectionHeader) {
      const pendingFullText = normalizeWhitespace(pendingSectionHeader.lines.join("\n"));
      mergedBlocks.push({
        page_number: pendingSectionHeader.page_number,
        paragraph_index: pendingSectionHeader.paragraph_index,
        title: pendingSectionHeader.title,
        full_text: pendingFullText,
        sections: extractStructuredSections(pendingFullText)
      });
      pendingSectionHeader = null;
    }

    mergedBlocks.push({
      page_number: block.page_number,
      paragraph_index: block.paragraph_index,
      title,
      full_text: fullText,
      sections: extractStructuredSections(fullText)
    });
  }

  if (pendingSectionHeader) {
    const pendingFullText = normalizeWhitespace(pendingSectionHeader.lines.join("\n"));
    mergedBlocks.push({
      page_number: pendingSectionHeader.page_number,
      paragraph_index: pendingSectionHeader.paragraph_index,
      title: pendingSectionHeader.title,
      full_text: pendingFullText,
      sections: extractStructuredSections(pendingFullText)
    });
  }

  return mergedBlocks.filter((block) => block.full_text.trim().length > 0);
}

router.get(
  "/meta",
  asyncHandler(async (_req: Request, res: Response) => {
    const meta = await getDocumentsMeta();

    res.json({
      ok: true,
      meta
    });
  })
);

router.get(
  "/",
  asyncHandler(async (req: Request, res: Response) => {
    const limitRaw = req.query.limit;

    const limit =
      typeof limitRaw === "string" && !Number.isNaN(Number(limitRaw))
        ? Math.max(1, Math.min(Number(limitRaw), 500))
        : 100;

    const union =
      typeof req.query.union === "string" && req.query.union.trim()
        ? req.query.union.trim()
        : undefined;

    const tariffType =
      typeof req.query.tariffType === "string" && req.query.tariffType.trim()
        ? req.query.tariffType.trim()
        : undefined;

    const tariffwerk =
      typeof req.query.tariffwerk === "string" && req.query.tariffwerk.trim()
        ? req.query.tariffwerk.trim()
        : undefined;

    const funktionsgruppe =
      typeof req.query.funktionsgruppe === "string" &&
      req.query.funktionsgruppe.trim()
        ? req.query.funktionsgruppe.trim()
        : undefined;

    const q =
      typeof req.query.q === "string" && req.query.q.trim()
        ? req.query.q.trim()
        : undefined;

    const documents = await getDocuments({
      limit,
      union,
      tariffType,
      tariffwerk,
      funktionsgruppe,
      q
    });

    res.json({
      ok: true,
      filters: {
        limit,
        union: union ?? null,
        tariffType: tariffType ?? null,
        tariffwerk: tariffwerk ?? null,
        funktionsgruppe: funktionsgruppe ?? null,
        q: q ?? null
      },
      count: documents.length,
      documents
    });
  })
);

router.get(
  "/:itemId/paragraphs",
  asyncHandler(async (req: Request, res: Response) => {
    const rawItemId = req.params.itemId;

    const itemId =
      typeof rawItemId === "string"
        ? rawItemId
        : Array.isArray(rawItemId)
          ? rawItemId[0]
          : undefined;

    if (!itemId) {
      return res.status(400).json({
        ok: false,
        error: "itemId_required"
      });
    }

    const result = await pool.query<ParagraphRow>(
      `
      SELECT
        p.id,
        p.page_number,
        p.paragraph_index,
        p.chunk_text
      FROM document_paragraphs p
      INNER JOIN documents d
        ON d.id = p.document_id
      WHERE d.item_id = $1
      ORDER BY
        p.page_number ASC NULLS LAST,
        p.paragraph_index ASC NULLS LAST,
        p.id ASC
      LIMIT 10000
      `,
      [itemId]
    );

    const paragraphs = buildTariffBlocks(result.rows);

    return res.json({
      ok: true,
      itemId,
      count: paragraphs.length,
      paragraphs
    });
  })
);

router.get(
  "/:itemId",
  asyncHandler(async (req: Request, res: Response) => {
    const rawItemId = req.params.itemId;

    const itemId =
      typeof rawItemId === "string"
        ? rawItemId
        : Array.isArray(rawItemId)
          ? rawItemId[0]
          : undefined;

    if (!itemId) {
      return res.status(400).json({
        ok: false,
        error: "itemId_required"
      });
    }

    const document = await getDocumentByItemId(itemId);

    if (!document) {
      return res.status(404).json({
        ok: false,
        error: "document_not_found"
      });
    }

    res.json({
      ok: true,
      document
    });
  })
);

export default router;