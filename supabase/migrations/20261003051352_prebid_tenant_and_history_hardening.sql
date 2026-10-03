-- Additional PREBID boundaries discovered by adversarial Preview validation.
CREATE FUNCTION private.prebid_related_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 o jsonb:=private.workspace_owner(TG_TABLE_NAME,r); e uuid:=(o->>'empresa_id')::uuid; tid uuid:=(o->>'tender_id')::uuid; k text;
BEGIN
 IF TG_OP='DELETE' OR tid IS NULL THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 IF r->>'producto_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.productos WHERE id=(r->>'producto_id')::uuid AND empresa_id=e) THEN RAISE EXCEPTION 'Material tenant mismatch'; END IF;
 IF r->>'labor_rate_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.labor_rates WHERE id=(r->>'labor_rate_id')::uuid AND empresa_id=e) THEN RAISE EXCEPTION 'Labor rate tenant mismatch'; END IF;
 IF r->>'subcontractor_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.subcontractors WHERE id=(r->>'subcontractor_id')::uuid AND empresa_id=e) THEN RAISE EXCEPTION 'Subcontractor tenant mismatch'; END IF;
 IF r->>'licitacion_item_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.licitacion_items WHERE id=(r->>'licitacion_item_id')::uuid AND licitacion_id=tid AND empresa_id=e) THEN RAISE EXCEPTION 'Tender source item context mismatch'; END IF;
 IF r->>'group_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.bim_element_groups WHERE id=(r->>'group_id')::uuid AND tender_id=tid AND project_id IS NULL) THEN RAISE EXCEPTION 'BIM group context mismatch'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.prebid_related_guard() FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['budget_items','budget_item_materials','budget_item_labor','budget_item_subcontracts','bim_elements','licitacion_oferta_items'] LOOP
  EXECUTE format('CREATE TRIGGER prebid_related_guard BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.prebid_related_guard()',t);
 END LOOP;
END $$;
CREATE UNIQUE INDEX budget_items_tender_source_once ON public.budget_items(tender_id,licitacion_item_id) WHERE tender_id IS NOT NULL AND licitacion_item_id IS NOT NULL;
CREATE INDEX prebid_versions_tender_idx ON public.licitacion_oferta_versions(tender_id,version DESC);

CREATE FUNCTION private.prebid_offer_fields_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE k text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=NEW.created_by AND empresa_id=NEW.empresa_id) THEN RAISE EXCEPTION 'Offer creator tenant mismatch'; END IF;
 IF TG_OP='UPDATE' AND NEW.created_by IS DISTINCT FROM OLD.created_by THEN RAISE EXCEPTION 'Offer creator immutable'; END IF;
 FOREACH k IN ARRAY ARRAY['indirectPct','generalPct','financingPct','riskPct','marginPct'] LOOP
  IF jsonb_typeof(NEW.cost_settings->k) IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'Cost settings require explicit finite numeric percentages'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER prebid_offer_fields_guard BEFORE INSERT OR UPDATE ON public.licitacion_ofertas FOR EACH ROW EXECUTE FUNCTION private.prebid_offer_fields_guard();
REVOKE ALL ON FUNCTION private.prebid_offer_fields_guard() FROM PUBLIC,anon,authenticated,service_role;

-- Legacy decision editors cannot bypass the canonical submitted offer lifecycle.
CREATE FUNCTION private.prebid_tender_history_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.licitacion_ofertas; tid uuid:=OLD.id;
BEGIN
 SELECT * INTO o FROM public.licitacion_ofertas WHERE licitacion_id=tid;
 IF o.submitted_version_id IS NULL THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Submitted tender history cannot be deleted'; END IF;
 IF NEW.empresa_id<>OLD.empresa_id OR NEW.project_id IS DISTINCT FROM OLD.project_id THEN RAISE EXCEPTION 'PREBID history owner cannot be changed'; END IF;
 IF NEW.decision IS DISTINCT FROM OLD.decision AND NOT EXISTS(SELECT 1 FROM private.prebid_permits WHERE transaction_id=txid_current() AND tender_id=tid) THEN RAISE EXCEPTION 'Use canonical human offer outcome'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER prebid_tender_history_guard BEFORE UPDATE OR DELETE ON public.licitaciones FOR EACH ROW EXECUTE FUNCTION private.prebid_tender_history_guard();
REVOKE ALL ON FUNCTION private.prebid_tender_history_guard() FROM PUBLIC,anon,authenticated,service_role;

-- Preserve snapshot documents in addition to the existing supplier quote guards.
CREATE FUNCTION private.prebid_attachment_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.licitacion_oferta_versions v WHERE v.snapshot->'facts'->'quote_versions' @> jsonb_build_array(jsonb_build_object('pdf_attachment_id',OLD.id))) THEN RAISE EXCEPTION 'Presented quote evidence is immutable'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER prebid_attachment_guard BEFORE UPDATE OR DELETE ON public.attachments FOR EACH ROW EXECUTE FUNCTION private.prebid_attachment_guard();
REVOKE ALL ON FUNCTION private.prebid_attachment_guard() FROM PUBLIC,anon,authenticated,service_role;
