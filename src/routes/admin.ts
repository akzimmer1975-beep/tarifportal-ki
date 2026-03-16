import { Router, type NextFunction, type Request, type Response } from "express";
import { asyncHandler } from "../lib/asyncHandler.js";
import { initDb, testDbConnection } from "../db.js";
import { ingestTarifportalToDb, scanTarifportal } from "../services/ingest.js";
import { extractAllDocuments } from "../services/ingest.js";
import { embedParagraphs } from "../services/embed.js";

const router = Router();

function requireAdminApiKey(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.header("x-api-key");

  if (!process.env.ADMIN_API_KEY) {
    return res.status(500).json({
      ok: false,
      error: "ADMIN_API_KEY is not configured"
    });
  }

  if (apiKey !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({
      ok: false,
      error: "unauthorized"
    });
  }

  next();
}

router.use(requireAdminApiKey);

router.get(
  "/status",
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({
      ok: true,
      service: "admin"
    });
  })
);

router.get(
  "/db/status",
  asyncHandler(async (_req: Request, res: Response) => {
    const db = await testDbConnection();

    res.json({
      ok: true,
      db
    });
  })
);

router.post(
  "/db/init",
  asyncHandler(async (_req: Request, res: Response) => {
    await initDb();

    res.json({
      ok: true,
      message: "database initialized"
    });
  })
);

router.post(
  "/scan",
  asyncHandler(async (_req: Request, res: Response) => {
    const result = await scanTarifportal();
    res.json(result);
  })
);

router.post(
  "/ingest",
  asyncHandler(async (_req: Request, res: Response) => {
    await initDb();

    const result = await ingestTarifportalToDb();

    res.json(result);
  })
);

router.post(
  "/extract-text",
  asyncHandler(async (_req: Request, res: Response) => {

    const result = await extractAllDocuments();

    res.json(result);

  })
);

router.post(
  "/embed",
  asyncHandler(async (_req, res) => {

    const result = await embedParagraphs(200);

    res.json(result);

  })
);

export default router;