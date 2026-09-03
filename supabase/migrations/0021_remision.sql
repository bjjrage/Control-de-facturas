-- Paso 1: agregar el nuevo valor al enum.
-- Postgres no permite usar un valor nuevo en la misma transacción en que se
-- agrega, por eso la migración de datos va en un archivo separado (0022).
ALTER TYPE public.sales_doc_type ADD VALUE IF NOT EXISTS 'REMISION';
