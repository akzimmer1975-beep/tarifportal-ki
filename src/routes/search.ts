import { Router, type Request, type Response } from "express";
import { asyncHandler } from "../lib/asyncHandler.js";
import { searchDocuments } from "../services/search.js";

const router = Router();

router.post(
  "/search",
  asyncHandler(async (req: Request, res: Response) => {
    const { query, limit, union } = req.body ?? {};

    if (typeof query !== "string" || !query.trim()) {
      return res.status(400).json({
        ok: false,
        error: "query_required"
      });
    }

    const safeLimit =
      typeof limit === "number" && Number.isFinite(limit)
        ? Math.max(1, Math.min(limit, 20))
        : 10;

    const safeUnion =
      union === "GDL" || union === "EVG"
        ? union
        : undefined;

    const results = await searchDocuments(query.trim(), {
      limit: safeLimit,
      union: safeUnion
    });

    res.json({
      ok: true,
      query: query.trim(),
      count: results.length,
      results
    });
  })
);

export default router;