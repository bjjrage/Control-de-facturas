-- =============================================================================
-- 0071_bim_presupuesto.sql
--
-- Módulo BIM + Presupuesto — vertical slice inicial.
--
-- FILOSOFÍA: el BIM aporta cantidades, el presupuesto (budget_items, 0028)
-- aporta precios. Este módulo NUNCA inventa precios: solo relaciona
-- elementos extraídos de un IFC con budget_items ya existentes (rubros con
-- unit_price cargado, a mano o por 0028's import-budget-dialog). Si no hay
-- unit_price en el budget_item, la línea queda "PRECIO NO DISPONIBLE" en la
-- capa de aplicación — no se calcula.
--
-- No se crea una tabla "presupuesto" nueva ni "budget_items_v2": budget_items
-- sigue siendo la única fuente de rubros/partidas de un proyecto (ver audit).
--
-- DISEÑO:
--   bim_models         -- un archivo IFC subido para un proyecto
--   bim_elements        -- cada elemento (IfcWall, IfcSlab, ...) extraído del
--                          IFC, con su cantidad y procedencia (quantity set
--                          explícito vs derivado) — nunca se pierde la unidad
--                          original del IFC.
--   bim_budget_matches   -- vínculo N:1 elemento BIM -> budget_item, con
--                          método (determinista/semántico/manual), score y
--                          confirmación humana explícita (confirmed_by/at).
--                          La UI solo PROPONE; el usuario CONFIRMA. Nada acá
--                          escribe en budget_items automáticamente.
--
-- RLS: mismo patrón que 0028 (current_empresa_id() + is_internal_role vía
-- project_id -> projects.empresa_id) y mismo patrón de storage que 0029
-- (execution-photos): bucket privado, path prefixed por project_id.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Modelos IFC subidos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bim_models (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  file_name     text NOT NULL,
  storage_path  text NOT NULL,
  schema        text,
  status        text NOT NULL DEFAULT 'PROCESANDO'
                CHECK (status IN ('PROCESANDO', 'LISTO', 'ERROR')),
  error_message text,
  element_count integer NOT NULL DEFAULT 0,
  uploaded_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 2. Elementos extraídos del IFC (cantidades, nunca precios)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bim_elements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bim_model_id      uuid NOT NULL REFERENCES public.bim_models(id) ON DELETE CASCADE,
  project_id        uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  ifc_guid          text NOT NULL,
  ifc_type          text NOT NULL,
  name              text,
  building_storey   text,
  material          text,
  properties        jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Cantidad: prioridad Qto explícito > propiedad cuantitativa > geometría.
  quantity_type     text CHECK (quantity_type IN ('length', 'area', 'volume', 'count', 'weight')),
  quantity_value    numeric(18,4),
  quantity_unit     text,
  quantity_source   text CHECK (quantity_source IN ('IFC_QTO', 'IFC_PROPERTY', 'GEOMETRY')),
  quantity_property text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bim_model_id, ifc_guid)
);

