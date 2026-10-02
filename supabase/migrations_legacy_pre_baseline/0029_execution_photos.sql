-- =============================================================================
-- 0029_execution_photos.sql
--
-- Fotos en el registro de avance de obra (execution_entries). El capataz ya
-- saca fotos y las manda por WhatsApp — esto las adjunta directo al parte.
--
-- DECISIÓN: a diferencia de los buckets existentes (invoice-files, quote-pdfs,
-- rfq-attachments — ver 0005_storage.sql), cuyas políticas SOLO filtran por
-- rol sin scoping de empresa_id (leak cross-tenant pre-existente, pendiente
-- aparte), acá SÍ se valida empresa_id via current_empresa_id(), igual que
-- el resto del Módulo Construcción. La ruta de cada archivo arranca con el
-- project_id, así que se valida que ese proyecto sea de la empresa del
-- usuario logueado.
-- =============================================================================

ALTER TABLE public.execution_entries
  ADD COLUMN IF NOT EXISTS photo_paths text[] NOT NULL DEFAULT '{}';

INSERT INTO storage.buckets (id, name, public)
VALUES ('execution-photos', 'execution-photos', false)
ON CONFLICT (id) DO NOTHING;

DO $$ BEGIN
IF NOT EXISTS (
  SELECT 1 FROM pg_policies
  WHERE tablename = 'objects' AND policyname = 'exec_photos_select'
) THEN
  CREATE POLICY exec_photos_select ON storage.objects FOR SELECT
    USING (
      bucket_id = 'execution-photos'
      AND (storage.foldername(name))[1] IN (
        SELECT id::text FROM public.projects
        WHERE empresa_id = public.current_empresa_id()
      )
      AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
    );
  CREATE POLICY exec_photos_insert ON storage.objects FOR INSERT
    WITH CHECK (
      bucket_id = 'execution-photos'
      AND (storage.foldername(name))[1] IN (
        SELECT id::text FROM public.projects
        WHERE empresa_id = public.current_empresa_id()
      )
      AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
    );
  CREATE POLICY exec_photos_delete ON storage.objects FOR DELETE
    USING (
      bucket_id = 'execution-photos'
      AND (storage.foldername(name))[1] IN (
        SELECT id::text FROM public.projects
        WHERE empresa_id = public.current_empresa_id()
      )
      AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
    );
END IF;
END $$;
