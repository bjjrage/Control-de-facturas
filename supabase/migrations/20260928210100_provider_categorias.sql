-- Costeo, fase 2: rubros de proveedores. El rubro de un proveedor es una
-- categoría de producto (categorias_producto), así un RFQ de los insumos de
-- una categoría se manda solo a los proveedores de ese rubro.
-- RLS igual que providers: lectura para roles internos, escritura admin.

CREATE TABLE IF NOT EXISTS public.provider_categorias (
  provider_id UUID NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  categoria_id UUID NOT NULL REFERENCES public.categorias_producto(id) ON DELETE CASCADE,
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_id, categoria_id)
);
CREATE INDEX IF NOT EXISTS idx_provider_categorias_categoria
  ON public.provider_categorias(empresa_id, categoria_id);
ALTER TABLE public.provider_categorias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "provider_categorias_select_internal" ON public.provider_categorias
  FOR SELECT
  USING (empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['comercial'::user_role, 'administracion'::user_role, 'admin'::user_role]));
CREATE POLICY "provider_categorias_admin_insert" ON public.provider_categorias
  FOR INSERT
  WITH CHECK (empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['admin'::user_role]));
CREATE POLICY "provider_categorias_admin_delete" ON public.provider_categorias
  FOR DELETE
  USING (empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['admin'::user_role]));

REVOKE ALL ON public.provider_categorias FROM PUBLIC, anon;
GRANT SELECT, INSERT, DELETE ON public.provider_categorias TO authenticated;
