-- Batch 6: keep project-level contracts/evidence scoped and close financial
-- and certificate races with server-side row locks.

-- A closed project certificate cannot have its measurement lines edited by a
-- stale browser request. Locking the parent serializes edits with transitions.
CREATE OR REPLACE FUNCTION public.guard_project_certificate_line_write()
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
    RAISE EXCEPTION 'No se puede mover una línea entre certificados';
  END IF;

  SELECT c.status::text INTO v_status
  FROM public.project_certificates c
  WHERE c.id = v_certificate_id
  FOR UPDATE;
  IF NOT FOUND OR v_status <> 'BORRADOR' THEN
    RAISE EXCEPTION 'Solo se pueden modificar líneas de un certificado en borrador';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_project_certificate_line_write ON public.project_certificate_items;
CREATE TRIGGER trg_guard_project_certificate_line_write
  BEFORE INSERT OR UPDATE ON public.project_certificate_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_project_certificate_line_write();
REVOKE ALL ON FUNCTION public.guard_project_certificate_line_write() FROM PUBLIC, anon, authenticated;

-- Recompute every line and the aggregate header in one transaction. The lock
-- makes the BORRADOR check durable for the complete resync operation.
CREATE OR REPLACE FUNCTION public.resync_project_certificate_quantities_atomically(
  p_empresa_id uuid,
  p_certificate_id uuid,
  p_actor_id uuid,
  p_updates jsonb
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_project_id uuid;
  v_status text;
  v_input_count integer;
  v_distinct_count integer;
  v_expected_count integer;
  v_updated_count integer;
  v_monto_anterior numeric;
  v_monto_presente numeric;
BEGIN
  IF auth.uid() IS NULL
     OR p_actor_id IS DISTINCT FROM auth.uid()
     OR public.current_empresa_id() IS DISTINCT FROM p_empresa_id
     OR NOT public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]) THEN
    RAISE EXCEPTION 'Acceso denegado para recalcular certificado';
  END IF;
  IF p_updates IS NULL OR pg_catalog.jsonb_typeof(p_updates) <> 'array' THEN
    RAISE EXCEPTION 'La lista de cantidades no es válida';
  END IF;

  SELECT c.project_id, c.status::text INTO v_project_id, v_status
  FROM public.project_certificates c
  JOIN public.projects p ON p.id = c.project_id AND p.empresa_id = p_empresa_id
  WHERE c.id = p_certificate_id
  FOR UPDATE OF c;
  IF NOT FOUND THEN RAISE EXCEPTION 'Certificado no encontrado para la empresa'; END IF;
  IF v_status <> 'BORRADOR' THEN
    RAISE EXCEPTION 'El certificado ya está elaborado y no se puede editar';
  END IF;

  SELECT count(*), count(DISTINCT u.item_id)
    INTO v_input_count, v_distinct_count
  FROM pg_catalog.jsonb_to_recordset(p_updates)
    AS u(item_id uuid, qty_anterior numeric, qty_presente numeric);
  IF v_input_count <> v_distinct_count THEN
    RAISE EXCEPTION 'La lista contiene líneas duplicadas';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_to_recordset(p_updates)
      AS u(item_id uuid, qty_anterior numeric, qty_presente numeric)
    WHERE u.item_id IS NULL OR u.qty_anterior IS NULL OR u.qty_presente IS NULL
      OR u.qty_anterior < 0 OR u.qty_presente < 0
  ) THEN
    RAISE EXCEPTION 'Las cantidades deben ser válidas y no negativas';
  END IF;

  SELECT count(*) INTO v_expected_count
  FROM public.project_certificate_items i
  WHERE i.certificate_id = p_certificate_id AND i.budget_item_id IS NOT NULL;
  IF v_input_count <> v_expected_count THEN
    RAISE EXCEPTION 'La lista de cantidades no coincide con las líneas del certificado';
  END IF;

  UPDATE public.project_certificate_items i
  SET qty_anterior = u.qty_anterior,
      qty_presente = u.qty_presente
  FROM pg_catalog.jsonb_to_recordset(p_updates)
    AS u(item_id uuid, qty_anterior numeric, qty_presente numeric)
  WHERE i.id = u.item_id AND i.certificate_id = p_certificate_id
    AND i.budget_item_id IS NOT NULL;
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count <> v_input_count THEN
    RAISE EXCEPTION 'Cambió una línea durante el recálculo del certificado';
  END IF;

  SELECT coalesce(sum(i.monto_anterior), 0), coalesce(sum(i.monto_presente), 0)
    INTO v_monto_anterior, v_monto_presente
  FROM public.project_certificate_items i
  WHERE i.certificate_id = p_certificate_id;
  UPDATE public.project_certificates c
  SET monto_anterior = v_monto_anterior,
      monto_presente = v_monto_presente
  WHERE c.id = p_certificate_id AND c.project_id = v_project_id AND c.status = 'BORRADOR';
  IF NOT FOUND THEN RAISE EXCEPTION 'El certificado cambió durante el recálculo'; END IF;

  RETURN v_updated_count;
