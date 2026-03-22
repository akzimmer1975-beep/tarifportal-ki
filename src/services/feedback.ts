import { pool } from "../db.js";
import type { CreateFeedbackBody, FeedbackRow } from "../types/feedback.js";

export function normalizeQuery(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "");
}

export function validateFeedbackPayload(body: CreateFeedbackBody): string[] {
  const errors: string[] = [];

  if (!body.queryText?.trim()) {
    errors.push("queryText ist erforderlich.");
  }

  if (!body.targetType) {
    errors.push("targetType ist erforderlich.");
  }

  if (!body.feedbackType) {
    errors.push("feedbackType ist erforderlich.");
  }

  if (body.targetType === "source" && !body.source) {
    errors.push("Für targetType='source' ist source erforderlich.");
  }

  if (body.targetType === "custom_source" && !body.customSource) {
    errors.push("Für targetType='custom_source' ist customSource erforderlich.");
  }

  if (
    body.targetType === "answer" &&
    !["answer_good", "answer_bad", "sources_good", "sources_bad"].includes(body.feedbackType)
  ) {
    errors.push("Ungültiger feedbackType für targetType='answer'.");
  }

  if (
    body.targetType === "source" &&
    !["relevant", "preferred", "not_relevant"].includes(body.feedbackType)
  ) {
    errors.push("Ungültiger feedbackType für targetType='source'.");
  }

  if (body.targetType === "custom_source" && body.feedbackType !== "custom_source") {
    errors.push("Für targetType='custom_source' muss feedbackType='custom_source' sein.");
  }

  return errors;
}

export async function insertFeedback(body: CreateFeedbackBody): Promise<FeedbackRow> {
  const normalizedQuery = body.normalizedQuery?.trim() || normalizeQuery(body.queryText);

  const result = await pool.query<FeedbackRow>(
    `
    INSERT INTO search_feedback (
      query_text,
      normalized_query,
      topic_key,
      section_key,
      target_type,
      feedback_type,

      source_document_name,
      source_union_name,
      source_tarif_type,
      source_tariffwerk,
      source_funktionsgruppe,
      source_page_number,
      source_paragraph_index,
      source_text,
      source_similarity,

      custom_document_name,
      custom_union_name,
      custom_tarif_type,
      custom_tariffwerk,
      custom_funktionsgruppe,
      custom_page_number,
      custom_paragraph_index,
      custom_text,
      custom_comment,

      answer_text,
      user_comment
    )
    VALUES (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, $10, $11, $12, $13, $14, $15,
      $16, $17, $18, $19, $20, $21, $22, $23, $24,
      $25, $26
    )
    RETURNING *
    `,
    [
      body.queryText,
      normalizedQuery,
      body.topicKey ?? null,
      body.sectionKey ?? null,
      body.targetType,
      body.feedbackType,

      body.source?.documentName ?? null,
      body.source?.unionName ?? null,
      body.source?.tarifType ?? body.source?.tariffType ?? null,
      body.source?.tariffwerk ?? null,
      body.source?.funktionsgruppe ?? null,
      body.source?.pageNumber ?? null,
      body.source?.paragraphIndex ?? null,
      body.source?.text ?? null,
      body.source?.similarity ?? null,

      body.customSource?.documentName ?? null,
      body.customSource?.unionName ?? null,
      body.customSource?.tarifType ?? body.customSource?.tariffType ?? null,
      body.customSource?.tariffwerk ?? null,
      body.customSource?.funktionsgruppe ?? null,
      body.customSource?.pageNumber ?? null,
      body.customSource?.paragraphIndex ?? null,
      body.customSource?.text ?? null,
      body.customSource?.comment ?? null,

      body.answerText ?? null,
      body.userComment ?? null
    ]
  );

  return result.rows[0];
}

export async function getFeedbackByQuery(query: string, limit = 20): Promise<FeedbackRow[]> {
  const normalizedQuery = normalizeQuery(query);

  const result = await pool.query<FeedbackRow>(
    `
    SELECT *
    FROM search_feedback
    WHERE normalized_query = $1
    ORDER BY created_at DESC
    LIMIT $2
    `,
    [normalizedQuery, Math.max(1, Math.min(limit, 100))]
  );

  return result.rows;
}