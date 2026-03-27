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
  full_text: string;
  sections: ApiParagraphSection[];
};

function normalizeWhitespace(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[ \u00A0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function mergeChunkTexts(chunks: string[]): string {
  const cleaned = chunks
    .map((chunk) => normalizeWhitespace(chunk))
    .filter(Boolean);

  if (cleaned.length === 0) return "";

  return cleaned.join("\n\n").trim();
}

function getSectionLevel(label: string): number {
  if (/^\(\d+\)$/.test(label)) return 1;
  if (/^[a-z]\)$/.test(label)) return 2;
  if (/^[a-z]{2}\)$/.test(label)) return 3;
  if (/^[a-z]{3}\)$/.test(label)) return 4;
  return 9;
}

function extractStructuredSections(fullText: string): ApiParagraphSection[] {
  const text = normalizeWhitespace(fullText);

  if (!text) return [];

  const pattern =
    /(?:^|\n|\s)(\(\d+\)|[a-z]\)|[a-z]{2}\)|[a-z]{3}\))(?=\s)/g;

  const matches = Array.from(text.matchAll(pattern));

  if (matches.length === 0) {
    return [];
  }

  const sections: ApiParagraphSection[] = [];

  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    const label = match[1];
    const rawIndex = match.index ?? 0;
    const labelStart = rawIndex + match[0].lastIndexOf(label);
    const contentStart = labelStart + label.length;
    const nextMatch = matches[i + 1];
    const contentEnd = nextMatch ? (nextMatch.index ?? text.length) : text.length;

    const rawText = text.slice(contentStart, contentEnd).trim();

    if (!rawText) continue;

    sections.push({
      id: `${label}-${i + 1}`,
      label,
      text: rawText,
      level: getSectionLevel(label),
      start_offset: contentStart,
      end_offset: contentEnd
    });
  }

  return sections;
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
      LIMIT 5000
      `,
      [itemId]
    );

    const groupedMap = new Map<
      string,
      {
        page_number: number | null;
        paragraph_index: number | null;
        chunks: string[];
      }
    >();

    for (const row of result.rows) {
      const key = `${row.page_number ?? "null"}::${row.paragraph_index ?? "null"}`;
      const existing = groupedMap.get(key);

      if (!existing) {
        groupedMap.set(key, {
          page_number: row.page_number,
          paragraph_index: row.paragraph_index,
          chunks: [row.chunk_text]
        });
        continue;
      }

      existing.chunks.push(row.chunk_text);
    }

    const paragraphs: ApiParagraph[] = Array.from(groupedMap.values()).map(
      (group) => {
        const fullText = mergeChunkTexts(group.chunks);
        const sections = extractStructuredSections(fullText);

        return {
          page_number: group.page_number,
          paragraph_index: group.paragraph_index,
          full_text: fullText,
          sections
        };
      }
    );

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