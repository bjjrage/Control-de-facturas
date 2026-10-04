-- Run only on Preview BEFORE applying 20261004050753; all changes roll back.
BEGIN;
CREATE TEMP TABLE goekua_before_columns AS SELECT * FROM information_schema.columns WHERE table_schema='public';
CREATE TEMP TABLE goekua_before_cdc AS SELECT id, cdc FROM public.sales_documents;
CREATE TEMP TABLE goekua_before_constraints AS SELECT * FROM information_schema.table_constraints WHERE table_schema='public';
ALTER TABLE public.sales_documents ADD COLUMN goekua_document_id text;
COMMENT ON COLUMN public.sales_documents.goekua_document_id IS
  'Opaque Goekua create identifier; not a fiscal CDC. Non-null blocks reissuance pending reconciliation.';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sales_documents'
    AND column_name='goekua_document_id' AND data_type='text' AND is_nullable='YES' AND column_default IS NULL) THEN
    RAISE EXCEPTION 'Provider ID must be nullable text without default';
  END IF;
  IF EXISTS (
    (SELECT * FROM information_schema.columns WHERE table_schema='public' AND NOT (table_name='sales_documents' AND column_name='goekua_document_id')
      EXCEPT SELECT * FROM goekua_before_columns)
    UNION ALL (SELECT * FROM goekua_before_columns EXCEPT SELECT * FROM information_schema.columns WHERE table_schema='public')
  ) THEN RAISE EXCEPTION 'Unexpected column delta'; END IF;
  IF EXISTS (
    (SELECT * FROM information_schema.table_constraints WHERE table_schema='public' EXCEPT SELECT * FROM goekua_before_constraints)
    UNION ALL (SELECT * FROM goekua_before_constraints EXCEPT SELECT * FROM information_schema.table_constraints WHERE table_schema='public')
  ) THEN RAISE EXCEPTION 'Unexpected constraint delta'; END IF;
  IF EXISTS (SELECT 1 FROM public.sales_documents WHERE goekua_document_id IS NOT NULL) THEN RAISE EXCEPTION 'Unexpected backfill'; END IF;
  IF EXISTS (
    (SELECT id,cdc FROM public.sales_documents EXCEPT SELECT * FROM goekua_before_cdc)
    UNION ALL (SELECT * FROM goekua_before_cdc EXCEPT SELECT id,cdc FROM public.sales_documents)
  ) THEN RAISE EXCEPTION 'CDC changed'; END IF;
END $$;
SELECT 'PASS: only nullable text provider ID, no backfill/CDC/constraint changes' AS result;
ROLLBACK;
