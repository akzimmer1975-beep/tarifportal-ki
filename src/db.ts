import pg from "pg";
import "dotenv/config";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL ist nicht gesetzt.");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.PGSSLMODE === "disable"
      ? false
      : {
          rejectUnauthorized: false
        }
});

export type DocumentRow = {
  id: number;
  item_id: string;
  name: string;
  path: string;
  union_name: string | null;
  tariff_type: string | null;
  tariffwerk: string | null;
  funktionsgruppe: string | null;
  stand: string | null;
  valid_from: string | null;
  valid_to: string | null;
  last_modified: string | null;
  size: number | null;
  web_url: string | null;
  downloaded_at: string | null;
  text_extracted_at: string | null;
  embedding_status: string | null;
  created_at: string;
  updated_at: string;
};

export type DocumentMetaInput = {
  itemId: string;
  name: string;
  path: string;
  union?: string | null;
  tariffType?: string | null;
  tariffwerk?: string | null;
  funktionsgruppe?: string | null;
  stand?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  lastModified?: string | null;
  size?: number | null;
  webUrl?: string | null;
  downloadedAt?: string | null;
  textExtractedAt?: string | null;
  embeddingStatus?: string | null;
};

export type DocumentParagraphInput = {
  itemId?: string;
  documentId?: number;
  pageNumber: number;
  paragraphIndex: number;
  chunkText: string;
  charCount?: number;
};

export type RawParagraphInput = {
  pageNumber?: number;
  page_number?: number;
  paragraphIndex?: number;
  paragraph_index?: number;
  chunkText?: string;
  chunk_text?: string;
  charCount?: number;
  char_count?: number;
};

export type UpsertDocumentsResult = DocumentRow[] & {
  count: number;
};

export type ReplaceParagraphsResult = {
  documentId: number;
  paragraphCount: number;
  written: number;
};

type ReplaceParagraphsObjectInput = {
  itemId: string;
  documentId?: number;
  paragraphs: DocumentParagraphInput[];
};

export type GetDocumentsOptions = {
  limit?: number;
  union?: string;
  tariffType?: string;
  tariffwerk?: string;
  funktionsgruppe?: string;
  q?: string;
};

export async function testDbConnection() {
  const client = await pool.connect();
  try {
    const result = await client.query("SELECT NOW() AS now");
    return result.rows[0];
  } finally {
    client.release();
  }
}

