-- Add one review-only row to a submission backed by human-supplied evidence.
-- This enables photo-only renditions without interpreting image contents.
CREATE OR REPLACE FUNCTION public.inventory_add_manual_warehouse_submission_line(
  p_empresa_id uuid,
  p_submission_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_submission record;
  v_evidence_id uuid;
  v_line_number integer;
  v_line_id uuid;
BEGIN
  IF auth.uid() IS NULL
     OR public.current_empresa_id() IS DISTINCT FROM p_empresa_id
     OR NOT coalesce(public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]), false) THEN
    RAISE EXCEPTION 'Acceso denegado para agregar una línea manual';
  END IF;

  SELECT id, project_id, status
    INTO v_submission
  FROM public.warehouse_submissions
  WHERE id = p_submission_id
    AND empresa_id = p_empresa_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Rendición no encontrada o no pertenece a la empresa';
  END IF;
  IF v_submission.status NOT IN ('READY', 'NEEDS_REVIEW') THEN
    RAISE EXCEPTION 'La rendición debe terminar de procesarse antes de agregar líneas';
  END IF;

  SELECT id
    INTO v_evidence_id
  FROM public.warehouse_submission_evidence
  WHERE submission_id = p_submission_id
    AND empresa_id = p_empresa_id
  ORDER BY created_at, id
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'La rendición necesita evidencia antes de agregar una línea manual';
  END IF;

  SELECT coalesce(max(line_number), 0) + 1
    INTO v_line_number
  FROM public.warehouse_submission_lines
  WHERE submission_id = p_submission_id
    AND empresa_id = p_empresa_id;

  INSERT INTO public.warehouse_submission_lines (
    empresa_id,
    submission_id,
    line_number,
    raw_description,
    state,
    uncertainty_reason,
    confidence,
    source_evidence_id
  ) VALUES (
    p_empresa_id,
    p_submission_id,
    v_line_number,
    format('Fila %s: descripción pendiente', v_line_number),
    'PROPOSED',
    'Línea ingresada manualmente desde la evidencia; completar y revisar antes de confirmar.',
    0,
    v_evidence_id
  )
  RETURNING id INTO v_line_id;

  RETURN jsonb_build_object(
    'line_id', v_line_id,
    'project_id', v_submission.project_id,
    'line_number', v_line_number
  );
END;
$$;

REVOKE ALL ON FUNCTION public.inventory_add_manual_warehouse_submission_line(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inventory_add_manual_warehouse_submission_line(uuid, uuid)
  TO authenticated;

-- Extraction state is controlled by the server-side processor only. A tenant
-- admin must not clear FAILED/PROCESSING evidence through the Data API.
REVOKE UPDATE, DELETE ON public.warehouse_submission_evidence
  FROM PUBLIC, anon, authenticated;
GRANT UPDATE ON public.warehouse_submission_evidence TO service_role;

CREATE OR REPLACE FUNCTION public.validate_warehouse_submission_evidence_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_submission_empresa uuid;
BEGIN
  SELECT empresa_id
    INTO v_submission_empresa
  FROM public.warehouse_submissions
  WHERE id = NEW.submission_id;

  IF v_submission_empresa IS NULL
     OR v_submission_empresa IS DISTINCT FROM NEW.empresa_id THEN
    RAISE EXCEPTION 'La evidencia no pertenece a la rendición y tenant indicados';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_warehouse_submission_evidence_tenant()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_00_validate_warehouse_submission_evidence_tenant
  ON public.warehouse_submission_evidence;
CREATE TRIGGER trg_00_validate_warehouse_submission_evidence_tenant
  BEFORE INSERT OR UPDATE ON public.warehouse_submission_evidence
  FOR EACH ROW EXECUTE FUNCTION public.validate_warehouse_submission_evidence_tenant();
