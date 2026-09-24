BEGIN;

-- `status` and confirmation metadata may only be changed by the canonical
-- submission confirmer or trusted server-side portal/processing code.
REVOKE UPDATE ON public.warehouse_submissions FROM PUBLIC, anon, authenticated;
-- A prior migration granted column-level UPDATE as well; table-level REVOKE
-- does not clear those independent ACL entries.
REVOKE UPDATE (
  id, empresa_id, location_id, project_id, portal_link_id, period_start,
  period_end, remision_number, notes, status, processing_error,
  submitted_by, reviewed_by, confirmed_by, processing_started_at,
  processed_at, confirmed_at, created_at, updated_at
) ON public.warehouse_submissions FROM PUBLIC, anon, authenticated;

-- Legacy projections and movement rows are not an alternate write path.
-- Canonical SECURITY DEFINER ledger functions remain able to maintain them.
REVOKE INSERT, UPDATE ON public.productos FROM PUBLIC, anon, authenticated;
GRANT INSERT (
  empresa_id, nombre, descripcion, unidad, sku, stock_minimo, activo,
  created_by, contenido_por_unidad, unidad_base, categoria_id
) ON public.productos TO authenticated;
GRANT UPDATE (
  nombre, descripcion, unidad, sku, stock_minimo, activo, updated_at,
  contenido_por_unidad, unidad_base, categoria_id
) ON public.productos TO authenticated;

REVOKE INSERT, UPDATE, DELETE ON public.stock_movimientos
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prevent_confirmed_warehouse_submission_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_submission_id uuid;
  v_status text;
BEGIN
  IF TG_TABLE_NAME = 'warehouse_submissions' THEN
    IF (TG_OP = 'DELETE' AND OLD.status = 'CONFIRMED')
       OR (TG_OP = 'UPDATE' AND OLD.status = 'CONFIRMED') THEN
      RAISE EXCEPTION 'Una rendición confirmada es inmutable';
    END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  v_submission_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.submission_id ELSE NEW.submission_id END;
  SELECT status INTO v_status
  FROM public.warehouse_submissions
  WHERE id = v_submission_id
  FOR UPDATE;
  IF v_status = 'CONFIRMED' THEN
    RAISE EXCEPTION 'Las líneas de una rendición confirmada son inmutables';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_confirmed_warehouse_submission_mutation()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_prevent_confirmed_warehouse_submission_mutation
  ON public.warehouse_submissions;
CREATE TRIGGER trg_prevent_confirmed_warehouse_submission_mutation
  BEFORE UPDATE OR DELETE ON public.warehouse_submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_confirmed_warehouse_submission_mutation();
DROP TRIGGER IF EXISTS trg_prevent_confirmed_warehouse_submission_line_mutation
  ON public.warehouse_submission_lines;
CREATE TRIGGER trg_prevent_confirmed_warehouse_submission_line_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON public.warehouse_submission_lines
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_confirmed_warehouse_submission_mutation();

-- Only the locked submission confirmer may emit movements carrying this
-- source. Prevents a direct inventory_post_movement call from creating an
-- extra/unlinked consumption that masquerades as part of a submission.
CREATE OR REPLACE FUNCTION public.enforce_warehouse_submission_movement_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_submission record;
  v_line record;
BEGIN
  IF NEW.source_type IS DISTINCT FROM 'WAREHOUSE_SUBMISSION' THEN
    RETURN NEW;
  END IF;

  IF NEW.movement_type IS DISTINCT FROM 'CONSUMPTION'
     OR NEW.source_id IS NULL OR NEW.source_line_id IS NULL
     OR current_setting('app.warehouse_submission_confirmation', true)
        IS DISTINCT FROM NEW.source_id::text THEN
    RAISE EXCEPTION 'Los consumos de rendición solo pueden generarse desde su confirmación canónica';
  END IF;

  SELECT id, empresa_id, location_id, project_id, status, upload_incomplete
    INTO v_submission
  FROM public.warehouse_submissions
  WHERE id = NEW.source_id AND empresa_id = NEW.empresa_id
  FOR UPDATE;
  IF NOT FOUND OR v_submission.status NOT IN ('READY', 'NEEDS_REVIEW')
     OR v_submission.upload_incomplete THEN
    RAISE EXCEPTION 'La rendición no pertenece a la empresa o no está lista para consumir';
  END IF;

  SELECT id, empresa_id, submission_id, producto_id, quantity, unit,
         budget_item_id, state
    INTO v_line
  FROM public.warehouse_submission_lines
  WHERE id = NEW.source_line_id
    AND submission_id = NEW.source_id
    AND empresa_id = NEW.empresa_id
  FOR UPDATE;
  IF NOT FOUND OR v_line.state IS DISTINCT FROM 'CONFIRMED'
     OR NEW.producto_id IS DISTINCT FROM v_line.producto_id
     OR NEW.quantity IS DISTINCT FROM v_line.quantity
     OR NEW.unit IS DISTINCT FROM v_line.unit
     OR NEW.budget_item_id IS DISTINCT FROM v_line.budget_item_id
     OR NEW.from_location_id IS DISTINCT FROM v_submission.location_id
     OR NEW.to_location_id IS NOT NULL
     OR NEW.project_id IS DISTINCT FROM v_submission.project_id THEN
    RAISE EXCEPTION 'El consumo no coincide con la línea confirmada de la rendición';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_warehouse_submission_movement_source()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_enforce_warehouse_submission_movement_source
  ON public.inventory_movements;
