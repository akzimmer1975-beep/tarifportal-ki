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
};

export type SearchDocumentsOptions = {
  limit?: number;
  union?: "GDL" | "EVG";
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
};

type NeighborRow = {
  paragraph_index: number | null;
  chunk_text: string | null;
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

function enrichRowWithNeighbors(row: BaseRow, previousText: string | null, nextText: string | null): SearchDocumentRow {
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
    similarity: row.similarity
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

export async function searchDocuments(
  query: string,
  options: SearchDocumentsOptions | number = {}
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
      1 - (e.embedding <=> $1::vector) AS similarity
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

export async function keywordSearch(
  query: string,
  options: SearchDocumentsOptions | number = {}
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
      0.35::float AS similarity
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