-- Costeo, fase 3: RFQ multi-ítem. Una RFQ puede tener N líneas (insumos de
-- un rubro) y el proveedor cotiza línea por línea. Las RFQ de un solo
-- producto (sin filas en rfq_items) siguen funcionando igual.
--
-- quote_version_items: precio por línea de cada versión de cotización.
-- precio_unitario NULL = el proveedor no cotiza ese ítem. cargado_por
-- distingue lo que cargó el proveedor en el portal de lo que transcribió
-- nuestro equipo a mano desde su foto/PDF (no hay parseo automático).
--
-- Escrituras: como el resto del circuito de cotizaciones, van por el admin
-- client después de validar token o empresa; RLS solo da lectura interna.

CREATE TABLE IF NOT EXISTS public.rfq_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  rfq_id UUID NOT NULL REFERENCES public.rfqs(id) ON DELETE CASCADE,
  producto_id UUID REFERENCES public.productos(id) ON DELETE SET NULL,
  descripcion TEXT NOT NULL,
  cantidad NUMERIC(14,4) NOT NULL CHECK (cantidad > 0),
  unidad TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rfq_items_rfq ON public.rfq_items(rfq_id, sort_order);
ALTER TABLE public.rfq_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rfq_items_select_internal" ON public.rfq_items
  FOR SELECT
  USING (empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['comercial'::user_role, 'administracion'::user_role, 'admin'::user_role]));
REVOKE ALL ON public.rfq_items FROM PUBLIC, anon;
GRANT SELECT ON public.rfq_items TO authenticated;

CREATE TABLE IF NOT EXISTS public.quote_version_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  quote_version_id UUID NOT NULL REFERENCES public.quote_versions(id) ON DELETE CASCADE,
  rfq_item_id UUID NOT NULL REFERENCES public.rfq_items(id) ON DELETE CASCADE,
  precio_unitario NUMERIC(18,4) CHECK (precio_unitario IS NULL OR precio_unitario >= 0),
  observaciones TEXT,
  cargado_por TEXT NOT NULL DEFAULT 'PROVEEDOR' CHECK (cargado_por IN ('PROVEEDOR', 'INTERNO')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (quote_version_id, rfq_item_id)
);
CREATE INDEX IF NOT EXISTS idx_quote_version_items_item ON public.quote_version_items(rfq_item_id);
ALTER TABLE public.quote_version_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quote_version_items_select_internal" ON public.quote_version_items
  FOR SELECT
  USING (empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['comercial'::user_role, 'administracion'::user_role, 'admin'::user_role]));
REVOKE ALL ON public.quote_version_items FROM PUBLIC, anon;
GRANT SELECT ON public.quote_version_items TO authenticated;
