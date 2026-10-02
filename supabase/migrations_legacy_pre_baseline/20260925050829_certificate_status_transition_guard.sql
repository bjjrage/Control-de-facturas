-- Enforce the certificate workflow at the database boundary. Backward steps
-- remain available only through the tenant-checked admin RPC below.
CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE private.project_certificate_transition_authorizations (
  transaction_id bigint NOT NULL,
  certificate_id uuid NOT NULL,
  user_id uuid NOT NULL,
  from_status text NOT NULL,
  to_status text NOT NULL,
  PRIMARY KEY (transaction_id, certificate_id)
);
REVOKE ALL ON TABLE private.project_certificate_transition_authorizations
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guard_project_certificate_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF (OLD.status = 'BORRADOR' AND NEW.status = 'ELABORADO')
     OR (OLD.status = 'ELABORADO' AND NEW.status = 'VERIFICADO')
     OR (OLD.status = 'VERIFICADO' AND NEW.status = 'APROBADO')
     OR (OLD.status = 'APROBADO' AND NEW.status = 'FACTURADO') THEN
    RETURN NEW;
  END IF;

  DELETE FROM private.project_certificate_transition_authorizations a
  WHERE a.transaction_id = pg_catalog.txid_current()
    AND a.certificate_id = OLD.id
    AND a.user_id = auth.uid()
    AND a.from_status = OLD.status::text
    AND a.to_status = NEW.status::text;
  IF FOUND THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'La regresión de estado del certificado requiere la acción administrativa autorizada';
END;
$$;

REVOKE ALL ON FUNCTION public.guard_project_certificate_status_transition()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_guard_project_certificate_status_transition
  ON public.project_certificates;
CREATE TRIGGER trg_guard_project_certificate_status_transition
  BEFORE UPDATE OF status ON public.project_certificates
  FOR EACH ROW EXECUTE FUNCTION public.guard_project_certificate_status_transition();

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

  SELECT c.project_id, c.numero, c.status::text
    INTO v_project_id, v_numero, v_status
  FROM public.project_certificates c
  JOIN public.projects p
    ON p.id = c.project_id
   AND p.empresa_id = public.current_empresa_id()
  WHERE c.id = p_certificate_id
  FOR UPDATE OF c;
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

REVOKE ALL ON FUNCTION public.revert_project_certificate_status_atomically(uuid, text)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.revert_project_certificate_status_atomically(uuid, text)
  TO authenticated;
