-- Serialize certificate creation with administrative rollback so a later
-- certificate cannot appear between the dependency check and the state change.
CREATE OR REPLACE FUNCTION public.guard_project_certificate_create()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_project_id uuid;
  v_latest_num integer;
  v_latest_status text;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_internal_role(ARRAY['administracion', 'admin']::public.user_role[]) THEN
    RAISE EXCEPTION 'Solo administración puede crear certificados';
  END IF;

  SELECT p.id INTO v_project_id
  FROM public.projects p
  WHERE p.id = NEW.project_id
    AND p.empresa_id = public.current_empresa_id()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proyecto no encontrado para la empresa';
  END IF;
  IF NEW.status IS DISTINCT FROM 'BORRADOR' THEN
    RAISE EXCEPTION 'Un certificado nuevo debe comenzar en borrador';
  END IF;

  -- The project row lock is shared with the rollback RPC. It also serializes
  -- concurrent creates, so the latest-state and next-number checks are fresh.
  SELECT c.numero, c.status::text
    INTO v_latest_num, v_latest_status
  FROM public.project_certificates c
  WHERE c.project_id = NEW.project_id
  ORDER BY c.numero DESC
  LIMIT 1;

  IF v_latest_num IS NOT NULL AND v_latest_status NOT IN ('APROBADO', 'FACTURADO') THEN
    RAISE EXCEPTION 'El certificado anterior debe estar aprobado antes de crear otro';
  END IF;
  IF NEW.numero IS DISTINCT FROM coalesce(v_latest_num, 0) + 1 THEN
    RAISE EXCEPTION 'El número del certificado cambió; actualizá la pantalla e intentá de nuevo';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_project_certificate_create()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_guard_project_certificate_create ON public.project_certificates;
CREATE TRIGGER trg_guard_project_certificate_create
  BEFORE INSERT ON public.project_certificates
  FOR EACH ROW EXECUTE FUNCTION public.guard_project_certificate_create();

CREATE OR REPLACE FUNCTION public.revert_project_certificate_status_atomically(
  p_certificate_id uuid,
  p_expected_status text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_numero integer;
  v_status text;
  v_target_status text;
BEGIN
  IF v_user_id IS NULL
     OR NOT public.is_internal_role(ARRAY['admin']::public.user_role[]) THEN
    RAISE EXCEPTION 'Solo administración puede retroceder un certificado';
  END IF;

  -- Lock project first (same lock order as certificate creation), then read
  -- the latest committed state in a new statement after any lock wait.
  SELECT p.id INTO v_project_id
  FROM public.projects p
  JOIN public.project_certificates c ON c.project_id = p.id
  WHERE c.id = p_certificate_id
    AND p.empresa_id = public.current_empresa_id()
  FOR UPDATE OF p;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Certificado no encontrado para la empresa';
  END IF;

  SELECT c.numero, c.status::text INTO v_numero, v_status
  FROM public.project_certificates c
  WHERE c.id = p_certificate_id AND c.project_id = v_project_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Certificado no encontrado para la empresa';
  END IF;
  IF v_status IS DISTINCT FROM p_expected_status THEN
    RAISE EXCEPTION 'El certificado cambió de estado; actualizá la pantalla e intentá de nuevo';
  END IF;

  v_target_status := CASE v_status
    WHEN 'ELABORADO' THEN 'BORRADOR'
    WHEN 'VERIFICADO' THEN 'ELABORADO'
    WHEN 'APROBADO' THEN 'VERIFICADO'
    WHEN 'FACTURADO' THEN 'APROBADO'
    ELSE NULL
  END;
  IF v_target_status IS NULL THEN
    RAISE EXCEPTION 'El certificado está en borrador, no se puede retroceder';
  END IF;

  IF v_status IN ('APROBADO', 'FACTURADO') AND EXISTS (
    SELECT 1
    FROM public.project_certificates later
    WHERE later.project_id = v_project_id
      AND later.numero > v_numero
  ) THEN
    RAISE EXCEPTION 'Existe un certificado posterior que depende de este';
  END IF;

  INSERT INTO private.project_certificate_transition_authorizations
    (transaction_id, certificate_id, user_id, from_status, to_status)
  VALUES
    (pg_catalog.txid_current(), p_certificate_id, v_user_id, v_status, v_target_status);

  IF v_status = 'ELABORADO' THEN
    UPDATE public.project_certificates
    SET status = v_target_status,
        elaborado_por = NULL,
        elaborado_at = NULL,
        closed_at = NULL,
        devolucion_anticipo_pct_snap = NULL,
        retencion_pct_snap = NULL
    WHERE id = p_certificate_id;
  ELSIF v_status = 'VERIFICADO' THEN
    UPDATE public.project_certificates
    SET status = v_target_status,
        verificado_por = NULL,
        verificado_at = NULL
    WHERE id = p_certificate_id;
  ELSIF v_status = 'APROBADO' THEN
    UPDATE public.project_certificates
    SET status = v_target_status,
        aprobado_por = NULL,
        aprobado_at = NULL
    WHERE id = p_certificate_id;
  ELSE
    UPDATE public.project_certificates
    SET status = v_target_status,
        facturado_at = NULL,
        factura_numero = NULL
    WHERE id = p_certificate_id;
  END IF;

  RETURN v_target_status;
END;
$$;
