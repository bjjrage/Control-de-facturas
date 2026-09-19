-- ============================================================================
-- 20260917000004_production_recipes.sql
-- Receta constructiva: unidad de producción → partidas (NO materiales).
--
-- Dos niveles distintos que NO se mezclan:
--   production_recipes (+components): 1 unidad de producción → partidas físicas
--   budget_item_materials (BOM/APU):   1 unidad de partida → materiales
--
-- La receta NO copia precios ni materiales: solo cantidades por unidad.
-- Forward-only, RLS multi-tenant, sin tocar tablas existentes.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.production_recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  production_unit TEXT NOT NULL,
  description TEXT,
  contract_total_quantity NUMERIC(18,4),
  source_type TEXT NOT NULL DEFAULT 'MANUAL'
    CHECK (source_type IN ('EXCEL', 'BIM', 'MANUAL')),
  source_file_name TEXT,
  source_version TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unicidad: globales por empresa vs por proyecto (NULLs no colisionan).
CREATE UNIQUE INDEX IF NOT EXISTS uq_production_recipes_global
  ON public.production_recipes (empresa_id, code)
  WHERE project_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_production_recipes_project
  ON public.production_recipes (project_id, code)
  WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_production_recipes_empresa
  ON public.production_recipes (empresa_id);
CREATE INDEX IF NOT EXISTS idx_production_recipes_project
  ON public.production_recipes (project_id);

CREATE TABLE IF NOT EXISTS public.production_recipe_components (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id UUID NOT NULL REFERENCES public.production_recipes(id) ON DELETE CASCADE,
  budget_item_id UUID NOT NULL REFERENCES public.budget_items(id) ON DELETE CASCADE,
  quantity_per_production_unit NUMERIC(18,4) NOT NULL CHECK (quantity_per_production_unit > 0),
  unit TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (recipe_id, budget_item_id)
);

CREATE INDEX IF NOT EXISTS idx_recipe_components_recipe
  ON public.production_recipe_components (recipe_id);

-- ----------------------------------------------------------------------------
-- RLS multi-tenant (fail-closed, mismo patrón que weekly plans / BOM)
-- ----------------------------------------------------------------------------
ALTER TABLE public.production_recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_recipe_components ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS production_recipes_tenant ON public.production_recipes;
CREATE POLICY production_recipes_tenant ON public.production_recipes
  FOR ALL TO authenticated
  USING (empresa_id = public.current_empresa_id())
  WITH CHECK (empresa_id = public.current_empresa_id());

DROP POLICY IF EXISTS production_recipe_components_tenant ON public.production_recipe_components;
CREATE POLICY production_recipe_components_tenant ON public.production_recipe_components
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.production_recipes r
      WHERE r.id = production_recipe_components.recipe_id
        AND r.empresa_id = public.current_empresa_id()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.production_recipes r
      WHERE r.id = production_recipe_components.recipe_id
        AND r.empresa_id = public.current_empresa_id()
    )
  );

REVOKE ALL ON public.production_recipes FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_recipes TO authenticated;
REVOKE ALL ON public.production_recipe_components FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_recipe_components TO authenticated;
