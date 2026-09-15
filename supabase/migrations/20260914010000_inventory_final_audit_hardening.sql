-- 20260914010000_inventory_final_audit_hardening.sql
-- Hardening P1: Inmutabilidad estricta de warehouse_submissions confirmadas
-- Hardening P2: Concurrencia segura y numeración atómica en warehouse_submission_lines

-- 1. Hardening P1: Inmutabilidad de warehouse_submissions cuando status = 'CONFIRMED'
CREATE OR REPLACE FUNCTION public.prevent_confirmed_warehouse_submission_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'CONFIRMED' THEN
      RAISE EXCEPTION 'Una rendición confirmada es inmutable y no puede ser eliminada';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'CONFIRMED' THEN
      RAISE EXCEPTION 'Una rendición confirmada es inmutable y no puede ser modificada ni reabierta';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_confirmed_warehouse_submission_mutation
  ON public.warehouse_submissions;
CREATE TRIGGER trg_prevent_confirmed_warehouse_submission_mutation
  BEFORE UPDATE OR DELETE ON public.warehouse_submissions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_confirmed_warehouse_submission_mutation();

-- 2. Hardening P2: RPC atómica para persistencia de líneas con bloqueo FOR UPDATE
-- de la cabecera, verificación de status y cálculo concurrente seguro de line_number.
CREATE OR REPLACE FUNCTION public.inventory_save_submission_lines_atomic(
  p_empresa_id   uuid,
  p_submission_id uuid,
  p_evidence_id   uuid,
  p_lines         jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_submission record;
  v_evidence record;
  v_next_line integer;
  v_item jsonb;
  v_inserted_count integer := 0;
  v_raw_desc text;
  v_qty numeric;
  v_unit text;
  v_confidence numeric;
  v_uncertainty text;
  v_notes text;
BEGIN
  -- Validar permisos de rol
  IF auth.role() <> 'service_role' THEN
    IF public.current_empresa_id() IS NULL OR public.current_empresa_id() IS DISTINCT FROM p_empresa_id
       OR NOT public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]) THEN
      RAISE EXCEPTION 'Acceso denegado para registrar líneas de rendición';
    END IF;
  END IF;

  -- Bloquear submission FOR UPDATE para serializar cálculo de line_number
  SELECT * INTO v_submission
  FROM public.warehouse_submissions
  WHERE id = p_submission_id AND empresa_id = p_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rendición no encontrada o no pertenece a la empresa';
  END IF;

  IF v_submission.status = 'CONFIRMED' THEN
    RAISE EXCEPTION 'No se pueden agregar líneas a una rendición confirmada';
  END IF;

  IF v_submission.status = 'VOIDED' THEN
    RAISE EXCEPTION 'No se pueden agregar líneas a una rendición anulada';
  END IF;

  -- Validar evidencia
  SELECT * INTO v_evidence
  FROM public.warehouse_submission_evidence
  WHERE id = p_evidence_id AND submission_id = p_submission_id AND empresa_id = p_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Evidencia no encontrada para esta rendición';
  END IF;

  -- Calcular el siguiente número de línea atómicamente dentro del lock
  SELECT coalesce(max(line_number), 0) + 1 INTO v_next_line
  FROM public.warehouse_submission_lines
  WHERE submission_id = p_submission_id;

  -- Insertar cada línea secuencialmente dentro de la transacción
  IF p_lines IS NOT NULL AND jsonb_array_length(p_lines) > 0 THEN
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_lines)
    LOOP
      v_raw_desc := trim(coalesce(v_item->>'rawDescription', ''));
      IF length(v_raw_desc) = 0 THEN
        CONTINUE;
      END IF;

      v_qty := (v_item->>'quantity')::numeric;
      v_unit := nullif(trim(coalesce(v_item->>'unit', '')), '');
      v_confidence := (v_item->>'confidence')::numeric;
      v_uncertainty := nullif(trim(coalesce(v_item->>'uncertaintyReason', '')), '');
      v_notes := nullif(trim(coalesce(v_item->>'notes', '')), '');

      INSERT INTO public.warehouse_submission_lines (
        empresa_id,
        submission_id,
        line_number,
        raw_description,
        quantity,
        unit,
        state,
        confidence,
        uncertainty_reason,
        source_evidence_id,
        notes
      ) VALUES (
        p_empresa_id,
        p_submission_id,
        v_next_line,
        v_raw_desc,
        v_qty,
        v_unit,
        'PROPOSED',
        v_confidence,
        v_uncertainty,
        p_evidence_id,
        v_notes
      );

      v_next_line := v_next_line + 1;
      v_inserted_count := v_inserted_count + 1;
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'inserted_count', v_inserted_count,
    'next_line_number', v_next_line
  );
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_confirmed_warehouse_submission_mutation() FROM anon, authenticated;
REVOKE ALL ON FUNCTION public.inventory_save_submission_lines_atomic(uuid, uuid, uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inventory_save_submission_lines_atomic(uuid, uuid, uuid, jsonb) TO authenticated, service_role;
