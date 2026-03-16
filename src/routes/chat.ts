import { Router, type Request, type Response } from "express";
import { answerWithRag } from "../services/rag.js";
import type { ChatRequestBody } from "../types/chat.js";

export const chatRouter = Router();

chatRouter.get("/", (_req, res) => {
  res.json({
    ok: true,
    route: "/api/chat"
  });
});

chatRouter.post("/", async (req: Request<{}, {}, ChatRequestBody>, res: Response) => {
  try {
    const query = req.body?.query?.trim();
    const union = req.body?.union;
    const compareUnions = req.body?.compareUnions === true;

    if (!query) {
      return res.status(400).json({
        ok: false,
        error: "missing_query",
        message: "Feld 'query' ist erforderlich."
      });
    }

    if (union && union !== "GDL" && union !== "EVG") {
      return res.status(400).json({
        ok: false,
        error: "invalid_union",
        message: "Feld 'union' darf nur 'GDL' oder 'EVG' sein."
      });
    }

    if (union && compareUnions) {
      return res.status(400).json({
        ok: false,
        error: "invalid_request",
        message: "'union' und 'compareUnions=true' dürfen nicht gleichzeitig gesetzt sein."
      });
    }

    const result = await answerWithRag(query, {
      union,
      compareUnions
    });

    return res.json({
      ok: true,
      mode: result.mode,
      answer: result.answer,
      structured: result.structured,
      sources: result.sources,
      sourcesByUnion: result.sourcesByUnion
    });
  } catch (error) {
    console.error("POST /api/chat failed:", error);

    const message =
      error instanceof Error ? error.message : "Unbekannter Fehler";

    return res.status(500).json({
      ok: false,
      error: "chat_failed",
      message
    });
  }
});