CREATE TRIGGER trg_enforce_warehouse_submission_movement_source
  BEFORE INSERT OR UPDATE ON public.inventory_movements
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_warehouse_submission_movement_source();

CREATE OR REPLACE FUNCTION public.enforce_warehouse_submission_canonical_confirmation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'CONFIRMED' THEN
    RAISE EXCEPTION 'Una rendición solo puede confirmarse mediante el flujo canónico';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'CONFIRMED' THEN
    RAISE EXCEPTION 'Una rendición confirmada es inmutable';
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.status = 'CONFIRMED'
     AND OLD.status IS DISTINCT FROM 'CONFIRMED' THEN
    IF NEW.confirmed_by IS NULL OR NEW.confirmed_at IS NULL
       OR NEW.project_id IS NULL OR NEW.location_id IS NULL THEN
      RAISE EXCEPTION 'La confirmación requiere responsable, obra y ubicación';
    END IF;
    IF NEW.upload_incomplete THEN
      RAISE EXCEPTION 'La rendición tiene cargas de archivos incompletas o pendientes';
    END IF;
    IF auth.uid() IS NOT NULL
       AND NEW.confirmed_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'El confirmador debe coincidir con el usuario autenticado';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.warehouse_submission_lines l
      WHERE l.submission_id = NEW.id
        AND l.empresa_id = NEW.empresa_id
        AND l.state = 'CONFIRMED'
    ) OR EXISTS (
      SELECT 1
      FROM public.warehouse_submission_lines l
      LEFT JOIN public.inventory_movements m
        ON m.id = l.inventory_movement_id
       AND m.empresa_id = NEW.empresa_id
      WHERE l.submission_id = NEW.id
        AND l.empresa_id = NEW.empresa_id
        AND (
          l.state = 'PROPOSED'
          OR (l.state = 'REJECTED' AND l.inventory_movement_id IS NOT NULL)
          OR (l.state = 'CONFIRMED' AND (
            l.producto_id IS NULL
            OR l.quantity IS NULL
            OR l.unit IS NULL
            OR l.budget_item_id IS NULL
            OR l.inventory_movement_id IS NULL
            OR m.id IS NULL
            OR m.status IS DISTINCT FROM 'CONFIRMED'
            OR m.movement_type IS DISTINCT FROM 'CONSUMPTION'
            OR m.source_type IS DISTINCT FROM 'WAREHOUSE_SUBMISSION'
            OR m.source_id IS DISTINCT FROM NEW.id
            OR m.source_line_id IS DISTINCT FROM l.id
            OR m.producto_id IS DISTINCT FROM l.producto_id
            OR m.quantity IS DISTINCT FROM l.quantity
            OR m.unit IS DISTINCT FROM l.unit
            OR m.project_id IS DISTINCT FROM NEW.project_id
            OR m.budget_item_id IS DISTINCT FROM l.budget_item_id
          ))
        )
    ) THEN
      RAISE EXCEPTION 'La rendición no tiene consumos canónicos completos y conciliados';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_warehouse_submission_canonical_confirmation()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_enforce_warehouse_submission_canonical_confirmation
  ON public.warehouse_submissions;
CREATE TRIGGER trg_enforce_warehouse_submission_canonical_confirmation
  BEFORE INSERT OR UPDATE ON public.warehouse_submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_warehouse_submission_canonical_confirmation();

