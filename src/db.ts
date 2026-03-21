import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false
});

export async function testDbConnection() {
  const client = await pool.connect();

  try {
    const result = await client.query("SELECT NOW() as now");
    return result.rows[0];
  } finally {
    client.release();
  }
}

export async function initDb() {
  await pool.query(`
    CREATE EXTENSION IF NOT EXISTS vector;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS documents (
      id BIGSERIAL PRIMARY KEY,
      item_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      path TEXT NOT NULL,
      union_name TEXT,
      tariff_type TEXT,
      tariffwerk TEXT,
      funktionsgruppe TEXT,
      stand TEXT,
      valid_from DATE,
      valid_to DATE,
      last_modified TIMESTAMPTZ,
      size BIGINT,
      web_url TEXT,
      downloaded_at TIMESTAMPTZ,
      text_extracted_at TIMESTAMPTZ,
      embedding_status TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_documents_union_name
    ON documents (union_name);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_documents_tariff_type
    ON documents (tariff_type);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_documents_tariffwerk
    ON documents (tariffwerk);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_documents_funktionsgruppe
    ON documents (funktionsgruppe);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_documents_valid_from
    ON documents (valid_from);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS document_paragraphs (
      id BIGSERIAL PRIMARY KEY,
      document_id BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL,
      page_number INTEGER NOT NULL,
      paragraph_index INTEGER NOT NULL,
      chunk_text TEXT NOT NULL,
      char_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (document_id, page_number, paragraph_index)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_document_paragraphs_document_id
    ON document_paragraphs (document_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_document_paragraphs_item_id
    ON document_paragraphs (item_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_document_paragraphs_page_number
    ON document_paragraphs (page_number);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS search_feedback (
      id BIGSERIAL PRIMARY KEY,

      query_text TEXT NOT NULL,
      normalized_query TEXT NOT NULL,
      topic_key TEXT,
      section_key TEXT,

      target_type TEXT NOT NULL CHECK (
        target_type IN ('source', 'answer', 'custom_source')
      ),

      feedback_type TEXT NOT NULL CHECK (
        feedback_type IN (
          'relevant',
          'preferred',
          'not_relevant',
          'answer_good',
          'answer_bad',
          'sources_good',
          'sources_bad',
          'custom_source'
        )
      ),

      source_document_name TEXT,
      source_union_name TEXT,
      source_tariff_type TEXT,
      source_tariffwerk TEXT,
      source_funktionsgruppe TEXT,
      source_page_number INTEGER,
      source_paragraph_index INTEGER,
      source_text TEXT,
      source_similarity DOUBLE PRECISION,

      custom_document_name TEXT,
      custom_union_name TEXT,
      custom_tariff_type TEXT,
      custom_tariffwerk TEXT,
      custom_funktionsgruppe TEXT,
      custom_page_number INTEGER,
      custom_paragraph_index INTEGER,
      custom_text TEXT,
      custom_comment TEXT,

      answer_text TEXT,
      user_comment TEXT,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_search_feedback_normalized_query
    ON search_feedback (normalized_query);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_search_feedback_topic_key
    ON search_feedback (topic_key);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_search_feedback_section_key
    ON search_feedback (section_key);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_search_feedback_target_type
    ON search_feedback (target_type);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_search_feedback_feedback_type
    ON search_feedback (feedback_type);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_search_feedback_created_at
    ON search_feedback (created_at DESC);
  `);
}

