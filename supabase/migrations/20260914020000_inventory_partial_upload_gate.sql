-- 20260914020000_inventory_partial_upload_gate.sql
-- Hardening P1: Ingestion gate fail-closed para cargas parciales de warehouse_submissions

-- 1. Agregar columna estructurada upload_incomplete a warehouse_submissions
ALTER TABLE public.warehouse_submissions
  ADD COLUMN IF NOT EXISTS upload_incomplete boolean NOT NULL DEFAULT false;

-- 2. Actualizar función inventory_confirm_warehouse_submission con gate fail-closed
CREATE OR REPLACE FUNCTION public.inventory_confirm_warehouse_submission(
  p_empresa_id   uuid,
  p_submission_id uuid,
  p_confirmed_by  uuid,
  p_idempotency_key text DEFAULT NULL
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_submission record;
  v_line record;
  v_movement uuid;
  v_ids uuid[] := '{}';
  v_key text;
BEGIN
  IF auth.role() <> 'service_role' THEN
    IF public.current_empresa_id() IS NULL OR public.current_empresa_id() IS DISTINCT FROM p_empresa_id
       OR NOT public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]) THEN
      RAISE EXCEPTION 'Acceso denegado para confirmar rendición';
    END IF;
  END IF;

  SELECT * INTO v_submission
  FROM public.warehouse_submissions
  WHERE id = p_submission_id AND empresa_id = p_empresa_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rendición no encontrada'; END IF;
  IF v_submission.status = 'VOIDED' THEN RAISE EXCEPTION 'La rendición está anulada'; END IF;
  IF v_submission.status = 'CONFIRMED' THEN
    SELECT coalesce(array_agg(inventory_movement_id ORDER BY line_number), '{}') INTO v_ids
    FROM public.warehouse_submission_lines
    WHERE submission_id = p_submission_id AND inventory_movement_id IS NOT NULL;
    RETURN v_ids;
  END IF;
  IF v_submission.upload_incomplete THEN
    RAISE EXCEPTION 'La rendición tiene cargas de archivos incompletas o pendientes';
  END IF;
  IF v_submission.status NOT IN ('READY', 'NEEDS_REVIEW') THEN
    RAISE EXCEPTION 'La rendición todavía no está lista para confirmar';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.warehouse_submission_lines
    WHERE submission_id = p_submission_id AND state = 'PROPOSED'
  ) THEN
    RAISE EXCEPTION 'La rendición todavía tiene líneas propuestas sin revisar';
  END IF;

  FOR v_line IN
    SELECT * FROM public.warehouse_submission_lines
    WHERE submission_id = p_submission_id AND empresa_id = p_empresa_id AND state = 'CONFIRMED'
    ORDER BY line_number
  LOOP
    IF v_line.producto_id IS NULL OR v_line.quantity IS NULL OR v_line.unit IS NULL
       OR v_line.budget_item_id IS NULL THEN
      RAISE EXCEPTION 'La línea % no está completa para confirmar', v_line.line_number;
    END IF;
    IF v_line.inventory_movement_id IS NOT NULL THEN
      v_ids := array_append(v_ids, v_line.inventory_movement_id);
      CONTINUE;
    END IF;
    v_key := coalesce(nullif(trim(p_idempotency_key), ''), p_submission_id::text) || ':' || v_line.id::text;
    v_movement := public.inventory_post_movement(
      p_empresa_id := p_empresa_id,
      p_producto_id := v_line.producto_id,
      p_quantity := v_line.quantity,
      p_unit := v_line.unit,
      p_movement_type := 'CONSUMPTION',
      p_from_location_id := v_submission.location_id,
      p_project_id := v_submission.project_id,
      p_budget_item_id := v_line.budget_item_id,
      p_source_type := 'WAREHOUSE_SUBMISSION',
      p_source_id := p_submission_id,
      p_source_line_id := v_line.id,
      p_idempotency_key := v_key,
      p_created_by := p_confirmed_by,
      p_metadata := jsonb_build_object('submission_id', p_submission_id, 'line_number', v_line.line_number)
    );
    UPDATE public.warehouse_submission_lines
    SET inventory_movement_id = v_movement, updated_at = now()
    WHERE id = v_line.id;
    v_ids := array_append(v_ids, v_movement);
  END LOOP;

  UPDATE public.warehouse_submissions
  SET status = 'CONFIRMED', confirmed_by = p_confirmed_by,
      confirmed_at = now(), updated_at = now(), processing_error = NULL
  WHERE id = p_submission_id;
  RETURN v_ids;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.inventory_confirm_warehouse_submission(uuid, uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inventory_confirm_warehouse_submission(uuid, uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.inventory_confirm_warehouse_submission(uuid, uuid, uuid, text)
  TO authenticated, service_role;
