-- =============================================================================
-- 20260927212500_certificate_header_guard_exclude_all_generated_columns.sql
--
-- Bug real encontrado en vivo (2026-09-27), segunda vuelta: "Elaborar" seguía
-- fallando después de excluir monto_liquido (20260927210000). El error real
-- (agregado temporalmente al mensaje para diagnosticar) fue:
--   {"monto_acumulado": {"new": null, "old": 2484250522.00}}
--
-- Cualquier columna GENERATED aparece como NULL en NEW dentro de un trigger
-- BEFORE UPDATE — Postgres recién la recalcula DESPUÉS de que corren los
-- triggers BEFORE. monto_liquido y monto_acumulado son ambas GENERATED, y
-- este problema afecta a TODAS las transiciones de estado (BORRADOR→
-- ELABORADO, ELABORADO→VERIFICADO, VERIFICADO→APROBADO, APROBADO⇄FACTURADO,
-- APROBADO⇄VERIFICADO, y la inmutabilidad de APROBADO/FACTURADO), no solo a
-- Elaborar. Se excluyen ambas columnas generadas en cada comparación.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.guard_project_certificate_header_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.id IS DISTINCT FROM NEW.id OR OLD.project_id IS DISTINCT FROM NEW.project_id OR OLD.numero IS DISTINCT FROM NEW.numero THEN
    RAISE EXCEPTION 'La identidad, el proyecto y el número del certificado son inmutables';
  END IF;
  IF OLD.status = 'BORRADOR' AND NEW.status = 'ELABORADO' THEN
    IF (pg_catalog.to_jsonb(NEW) - ARRAY['status','elaborado_por','elaborado_at','closed_at','devolucion_anticipo_pct_snap','retencion_pct_snap','devolucion_anticipo','retencion','monto_liquido','monto_acumulado','updated_at'])
       IS DISTINCT FROM
       (pg_catalog.to_jsonb(OLD) - ARRAY['status','elaborado_por','elaborado_at','closed_at','devolucion_anticipo_pct_snap','retencion_pct_snap','devolucion_anticipo','retencion','monto_liquido','monto_acumulado','updated_at']) THEN
      RAISE EXCEPTION 'La transición de certificado no puede modificar otros datos';
    END IF;
  ELSIF OLD.status = 'ELABORADO' AND NEW.status = 'VERIFICADO' THEN
    IF (pg_catalog.to_jsonb(NEW) - ARRAY['status','verificado_por','verificado_at','monto_liquido','monto_acumulado','updated_at'])
       IS DISTINCT FROM (pg_catalog.to_jsonb(OLD) - ARRAY['status','verificado_por','verificado_at','monto_liquido','monto_acumulado','updated_at']) THEN
      RAISE EXCEPTION 'La transición de certificado no puede modificar otros datos';
    END IF;
  ELSIF OLD.status = 'VERIFICADO' AND NEW.status = 'APROBADO' THEN
    IF (pg_catalog.to_jsonb(NEW) - ARRAY['status','aprobado_por','aprobado_at','monto_liquido','monto_acumulado','updated_at'])
       IS DISTINCT FROM (pg_catalog.to_jsonb(OLD) - ARRAY['status','aprobado_por','aprobado_at','monto_liquido','monto_acumulado','updated_at']) THEN
      RAISE EXCEPTION 'La transición de certificado no puede modificar otros datos';
    END IF;
  END IF;
  IF OLD.status NOT IN ('APROBADO', 'FACTURADO') THEN RETURN NEW; END IF;
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    IF (pg_catalog.to_jsonb(NEW) - ARRAY['updated_at','monto_liquido','monto_acumulado']) IS DISTINCT FROM (pg_catalog.to_jsonb(OLD) - ARRAY['updated_at','monto_liquido','monto_acumulado']) THEN
      RAISE EXCEPTION 'La cabecera de un certificado aprobado o facturado es inmutable';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'APROBADO' AND NEW.status = 'FACTURADO' THEN
    IF NEW.factura_numero IS NULL OR pg_catalog.btrim(NEW.factura_numero) = '' OR NEW.facturado_at IS NULL THEN
      RAISE EXCEPTION 'Un certificado facturado requiere número y fecha de factura';
    END IF;
    IF (pg_catalog.to_jsonb(NEW) - ARRAY['status','factura_numero','facturado_at','monto_liquido','monto_acumulado','updated_at'])
       IS DISTINCT FROM (pg_catalog.to_jsonb(OLD) - ARRAY['status','factura_numero','facturado_at','monto_liquido','monto_acumulado','updated_at']) THEN
      RAISE EXCEPTION 'La facturación no puede modificar otros datos del certificado';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'APROBADO' AND NEW.status = 'VERIFICADO' THEN
    IF (pg_catalog.to_jsonb(NEW) - ARRAY['status','aprobado_por','aprobado_at','monto_liquido','monto_acumulado','updated_at'])
       IS DISTINCT FROM (pg_catalog.to_jsonb(OLD) - ARRAY['status','aprobado_por','aprobado_at','monto_liquido','monto_acumulado','updated_at']) THEN
      RAISE EXCEPTION 'La reversa de aprobación no puede modificar otros datos del certificado';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'FACTURADO' AND NEW.status = 'APROBADO' THEN
    IF (pg_catalog.to_jsonb(NEW) - ARRAY['status','factura_numero','facturado_at','monto_liquido','monto_acumulado','updated_at'])
       IS DISTINCT FROM (pg_catalog.to_jsonb(OLD) - ARRAY['status','factura_numero','facturado_at','monto_liquido','monto_acumulado','updated_at']) THEN
      RAISE EXCEPTION 'La reversa de facturación no puede modificar otros datos del certificado';
    END IF;
    RETURN NEW;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_project_certificate_header_immutability() FROM PUBLIC, anon, authenticated, service_role;
