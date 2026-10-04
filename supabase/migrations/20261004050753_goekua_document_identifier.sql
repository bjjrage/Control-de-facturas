ALTER TABLE public.sales_documents ADD COLUMN goekua_document_id text;
COMMENT ON COLUMN public.sales_documents.goekua_document_id IS
  'Opaque Goekua create identifier; not a fiscal CDC. Non-null blocks reissuance pending reconciliation.';