export async function upsertDocuments(files: any[]) {
  let written = 0;

  for (const file of files) {
    await pool.query(
      `
      INSERT INTO documents (
        item_id,
        name,
        path,
        union_name,
        tariff_type,
        tariffwerk,
        funktionsgruppe,
        stand,
        valid_from,
        valid_to,
        last_modified,
        size,
        web_url,
        updated_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW()
      )
      ON CONFLICT (item_id)
      DO UPDATE SET
        name = EXCLUDED.name,
        path = EXCLUDED.path,
        union_name = EXCLUDED.union_name,
        tariff_type = EXCLUDED.tariff_type,
        tariffwerk = EXCLUDED.tariffwerk,
        funktionsgruppe = EXCLUDED.funktionsgruppe,
        stand = EXCLUDED.stand,
        valid_from = EXCLUDED.valid_from,
        valid_to = EXCLUDED.valid_to,
        last_modified = EXCLUDED.last_modified,
        size = EXCLUDED.size,
        web_url = EXCLUDED.web_url,
        updated_at = NOW()
      `,
      [
        file.itemId,
        file.name,
        file.path,
        file.union ?? null,
        file.tariffType ?? null,
        file.tariffwerk ?? null,
        file.funktionsgruppe ?? null,
        file.stand ?? null,
        file.validFrom ?? null,
        file.validTo ?? null,
        file.lastModifiedDateTime ?? null,
        Number(file.size ?? 0),
        file.webUrl ?? null
      ]
    );

    written++;
  }

  return {
    ok: true,
    count: written
  };
}

export type GetDocumentsOptions = {
  limit?: number;
  union?: string;
  tariffType?: string;
  tariffwerk?: string;
  funktionsgruppe?: string;
  q?: string;
};

