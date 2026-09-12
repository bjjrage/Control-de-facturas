-- 0077_certificate_invoice_bridge.sql
-- Conecta certificados de obra con facturas de venta.
-- Antes: factura_numero era texto libre sin validación.
-- Ahora: sales_documents.certificate_id es FK real que permite consultar
-- en ambas direcciones y elimina el doble conteo en flujo de caja.
--
-- La columna es nullable para no romper facturas existentes creadas
-- antes de este bridge. ON DELETE SET NULL protege el documento de venta
-- si por alguna razón se revierte/borra un certificado.

ALTER TABLE public.sales_documents
  ADD COLUMN IF NOT EXISTS certificate_id UUID
    REFERENCES public.project_certificates(id)
    ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_sales_documents_certificate
  ON public.sales_documents(certificate_id)
  WHERE certificate_id IS NOT NULL;

-- Unique parcial: un certificado puede tener a lo sumo UN documento de venta
-- en estado activo (BORRADOR o EMITIDA). Impide doble facturación accidental.
-- Las ANULADAS no cuentan (se puede re-facturar si una factura fue anulada).
CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_documents_certificate_active
  ON public.sales_documents(certificate_id)
  WHERE certificate_id IS NOT NULL
    AND status NOT IN ('ANULADA');
