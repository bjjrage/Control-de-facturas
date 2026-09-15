-- 20260914030000_inventory_partial_upload_resolution.sql
-- Hardening P1: resolución estructurada de cargas parciales de warehouse_submissions.
--
-- El gate fail-closed de 20260914020000 introdujo upload_incomplete, pero el
-- endpoint de portal lo volvía a false apenas un POST posterior no tuviera
-- rechazos, sin verificar que los archivos pendientes de un POST anterior
-- hubieran sido efectivamente resueltos. Esto persiste el estado pendiente
-- de forma estructurada (pending_uploads) e impone un único camino
-- controlado (RPC SECURITY DEFINER restringida a service_role) para
-- transicionar upload_incomplete de true a false.

-- 1. Persistir estructuradamente los uploads pendientes, identificados por sha256.
ALTER TABLE public.warehouse_submissions
  ADD COLUMN IF NOT EXISTS pending_uploads jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.warehouse_submissions
  ADD CONSTRAINT warehouse_submissions_pending_uploads_is_array
  CHECK (jsonb_typeof(pending_uploads) = 'array');

-- 2. Camino controlado: solo esta RPC (invocada por el endpoint de portal con
-- el cliente service_role) puede resolver o registrar pendientes y, por lo
-- tanto, mover upload_incomplete. No se expone a authenticated/anon.
CREATE OR REPLACE FUNCTION public.inventory_apply_warehouse_upload_result(
  p_empresa_id      uuid,
  p_submission_id   uuid,
  p_resolved_sha256 text[],
  p_failed          jsonb
)
RETURNS TABLE(upload_incomplete boolean, pending_uploads jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_submission record;
  v_pending jsonb;
  v_resolved text[];
  v_failed jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Acceso denegado: sólo el portal de rendiciones puede actualizar el estado de ingestión';
  END IF;

  v_resolved := coalesce(p_resolved_sha256, '{}');
  v_failed := coalesce(p_failed, '[]'::jsonb);
  IF jsonb_typeof(v_failed) <> 'array' THEN
    RAISE EXCEPTION 'p_failed debe ser un arreglo jsonb';
  END IF;

  SELECT * INTO v_submission
  FROM public.warehouse_submissions
  WHERE id = p_submission_id AND empresa_id = p_empresa_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rendición no encontrada'; END IF;
  IF v_submission.status IN ('CONFIRMED', 'VOIDED') THEN
    RAISE EXCEPTION 'La rendición está cerrada y no admite cambios de ingestión';
  END IF;

  -- Quita del pendiente todo lo que este lote resolvió exitosamente.
  v_pending := coalesce(
    (
      SELECT jsonb_agg(elem)
      FROM jsonb_array_elements(v_submission.pending_uploads) elem
      WHERE NOT (elem ->> 'sha256' = ANY (v_resolved))
    ),
    '[]'::jsonb
  );

  -- Sustituye (por sha256) cualquier pendiente previo por su versión más
  -- reciente y agrega los fallos nuevos de este lote.
  IF jsonb_array_length(v_failed) > 0 THEN
    v_pending := coalesce(
      (
        SELECT jsonb_agg(elem)
        FROM jsonb_array_elements(v_pending) elem
        WHERE NOT (
          elem ->> 'sha256' IN (SELECT f ->> 'sha256' FROM jsonb_array_elements(v_failed) f)
        )
      ),
      '[]'::jsonb
    ) || v_failed;
  END IF;

  UPDATE public.warehouse_submissions
  SET pending_uploads = v_pending,
      upload_incomplete = (jsonb_array_length(v_pending) > 0),
      updated_at = now()
  WHERE id = p_submission_id AND empresa_id = p_empresa_id;

  RETURN QUERY SELECT (jsonb_array_length(v_pending) > 0), v_pending;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.inventory_apply_warehouse_upload_result(uuid, uuid, text[], jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inventory_apply_warehouse_upload_result(uuid, uuid, text[], jsonb) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_apply_warehouse_upload_result(uuid, uuid, text[], jsonb)
  TO service_role;

-- 3. Cinturón y tirantes: ningún cliente con rol authenticated/anon puede
-- escribir directamente upload_incomplete/pending_uploads via UPDATE, ni
-- siquiera dentro del alcance que la policy de RLS ya permite a
-- administracion/admin. Sólo la RPC anterior (SECURITY DEFINER, dueña de la
-- tabla) puede modificarlas.
--
-- authenticated tiene UPDATE a nivel de tabla completa desde el grant
-- original (0006_grants). Un REVOKE UPDATE (columna) por sí solo NO alcanza:
-- en Postgres los privilegios de columna son un permiso ADICIONAL, no una
-- restricción, así que un rol con UPDATE de tabla completa puede seguir
-- escribiendo cualquier columna aunque se le revoque esa columna puntual.
-- Hace falta revocar el UPDATE de tabla completa y re-otorgarlo solo sobre
-- las columnas que los flujos legítimos (portal → status/processing_error,
-- revisión de líneas, etc.) necesitan modificar.
REVOKE UPDATE ON public.warehouse_submissions FROM authenticated;
REVOKE UPDATE ON public.warehouse_submissions FROM anon;
GRANT UPDATE (
  id, empresa_id, location_id, project_id, portal_link_id, period_start,
  period_end, remision_number, notes, status, processing_error,
  submitted_by, reviewed_by, confirmed_by, processing_started_at,
  processed_at, confirmed_at, created_at, updated_at
) ON public.warehouse_submissions TO authenticated;

-- 4. inventory_confirm_warehouse_submission ya rechaza upload_incomplete=true
-- (20260914020000). Al quedar pending_uploads como fuente estructurada y
-- upload_incomplete derivado exclusivamente de su longitud a través de la
-- RPC anterior, el gate de confirmación queda cerrado frente a reintentos
-- parciales no resueltos sin necesitar cambios en esa función.
