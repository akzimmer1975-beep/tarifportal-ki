CREATE EXTENSION IF NOT EXISTS vector;

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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_documents_union_name
    ON documents (union_name);

CREATE INDEX IF NOT EXISTS idx_documents_tariffwerk
    ON documents (tariffwerk);

CREATE INDEX IF NOT EXISTS idx_documents_funktionsgruppe
    ON documents (funktionsgruppe);

CREATE INDEX IF NOT EXISTS idx_documents_valid_from
    ON documents (valid_from);

CREATE INDEX IF NOT EXISTS idx_documents_last_modified
    ON documents (last_modified);

CREATE INDEX IF NOT EXISTS idx_documents_path
    ON documents (path);