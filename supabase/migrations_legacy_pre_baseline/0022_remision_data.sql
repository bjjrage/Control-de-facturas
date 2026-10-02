-- Paso 2: migrar datos NOTA_VENTA → REMISION y actualizar el DEFAULT.
UPDATE public.sales_documents
SET doc_type = 'REMISION'
WHERE doc_type = 'NOTA_VENTA';

ALTER TABLE public.sales_documents
  ALTER COLUMN doc_type SET DEFAULT 'REMISION';
