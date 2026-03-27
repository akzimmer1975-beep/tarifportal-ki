import { Router, type Request, type Response } from "express";
import type { CreateFeedbackBody } from "../types/feedback.js";
import {
  getFeedbackByQuery,
  insertFeedback,
  validateFeedbackPayload
} from "../services/feedback.js";

const feedbackRouter = Router();

feedbackRouter.post("/", async (req: Request, res: Response) => {
  try {
    const body = req.body as CreateFeedbackBody;
    const errors = validateFeedbackPayload(body);

    if (errors.length > 0) {
      return res.status(400).json({
        ok: false,
        errors
      });
    }

    const feedback = await insertFeedback(body);

    return res.status(201).json({
      ok: true,
      feedback
    });
  } catch (error) {
    console.error("POST /api/feedback failed:", error);

    return res.status(500).json({
      ok: false,
      error: "Feedback konnte nicht gespeichert werden."
    });
  }
});

feedbackRouter.get("/search", async (req: Request, res: Response) => {
  try {
    const query = String(req.query.query ?? "").trim();
    const limit = Number(req.query.limit ?? 20);

    if (!query) {
      return res.status(400).json({
        ok: false,
        error: "query ist erforderlich."
      });
    }

    const results = await getFeedbackByQuery(query, limit);

    return res.json({
      ok: true,
      query,
      count: results.length,
      results
    });
  } catch (error) {
    console.error("GET /api/feedback/search failed:", error);

    return res.status(500).json({
      ok: false,
      error: "Feedback konnte nicht geladen werden."
    });
  }
});

export { feedbackRouter };
export default feedbackRouter;