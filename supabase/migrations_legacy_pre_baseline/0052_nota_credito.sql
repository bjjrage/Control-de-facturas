-- Agrega el tipo NOTA_CREDITO al enum de documentos de venta
-- y una FK opcional al documento origen (para NC generadas desde una factura)

ALTER TYPE public.sales_doc_type ADD VALUE IF NOT EXISTS 'NOTA_CREDITO';

ALTER TABLE public.sales_documents
  ADD COLUMN IF NOT EXISTS source_document_id uuid
    REFERENCES public.sales_documents(id)
    ON DELETE SET NULL;

COMMENT ON COLUMN public.sales_documents.source_document_id
  IS 'Factura origen de la nota de crédito (nullable — NC libre no la tiene)';
