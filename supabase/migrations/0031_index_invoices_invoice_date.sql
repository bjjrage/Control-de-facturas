-- Índice en invoices.invoice_date para acelerar el filtro por mes (caso de uso default).
-- Sin este índice la query principal de /invoices hace full scan sobre todas las
-- facturas de la empresa cada vez que se filtra por rango de fecha.
CREATE INDEX IF NOT EXISTS idx_invoices_invoice_date ON public.invoices(invoice_date);
