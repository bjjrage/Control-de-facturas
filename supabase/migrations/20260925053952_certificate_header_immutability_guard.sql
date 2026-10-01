-- Freeze issued certificate headers and prevent changing their project or
-- sequence after creation. Workflow-specific changes remain narrow and the
-- status-transition trigger still authorizes the backward steps.
CREATE OR REPLACE FUNCTION public.guard_project_certificate_header_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.id IS DISTINCT FROM NEW.id
     OR OLD.project_id IS DISTINCT FROM NEW.project_id
     OR OLD.numero IS DISTINCT FROM NEW.numero THEN
    RAISE EXCEPTION 'La identidad, el proyecto y el número del certificado son inmutables';
  END IF;

  -- Forward transitions may only update the signature/calculation fields
  -- owned by that step; this blocks changing amounts or period while
  -- approving a certificate in the same direct UPDATE.
  IF OLD.status = 'BORRADOR' AND NEW.status = 'ELABORADO' THEN
    IF (pg_catalog.to_jsonb(NEW) - ARRAY['status', 'elaborado_por', 'elaborado_at', 'closed_at',
        'devolucion_anticipo_pct_snap', 'retencion_pct_snap', 'devolucion_anticipo', 'retencion', 'updated_at'])
       IS DISTINCT FROM
       (pg_catalog.to_jsonb(OLD) - ARRAY['status', 'elaborado_por', 'elaborado_at', 'closed_at',
        'devolucion_anticipo_pct_snap', 'retencion_pct_snap', 'devolucion_anticipo', 'retencion', 'updated_at']) THEN
      RAISE EXCEPTION 'La transiciÃ³n de certificado no puede modificar otros datos';
    END IF;
  ELSIF OLD.status = 'ELABORADO' AND NEW.status = 'VERIFICADO' THEN
    IF (pg_catalog.to_jsonb(NEW) - ARRAY['status', 'verificado_por', 'verificado_at', 'updated_at'])
       IS DISTINCT FROM
       (pg_catalog.to_jsonb(OLD) - ARRAY['status', 'verificado_por', 'verificado_at', 'updated_at']) THEN
      RAISE EXCEPTION 'La transiciÃ³n de certificado no puede modificar otros datos';
    END IF;
  ELSIF OLD.status = 'VERIFICADO' AND NEW.status = 'APROBADO' THEN
    IF (pg_catalog.to_jsonb(NEW) - ARRAY['status', 'aprobado_por', 'aprobado_at', 'updated_at'])
       IS DISTINCT FROM
       (pg_catalog.to_jsonb(OLD) - ARRAY['status', 'aprobado_por', 'aprobado_at', 'updated_at']) THEN
      RAISE EXCEPTION 'La transiciÃ³n de certificado no puede modificar otros datos';
    END IF;
  END IF;

  IF OLD.status NOT IN ('APROBADO', 'FACTURADO') THEN
    RETURN NEW;
  END IF;

  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    IF (pg_catalog.to_jsonb(NEW) - 'updated_at')
       IS DISTINCT FROM (pg_catalog.to_jsonb(OLD) - 'updated_at') THEN
      RAISE EXCEPTION 'La cabecera de un certificado aprobado o facturado es inmutable';
    END IF;
    RETURN NEW;
  END IF;

  -- APROBADO -> FACTURADO is the forward workflow step. Only invoice metadata
  -- may accompany it; the existing status guard validates the transition.
  IF OLD.status = 'APROBADO' AND NEW.status = 'FACTURADO' THEN
    IF NEW.factura_numero IS NULL OR pg_catalog.btrim(NEW.factura_numero) = ''
       OR NEW.facturado_at IS NULL THEN
      RAISE EXCEPTION 'Un certificado facturado requiere nÃºmero y fecha de factura';
    END IF;
    IF (pg_catalog.to_jsonb(NEW) - ARRAY['status', 'factura_numero', 'facturado_at', 'updated_at'])
       IS DISTINCT FROM
       (pg_catalog.to_jsonb(OLD) - ARRAY['status', 'factura_numero', 'facturado_at', 'updated_at']) THEN
      RAISE EXCEPTION 'La facturación no puede modificar otros datos del certificado';
    END IF;
    RETURN NEW;
  END IF;

  -- Backward transitions from terminal statuses are still validated by the
  -- one-use authorization consumed by the status-transition guard.
  IF OLD.status = 'APROBADO' AND NEW.status = 'VERIFICADO' THEN
    IF (pg_catalog.to_jsonb(NEW) - ARRAY['status', 'aprobado_por', 'aprobado_at', 'updated_at'])
       IS DISTINCT FROM
       (pg_catalog.to_jsonb(OLD) - ARRAY['status', 'aprobado_por', 'aprobado_at', 'updated_at']) THEN
      RAISE EXCEPTION 'La reversa de aprobación no puede modificar otros datos del certificado';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'FACTURADO' AND NEW.status = 'APROBADO' THEN
    IF (pg_catalog.to_jsonb(NEW) - ARRAY['status', 'factura_numero', 'facturado_at', 'updated_at'])
       IS DISTINCT FROM
       (pg_catalog.to_jsonb(OLD) - ARRAY['status', 'factura_numero', 'facturado_at', 'updated_at']) THEN
      RAISE EXCEPTION 'La reversa de facturación no puede modificar otros datos del certificado';
    END IF;
    RETURN NEW;
  END IF;

  -- Leave invalid status changes to the existing transition guard, which
  -- validates and consumes the one-use authorization for legitimate rollbacks.
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_project_certificate_header_immutability()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_guard_project_certificate_header_immutability
  ON public.project_certificates;
CREATE TRIGGER trg_guard_project_certificate_header_immutability
  BEFORE UPDATE ON public.project_certificates
  FOR EACH ROW EXECUTE FUNCTION public.guard_project_certificate_header_immutability();
