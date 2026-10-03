CREATE FUNCTION private.handoff_certificate_parameters_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.projects p WHERE p.id=NEW.project_id AND p.source_tender_id IS NOT NULL AND
 (p.anticipo_pct IS NULL OR p.devolucion_anticipo_pct IS NULL OR p.retencion_pct IS NULL OR p.iva_pct IS NULL)) THEN
 RAISE EXCEPTION 'Confirm contractual parameters before creating/elaborating certificates'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER handoff_certificate_parameters_guard BEFORE INSERT OR UPDATE ON public.project_certificates FOR EACH ROW EXECUTE FUNCTION private.handoff_certificate_parameters_guard();
REVOKE ALL ON FUNCTION private.handoff_certificate_parameters_guard() FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE public.projects ADD CONSTRAINT project_contract_percentages_range CHECK(
 (anticipo_pct IS NULL OR anticipo_pct BETWEEN 0 AND 100) AND
 (devolucion_anticipo_pct IS NULL OR devolucion_anticipo_pct BETWEEN 0 AND 100) AND
 (retencion_pct IS NULL OR retencion_pct BETWEEN 0 AND 100) AND
 (iva_pct IS NULL OR iva_pct BETWEEN 0 AND 100)) NOT VALID;
-- New/updated rows checked. Do not backfill or rewrite historical contracts.
