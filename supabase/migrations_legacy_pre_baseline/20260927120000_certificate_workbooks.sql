-- =============================================================================
-- 20260927120000_certificate_workbooks.sql
--
-- Fase 1 de "Certificados Excel-first" (ver memoria de proyecto
-- excel-first-certificados). El certificado deja de depender de que Luna
-- decida qué extraer del Excel de origen: el libro completo se guarda acá,
-- y desde ahí Luna (Fase 5) solo devuelve un MAPEO semántico que un
-- extractor determinístico aplica sobre estas celdas.
--
-- Dos niveles de verdad, a propósito distintos:
-- 1. original_storage_path: el .xlsx tal cual lo subió el usuario, en
--    Storage privado, INMUTABLE — nunca se sobrescribe ni se transforma.
--    Es el documento fuente; siempre se puede volver a descargar igual.
-- 2. working_snapshot: copia de trabajo estructurada (jsonb) — lo que la
--    planilla embebida edita y lo que lee el extractor. NO se exige que
--    reconstruya el .xlsx byte a byte (estilos/gráficos/objetos se pierden
--    a propósito); se exige equivalencia OPERACIONAL: hojas, orden,
--    visible/hidden, valores, fórmulas, merges, anchos de columna y named
--    ranges — lo mismo que ya guarda WorkbookRepresentation
--    (lib/workbook-interpretation/parser.ts), reutilizado acá.
--
-- Un certificado tiene a lo sumo UN workbook (constraint unique). No hay
-- política de DELETE de usuario: el workbook se borra en cascada con su
-- certificado (mismo criterio que project_certificate_items).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.certificate_workbooks (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id            uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  project_id            uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  certificate_id        uuid NOT NULL UNIQUE REFERENCES public.project_certificates(id) ON DELETE CASCADE,

  original_file_name    text NOT NULL,
  original_file_size    integer NOT NULL,
  original_storage_path text NOT NULL,
  original_file_hash    text NOT NULL,

  -- WorkbookRepresentation completo (todas las hojas, ocultas incluidas, con
  -- fórmulas y celdas combinadas) — ver lib/workbook-interpretation/store.ts.
  working_snapshot      jsonb NOT NULL,
  working_revision       integer NOT NULL DEFAULT 1,
  -- Huella de ESTRUCTURA (hojas + encabezados + columnas), no de contenido:
  -- editar valores no la cambia; agregar una hoja o mover una columna sí.
  -- La usa el mapeo de Luna (Fase 5/6) para saber si sigue siendo válido.
  structure_hash        text NOT NULL,

  -- Último mapeo semántico que devolvió Luna (Fase 5) — null hasta el
  -- primer análisis. Se versiona junto con structure_hash: un mapeo con un
  -- structure_hash viejo ya no es válido y hay que re-analizar.
  mapping               jsonb,
  mapping_structure_hash text,
  mapping_model         text,
  analyzed_at           timestamptz,
  analysis_error        text,

  created_by            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_certificate_workbooks_project ON public.certificate_workbooks(project_id);

DROP TRIGGER IF EXISTS trg_certificate_workbooks_updated_at ON public.certificate_workbooks;
CREATE TRIGGER trg_certificate_workbooks_updated_at
  BEFORE UPDATE ON public.certificate_workbooks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- La planilla de trabajo solo se edita mientras el certificado esté en
-- BORRADOR — mismo principio que ya protege project_certificate_items
-- (guard_project_certificate_line_write, aplicada 2026-09-27). Desde
-- ELABORADO el workbook queda congelado igual que el resto del certificado.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_certificate_workbook_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_certificate_id uuid := coalesce(NEW.certificate_id, OLD.certificate_id);
  v_status text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.certificate_id IS DISTINCT FROM NEW.certificate_id THEN
    RAISE EXCEPTION 'La planilla no puede moverse a otro certificado';
  END IF;

  SELECT c.status::text INTO v_status
  FROM public.project_certificates c
  WHERE c.id = v_certificate_id
  FOR UPDATE;
  IF NOT FOUND AND TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND (NOT FOUND OR v_status IS DISTINCT FROM 'BORRADOR') THEN
    RAISE EXCEPTION 'Solo se puede editar la planilla de un certificado en borrador';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_certificate_workbook_write ON public.certificate_workbooks;
CREATE TRIGGER trg_guard_certificate_workbook_write
  BEFORE UPDATE OR DELETE ON public.certificate_workbooks
  FOR EACH ROW EXECUTE FUNCTION public.guard_certificate_workbook_write();
REVOKE ALL ON FUNCTION public.guard_certificate_workbook_write() FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- RLS — mismo patrón que planillas (0088) / computo_imports (0075):
-- empresa_id = current_empresa_id() + is_internal_role. Sin policy de
-- DELETE: se borra en cascada con el certificado, nunca a mano.
-- ---------------------------------------------------------------------------
ALTER TABLE public.certificate_workbooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY certificate_workbooks_select ON public.certificate_workbooks
  FOR SELECT USING (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY certificate_workbooks_insert ON public.certificate_workbooks
  FOR INSERT WITH CHECK (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY certificate_workbooks_update ON public.certificate_workbooks
  FOR UPDATE USING (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]))
  WITH CHECK (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));

REVOKE ALL ON TABLE public.certificate_workbooks FROM anon;
REVOKE ALL ON TABLE public.certificate_workbooks FROM PUBLIC;
REVOKE ALL ON TABLE public.certificate_workbooks FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.certificate_workbooks TO authenticated;
GRANT ALL ON TABLE public.certificate_workbooks TO service_role;

-- ---------------------------------------------------------------------------
-- Storage — bucket privado, path prefixed por project_id (patrón 0075).
-- Solo el .xlsx original vive acá; la copia de trabajo es la columna jsonb.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('certificate-workbooks', 'certificate-workbooks', false)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
IF NOT EXISTS (
  SELECT 1 FROM pg_policies
  WHERE tablename = 'objects' AND policyname = 'certificate_workbooks_storage_select'
) THEN
  CREATE POLICY certificate_workbooks_storage_select ON storage.objects FOR SELECT
    USING (
      bucket_id = 'certificate-workbooks'
      AND (storage.foldername(name))[1] IN (
        SELECT id::text FROM public.projects WHERE empresa_id = public.current_empresa_id()
      )
      AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
    );
  CREATE POLICY certificate_workbooks_storage_insert ON storage.objects FOR INSERT
    WITH CHECK (
      bucket_id = 'certificate-workbooks'
      AND (storage.foldername(name))[1] IN (
        SELECT id::text FROM public.projects WHERE empresa_id = public.current_empresa_id()
      )
      AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
    );
END IF;
END $$;