export async function getDocuments(options: GetDocumentsOptions = {}) {
  const limit = Math.max(1, Math.min(options.limit ?? 100, 500));

  const where: string[] = [];
  const values: unknown[] = [];
  let index = 1;

  if (options.union) {
    where.push(`union_name = $${index++}`);
    values.push(options.union);
  }

  if (options.tariffType) {
    where.push(`tariff_type = $${index++}`);
    values.push(options.tariffType);
  }

  if (options.tariffwerk) {
    where.push(`tariffwerk = $${index++}`);
    values.push(options.tariffwerk);
  }

  if (options.funktionsgruppe) {
    where.push(`funktionsgruppe = $${index++}`);
    values.push(options.funktionsgruppe);
  }

  if (options.q) {
    where.push(`(
      name ILIKE $${index}
      OR path ILIKE $${index}
      OR COALESCE(union_name,'') ILIKE $${index}
      OR COALESCE(tariff_type,'') ILIKE $${index}
      OR COALESCE(tariffwerk,'') ILIKE $${index}
      OR COALESCE(funktionsgruppe,'') ILIKE $${index}
      OR COALESCE(stand,'') ILIKE $${index}
    )`);
    values.push(`%${options.q}%`);
    index++;
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";

  values.push(limit);

  const result = await pool.query(
    `
    SELECT
      id,
      item_id,
      name,
      path,
      union_name,
      tariff_type,
      tariffwerk,
      funktionsgruppe,
      stand,
      TO_CHAR(valid_from,'YYYY-MM-DD') AS valid_from,
      TO_CHAR(valid_to,'YYYY-MM-DD') AS valid_to,
      last_modified,
      size,
      web_url,
      downloaded_at,
      text_extracted_at,
      embedding_status,
      created_at,
      updated_at
    FROM documents
    ${whereSql}
    ORDER BY
      union_name ASC NULLS LAST,
      tariff_type ASC NULLS LAST,
      tariffwerk ASC NULLS LAST,
      funktionsgruppe ASC NULLS LAST,
      valid_from DESC NULLS LAST,
      updated_at DESC
    LIMIT $${index}
    `,
    values
  );

  return result.rows;
}

export async function getDocumentByItemId(itemId: string) {
  const result = await pool.query(
    `
    SELECT
      id,
      item_id,
      name,
      path,
      union_name,
      tariff_type,
      tariffwerk,
      funktionsgruppe,
      stand,
      TO_CHAR(valid_from,'YYYY-MM-DD') AS valid_from,
      TO_CHAR(valid_to,'YYYY-MM-DD') AS valid_to,
      last_modified,
      size,
      web_url,
      downloaded_at,
      text_extracted_at,
      embedding_status,
      created_at,
      updated_at
    FROM documents
    WHERE item_id = $1
    LIMIT 1
    `,
    [itemId]
  );

  return result.rows[0] ?? null;
}

export async function getDocumentsMeta() {
  const [unionsResult, tariffTypesResult, tariffwerkeResult, funktionsgruppenResult] =
    await Promise.all([
      pool.query(`
        SELECT DISTINCT union_name
        FROM documents
        WHERE union_name IS NOT NULL AND union_name <> ''
        ORDER BY union_name ASC
      `),
      pool.query(`
        SELECT DISTINCT tariff_type
        FROM documents
        WHERE tariff_type IS NOT NULL AND tariff_type <> ''
        ORDER BY tariff_type ASC
      `),
      pool.query(`
        SELECT DISTINCT tariffwerk
        FROM documents
        WHERE tariffwerk IS NOT NULL AND tariffwerk <> ''
        ORDER BY tariffwerk ASC
      `),
      pool.query(`
        SELECT DISTINCT funktionsgruppe
        FROM documents
        WHERE funktionsgruppe IS NOT NULL AND funktionsgruppe <> ''
        ORDER BY funktionsgruppe ASC
      `)
    ]);

  return {
    unions: unionsResult.rows.map((row) => row.union_name),
    tariffTypes: tariffTypesResult.rows.map((row) => row.tariff_type),
    tariffwerke: tariffwerkeResult.rows.map((row) => row.tariffwerk),
    funktionsgruppen: funktionsgruppenResult.rows.map((row) => row.funktionsgruppe)
  };
}

export type SaveDocumentParagraphInput = {
  documentId: number;
  itemId: string;
  pageNumber: number;
  paragraphIndex: number;
  chunkText: string;
};

export async function replaceDocumentParagraphs(
  documentId: number,
  itemId: string,
  paragraphs: SaveDocumentParagraphInput[]
) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `DELETE FROM document_paragraphs WHERE document_id = $1`,
      [documentId]
    );

    let written = 0;

    for (const paragraph of paragraphs) {
      await client.query(
        `
        INSERT INTO document_paragraphs (
          document_id,
          item_id,
          page_number,
          paragraph_index,
          chunk_text,
          char_count,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        `,
        [
          documentId,
          itemId,
          paragraph.pageNumber,
          paragraph.paragraphIndex,
          paragraph.chunkText,
          paragraph.chunkText.length
        ]
      );

      written++;
    }

    await client.query(
      `
      UPDATE documents
      SET
        downloaded_at = COALESCE(downloaded_at, NOW()),
        text_extracted_at = NOW(),
        updated_at = NOW()
      WHERE id = $1
      `,
      [documentId]
    );

    await client.query("COMMIT");

    return {
      ok: true,
      written
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getDocumentParagraphsByItemId(itemId: string) {
  const result = await pool.query(
    `
    SELECT
      dp.id,
      dp.document_id,
      dp.item_id,
      dp.page_number,
      dp.paragraph_index,
      dp.chunk_text,
      dp.char_count,
      dp.created_at,
      dp.updated_at
    FROM document_paragraphs dp
    WHERE dp.item_id = $1
    ORDER BY dp.page_number ASC, dp.paragraph_index ASC
    `,
    [itemId]
  );

  return result.rows;
}

export async function getDocumentsPendingTextExtraction(limit = 25) {
  const safeLimit = Math.max(1, Math.min(limit, 500));

  const result = await pool.query(
    `
    SELECT
      id,
      item_id,
      name,
      path,
      union_name,
      tariff_type,
      tariffwerk,
      funktionsgruppe,
      stand,
      valid_from,
      valid_to,
      last_modified,
      size,
      web_url,
      downloaded_at,
      text_extracted_at,
      embedding_status,
      created_at,
      updated_at
    FROM documents
    WHERE text_extracted_at IS NULL
    ORDER BY created_at ASC, id ASC
    LIMIT $1
    `,
    [safeLimit]
  );

  return result.rows;
}