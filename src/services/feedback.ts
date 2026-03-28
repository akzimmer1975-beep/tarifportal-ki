import { pool } from "../db.js";
import type {
  CreateFeedbackBody,
  FeedbackCustomSourceInput,
  FeedbackRow,
  FeedbackSourceInput
} from "../types/feedback.js";

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  const normalized = normalizeText(value);
  return normalized ? normalized : null;
}

function normalizeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function getUnifiedTariffType(
  value: { tariffType?: string; tarifType?: string } | null | undefined
): string | null {
  return normalizeOptionalText(value?.tariffType) ?? normalizeOptionalText(value?.tarifType);
}

function normalizeSourceInput(source?: FeedbackSourceInput) {
  if (!source) return null;

  return {
    documentName: normalizeOptionalText(source.documentName),
    unionName: normalizeOptionalText(source.unionName),
    tariffType: getUnifiedTariffType(source),
    tariffwerk: normalizeOptionalText(source.tariffwerk),
    funktionsgruppe: normalizeOptionalText(source.funktionsgruppe),
    pageNumber: normalizeNumber(source.pageNumber),
    paragraphIndex: normalizeNumber(source.paragraphIndex),
    text: normalizeOptionalText(source.text),
    fullText: normalizeOptionalText(source.fullText),
    sectionIndex: normalizeNumber(source.sectionIndex),
    similarity: normalizeNumber(source.similarity)
  };
}

function normalizeCustomSourceInput(customSource?: FeedbackCustomSourceInput) {
  if (!customSource) return null;

  return {
    documentName: normalizeOptionalText(customSource.documentName),
    unionName: normalizeOptionalText(customSource.unionName),
    tariffType: getUnifiedTariffType(customSource),
    tariffwerk: normalizeOptionalText(customSource.tariffwerk),
    funktionsgruppe: normalizeOptionalText(customSource.funktionsgruppe),
    pageNumber: normalizeNumber(customSource.pageNumber),
    paragraphIndex: normalizeNumber(customSource.paragraphIndex),
    text: normalizeOptionalText(customSource.text),
    comment: normalizeOptionalText(customSource.comment)
  };
}

export function normalizeQuery(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "");
}

export function validateFeedbackPayload(body: CreateFeedbackBody): string[] {
  const errors: string[] = [];

  const queryText = normalizeOptionalText(body.queryText);
  const source = normalizeSourceInput(body.source);
  const customSource = normalizeCustomSourceInput(body.customSource);

  if (!queryText) {
    errors.push("queryText ist erforderlich.");
  }

  if (!body.targetType) {
    errors.push("targetType ist erforderlich.");
  }

  if (!body.feedbackType) {
    errors.push("feedbackType ist erforderlich.");
  }

  if (body.targetType === "source" && !source) {
    errors.push("Für targetType='source' ist source erforderlich.");
  }

  if (body.targetType === "custom_source" && !customSource) {
    errors.push("Für targetType='custom_source' ist customSource erforderlich.");
  }

  if (
    body.targetType === "answer" &&
    !["answer_good", "answer_bad", "sources_good", "sources_bad"].includes(
      body.feedbackType
    )
  ) {
    errors.push("Ungültiger feedbackType für targetType='answer'.");
  }

  if (
    body.targetType === "source" &&
    !["relevant", "preferred", "not_relevant"].includes(body.feedbackType)
  ) {
    errors.push("Ungültiger feedbackType für targetType='source'.");
  }

  if (
    body.targetType === "custom_source" &&
    body.feedbackType !== "custom_source"
  ) {
    errors.push(
      "Für targetType='custom_source' muss feedbackType='custom_source' sein."
    );
  }

  if (body.targetType === "source" && source && !source.documentName) {
    errors.push("Für source-Feedback ist documentName erforderlich.");
  }

  if (
    body.targetType === "source" &&
    source &&
    !source.text &&
    !source.fullText
  ) {
    errors.push(
      "Für source-Feedback ist mindestens text oder fullText erforderlich."
    );
  }

  if (body.targetType === "custom_source" && customSource && !customSource.documentName) {
    errors.push("Für custom_source ist documentName erforderlich.");
  }

  if (body.targetType === "custom_source" && customSource && !customSource.text) {
    errors.push("Für custom_source ist text erforderlich.");
  }

  return errors;
}

export async function insertFeedback(
  body: CreateFeedbackBody
): Promise<FeedbackRow> {
  const normalizedQuery =
    normalizeOptionalText(body.normalizedQuery) || normalizeQuery(body.queryText);

  const source = normalizeSourceInput(body.source);
  const customSource = normalizeCustomSourceInput(body.customSource);

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
      source_full_text,
      source_section_index,
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
      $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
      $18, $19, $20, $21, $22, $23, $24, $25, $26,
      $27, $28
    )
    RETURNING *
    `,
    [
      normalizeText(body.queryText),
      normalizedQuery,
      normalizeOptionalText(body.topicKey),
      normalizeOptionalText(body.sectionKey),
      body.targetType,
      body.feedbackType,

      source?.documentName ?? null,
      source?.unionName ?? null,
      source?.tariffType ?? null,
      source?.tariffwerk ?? null,
      source?.funktionsgruppe ?? null,
      source?.pageNumber ?? null,
      source?.paragraphIndex ?? null,
      source?.text ?? null,
      source?.fullText ?? null,
      source?.sectionIndex ?? null,
      source?.similarity ?? null,

      customSource?.documentName ?? null,
      customSource?.unionName ?? null,
      customSource?.tariffType ?? null,
      customSource?.tariffwerk ?? null,
      customSource?.funktionsgruppe ?? null,
      customSource?.pageNumber ?? null,
      customSource?.paragraphIndex ?? null,
      customSource?.text ?? null,
      customSource?.comment ?? null,

      normalizeOptionalText(body.answerText),
      normalizeOptionalText(body.userComment)
    ]
  );

  return result.rows[0];
}

export async function getFeedbackByQuery(
  query: string,
  limit = 20
): Promise<FeedbackRow[]> {
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