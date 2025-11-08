-- 04_documents.sql
SET search_path = docs, public;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'doc_kind_enum'
      AND n.nspname = 'docs'
  ) THEN
    CREATE TYPE docs.doc_kind_enum AS ENUM ('note');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     smallint REFERENCES settings.profile(id) ON DELETE SET NULL,
  title        text NOT NULL,
  kind         doc_kind_enum NOT NULL DEFAULT 'note',
  tags         text[] DEFAULT '{}',
  body_md      text,            -- optional markdown
  body_json    jsonb,           -- or structured blob
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS documents_owner_idx ON documents (owner_id);
CREATE INDEX IF NOT EXISTS documents_tags_gin ON documents USING gin (tags);
CREATE INDEX IF NOT EXISTS documents_title_trgm ON documents USING gin (title gin_trgm_ops);

DROP TRIGGER IF EXISTS t_documents_u ON documents;
CREATE TRIGGER t_documents_u
BEFORE UPDATE ON documents
FOR EACH ROW EXECUTE FUNCTION util.touch_updated_at();