END;
$$;

-- Contract and budget-item references on a subcontractor contract must point
-- to the same project and company.
CREATE OR REPLACE FUNCTION public.guard_subcontractor_contract_project_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_project_empresa uuid;
  v_subcontractor_empresa uuid;
  v_budget_project uuid;
BEGIN
  SELECT p.empresa_id INTO v_project_empresa
  FROM public.projects p WHERE p.id = NEW.project_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Proyecto del contrato no encontrado'; END IF;
  SELECT s.empresa_id INTO v_subcontractor_empresa
  FROM public.subcontractors s WHERE s.id = NEW.subcontractor_id;
  IF NOT FOUND OR v_subcontractor_empresa IS DISTINCT FROM v_project_empresa THEN
    RAISE EXCEPTION 'El subcontratista no pertenece a la empresa del proyecto';
  END IF;
  IF NEW.budget_item_id IS NOT NULL THEN
    SELECT b.project_id INTO v_budget_project
    FROM public.budget_items b WHERE b.id = NEW.budget_item_id;
    IF NOT FOUND OR v_budget_project IS DISTINCT FROM NEW.project_id THEN
      RAISE EXCEPTION 'La partida presupuestaria no pertenece al proyecto del contrato';
    END IF;
  END IF;
  IF auth.uid() IS NOT NULL AND v_project_empresa IS DISTINCT FROM public.current_empresa_id() THEN
    RAISE EXCEPTION 'El proyecto del contrato pertenece a otra empresa';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_subcontractor_contract_project_scope ON public.subcontractor_contracts;
CREATE TRIGGER trg_guard_subcontractor_contract_project_scope
  BEFORE INSERT OR UPDATE ON public.subcontractor_contracts
  FOR EACH ROW EXECUTE FUNCTION public.guard_subcontractor_contract_project_scope();
REVOKE ALL ON FUNCTION public.guard_subcontractor_contract_project_scope() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.guard_subcontractor_certificate_project_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contract_project uuid;
  v_project_empresa uuid;
BEGIN
  SELECT c.project_id INTO v_contract_project
  FROM public.subcontractor_contracts c WHERE c.id = NEW.contract_id;
  IF NOT FOUND OR v_contract_project IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION 'El certificado debe pertenecer al proyecto de su contrato';
  END IF;
  SELECT p.empresa_id INTO v_project_empresa
  FROM public.projects p WHERE p.id = NEW.project_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Proyecto del certificado no encontrado'; END IF;
  IF auth.uid() IS NOT NULL AND v_project_empresa IS DISTINCT FROM public.current_empresa_id() THEN
    RAISE EXCEPTION 'El certificado pertenece a otra empresa';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_subcontractor_certificate_project_scope ON public.subcontractor_certificates;
CREATE TRIGGER trg_guard_subcontractor_certificate_project_scope
  BEFORE INSERT OR UPDATE ON public.subcontractor_certificates
  FOR EACH ROW EXECUTE FUNCTION public.guard_subcontractor_certificate_project_scope();
REVOKE ALL ON FUNCTION public.guard_subcontractor_certificate_project_scope() FROM PUBLIC, anon, authenticated;

