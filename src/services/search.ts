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

export async function searchDocuments(
  query: string,
  options: { limit?: number; union?: "GDL" | "EVG" } = {}
): Promise<SearchDocumentRow[]> {

  const limit = options.limit ?? 10;
  const union = options.union;

  const embedding = await client.embeddings.create({
    model: "text-embedding-3-small",
    input: query
  });

  const vector = toPgVector(embedding.data[0].embedding);

  const params: unknown[] = [vector];

  let unionFilter = "";

  if (union) {
    params.push(union);
    unionFilter = `WHERE d.union_name = $${params.length}`;
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
    JOIN document_paragraphs p
      ON p.id = e.paragraph_id
    JOIN documents d
      ON d.id = p.document_id

    ${unionFilter}

    ORDER BY e.embedding <=> $1::vector
    LIMIT $${params.length}
  `;

  const result = await pool.query<SearchDocumentRow>(sql, params);

  return result.rows;
}