-- Módulo Órdenes de Pago (OP)
-- Una OP agrupa facturas APTO_PARA_PAGO de un mismo proveedor.
-- Al ejecutarse, todas sus facturas pasan a PAGADO.

CREATE SEQUENCE IF NOT EXISTS public.op_code_seq START 1;

CREATE OR REPLACE FUNCTION public.next_op_code()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT 'OP-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.op_code_seq')::text, 4, '0');
$$;

CREATE TABLE IF NOT EXISTS public.payment_orders (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id  uuid        NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  code        text        NOT NULL,
  provider_id uuid        NOT NULL REFERENCES public.providers(id),
  status      text        NOT NULL DEFAULT 'EMITIDA'
                          CHECK (status IN ('EMITIDA', 'EJECUTADA')),
  notes       text,
  created_by  uuid        REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz,
  UNIQUE(empresa_id, code)
);

-- Cada factura puede pertenecer a una sola OP (UNIQUE en invoice_id)
CREATE TABLE IF NOT EXISTS public.payment_order_invoices (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id        uuid        NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  payment_order_id  uuid        NOT NULL REFERENCES public.payment_orders(id) ON DELETE CASCADE,
  invoice_id        uuid        NOT NULL REFERENCES public.invoices(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(invoice_id)
);

ALTER TABLE public.payment_orders         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_order_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY payment_orders_select ON public.payment_orders
  FOR SELECT USING (public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));

CREATE POLICY payment_orders_insert ON public.payment_orders
  FOR INSERT WITH CHECK (public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));

CREATE POLICY payment_orders_update ON public.payment_orders
  FOR UPDATE USING (public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));

CREATE POLICY payment_order_invoices_select ON public.payment_order_invoices
  FOR SELECT USING (public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));

CREATE POLICY payment_order_invoices_insert ON public.payment_order_invoices
  FOR INSERT WITH CHECK (public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));

CREATE POLICY payment_order_invoices_delete ON public.payment_order_invoices
  FOR DELETE USING (public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
