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

type ParagraphSection = {
  id: string;
  db_id: number;
  page_number: number | null;
  paragraph_index: number | null;
  chunk_text: string;
};

type ParagraphGroup = {
  page_number: number | null;
  paragraph_index: number | null;
  full_text: string;
  sections: ParagraphSection[];
};

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
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
      LIMIT 2000
      `,
      [itemId]
    );

    const groupedMap = new Map<string, ParagraphGroup>();

    for (const row of result.rows) {
      const key = `${row.page_number ?? "null"}::${row.paragraph_index ?? "null"}`;

      const section: ParagraphSection = {
        id: String(row.id),
        db_id: row.id,
        page_number: row.page_number,
        paragraph_index: row.paragraph_index,
        chunk_text: row.chunk_text
      };

      const existing = groupedMap.get(key);

      if (!existing) {
        groupedMap.set(key, {
          page_number: row.page_number,
          paragraph_index: row.paragraph_index,
          full_text: normalizeText(row.chunk_text),
          sections: [section]
        });
        continue;
      }

      existing.sections.push(section);

      const nextText = normalizeText(row.chunk_text);
      existing.full_text = [existing.full_text, nextText].filter(Boolean).join("\n\n");
    }

    const paragraphs = Array.from(groupedMap.values());

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