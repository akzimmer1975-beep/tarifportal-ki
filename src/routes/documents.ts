import { Router, type Request, type Response } from "express";
import { asyncHandler } from "../lib/asyncHandler.js";
import {
  getDocumentByItemId,
  getDocuments,
  getDocumentsMeta
} from "../db.js";

const router = Router();

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
  "/:itemId",
  asyncHandler(async (req: Request, res: Response) => {
    const { itemId } = req.params;

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