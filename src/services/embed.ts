import OpenAI from "openai";
import { pool } from "../db.js";

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  throw new Error("OPENAI_API_KEY is not set");
}

const client = new OpenAI({
  apiKey
});

function toPgVector(values: number[]) {
  return `[${values.join(",")}]`;
}

export async function embedParagraphs(limit = 200) {
  console.log("[embed] start, limit =", limit);

  const paragraphs = await pool.query(
    `
    SELECT p.id, p.chunk_text
    FROM document_paragraphs p
    LEFT JOIN document_embeddings e
      ON e.paragraph_id = p.id
    WHERE e.id IS NULL
    ORDER BY p.id ASC
    LIMIT $1
    `,
    [limit]
  );

  console.log("[embed] paragraphs found =", paragraphs.rows.length);

  const results: Array<{
    paragraphId: string | number;
    ok?: boolean;
    error?: string;
  }> = [];

  let successCount = 0;
  let errorCount = 0;

  for (const row of paragraphs.rows) {
    try {
      console.log("[embed] embedding paragraph", row.id);

      const embedding = await client.embeddings.create({
        model: "text-embedding-3-small",
        input: row.chunk_text
      });

      const vector = embedding.data[0].embedding;
      const pgVector = toPgVector(vector);

      await pool.query(
        `
        INSERT INTO document_embeddings (paragraph_id, embedding)
        VALUES ($1, $2::vector)
        `,
        [row.id, pgVector]
      );

      successCount++;
      results.push({
        paragraphId: row.id,
        ok: true
      });

      console.log("[embed] stored paragraph", row.id);
    } catch (err: any) {
      errorCount++;
      results.push({
        paragraphId: row.id,
        error: err?.message ?? "Unknown error"
      });

      console.error("[embed] error paragraph", row.id, err?.message ?? err);
    }
  }

  console.log("[embed] done", { successCount, errorCount });

  return {
    ok: errorCount === 0,
    processed: results.length,
    successCount,
    errorCount,
    results
  };
}