-- Approvals serialize on the contract row so concurrent approvals cannot
-- exceed the contracted ceiling. Direct authenticated UPDATE is removed.
CREATE OR REPLACE FUNCTION public.approve_subcontractor_certificate_atomically(
  p_empresa_id uuid,
  p_certificate_id uuid,
  p_approved_pct numeric,
  p_approved_amount numeric,
  p_notes text,
  p_actor_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contract_id uuid;
  v_project_id uuid;
  v_status text;
  v_existing_pct numeric;
  v_existing_amount numeric;
  v_existing_notes text;
  v_contracted_amount numeric;
  v_other_approved numeric;
BEGIN
  IF auth.uid() IS NULL
     OR p_actor_id IS DISTINCT FROM auth.uid()
     OR public.current_empresa_id() IS DISTINCT FROM p_empresa_id
     OR NOT public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]) THEN
    RAISE EXCEPTION 'Acceso denegado para aprobar certificado de subcontratista';
  END IF;
  IF p_approved_pct IS NULL OR p_approved_pct <= 0 OR p_approved_pct > 100
     OR p_approved_amount IS NULL OR p_approved_amount <= 0 THEN
    RAISE EXCEPTION 'El porcentaje y el monto aprobados deben ser válidos';
  END IF;

  SELECT sc.contract_id, sc.project_id, sc.status, sc.approved_pct, sc.approved_amount, sc.notes
    INTO v_contract_id, v_project_id, v_status, v_existing_pct, v_existing_amount, v_existing_notes
  FROM public.subcontractor_certificates sc
  JOIN public.projects p ON p.id = sc.project_id AND p.empresa_id = p_empresa_id
  WHERE sc.id = p_certificate_id
  FOR UPDATE OF sc;
  IF NOT FOUND THEN RAISE EXCEPTION 'Certificado no encontrado para la empresa'; END IF;

  SELECT c.contracted_amount INTO v_contracted_amount
  FROM public.subcontractor_contracts c
  WHERE c.id = v_contract_id AND c.project_id = v_project_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Contrato no encontrado para el proyecto'; END IF;

  IF v_status = 'APROBADO'
     AND v_existing_pct IS NOT DISTINCT FROM p_approved_pct
     AND v_existing_amount IS NOT DISTINCT FROM p_approved_amount
     AND v_existing_notes IS NOT DISTINCT FROM p_notes THEN
    RETURN p_certificate_id;
  END IF;
  IF v_status <> 'PENDIENTE' THEN
    RAISE EXCEPTION 'Solo se puede aprobar un certificado pendiente';
  END IF;

  SELECT coalesce(sum(sc.approved_amount), 0) INTO v_other_approved
  FROM public.subcontractor_certificates sc
  WHERE sc.contract_id = v_contract_id AND sc.id <> p_certificate_id
    AND sc.status IN ('APROBADO','PAGADO');
  IF v_other_approved + p_approved_amount > v_contracted_amount THEN
    RAISE EXCEPTION 'La aprobación supera el monto contratado';
  END IF;

  UPDATE public.subcontractor_certificates sc
  SET status = 'APROBADO', approved_pct = p_approved_pct,
      approved_amount = p_approved_amount, notes = p_notes
  WHERE sc.id = p_certificate_id AND sc.project_id = v_project_id AND sc.status = 'PENDIENTE';
  IF NOT FOUND THEN RAISE EXCEPTION 'El certificado cambió durante la aprobación'; END IF;
  RETURN p_certificate_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_subcontractor_certificate_atomically(
  p_empresa_id uuid,
  p_certificate_id uuid,
  p_notes text,
  p_actor_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_project_id uuid;
  v_status text;
BEGIN
  IF auth.uid() IS NULL
     OR p_actor_id IS DISTINCT FROM auth.uid()
     OR public.current_empresa_id() IS DISTINCT FROM p_empresa_id
     OR NOT public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]) THEN
    RAISE EXCEPTION 'Acceso denegado para rechazar certificado de subcontratista';
  END IF;
  SELECT sc.project_id, sc.status INTO v_project_id, v_status
  FROM public.subcontractor_certificates sc
  JOIN public.projects p ON p.id = sc.project_id AND p.empresa_id = p_empresa_id
  WHERE sc.id = p_certificate_id
  FOR UPDATE OF sc;
  IF NOT FOUND THEN RAISE EXCEPTION 'Certificado no encontrado para la empresa'; END IF;
  IF v_status = 'RECHAZADO' THEN RETURN p_certificate_id; END IF;
  IF v_status <> 'PENDIENTE' THEN RAISE EXCEPTION 'Solo se puede rechazar un certificado pendiente'; END IF;

  UPDATE public.subcontractor_certificates sc
  SET status = 'RECHAZADO', notes = p_notes
  WHERE sc.id = p_certificate_id AND sc.project_id = v_project_id AND sc.status = 'PENDIENTE';
  IF NOT FOUND THEN RAISE EXCEPTION 'El certificado cambió durante el rechazo'; END IF;
  RETURN p_certificate_id;
END;
$$;

DROP POLICY IF EXISTS subcontractor_certificates_update ON public.subcontractor_certificates;
REVOKE UPDATE ON TABLE public.subcontractor_certificates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.subcontractor_certificates TO authenticated;
-- The public certificate portal persists only its server-side AI review result.
-- Keep that narrow service-role path while removing human direct row updates.
GRANT UPDATE (ai_flags) ON TABLE public.subcontractor_certificates TO service_role;

REVOKE ALL ON FUNCTION public.resync_project_certificate_quantities_atomically(uuid, uuid, uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resync_project_certificate_quantities_atomically(uuid, uuid, uuid, jsonb)
  TO authenticated;
REVOKE ALL ON FUNCTION public.approve_subcontractor_certificate_atomically(uuid, uuid, numeric, numeric, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_subcontractor_certificate_atomically(uuid, uuid, numeric, numeric, text, uuid)
  TO authenticated;
REVOKE ALL ON FUNCTION public.reject_subcontractor_certificate_atomically(uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_subcontractor_certificate_atomically(uuid, uuid, text, uuid)
  TO authenticated;
