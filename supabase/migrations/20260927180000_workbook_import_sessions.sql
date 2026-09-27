-- =============================================================================
-- 20260927180000_workbook_import_sessions.sql
--
-- Fase 4 de "Certificados Excel-first" (ver memoria de proyecto
-- excel-first-certificados). Una OBRA NUEVA no se crea antes de que el
-- usuario confirme lo que Luna entendió del Excel: no queremos projects
-- basura, nombres inventados ni obras creadas por un archivo equivocado.
--
-- 1. workbook_import_sessions: el Excel entra completo (original inmutable en
--    Storage + copia de trabajo editable) SIN project. La planilla se ve y se
--    edita dentro de la sesión mientras Luna analiza en segundo plano. Al
--    confirmar se crea la obra (y el certificado si corresponde) y la sesión
--    queda CONFIRMED, apuntando a esa obra. Mismo formato de libro que
--    certificate_workbooks (lib/certificates/workbook-store.ts).
-- 2. projects.contract_regime: el régimen contractual lo confirma el usuario
--    una vez; Luna solo lo sugiere. NULL = obra existente de antes de este
--    campo (legado): conserva la visibilidad actual de Certificados.
-- 3. certificate_workbooks.source_kind / import_session_id: de dónde vino la
--    planilla del certificado (subida directa o sesión de obra nueva). El
--    original de una sesión no se vuelve a subir: se reutiliza su archivo.
-- 4. project_certificate_items: procedencia documental de cada línea (hoja,
--    fila, celdas, versión de mapeo) para "Ver origen" y auditoría.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.workbook_import_sessions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status                text NOT NULL DEFAULT 'UPLOADED'
                        CHECK (status IN ('UPLOADED', 'ANALYZING', 'ANALYZED', 'ANALYSIS_FAILED', 'CONFIRMED', 'DISCARDED')),

  original_file_name    text NOT NULL,
  original_file_size    integer NOT NULL,
  original_storage_path text NOT NULL,
  original_file_hash    text NOT NULL,

  working_snapshot      jsonb NOT NULL,
  working_revision      integer NOT NULL DEFAULT 1,
  structure_hash        text NOT NULL,

  -- Resultado de Luna (plan/mapeo) y candidato extraído determinísticamente
  -- sobre la copia de trabajo. Se reemplazan al re-analizar.
  interpretation        jsonb,
  candidate             jsonb,
  analyzed_structure_hash text,
  analysis_started_at   timestamptz,
  analyzed_at           timestamptz,
  analysis_error        text,
  suggested_regime      text CHECK (suggested_regime IN ('PUBLIC_WORK', 'PRIVATE_WORK', 'OTHER')),

  confirmed_project_id  uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  confirmed_at          timestamptz,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workbook_import_sessions_empresa
  ON public.workbook_import_sessions(empresa_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_workbook_import_sessions_updated_at ON public.workbook_import_sessions;
CREATE TRIGGER trg_workbook_import_sessions_updated_at
  BEFORE UPDATE ON public.workbook_import_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Una sesión confirmada o descartada ya no cambia su documento: la planilla
-- de la obra creada vive desde ahí en certificate_workbooks.
CREATE OR REPLACE FUNCTION public.guard_workbook_import_session_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.status IN ('CONFIRMED', 'DISCARDED') AND (
       NEW.working_snapshot IS DISTINCT FROM OLD.working_snapshot
       OR NEW.original_storage_path IS DISTINCT FROM OLD.original_storage_path
       OR NEW.status IS DISTINCT FROM OLD.status) THEN
    RAISE EXCEPTION 'La sesión de importación ya fue cerrada';
  END IF;
  IF OLD.empresa_id IS DISTINCT FROM NEW.empresa_id THEN
    RAISE EXCEPTION 'La sesión no puede cambiar de empresa';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_workbook_import_session_write() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_guard_workbook_import_session_write ON public.workbook_import_sessions;
CREATE TRIGGER trg_guard_workbook_import_session_write
  BEFORE UPDATE ON public.workbook_import_sessions
  FOR EACH ROW EXECUTE FUNCTION public.guard_workbook_import_session_write();

ALTER TABLE public.workbook_import_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workbook_import_sessions_select ON public.workbook_import_sessions;
CREATE POLICY workbook_import_sessions_select ON public.workbook_import_sessions
  FOR SELECT USING (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
DROP POLICY IF EXISTS workbook_import_sessions_insert ON public.workbook_import_sessions;
CREATE POLICY workbook_import_sessions_insert ON public.workbook_import_sessions
  FOR INSERT WITH CHECK (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
DROP POLICY IF EXISTS workbook_import_sessions_update ON public.workbook_import_sessions;
CREATE POLICY workbook_import_sessions_update ON public.workbook_import_sessions
  FOR UPDATE USING (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]))
  WITH CHECK (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));

REVOKE ALL ON TABLE public.workbook_import_sessions FROM anon;
REVOKE ALL ON TABLE public.workbook_import_sessions FROM PUBLIC;
REVOKE ALL ON TABLE public.workbook_import_sessions FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.workbook_import_sessions TO authenticated;
GRANT ALL ON TABLE public.workbook_import_sessions TO service_role;

-- Storage: la sesión todavía no tiene project, así que su original vive en
-- sessions/<empresa_id>/<session_id>/ dentro del mismo bucket privado.
DO $$ BEGIN
IF NOT EXISTS (
  SELECT 1 FROM pg_policies
  WHERE tablename = 'objects' AND policyname = 'certificate_workbooks_sessions_select'
) THEN
  CREATE POLICY certificate_workbooks_sessions_select ON storage.objects FOR SELECT
    USING (
      bucket_id = 'certificate-workbooks'
      AND (storage.foldername(name))[1] = 'sessions'
      AND (storage.foldername(name))[2] = public.current_empresa_id()::text
      AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
    );
  CREATE POLICY certificate_workbooks_sessions_insert ON storage.objects FOR INSERT
    WITH CHECK (
      bucket_id = 'certificate-workbooks'
      AND (storage.foldername(name))[1] = 'sessions'
      AND (storage.foldername(name))[2] = public.current_empresa_id()::text
      AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
    );
END IF;
END $$;

-- Régimen contractual (Corrección 3). Sin default a propósito: NULL = legado.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS contract_regime text
  CHECK (contract_regime IN ('PUBLIC_WORK', 'PRIVATE_WORK', 'OTHER'));

ALTER TABLE public.certificate_workbooks
  ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'UPLOAD'
    CHECK (source_kind IN ('UPLOAD', 'IMPORT_SESSION')),
  ADD COLUMN IF NOT EXISTS import_session_id uuid REFERENCES public.workbook_import_sessions(id) ON DELETE SET NULL;

ALTER TABLE public.project_certificate_items
  ADD COLUMN IF NOT EXISTS source_sheet text,
  ADD COLUMN IF NOT EXISTS source_row integer,
  ADD COLUMN IF NOT EXISTS source_cells jsonb,
  ADD COLUMN IF NOT EXISTS mapping_version text;
