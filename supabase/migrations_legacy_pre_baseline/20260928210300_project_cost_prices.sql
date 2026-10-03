-- Costeo, fase 4: precio ELEGIDO por insumo para una obra. Solo guarda la
-- elección explícita del usuario (otra cotización o precio manual); la
-- sugerencia automática (cotización más barata → estimación del cost-engine
-- → costo_promedio) se calcula en vivo y no se persiste, para no quedar
-- desactualizada.

CREATE TABLE IF NOT EXISTS public.project_cost_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  producto_id UUID NOT NULL REFERENCES public.productos(id) ON DELETE CASCADE,
  precio_unitario NUMERIC(18,4) NOT NULL CHECK (precio_unitario >= 0),
  fuente TEXT NOT NULL CHECK (fuente IN ('COTIZACION', 'ESTIMACION', 'HISTORICO', 'MANUAL')),
  quote_version_item_id UUID REFERENCES public.quote_version_items(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, producto_id)
);
ALTER TABLE public.project_cost_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "project_cost_prices_empresa_isolation" ON public.project_cost_prices
  FOR ALL TO authenticated
  USING (empresa_id = public.current_empresa_id())
  WITH CHECK (empresa_id = public.current_empresa_id());
REVOKE ALL ON public.project_cost_prices FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_cost_prices TO authenticated;
