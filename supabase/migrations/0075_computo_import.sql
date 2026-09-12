-- =============================================================================
-- 0075_computo_import.sql
--
-- Importador de cómputo métrico (Excel/PDF) — segundo origen de cantidades para
-- el mismo pipeline de matching semántico que usa BIM (DeepSeek + confirmación
-- humana), para proyectos SIN modelo IFC. Tablas paralelas, aisladas de
-- bim_*: bim_elements/bim_element_groups tienen bim_model_id/ifc_guid/ifc_type
-- NOT NULL y una capa de agrupación (muchos elementos 3D iguales -> un grupo)
-- que acá no aplica — un cómputo en Excel/PDF ya viene una fila = un ítem.
--
-- Mismos 5 estados que bim_group_matches (SUGGESTED/REVIEW/REVIEW_REQUIRED/
-- NO_MATCH/CONFIRMED/REJECTED) — el humano siempre confirma, DeepSeek nunca
-- escribe precio, igual que en BIM.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.computo_imports (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_type         text NOT NULL CHECK (source_type IN ('EXCEL', 'PDF')),
  file_name           text NOT NULL,
  storage_path        text NOT NULL,
  status              text NOT NULL DEFAULT 'PROCESANDO'
                       CHECK (status IN ('PROCESANDO', 'LISTO', 'BAJA_CONFIANZA', 'ERROR')),
  error_message       text,
  confidence_summary  jsonb,
  uploaded_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.computo_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  computo_import_id   uuid NOT NULL REFERENCES public.computo_imports(id) ON DELETE CASCADE,
  project_id          uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  row_index           integer NOT NULL,
  description         text NOT NULL,
  quantity_value       numeric(18,4),
  quantity_unit        text,
  raw_row             jsonb NOT NULL DEFAULT '{}'::jsonb,
  row_confidence      numeric(3,2),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.computo_item_matches (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  computo_item_id     uuid NOT NULL REFERENCES public.computo_items(id) ON DELETE CASCADE,
  budget_item_id      uuid REFERENCES public.budget_items(id) ON DELETE CASCADE,
  method              text NOT NULL CHECK (method IN ('SEMANTIC', 'MANUAL')),
  score               numeric(5,4),
  reason              text,
  status              text NOT NULL CHECK (status IN ('SUGGESTED', 'REVIEW', 'REVIEW_REQUIRED', 'NO_MATCH', 'CONFIRMED', 'REJECTED')),
  confirmed_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT computo_item_matches_budget_item_required
    CHECK ((status IN ('SUGGESTED', 'CONFIRMED') AND budget_item_id IS NOT NULL)
           OR status IN ('REVIEW', 'REVIEW_REQUIRED', 'NO_MATCH', 'REJECTED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_computo_item_confirmed_match
  ON public.computo_item_matches (computo_item_id)
  WHERE status = 'CONFIRMED';

CREATE INDEX IF NOT EXISTS idx_computo_imports_project      ON public.computo_imports(project_id);
CREATE INDEX IF NOT EXISTS idx_computo_items_import         ON public.computo_items(computo_import_id);
CREATE INDEX IF NOT EXISTS idx_computo_items_project        ON public.computo_items(project_id);
CREATE INDEX IF NOT EXISTS idx_computo_item_matches_item    ON public.computo_item_matches(computo_item_id);
CREATE INDEX IF NOT EXISTS idx_computo_item_matches_budget  ON public.computo_item_matches(budget_item_id);

-- ---------------------------------------------------------------------------
-- RLS — mismo patrón que 0071/0073 (current_empresa_id() + is_internal_role)
-- ---------------------------------------------------------------------------
ALTER TABLE public.computo_imports      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.computo_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.computo_item_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY computo_imports_select ON public.computo_imports
  FOR SELECT USING (
    project_id IN (SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id())
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY computo_imports_insert ON public.computo_imports
  FOR INSERT WITH CHECK (
    project_id IN (SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id())
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY computo_imports_update ON public.computo_imports
  FOR UPDATE USING (
    project_id IN (SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id())
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY computo_imports_delete ON public.computo_imports
  FOR DELETE USING (
    project_id IN (SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id())
    AND public.is_internal_role(ARRAY['admin']::public.user_role[]));

CREATE POLICY computo_items_select ON public.computo_items
  FOR SELECT USING (
    project_id IN (SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id())
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY computo_items_insert ON public.computo_items
  FOR INSERT WITH CHECK (
    project_id IN (SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id())
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY computo_items_delete ON public.computo_items
  FOR DELETE USING (
    project_id IN (SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id())
    AND public.is_internal_role(ARRAY['admin']::public.user_role[]));

CREATE POLICY computo_item_matches_select ON public.computo_item_matches
  FOR SELECT USING (
    computo_item_id IN (
      SELECT id FROM public.computo_items WHERE project_id IN (
        SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id()))
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY computo_item_matches_insert ON public.computo_item_matches
  FOR INSERT WITH CHECK (
    computo_item_id IN (
      SELECT id FROM public.computo_items WHERE project_id IN (
        SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id()))
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY computo_item_matches_update ON public.computo_item_matches
  FOR UPDATE USING (
    computo_item_id IN (
      SELECT id FROM public.computo_items WHERE project_id IN (
        SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id()))
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY computo_item_matches_delete ON public.computo_item_matches
  FOR DELETE USING (
    computo_item_id IN (
      SELECT id FROM public.computo_items WHERE project_id IN (
        SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id()))
    AND public.is_internal_role(ARRAY['admin']::public.user_role[]));

-- ---------------------------------------------------------------------------
-- Storage — bucket privado, path prefixed por project_id (patrón bim-models)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('computo-imports', 'computo-imports', false)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
IF NOT EXISTS (
  SELECT 1 FROM pg_policies
  WHERE tablename = 'objects' AND policyname = 'computo_imports_storage_select'
) THEN
  CREATE POLICY computo_imports_storage_select ON storage.objects FOR SELECT
    USING (
      bucket_id = 'computo-imports'
      AND (storage.foldername(name))[1] IN (
        SELECT id::text FROM public.projects WHERE empresa_id = public.current_empresa_id()
      )
      AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
    );
  CREATE POLICY computo_imports_storage_insert ON storage.objects FOR INSERT
    WITH CHECK (
      bucket_id = 'computo-imports'
      AND (storage.foldername(name))[1] IN (
        SELECT id::text FROM public.projects WHERE empresa_id = public.current_empresa_id()
      )
      AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
    );
  CREATE POLICY computo_imports_storage_delete ON storage.objects FOR DELETE
    USING (
      bucket_id = 'computo-imports'
      AND (storage.foldername(name))[1] IN (
        SELECT id::text FROM public.projects WHERE empresa_id = public.current_empresa_id()
      )
      AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
    );
END IF;
END $$;