-- Confirmed rows created before this gate cannot be reported as a successful
-- idempotent confirmation unless every line is linked to its exact consumption.
CREATE OR REPLACE FUNCTION public.inventory_confirm_warehouse_submission(
  p_empresa_id uuid,
  p_submission_id uuid,
  p_confirmed_by uuid,
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
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF public.current_empresa_id() IS DISTINCT FROM p_empresa_id
       OR NOT public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]) THEN
      RAISE EXCEPTION 'Acceso denegado para confirmar rendición';
    END IF;
    IF p_confirmed_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'El confirmador debe coincidir con el usuario autenticado';
    END IF;
  END IF;

  SELECT * INTO v_submission
  FROM public.warehouse_submissions
  WHERE id = p_submission_id AND empresa_id = p_empresa_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Rendición no encontrada'; END IF;
  IF v_submission.status = 'VOIDED' THEN RAISE EXCEPTION 'La rendición está anulada'; END IF;
  IF v_submission.status = 'CONFIRMED' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.warehouse_submission_lines l
      WHERE l.submission_id = p_submission_id
        AND l.empresa_id = p_empresa_id
        AND l.state = 'CONFIRMED'
    ) OR EXISTS (
      SELECT 1
      FROM public.warehouse_submission_lines l
      LEFT JOIN public.inventory_movements m
        ON m.id = l.inventory_movement_id
       AND m.empresa_id = p_empresa_id
      WHERE l.submission_id = p_submission_id
        AND l.empresa_id = p_empresa_id
        AND (
          l.state = 'PROPOSED'
          OR (l.state = 'REJECTED' AND l.inventory_movement_id IS NOT NULL)
          OR (l.state = 'CONFIRMED' AND (
            l.producto_id IS NULL
            OR l.quantity IS NULL
            OR l.unit IS NULL
            OR l.budget_item_id IS NULL
            OR l.inventory_movement_id IS NULL
            OR m.id IS NULL
            OR m.status IS DISTINCT FROM 'CONFIRMED'
            OR m.movement_type IS DISTINCT FROM 'CONSUMPTION'
            OR m.source_type IS DISTINCT FROM 'WAREHOUSE_SUBMISSION'
            OR m.source_id IS DISTINCT FROM p_submission_id
            OR m.source_line_id IS DISTINCT FROM l.id
            OR m.producto_id IS DISTINCT FROM l.producto_id
            OR m.quantity IS DISTINCT FROM l.quantity
            OR m.unit IS DISTINCT FROM l.unit
            OR m.project_id IS DISTINCT FROM v_submission.project_id
            OR m.budget_item_id IS DISTINCT FROM l.budget_item_id
          ))
        )
    ) THEN
      RAISE EXCEPTION 'La rendición confirmada no concilia con sus consumos canónicos; requiere revisión';
    END IF;

    SELECT coalesce(array_agg(l.inventory_movement_id ORDER BY l.line_number), '{}') INTO v_ids
    FROM public.warehouse_submission_lines l
    WHERE l.submission_id = p_submission_id
      AND l.empresa_id = p_empresa_id
      AND l.state = 'CONFIRMED';
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
    WHERE submission_id = p_submission_id
      AND empresa_id = p_empresa_id
      AND state = 'PROPOSED'
  ) THEN
    RAISE EXCEPTION 'La rendición todavía tiene líneas propuestas sin revisar';
  END IF;

  PERFORM set_config('app.warehouse_submission_confirmation', p_submission_id::text, true);
  FOR v_line IN
    SELECT * FROM public.warehouse_submission_lines
    WHERE submission_id = p_submission_id
      AND empresa_id = p_empresa_id
      AND state = 'CONFIRMED'
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
    WHERE id = v_line.id AND empresa_id = p_empresa_id;
    v_ids := array_append(v_ids, v_movement);
  END LOOP;
  PERFORM set_config('app.warehouse_submission_confirmation', '', true);

  UPDATE public.warehouse_submissions
  SET status = 'CONFIRMED', confirmed_by = p_confirmed_by,
      confirmed_at = now(), updated_at = now(), processing_error = NULL
  WHERE id = p_submission_id AND empresa_id = p_empresa_id;
  RETURN v_ids;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.inventory_confirm_warehouse_submission(uuid, uuid, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inventory_confirm_warehouse_submission(uuid, uuid, uuid, text)
  TO authenticated, service_role;

-- The legacy stock RPC bypasses inventory_movements/inventory_balances and
-- trusts a caller-supplied tenant id. Keep it present for migration history,
-- but remove its public application write surface entirely.
REVOKE ALL ON FUNCTION public.registrar_stock_movimiento(
  uuid, uuid, text, numeric, text, uuid, text, uuid, numeric,
  uuid, uuid, uuid, uuid
) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
