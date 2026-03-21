import { Router, type Request, type Response } from "express";
import { searchDocuments } from "../services/search.js";

const router = Router();

router.post("/search", async (req: Request, res: Response) => {
  try {
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

    const safeUnion = union === "GDL" || union === "EVG" ? union : undefined;

    const results = await searchDocuments(query.trim(), {
      limit: safeLimit,
      union: safeUnion
    });

    return res.json({
      ok: true,
      query: query.trim(),
      count: results.length,
      results
    });
  } catch (error) {
    console.error("POST /api/search failed:", error);

    const message = error instanceof Error ? error.message : "Unbekannter Fehler";

    return res.status(500).json({
      ok: false,
      error: "search_failed",
      message
    });
  }
});

export default router;