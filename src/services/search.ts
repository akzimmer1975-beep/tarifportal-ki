import OpenAI from "openai";
import { pool } from "../db.js";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

function toPgVector(values: number[]) {
  return `[${values.join(",")}]`;
}

export type SearchDocumentRow = {
  document_name: string;
  union_name: string | null;
  tarif_type: string | null;
  tariffwerk: string | null;
  funktionsgruppe: string | null;
  page_number: number | null;
  paragraph_index: number | null;

  paragraph_index_from: number | null;
  paragraph_index_to: number | null;

  chunk_text: string;
  previous_text: string | null;
  next_text: string | null;
  full_source_text: string;

  similarity: number;

  semantic_score: number;
  keyword_score: number;
  feedback_score: number;
  final_score: number;
  feedback_matches: number;
};

export type SearchDocumentsOptions = {
  limit?: number;
  union?: "GDL" | "EVG";
  topicKey?: string | null;
  sectionKey?: string | null;
};

type BaseRow = {
  document_name: string;
  union_name: string | null;
  tarif_type: string | null;
  tariffwerk: string | null;
  funktionsgruppe: string | null;
  page_number: number | null;
  paragraph_index: number | null;
  chunk_text: string;
  similarity: number;
  semantic_score?: number;
  keyword_score?: number;
  feedback_score?: number;
  final_score?: number;
  feedback_matches?: number;
};

type NeighborRow = {
  paragraph_index: number | null;
  chunk_text: string | null;
};

type FeedbackRow = {
  normalized_query: string | null;
  topic_key: string | null;
  section_key: string | null;
  feedback_type: string | null;

  source_document_name: string | null;
  source_union_name: string | null;
  source_tarif_type: string | null;
  source_tariffwerk: string | null;
  source_funktionsgruppe: string | null;
  source_page_number: number | null;
  source_paragraph_index: number | null;
  source_section_index: number | null;
  source_text: string | null;
  source_full_text: string | null;

  custom_document_name: string | null;
  custom_union_name: string | null;
  custom_tarif_type: string | null;
  custom_tariffwerk: string | null;
  custom_funktionsgruppe: string | null;
  custom_page_number: number | null;
  custom_paragraph_index: number | null;
  custom_text: string | null;
};

