-- 0078_invoice_exchange_rate.sql
-- Agrega tipo de cambio a facturas de compra en moneda extranjera.
-- Nullable: facturas PYG no lo necesitan; facturas USD creadas antes
-- de esta migración quedan en NULL (ya están como REVISION_REQUERIDA en cost_observations).

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(18, 6);

COMMENT ON COLUMN public.invoices.exchange_rate IS
  'Tipo de cambio al momento de registrar la factura (solo relevante cuando currency != PYG). Ej: 7900 significa 1 USD = 7900 PYG.';
