-- Existing company-only APU policies remain for execution. PREBID also requires
-- an active human internal actor. Supplier quote submission uses its existing
-- private transaction permit, which cannot authorize budget or price changes.
CREATE FUNCTION private.prebid_actor_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 o jsonb:=private.workspace_owner(TG_TABLE_NAME,r); tid uuid:=(o->>'tender_id')::uuid; rid uuid;
BEGIN
 IF tid IS NULL THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 IF EXISTS(SELECT 1 FROM public.profiles p JOIN public.empresas e ON e.id=p.empresa_id
  WHERE p.id=auth.uid() AND p.empresa_id=(o->>'empresa_id')::uuid AND p.active AND e.active AND p.role IN ('comercial','administracion','admin')) THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 IF TG_TABLE_NAME IN ('rfqs','rfq_providers','quotes','quote_versions','quote_version_items') AND TG_OP<>'DELETE' THEN
  IF EXISTS(SELECT 1 FROM private.rfq_write_permits permit JOIN public.rfqs rfq ON rfq.id=permit.rfq_id
   WHERE permit.transaction_id=txid_current() AND permit.kind='quote' AND rfq.tender_id=tid) THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Active internal PREBID actor required' USING ERRCODE='42501';
END $$;
REVOKE ALL ON FUNCTION private.prebid_actor_guard() FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['budget_items','budget_item_materials','budget_item_labor','budget_item_equipment',
 'budget_item_subcontracts','bim_models','bim_elements','bim_element_groups','bim_budget_matches','bim_group_matches',
 'project_cost_prices','rfqs','rfq_items','rfq_providers','quotes','quote_versions','quote_version_items','rfq_quote_reviews','planillas','licitacion_oferta_items'] LOOP
  EXECUTE format('CREATE TRIGGER prebid_actor_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.prebid_actor_guard()',t);
 END LOOP;
END $$;