function normalizeOptions(
  options: SearchDocumentsOptions | number = {}
): SearchDocumentsOptions {
  if (typeof options === "number") {
    return { limit: options };
  }
  return options;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeCompareText(value: string | null | undefined): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[„“”"']/g, "")
    .replace(/[–—-]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeQueryText(value: string | null | undefined): string {
  return normalizeCompareText(value)
    .replace(/[^a-z0-9äöüß§()\[\].,:;+\- ]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksIncomplete(text: string): boolean {
  const t = normalizeText(text);
  if (!t) return false;

  if (t.length < 220) return true;

  const last = t.slice(-1);
  if (![".", "!", "?", ":", ";", ")"].includes(last)) return true;

  return false;
}

function shouldAttachNext(current: string, next: string | null): boolean {
  if (!next) return false;

  const c = normalizeText(current);
  const n = normalizeText(next);

  if (!n) return false;
  if (looksIncomplete(c)) return true;

  if (/gem\.?$/i.test(c)) return true;
  if (/beträgt$/i.test(c)) return true;
  if (/betragen$/i.test(c)) return true;
  if (/und$/i.test(c)) return true;
  if (/sowie$/i.test(c)) return true;
  if (/von$/i.test(c)) return true;
  if (/mindestens$/i.test(c)) return true;
  if (/höchstens$/i.test(c)) return true;

  if (/^\d+([.,]\d+)?\s*(stunden|std\.?|tage|wochen|monate|%|prozent)/i.test(n)) {
    return true;
  }

  if (/^\(?\d+([.,]\d+)?\)?$/i.test(n)) {
    return true;
  }

  return false;
}

function shouldAttachPrevious(previous: string | null, current: string): boolean {
  if (!previous) return false;

  const p = normalizeText(previous);
  const c = normalizeText(current);

  if (!p || !c) return false;
  if (p.length < 140) return true;
  if (!/[.!?)]$/.test(p)) return true;

  if (/^(diese|dieser|dieses|dabei|hierfür|hierzu|sie|er|es)\b/i.test(c)) {
    return true;
  }

  return false;
}

function buildRowKey(row: {
  document_name: string;
  union_name: string | null;
  page_number: number | null;
  paragraph_index: number | null;
  chunk_text: string;
}) {
  return [
    row.document_name,
    row.union_name ?? "",
    row.page_number ?? "",
    row.paragraph_index ?? "",
    normalizeCompareText(row.chunk_text)
  ].join("::");
}

function feedbackTypeWeight(feedbackType: string | null | undefined): number {
  const value = normalizeCompareText(feedbackType);

  if (value === "preferred") return 0.35;
  if (value === "relevant") return 0.18;
  if (value === "not_relevant") return -0.28;

  return 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function getFeedbackSourceFields(row: FeedbackRow) {
  return {
    document_name: row.source_document_name ?? row.custom_document_name ?? null,
    union_name: row.source_union_name ?? row.custom_union_name ?? null,
    tarif_type: row.source_tarif_type ?? row.custom_tarif_type ?? null,
    tariffwerk: row.source_tariffwerk ?? row.custom_tariffwerk ?? null,
    funktionsgruppe: row.source_funktionsgruppe ?? row.custom_funktionsgruppe ?? null,
    page_number: row.source_page_number ?? row.custom_page_number ?? null,
    paragraph_index: row.source_paragraph_index ?? row.custom_paragraph_index ?? null,
    text: row.source_text ?? row.custom_text ?? null,
    full_text: row.source_full_text ?? null
  };
}

function textOverlapScore(a: string | null | undefined, b: string | null | undefined): number {
  const aa = normalizeCompareText(a);
  const bb = normalizeCompareText(b);

  if (!aa || !bb) return 0;
  if (aa === bb) return 1;

  if (aa.length >= 30 && bb.includes(aa)) return 0.92;
  if (bb.length >= 30 && aa.includes(bb)) return 0.92;

  const aWords = new Set(aa.split(" ").filter(Boolean));
  const bWords = new Set(bb.split(" ").filter(Boolean));

  if (!aWords.size || !bWords.size) return 0;

  let overlap = 0;
  for (const word of aWords) {
    if (bWords.has(word)) overlap++;
  }

  return overlap / Math.max(aWords.size, bWords.size);
}

function getContextScore(params: {
  searchQuery: string;
  searchTopicKey?: string | null;
  searchSectionKey?: string | null;
  feedback: FeedbackRow;
}): number {
  const normalizedQuery = normalizeQueryText(params.searchQuery);
  const feedbackQuery = normalizeQueryText(params.feedback.normalized_query);
  const feedbackTopicKey = normalizeQueryText(params.feedback.topic_key);
  const feedbackSectionKey = normalizeQueryText(params.feedback.section_key);
  const searchTopicKey = normalizeQueryText(params.searchTopicKey);
  const searchSectionKey = normalizeQueryText(params.searchSectionKey);

  let score = 0.15;

  if (feedbackQuery && normalizedQuery) {
    if (feedbackQuery === normalizedQuery) {
      score += 0.75;
    } else if (
      feedbackQuery.includes(normalizedQuery) ||
      normalizedQuery.includes(feedbackQuery)
    ) {
      score += 0.4;
    }
  }

  if (feedbackTopicKey && searchTopicKey && feedbackTopicKey === searchTopicKey) {
    score += 0.35;
  }

  if (
    feedbackSectionKey &&
    searchSectionKey &&
    feedbackSectionKey === searchSectionKey
  ) {
    score += 0.45;
  }

  return clamp(score, 0, 1.7);
}

function getSourceMatchScore(
  row: SearchDocumentRow | BaseRow,
  feedback: FeedbackRow
): number {
  const source = getFeedbackSourceFields(feedback);
  let score = 0;

  const rowDocument = normalizeCompareText(row.document_name);
  const sourceDocument = normalizeCompareText(source.document_name);
  const rowUnion = normalizeCompareText(row.union_name);
  const sourceUnion = normalizeCompareText(source.union_name);
  const rowTarifType = normalizeCompareText(row.tarif_type);
  const sourceTarifType = normalizeCompareText(source.tarif_type);
  const rowTariffwerk = normalizeCompareText(row.tariffwerk);
  const sourceTariffwerk = normalizeCompareText(source.tariffwerk);
  const rowFunktionsgruppe = normalizeCompareText(row.funktionsgruppe);
  const sourceFunktionsgruppe = normalizeCompareText(source.funktionsgruppe);

  if (rowDocument && sourceDocument && rowDocument === sourceDocument) {
    score += 0.42;
  }

  if (rowUnion && sourceUnion && rowUnion === sourceUnion) {
    score += 0.08;
  }

  if (rowTarifType && sourceTarifType && rowTarifType === sourceTarifType) {
    score += 0.06;
  }

  if (rowTariffwerk && sourceTariffwerk && rowTariffwerk === sourceTariffwerk) {
    score += 0.05;
  }

  if (
    rowFunktionsgruppe &&
    sourceFunktionsgruppe &&
    rowFunktionsgruppe === sourceFunktionsgruppe
  ) {
    score += 0.05;
  }

  if (
    source.page_number != null &&
    row.page_number != null &&
    source.page_number === row.page_number
  ) {
    score += 0.14;
  }

  if (
    source.paragraph_index != null &&
    row.paragraph_index != null &&
    source.paragraph_index === row.paragraph_index
  ) {
    score += 0.3;
  }

  const directTextScore = textOverlapScore(row.chunk_text, source.text);
  const fullTextScore =
    "full_source_text" in row
      ? Math.max(
          textOverlapScore(row.full_source_text, source.full_text),
          textOverlapScore(row.full_source_text, source.text),
          textOverlapScore(row.chunk_text, source.full_text)
        )
      : Math.max(
          textOverlapScore(row.chunk_text, source.full_text),
          textOverlapScore(row.chunk_text, source.text)
        );

  const bestTextScore = Math.max(directTextScore, fullTextScore);

  if (bestTextScore >= 0.95) {
    score += 0.42;
  } else if (bestTextScore >= 0.7) {
    score += 0.28;
  } else if (bestTextScore >= 0.45) {
    score += 0.14;
  }

  return clamp(score, 0, 1.55);
}

async function getNeighbors(
  documentName: string,
  paragraphIndex: number | null
): Promise<{ previousText: string | null; nextText: string | null }> {
  if (paragraphIndex == null) {
    return { previousText: null, nextText: null };
  }

  const sql = `
    SELECT
      p.paragraph_index,
      p.chunk_text
    FROM document_paragraphs p
    INNER JOIN documents d
      ON d.id = p.document_id
    WHERE d.name = $1
      AND p.paragraph_index IN ($2, $3)
    ORDER BY p.paragraph_index ASC
  `;

  const result = await pool.query<NeighborRow>(sql, [
    documentName,
    paragraphIndex - 1,
    paragraphIndex + 1
  ]);

  let previousText: string | null = null;
  let nextText: string | null = null;

  for (const row of result.rows) {
    if (row.paragraph_index === paragraphIndex - 1) {
      previousText = row.chunk_text ?? null;
    }
    if (row.paragraph_index === paragraphIndex + 1) {
      nextText = row.chunk_text ?? null;
    }
  }

  return { previousText, nextText };
}

function enrichRowWithNeighbors(
  row: BaseRow,
  previousText: string | null,
  nextText: string | null
): SearchDocumentRow {
  const current = normalizeText(row.chunk_text);
  const prev = normalizeText(previousText);
  const next = normalizeText(nextText);

  const includePrevious = shouldAttachPrevious(prev || null, current);
  const includeNext = shouldAttachNext(current, next || null);

  const parts: string[] = [];
  let paragraphFrom = row.paragraph_index;
  let paragraphTo = row.paragraph_index;

  if (includePrevious && prev) {
    parts.push(prev);
    if (row.paragraph_index != null) {
      paragraphFrom = row.paragraph_index - 1;
    }
  }

  parts.push(current);

  if (includeNext && next) {
    parts.push(next);
    if (row.paragraph_index != null) {
      paragraphTo = row.paragraph_index + 1;
    }
  }

  const semanticScore = Number(row.semantic_score ?? 0);
  const keywordScore = Number(row.keyword_score ?? 0);
  const feedbackScore = Number(row.feedback_score ?? 0);
  const finalScore =
    typeof row.final_score === "number"
      ? row.final_score
      : semanticScore * 0.72 + keywordScore * 0.28 + feedbackScore;

  return {
    document_name: row.document_name,
    union_name: row.union_name,
    tarif_type: row.tarif_type,
    tariffwerk: row.tariffwerk,
    funktionsgruppe: row.funktionsgruppe,
    page_number: row.page_number,
    paragraph_index: row.paragraph_index,
    paragraph_index_from: paragraphFrom,
    paragraph_index_to: paragraphTo,
    chunk_text: current,
    previous_text: prev || null,
    next_text: next || null,
    full_source_text: parts.join("\n\n").trim(),
    similarity: finalScore,
    semantic_score: semanticScore,
    keyword_score: keywordScore,
    feedback_score: feedbackScore,
    final_score: finalScore,
    feedback_matches: Number(row.feedback_matches ?? 0)
  };
}

async function enrichRows(rows: BaseRow[]): Promise<SearchDocumentRow[]> {
  return Promise.all(
    rows.map(async (row) => {
      const neighbors = await getNeighbors(row.document_name, row.paragraph_index);
      return enrichRowWithNeighbors(row, neighbors.previousText, neighbors.nextText);
    })
  );
}

async function loadRelevantFeedback(
  query: string,
  options: SearchDocumentsOptions
): Promise<FeedbackRow[]> {
  const normalizedQuery = normalizeQueryText(query);
  const normalizedTopicKey = normalizeQueryText(options.topicKey);
  const normalizedSectionKey = normalizeQueryText(options.sectionKey);

  if (!normalizedQuery && !normalizedTopicKey && !normalizedSectionKey) {
    return [];
  }

  const conditions: string[] = [];
  const params: unknown[] = [];
  let index = 1;

  if (normalizedQuery) {
    conditions.push(`normalized_query = $${index++}`);
    params.push(normalizedQuery);
  }

  if (normalizedTopicKey) {
    conditions.push(`topic_key = $${index++}`);
    params.push(normalizedTopicKey);
  }

  if (normalizedSectionKey) {
    conditions.push(`section_key = $${index++}`);
    params.push(normalizedSectionKey);
  }

  if (!conditions.length) {
    return [];
  }

  let unionClause = "";
  if (options.union) {
    params.push(options.union);
    unionClause = `
      AND (
        source_union_name = $${index}
        OR custom_union_name = $${index}
        OR source_union_name IS NULL
        OR custom_union_name IS NULL
      )
    `;
    index += 1;
  }

  const sql = `
    SELECT
      normalized_query,
      topic_key,
      section_key,
      feedback_type,

      source_document_name,
      source_union_name,
      source_tarif_type,
      source_tariffwerk,
      source_funktionsgruppe,
      source_page_number,
      source_paragraph_index,
      source_section_index,
      source_text,
      source_full_text,

      custom_document_name,
      custom_union_name,
      custom_tarif_type,
      custom_tariffwerk,
      custom_funktionsgruppe,
      custom_page_number,
      custom_paragraph_index,
      custom_text
    FROM search_feedback
    WHERE (${conditions.join(" OR ")})
    ${unionClause}
    ORDER BY created_at DESC
    LIMIT 300
  `;

  const result = await pool.query<FeedbackRow>(sql, params);
  return result.rows;
}

function applyFeedbackToRows(
  rows: SearchDocumentRow[],
  feedbackRows: FeedbackRow[],
  query: string,
  options: SearchDocumentsOptions
): SearchDocumentRow[] {
  if (!feedbackRows.length) {
    return rows
      .map((row) => {
        const finalScore = row.semantic_score * 0.72 + row.keyword_score * 0.28;
        return {
          ...row,
          feedback_score: 0,
          feedback_matches: 0,
          final_score: finalScore,
          similarity: finalScore
        };
      })
      .sort((a, b) => b.final_score - a.final_score);
  }

  return rows
    .map((row) => {
      let feedbackScore = 0;
      let feedbackMatches = 0;

      for (const feedback of feedbackRows) {
        const typeWeight = feedbackTypeWeight(feedback.feedback_type);
        if (typeWeight === 0) continue;

        const contextScore = getContextScore({
          searchQuery: query,
          searchTopicKey: options.topicKey,
          searchSectionKey: options.sectionKey,
          feedback
        });

        const sourceScore = getSourceMatchScore(row, feedback);

        if (sourceScore < 0.35) {
          continue;
        }

        const contribution = typeWeight * contextScore * sourceScore;

        if (Math.abs(contribution) < 0.02) {
          continue;
        }

        feedbackScore += contribution;
        feedbackMatches += 1;
      }

      feedbackScore = clamp(feedbackScore, -0.45, 0.45);

      const finalScore =
        row.semantic_score * 0.72 + row.keyword_score * 0.28 + feedbackScore;

      return {
        ...row,
        feedback_score: feedbackScore,
        feedback_matches: feedbackMatches,
        final_score: finalScore,
        similarity: finalScore
      };
    })
    .sort((a, b) => {
      if (b.final_score !== a.final_score) return b.final_score - a.final_score;
      if (b.feedback_score !== a.feedback_score) {
        return b.feedback_score - a.feedback_score;
      }
      return b.semantic_score - a.semantic_score;
    });
}

function dedupeMergedRows(rows: SearchDocumentRow[]): SearchDocumentRow[] {
  const map = new Map<string, SearchDocumentRow>();

  for (const row of rows) {
    const key = buildRowKey(row);
    const existing = map.get(key);

    if (!existing) {
      map.set(key, row);
      continue;
    }

    const semanticScore = Math.max(existing.semantic_score, row.semantic_score);
    const keywordScore = Math.max(existing.keyword_score, row.keyword_score);
    const feedbackScore = Math.max(existing.feedback_score, row.feedback_score);
    const finalScore = semanticScore * 0.72 + keywordScore * 0.28 + feedbackScore;

    map.set(key, {
      ...existing,
      previous_text: existing.previous_text ?? row.previous_text,
      next_text: existing.next_text ?? row.next_text,
      full_source_text: existing.full_source_text || row.full_source_text,
      semantic_score: semanticScore,
      keyword_score: keywordScore,
      feedback_score: feedbackScore,
      final_score: finalScore,
      similarity: finalScore,
      feedback_matches: Math.max(existing.feedback_matches, row.feedback_matches)
    });
  }

  return Array.from(map.values());
}

async function semanticSearchBase(
  query: string,
  options: SearchDocumentsOptions
): Promise<SearchDocumentRow[]> {
  const normalized = normalizeOptions(options);

  const limit =
    typeof normalized.limit === "number" && Number.isFinite(normalized.limit)
      ? Math.max(1, Math.min(normalized.limit, 50))
      : 10;

  const union = normalized.union;

  const embeddingResult = await client.embeddings.create({
    model: "text-embedding-3-small",
    input: query
  });

  const vector = toPgVector(embeddingResult.data[0].embedding);

  const params: unknown[] = [vector];
  let whereClause = "";

  if (union) {
    params.push(union);
    whereClause = `WHERE d.union_name = $${params.length}`;
  }

  params.push(limit);

  const sql = `
    SELECT
      d.name AS document_name,
      d.union_name,
      d.tariff_type AS tarif_type,
      d.tariffwerk,
      d.funktionsgruppe,
      p.page_number,
      p.paragraph_index,
      p.chunk_text,
      1 - (e.embedding <=> $1::vector) AS similarity,
      1 - (e.embedding <=> $1::vector) AS semantic_score,
      0::float AS keyword_score,
      0::float AS feedback_score,
      0::float AS final_score,
      0::int AS feedback_matches
    FROM document_embeddings e
    INNER JOIN document_paragraphs p
      ON p.id = e.paragraph_id
    INNER JOIN documents d
      ON d.id = p.document_id
    ${whereClause}
    ORDER BY e.embedding <=> $1::vector
    LIMIT $${params.length}
  `;

  const result = await pool.query<BaseRow>(sql, params);
  return enrichRows(result.rows);
}

async function keywordSearchBase(
  query: string,
  options: SearchDocumentsOptions
): Promise<SearchDocumentRow[]> {
  const normalized = normalizeOptions(options);

  const limit =
    typeof normalized.limit === "number" && Number.isFinite(normalized.limit)
      ? Math.max(1, Math.min(normalized.limit, 50))
      : 10;

  const union = normalized.union;

  const params: unknown[] = [query];
  let whereClause = `WHERE p.chunk_text ILIKE '%' || $1 || '%'`;

  if (union) {
    params.push(union);
    whereClause += ` AND d.union_name = $${params.length}`;
  }

  params.push(limit);

  const sql = `
    SELECT
      d.name AS document_name,
      d.union_name,
      d.tariff_type AS tarif_type,
      d.tariffwerk,
      d.funktionsgruppe,
      p.page_number,
      p.paragraph_index,
      p.chunk_text,
      0.35::float AS similarity,
      0::float AS semantic_score,
      0.35::float AS keyword_score,
      0::float AS feedback_score,
      0::float AS final_score,
      0::int AS feedback_matches
    FROM document_paragraphs p
    INNER JOIN documents d
      ON d.id = p.document_id
    ${whereClause}
    ORDER BY
      d.name ASC,
      p.page_number ASC NULLS LAST,
      p.paragraph_index ASC NULLS LAST
    LIMIT $${params.length}
  `;

  const result = await pool.query<BaseRow>(sql, params);
  return enrichRows(result.rows);
}

export async function searchDocuments(
  query: string,
  options: SearchDocumentsOptions | number = {}
): Promise<SearchDocumentRow[]> {
  const normalized = normalizeOptions(options);

  const limit =
    typeof normalized.limit === "number" && Number.isFinite(normalized.limit)
      ? Math.max(1, Math.min(normalized.limit, 50))
      : 10;

  const [semanticRows, feedbackRows] = await Promise.all([
    semanticSearchBase(query, normalized),
    loadRelevantFeedback(query, normalized)
  ]);

  const ranked = applyFeedbackToRows(semanticRows, feedbackRows, query, normalized);

  return ranked.slice(0, limit);
}

export async function keywordSearch(
  query: string,
  options: SearchDocumentsOptions | number = {}
): Promise<SearchDocumentRow[]> {
  const normalized = normalizeOptions(options);

  const limit =
    typeof normalized.limit === "number" && Number.isFinite(normalized.limit)
      ? Math.max(1, Math.min(normalized.limit, 50))
      : 10;

  const [keywordRows, feedbackRows] = await Promise.all([
    keywordSearchBase(query, normalized),
    loadRelevantFeedback(query, normalized)
  ]);

  const ranked = applyFeedbackToRows(keywordRows, feedbackRows, query, normalized);

  return ranked.slice(0, limit);
}

export async function hybridSearch(
  query: string,
  options: SearchDocumentsOptions | number = {}
): Promise<SearchDocumentRow[]> {
  const normalized = normalizeOptions(options);

  const limit =
    typeof normalized.limit === "number" && Number.isFinite(normalized.limit)
      ? Math.max(1, Math.min(normalized.limit, 50))
      : 10;

  const expandedLimit = Math.min(limit * 2, 50);

  const [semanticRows, keywordRows, feedbackRows] = await Promise.all([
    semanticSearchBase(query, {
      ...normalized,
      limit: expandedLimit
    }),
    keywordSearchBase(query, {
      ...normalized,
      limit: Math.min(expandedLimit, 20)
    }),
    loadRelevantFeedback(query, normalized)
  ]);

  const merged = dedupeMergedRows([...semanticRows, ...keywordRows]);
  const ranked = applyFeedbackToRows(merged, feedbackRows, query, normalized);

  return ranked.slice(0, limit);
}