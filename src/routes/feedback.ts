import { Router, type Request, type Response } from "express";
import { pool, insertSearchFeedback } from "../db.js";

/**
 * Hilfsfunktionen
 */

function normalizeQueryText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[\s\n\r\t]+/g, " ")
    .replace(/[.,;:!?()[\]{}"']/g, "")
    .trim();
}

function deriveQualityLabel(answerRating: string) {
  switch (answerRating) {
    case "correct":
      return "green";
    case "partially_correct":
      return "yellow";
    case "wrong":
    case "no_source":
      return "red";
    default:
      return "yellow";
  }
}

function validate(body: any): string[] {
  const errors: string[] = [];

  if (!body.queryText) errors.push("queryText fehlt");
  if (!body.answerRating) errors.push("answerRating fehlt");

  return errors;
}

const feedbackRouter = Router();

/**
 * POST /api/feedback
 */
feedbackRouter.post("/", async (req: Request, res: Response) => {
  try {
    const body = req.body;

    const errors = validate(body);
    if (errors.length > 0) {
      return res.status(400).json({
        ok: false,
        errors
      });
    }

    const normalizedQuery =
      body.normalizedQuery ?? normalizeQueryText(body.queryText);

    const qualityLabel =
      body.qualityLabel ?? deriveQualityLabel(body.answerRating);

    const saved = await insertSearchFeedback({
      queryText: body.queryText,
      normalizedQuery,

      topicKey: body.topicKey ?? null,
      sectionKey: body.sectionKey ?? null,
      targetType: "answer",
      feedbackType: body.feedbackType ?? "review",

      // SOURCE (aus Auswahl oder Bewertung)
      sourceDocumentName: body.source?.documentName ?? null,
      sourceUnionName: body.source?.unionName ?? null,
      sourceTarifType: body.source?.tariffType ?? null,
      sourceTariffwerk: body.source?.tariffwerk ?? null,
      sourceFunktionsgruppe: null,
      sourcePageNumber: body.source?.pageNumber ?? null,
      sourceParagraphIndex: body.source?.paragraphIndex ?? null,
      sourceText: body.source?.sourceText ?? null,
      sourceFullText: body.source?.sourceFullText ?? null,
      sourceSectionIndex: body.source?.sectionIndex ?? null,
      sourceSimilarity: null,

      // CUSTOM SOURCE (optional später)
      customDocumentName: null,
      customUnionName: null,
      customTarifType: null,
      customTariffwerk: null,
      customFunktionsgruppe: null,
      customPageNumber: null,
      customParagraphIndex: null,
      customText: null,
      customComment: null,

      // ANSWER
      answerText: body.answerText ?? null,
      userComment: body.answerComment ?? null,

      // NEUE FELDER (WICHTIG)
      answerRating: body.answerRating,
      qualityLabel,
      sourceRating: body.source?.sourceRating ?? null,
      documentId: body.source?.documentId ?? null,
      sectionLabel: body.source?.sectionLabel ?? null,

      metadata: {
        sourceRatings: body.metadata?.sourceRatings ?? {},
        pickedSourceUsed: body.metadata?.pickedSourceUsed ?? false
      }
    });

    return res.status(201).json({
      ok: true,
      feedback: saved
    });
  } catch (error) {
    console.error("POST /api/feedback failed:", error);
    console.error("BODY:", JSON.stringify(req.body, null, 2));

    return res.status(500).json({
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Feedback konnte nicht gespeichert werden"
    });
  }
});

/**
 * (Optional) GET für Debug
 */
feedbackRouter.get("/search", async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM search_feedback
      ORDER BY created_at DESC
      LIMIT 50
    `);

    return res.json({
      ok: true,
      count: result.rows.length,
      results: result.rows
    });
  } catch (error) {
    console.error("GET /api/feedback/search failed:", error);

    return res.status(500).json({
      ok: false,
      error: "Feedback konnte nicht geladen werden"
    });
  }
});

export { feedbackRouter };
export default feedbackRouter;