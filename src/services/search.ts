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
  chunk_text: string;
  similarity: number;
};

export type SearchDocumentsOptions = {
  limit?: number;
  union?: "GDL" | "EVG";
};

function normalizeOptions(
  options: SearchDocumentsOptions | number = {}
): SearchDocumentsOptions {
  if (typeof options === "number") {
    return { limit: options };
  }
  return options;
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
      d.tarif_type,
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

  const result = await pool.query<SearchDocumentRow>(sql, params);
  return result.rows;
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
      d.tarif_type,
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

  const result = await pool.query<SearchDocumentRow>(sql, params);
  return result.rows;
}