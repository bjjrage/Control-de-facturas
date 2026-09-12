-- =============================================================================
-- 0073_bim_groups.sql
--
-- Agrupación de elementos BIM antes del matching semántico. Hasta 0071, cada
-- bim_element se emparejaba contra el presupuesto de forma individual — un
-- proyecto con 10 muros técnicamente idénticos generaba 10 llamadas a
-- DeepSeek para la misma pregunta. Este slice introduce:
--
--   bim_element_groups   -- N elementos con la misma característica técnica
--                            relevante (tipo IFC, material, unidad, espesor/
--                            resistencia dentro de tolerancia) agrupados en
--                            UNA fila, con la cantidad total ya sumada
--                            (numeric(18,4), misma precisión que
--                            budget_items.quantity — ver roundQuantity4 en
--                            lib/format.ts).
--   bim_group_matches    -- la propuesta/confirmación de matching vive acá,
--                            a nivel de GRUPO, no de elemento individual.
--                            bim_budget_matches (0070) sigue existiendo para
--                            no romper nada del slice anterior, pero el flujo
--                            de agrupación no la usa.
--
-- Estados de bim_group_matches — a propósito NO se mezcla la propuesta de la
-- IA con la decisión humana en el mismo estado:
--   SUGGESTED  -- DeepSeek propuso MATCH. Aún no confirmado por un humano.
--   REVIEW     -- DeepSeek se abstuvo (ambigüedad real). Requiere elección humana.
--   NO_MATCH   -- DeepSeek concluyó que no hay rubro equivalente.
--   CONFIRMED  -- un humano confirmó (el candidato sugerido u otro manual).
--   REJECTED   -- un humano decidió explícitamente "dejar sin asignar" —
--                 distinto de NO_MATCH (que es una conclusión de la IA).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.bim_element_groups (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bim_model_id      uuid NOT NULL REFERENCES public.bim_models(id) ON DELETE CASCADE,
  project_id        uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  ifc_type          text NOT NULL,
  material          text,
  normalized_name   text NOT NULL,
  quantity_type     text CHECK (quantity_type IN ('length', 'area', 'volume', 'count', 'weight')),
  quantity_unit     text,
  total_quantity    numeric(18,4),
  element_count     integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bim_elements
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES public.bim_element_groups(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.bim_group_matches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        uuid NOT NULL REFERENCES public.bim_element_groups(id) ON DELETE CASCADE,
  budget_item_id  uuid REFERENCES public.budget_items(id) ON DELETE CASCADE,
  method          text NOT NULL CHECK (method IN ('SEMANTIC', 'MANUAL')),
  score           numeric(5,4),
  reason          text,
  status          text NOT NULL CHECK (status IN ('SUGGESTED', 'REVIEW', 'NO_MATCH', 'CONFIRMED', 'REJECTED')),
  confirmed_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bim_group_matches_budget_item_required
    CHECK ((status IN ('SUGGESTED', 'CONFIRMED') AND budget_item_id IS NOT NULL) OR status IN ('REVIEW', 'NO_MATCH', 'REJECTED'))
);

-- Un grupo tiene a lo sumo un match CONFIRMADO vigente.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bim_group_confirmed_match
  ON public.bim_group_matches (group_id)
  WHERE status = 'CONFIRMED';

CREATE INDEX IF NOT EXISTS idx_bim_element_groups_model   ON public.bim_element_groups(bim_model_id);
CREATE INDEX IF NOT EXISTS idx_bim_element_groups_project ON public.bim_element_groups(project_id);
CREATE INDEX IF NOT EXISTS idx_bim_elements_group         ON public.bim_elements(group_id);
CREATE INDEX IF NOT EXISTS idx_bim_group_matches_group    ON public.bim_group_matches(group_id);
CREATE INDEX IF NOT EXISTS idx_bim_group_matches_budget   ON public.bim_group_matches(budget_item_id);

-- ---------------------------------------------------------------------------
-- RLS — mismo patrón que 0070 (current_empresa_id() + is_internal_role vía
-- project_id -> projects.empresa_id)
-- ---------------------------------------------------------------------------
ALTER TABLE public.bim_element_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bim_group_matches  ENABLE ROW LEVEL SECURITY;

CREATE POLICY bim_element_groups_select ON public.bim_element_groups
  FOR SELECT USING (
    project_id IN (SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id())
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY bim_element_groups_insert ON public.bim_element_groups
  FOR INSERT WITH CHECK (
    project_id IN (SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id())
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY bim_element_groups_delete ON public.bim_element_groups
  FOR DELETE USING (
    project_id IN (SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id())
    AND public.is_internal_role(ARRAY['admin']::public.user_role[]));

CREATE POLICY bim_group_matches_select ON public.bim_group_matches
  FOR SELECT USING (
    group_id IN (
      SELECT id FROM public.bim_element_groups WHERE project_id IN (
        SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id()))
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY bim_group_matches_insert ON public.bim_group_matches
  FOR INSERT WITH CHECK (
    group_id IN (
      SELECT id FROM public.bim_element_groups WHERE project_id IN (
        SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id()))
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY bim_group_matches_update ON public.bim_group_matches
  FOR UPDATE USING (
    group_id IN (
      SELECT id FROM public.bim_element_groups WHERE project_id IN (
        SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id()))
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY bim_group_matches_delete ON public.bim_group_matches
  FOR DELETE USING (
    group_id IN (
      SELECT id FROM public.bim_element_groups WHERE project_id IN (
        SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id()))
    AND public.is_internal_role(ARRAY['admin']::public.user_role[]));