export async function initDb(): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query(`CREATE EXTENSION IF NOT EXISTS vector;`);

    await client.query(`
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

    await client.query(`
      CREATE TABLE IF NOT EXISTS document_paragraphs (
        id BIGSERIAL PRIMARY KEY,
        document_id BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL,
        page_number INT NOT NULL,
        paragraph_index INT NOT NULL,
        chunk_text TEXT NOT NULL,
        char_count INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS document_embeddings (
        id BIGSERIAL PRIMARY KEY,
        paragraph_id BIGINT NOT NULL REFERENCES document_paragraphs(id) ON DELETE CASCADE,
        embedding vector(1536),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS search_feedback (
        id BIGSERIAL PRIMARY KEY,
        query_text TEXT NOT NULL,
        normalized_query TEXT NOT NULL,
        topic_key TEXT,
        section_key TEXT,
        target_type TEXT NOT NULL,
        feedback_type TEXT NOT NULL,

        source_document_name TEXT,
        source_union_name TEXT,
        source_tarif_type TEXT,
        source_tariffwerk TEXT,
        source_funktionsgruppe TEXT,
        source_page_number INT,
        source_paragraph_index INT,
        source_text TEXT,
        source_similarity DOUBLE PRECISION,

        custom_document_name TEXT,
        custom_union_name TEXT,
        custom_tarif_type TEXT,
        custom_tariffwerk TEXT,
        custom_funktionsgruppe TEXT,
        custom_page_number INT,
        custom_paragraph_index INT,
        custom_text TEXT,
        custom_comment TEXT,

        answer_text TEXT,
        user_comment TEXT,

        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        query_embedding vector(1536)
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_documents_item_id
      ON documents(item_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_documents_union_name
      ON documents(union_name);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_documents_tarif_type
      ON documents(tarif_type);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_document_paragraphs_document_id
      ON document_paragraphs(document_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_document_paragraphs_item_id
      ON document_paragraphs(item_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_document_embeddings_paragraph_id
      ON document_embeddings(paragraph_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_search_feedback_normalized_query
      ON search_feedback(normalized_query);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_search_feedback_feedback_type
      ON search_feedback(feedback_type);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_search_feedback_target_type
      ON search_feedback(target_type);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_search_feedback_source_union_name
      ON search_feedback(source_union_name);
    `);

    try {
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_document_embeddings_vector_cosine
        ON document_embeddings
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100);
      `);
    } catch (error) {
      console.warn("Konnte ivfflat-Index nicht anlegen:", error);
    }
  } finally {
    client.release();
  }
}

export async function getDocuments(
  options: GetDocumentsOptions = {}
): Promise<DocumentRow[]> {
  const limit =
    typeof options.limit === "number" && Number.isFinite(options.limit)
      ? Math.max(1, Math.min(options.limit, 500))
      : 100;

  const params: unknown[] = [];
  const where: string[] = [];

  if (options.union?.trim()) {
    params.push(options.union.trim());
    where.push(`union_name = $${params.length}`);
  }

  if (options.tariffType?.trim()) {
    params.push(options.tariffType.trim());
    where.push(`tarif_type = $${params.length}`);
  }

  if (options.tariffwerk?.trim()) {
    params.push(options.tariffwerk.trim());
    where.push(`tariffwerk = $${params.length}`);
  }

  if (options.funktionsgruppe?.trim()) {
    params.push(options.funktionsgruppe.trim());
    where.push(`funktionsgruppe = $${params.length}`);
  }

  if (options.q?.trim()) {
    params.push(`%${options.q.trim()}%`);
    const qParam = `$${params.length}`;
    where.push(`(
      name ILIKE ${qParam}
      OR path ILIKE ${qParam}
      OR COALESCE(union_name, '') ILIKE ${qParam}
      OR COALESCE(tarif_type, '') ILIKE ${qParam}
      OR COALESCE(tariffwerk, '') ILIKE ${qParam}
      OR COALESCE(funktionsgruppe, '') ILIKE ${qParam}
    )`);
  }

  params.push(limit);

  const sql = `
    SELECT
      id,
      item_id,
      name,
      path,
      union_name,
      tarif_type,
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
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY
      union_name ASC NULLS LAST,
      tariffwerk ASC NULLS LAST,
      name ASC
    LIMIT $${params.length}
  `;

  const result = await pool.query<DocumentRow>(sql, params);
  return result.rows;
}

export async function getDocumentsMeta(_options?: unknown): Promise<DocumentRow[]> {
  const result = await pool.query<DocumentRow>(`
    SELECT
      id,
      item_id,
      name,
      path,
      union_name,
      tarif_type,
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
    ORDER BY
      union_name ASC NULLS LAST,
      tariffwerk ASC NULLS LAST,
      name ASC
  `);

  return result.rows;
}

export async function getDocumentByItemId(
  itemId: string
): Promise<DocumentRow | null> {
  const result = await pool.query<DocumentRow>(
    `
      SELECT
        id,
        item_id,
        name,
        path,
        union_name,
        tarif_type,
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
      WHERE item_id = $1
      LIMIT 1
    `,
    [itemId]
  );

  return result.rows[0] ?? null;
}

export async function upsertDocuments(
  docs: DocumentMetaInput[]
): Promise<UpsertDocumentsResult> {
  if (!docs.length) {
    return Object.assign([] as DocumentRow[], { count: 0 });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const saved: DocumentRow[] = [];

    for (const doc of docs) {
      const result = await client.query<DocumentRow>(
        `
          INSERT INTO documents (
            item_id,
            name,
            path,
            union_name,
            tarif_type,
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
            updated_at
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8,
            $9::date,
            $10::date,
            $11::timestamptz,
            $12,
            $13,
            $14::timestamptz,
            $15::timestamptz,
            $16,
            NOW()
          )
          ON CONFLICT (item_id)
          DO UPDATE SET
            name = EXCLUDED.name,
            path = EXCLUDED.path,
            union_name = EXCLUDED.union_name,
            tarif_type = EXCLUDED.tarif_type,
            tariffwerk = EXCLUDED.tariffwerk,
            funktionsgruppe = EXCLUDED.funktionsgruppe,
            stand = EXCLUDED.stand,
            valid_from = EXCLUDED.valid_from,
            valid_to = EXCLUDED.valid_to,
            last_modified = EXCLUDED.last_modified,
            size = EXCLUDED.size,
            web_url = EXCLUDED.web_url,
            downloaded_at = EXCLUDED.downloaded_at,
            text_extracted_at = COALESCE(EXCLUDED.text_extracted_at, documents.text_extracted_at),
            embedding_status = COALESCE(EXCLUDED.embedding_status, documents.embedding_status),
            updated_at = NOW()
          RETURNING
            id,
            item_id,
            name,
            path,
            union_name,
            tarif_type,
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
        `,
        [
          doc.itemId,
          doc.name,
          doc.path,
          doc.union ?? null,
          doc.tarifType ?? null,
          doc.tariffwerk ?? null,
          doc.funktionsgruppe ?? null,
          doc.stand ?? null,
          doc.validFrom ?? null,
          doc.validTo ?? null,
          doc.lastModified ?? null,
          doc.size ?? null,
          doc.webUrl ?? null,
          doc.downloadedAt ?? null,
          doc.textExtractedAt ?? null,
          doc.embeddingStatus ?? null
        ]
      );

      saved.push(result.rows[0]);
    }

    await client.query("COMMIT");

    return Object.assign(saved, {
      count: saved.length
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function normalizeRawParagraphs(
  rawParagraphs: RawParagraphInput[],
  itemId: string,
  documentId?: number
): DocumentParagraphInput[] {
  return rawParagraphs.map((p, index) => ({
    itemId,
    documentId,
    pageNumber: p.pageNumber ?? p.page_number ?? 1,
    paragraphIndex: p.paragraphIndex ?? p.paragraph_index ?? index + 1,
    chunkText: p.chunkText ?? p.chunk_text ?? "",
    charCount: p.charCount ?? p.char_count
  }));
}

async function replaceDocumentParagraphsInternal(
  params: ReplaceParagraphsObjectInput
): Promise<ReplaceParagraphsResult> {
  const { itemId, documentId: explicitDocumentId, paragraphs } = params;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    let documentId = explicitDocumentId;

    if (!documentId) {
      const docResult = await client.query<{ id: number }>(
        `SELECT id FROM documents WHERE item_id = $1 LIMIT 1`,
        [itemId]
      );

      documentId = docResult.rows[0]?.id;
    }

    if (!documentId) {
      throw new Error(`Dokument mit item_id '${itemId}' nicht gefunden.`);
    }

    const existingParagraphIds = await client.query<{ id: number }>(
      `SELECT id FROM document_paragraphs WHERE document_id = $1`,
      [documentId]
    );

    const paragraphIds = existingParagraphIds.rows.map((row) => row.id);

    if (paragraphIds.length) {
      await client.query(
        `DELETE FROM document_embeddings WHERE paragraph_id = ANY($1::bigint[])`,
        [paragraphIds]
      );
    }

    await client.query(`DELETE FROM document_paragraphs WHERE document_id = $1`, [
      documentId
    ]);

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
          paragraph.charCount ?? paragraph.chunkText.length
        ]
      );

      written += 1;
    }

    await client.query(
      `
        UPDATE documents
        SET
          text_extracted_at = NOW(),
          embedding_status = 'pending',
          updated_at = NOW()
        WHERE id = $1
      `,
      [documentId]
    );

    await client.query("COMMIT");

    return {
      documentId,
      paragraphCount: written,
      written
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function replaceDocumentParagraphs(
  params: ReplaceParagraphsObjectInput
): Promise<ReplaceParagraphsResult>;

export async function replaceDocumentParagraphs(
  itemId: string,
  paragraphs: RawParagraphInput[],
  options?: unknown
): Promise<ReplaceParagraphsResult>;

export async function replaceDocumentParagraphs(
  documentId: number,
  itemId: string,
  paragraphs: RawParagraphInput[]
): Promise<ReplaceParagraphsResult>;

export async function replaceDocumentParagraphs(
  arg1: ReplaceParagraphsObjectInput | string | number,
  arg2?: string | RawParagraphInput[],
  arg3?: unknown
): Promise<ReplaceParagraphsResult> {
  if (typeof arg1 === "number") {
    const documentId = arg1;
    const itemId = typeof arg2 === "string" ? arg2 : "";
    const rawParagraphs = Array.isArray(arg3) ? (arg3 as RawParagraphInput[]) : [];

    if (!itemId) {
      throw new Error("itemId fehlt.");
    }

    return replaceDocumentParagraphsInternal({
      documentId,
      itemId,
      paragraphs: normalizeRawParagraphs(rawParagraphs, itemId, documentId)
    });
  }

  if (typeof arg1 === "string") {
    const itemId = arg1;
    const rawParagraphs = Array.isArray(arg2) ? arg2 : [];

    return replaceDocumentParagraphsInternal({
      itemId,
      paragraphs: normalizeRawParagraphs(rawParagraphs, itemId)
    });
  }

  return replaceDocumentParagraphsInternal(arg1);
}

export async function setDocumentEmbeddingStatus(
  itemId: string,
  status: string
): Promise<void> {
  await pool.query(
    `
      UPDATE documents
      SET
        embedding_status = $2,
        updated_at = NOW()
      WHERE item_id = $1
    `,
    [itemId, status]
  );
}

export async function getParagraphsForEmbedding(limit = 100): Promise<
  Array<{
    paragraph_id: number;
    item_id: string;
    chunk_text: string;
  }>
> {
  const result = await pool.query<{
    paragraph_id: number;
    item_id: string;
    chunk_text: string;
  }>(
    `
      SELECT
        p.id AS paragraph_id,
        p.item_id,
        p.chunk_text
      FROM document_paragraphs p
      LEFT JOIN document_embeddings e
        ON e.paragraph_id = p.id
      WHERE e.id IS NULL
      ORDER BY p.id ASC
      LIMIT $1
    `,
    [limit]
  );

  return result.rows;
}

export async function saveParagraphEmbedding(params: {
  paragraphId: number;
  embedding: number[];
}): Promise<void> {
  await pool.query(
    `
      INSERT INTO document_embeddings (paragraph_id, embedding)
      VALUES ($1, $2::vector)
      ON CONFLICT DO NOTHING
    `,
    [params.paragraphId, `[${params.embedding.join(",")}]`]
  );
}