-- ---------------------------------------------------------------------------
-- 3. Matches propuestos/confirmados entre elemento BIM y rubro de presupuesto
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.bim_budget_matches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bim_element_id  uuid NOT NULL REFERENCES public.bim_elements(id) ON DELETE CASCADE,
  budget_item_id  uuid NOT NULL REFERENCES public.budget_items(id) ON DELETE CASCADE,
  method          text NOT NULL CHECK (method IN ('DETERMINISTIC', 'SEMANTIC', 'MANUAL')),
  score           numeric(5,4),
  status          text NOT NULL DEFAULT 'PROPUESTO'
                  CHECK (status IN ('PROPUESTO', 'CONFIRMADO', 'DESCARTADO')),
  confirmed_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- Un elemento BIM tiene a lo sumo un match CONFIRMADO vigente; puede tener
  -- varios PROPUESTO/DESCARTADO (histórico de sugerencias).
  UNIQUE (bim_element_id, budget_item_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_bim_element_confirmed_match
  ON public.bim_budget_matches (bim_element_id)
  WHERE status = 'CONFIRMADO';

-- ---------------------------------------------------------------------------
-- 4. Índices
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_bim_models_project        ON public.bim_models(project_id);
CREATE INDEX IF NOT EXISTS idx_bim_elements_model         ON public.bim_elements(bim_model_id);
CREATE INDEX IF NOT EXISTS idx_bim_elements_project       ON public.bim_elements(project_id);
CREATE INDEX IF NOT EXISTS idx_bim_matches_element        ON public.bim_budget_matches(bim_element_id);
CREATE INDEX IF NOT EXISTS idx_bim_matches_budget_item    ON public.bim_budget_matches(budget_item_id);

-- ---------------------------------------------------------------------------
-- 5. RLS — mismo patrón que budget_items/execution_entries (0028)
-- ---------------------------------------------------------------------------
ALTER TABLE public.bim_models         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bim_elements       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bim_budget_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY bim_models_select ON public.bim_models
  FOR SELECT USING (
    project_id IN (SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id())
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY bim_models_insert ON public.bim_models
  FOR INSERT WITH CHECK (
    project_id IN (SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id())
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY bim_models_update ON public.bim_models
  FOR UPDATE USING (
    project_id IN (SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id())
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY bim_models_delete ON public.bim_models
  FOR DELETE USING (
    project_id IN (SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id())
    AND public.is_internal_role(ARRAY['admin']::public.user_role[]));

CREATE POLICY bim_elements_select ON public.bim_elements
  FOR SELECT USING (
    project_id IN (SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id())
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY bim_elements_insert ON public.bim_elements
  FOR INSERT WITH CHECK (
    project_id IN (SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id())
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY bim_elements_delete ON public.bim_elements
  FOR DELETE USING (
    project_id IN (SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id())
    AND public.is_internal_role(ARRAY['admin']::public.user_role[]));

CREATE POLICY bim_matches_select ON public.bim_budget_matches
  FOR SELECT USING (
    bim_element_id IN (
      SELECT id FROM public.bim_elements WHERE project_id IN (
        SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id()))
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY bim_matches_insert ON public.bim_budget_matches
  FOR INSERT WITH CHECK (
    bim_element_id IN (
      SELECT id FROM public.bim_elements WHERE project_id IN (
        SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id()))
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY bim_matches_update ON public.bim_budget_matches
  FOR UPDATE USING (
    bim_element_id IN (
      SELECT id FROM public.bim_elements WHERE project_id IN (
        SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id()))
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY bim_matches_delete ON public.bim_budget_matches
  FOR DELETE USING (
    bim_element_id IN (
      SELECT id FROM public.bim_elements WHERE project_id IN (
        SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id()))
    AND public.is_internal_role(ARRAY['admin']::public.user_role[]));

-- ---------------------------------------------------------------------------
-- 6. Storage — bucket privado, path prefixed por project_id (patrón 0029)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('bim-models', 'bim-models', false)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
IF NOT EXISTS (
  SELECT 1 FROM pg_policies
  WHERE tablename = 'objects' AND policyname = 'bim_models_storage_select'
) THEN
  CREATE POLICY bim_models_storage_select ON storage.objects FOR SELECT
    USING (
      bucket_id = 'bim-models'
      AND (storage.foldername(name))[1] IN (
        SELECT id::text FROM public.projects
        WHERE empresa_id = public.current_empresa_id()
      )
      AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
    );
  CREATE POLICY bim_models_storage_insert ON storage.objects FOR INSERT
    WITH CHECK (
      bucket_id = 'bim-models'
      AND (storage.foldername(name))[1] IN (
        SELECT id::text FROM public.projects
        WHERE empresa_id = public.current_empresa_id()
      )
      AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
    );
  CREATE POLICY bim_models_storage_delete ON storage.objects FOR DELETE
    USING (
      bucket_id = 'bim-models'
      AND (storage.foldername(name))[1] IN (
        SELECT id::text FROM public.projects
        WHERE empresa_id = public.current_empresa_id()
      )
      AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
    );
END IF;
END $$;
