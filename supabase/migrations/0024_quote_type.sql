-- Tipo de cotización: RFQ (multi-proveedor) o COT (proveedor único)
ALTER TABLE public.rfqs
  ADD COLUMN IF NOT EXISTS quote_type text NOT NULL DEFAULT 'RFQ'
  CHECK (quote_type IN ('RFQ', 'COT'));

-- Secuencia independiente para códigos COT
CREATE SEQUENCE IF NOT EXISTS public.cot_code_seq START 1;

-- Función para generar el próximo código COT
CREATE OR REPLACE FUNCTION public.next_cot_code()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT 'COT-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.cot_code_seq')::text, 4, '0');
$$;
