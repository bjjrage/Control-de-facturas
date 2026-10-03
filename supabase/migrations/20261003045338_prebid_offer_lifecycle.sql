-- Canonical offer lifecycle, immutable database facts and human handoff readiness.
CREATE FUNCTION private.prebid_offer_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tid uuid:=CASE WHEN TG_OP='DELETE' THEN OLD.licitacion_id ELSE NEW.licitacion_id END; permitted boolean;
BEGIN
 PERFORM 1 FROM public.licitaciones WHERE id=tid FOR UPDATE;
 permitted:=EXISTS(SELECT 1 FROM private.prebid_permits WHERE transaction_id=txid_current() AND tender_id=tid);
 IF TG_OP='DELETE' THEN
  IF OLD.submitted_version_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.licitacion_oferta_versions WHERE oferta_id=OLD.id) THEN RAISE EXCEPTION 'Offer history cannot be deleted'; END IF;
  RETURN OLD;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.licitaciones WHERE id=NEW.licitacion_id AND empresa_id=NEW.empresa_id) THEN RAISE EXCEPTION 'Offer tenant mismatch'; END IF;
 IF TG_OP='UPDATE' AND (NEW.licitacion_id<>OLD.licitacion_id OR NEW.empresa_id<>OLD.empresa_id) THEN RAISE EXCEPTION 'Offer owner immutable'; END IF;
 IF NOT permitted THEN
  IF TG_OP='INSERT' AND NEW.estado<>'BORRADOR' THEN RAISE EXCEPTION 'Start with BORRADOR'; END IF;
  IF TG_OP='UPDATE' AND (NEW.estado<>OLD.estado OR OLD.estado<>'BORRADOR' OR NEW.submitted_version_id IS DISTINCT FROM OLD.submitted_version_id OR NEW.winning_version_id IS DISTINCT FROM OLD.winning_version_id OR NEW.awarded_amount IS DISTINCT FROM OLD.awarded_amount OR NEW.awarded_confirmed_by IS DISTINCT FROM OLD.awarded_confirmed_by OR NEW.awarded_confirmed_at IS DISTINCT FROM OLD.awarded_confirmed_at) THEN RAISE EXCEPTION 'Use human PREBID lifecycle'; END IF;
  IF TG_OP='INSERT' AND (NEW.submitted_version_id IS NOT NULL OR NEW.winning_version_id IS NOT NULL OR NEW.awarded_amount IS NOT NULL) THEN RAISE EXCEPTION 'No client supplied outcome'; END IF;
 END IF;
 IF jsonb_typeof(NEW.cost_settings)<>'object' OR NOT (NEW.cost_settings ?& ARRAY['indirectPct','generalPct','financingPct','riskPct','marginPct']) THEN RAISE EXCEPTION 'Explicit cost settings required'; END IF;
 IF (NEW.cost_settings->>'indirectPct')::numeric NOT BETWEEN 0 AND 100 OR (NEW.cost_settings->>'generalPct')::numeric NOT BETWEEN 0 AND 100 OR (NEW.cost_settings->>'financingPct')::numeric NOT BETWEEN 0 AND 100 OR (NEW.cost_settings->>'riskPct')::numeric NOT BETWEEN 0 AND 100 OR (NEW.cost_settings->>'marginPct')::numeric NOT BETWEEN 0 AND 99 THEN RAISE EXCEPTION 'Invalid cost settings'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER prebid_offer_guard BEFORE INSERT OR UPDATE OR DELETE ON public.licitacion_ofertas FOR EACH ROW EXECUTE FUNCTION private.prebid_offer_guard();
REVOKE ALL ON FUNCTION private.prebid_offer_guard() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.prebid_version_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP<>'INSERT' OR NOT EXISTS(SELECT 1 FROM private.prebid_permits WHERE transaction_id=txid_current() AND tender_id=NEW.tender_id) THEN RAISE EXCEPTION 'Offer versions are immutable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.licitacion_ofertas WHERE id=NEW.oferta_id AND licitacion_id=NEW.tender_id AND empresa_id=NEW.empresa_id) THEN RAISE EXCEPTION 'Version context mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER prebid_version_guard BEFORE INSERT OR UPDATE OR DELETE ON public.licitacion_oferta_versions FOR EACH ROW EXECUTE FUNCTION private.prebid_version_guard();
REVOKE ALL ON FUNCTION private.prebid_version_guard() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.prebid_facts(t uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE f jsonb; ids uuid[]; rfq_ids uuid[];
BEGIN
 SELECT coalesce(array_agg(DISTINCT producto_id),'{}') INTO ids FROM public.budget_item_materials WHERE tender_id=t;
 SELECT coalesce(array_agg(id),'{}') INTO rfq_ids FROM public.rfqs WHERE tender_id=t;
 SELECT jsonb_build_object(
 'context',jsonb_build_object('kind','TENDER','id',t),
 'tender',(SELECT jsonb_build_object('id',id,'empresa_id',empresa_id,'titulo',titulo,'moneda',moneda,'dncp_nro',dncp_nro) FROM public.licitaciones WHERE id=t),
 'settings',(SELECT cost_settings FROM public.licitacion_ofertas WHERE licitacion_id=t),
 'items',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY sort_order,id) FROM public.budget_items x WHERE tender_id=t),'[]'),
 'materials',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.budget_item_materials x WHERE tender_id=t),'[]'),
 'labor',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.budget_item_labor x WHERE tender_id=t),'[]'),
 'equipment',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.budget_item_equipment x WHERE tender_id=t),'[]'),
 'subcontracts',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.budget_item_subcontracts x WHERE tender_id=t),'[]'),
 'prices',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.project_cost_prices x WHERE tender_id=t),'[]'),
 'products',coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'nombre',nombre,'unidad',unidad,'costo_promedio',costo_promedio) ORDER BY id) FROM public.productos WHERE id=ANY(ids)),'[]'),
 'observations',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY fecha_observacion DESC,id) FROM public.cost_observations x WHERE producto_id=ANY(ids) AND empresa_id=(SELECT empresa_id FROM public.licitaciones WHERE id=t) AND estado_evidencia='VALIDA' AND fuente IN ('FACTURA','RECEPCION') AND fecha_observacion<=current_date AND precio_unitario>0 AND cantidad>0),'[]'),
 'rfqs',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.rfqs x WHERE id=ANY(rfq_ids)),'[]'),
 'rfq_items',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.rfq_items x WHERE rfq_id=ANY(rfq_ids)),'[]'),
 'invitations',coalesce((SELECT jsonb_agg(to_jsonb(x)-'token' ORDER BY id) FROM public.rfq_providers x WHERE rfq_id=ANY(rfq_ids)),'[]'),
 'quotes',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.quotes x WHERE rfq_provider_id IN (SELECT id FROM public.rfq_providers WHERE rfq_id=ANY(rfq_ids))),'[]'),
 'quote_versions',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.quote_versions x WHERE quote_id IN (SELECT q.id FROM public.quotes q JOIN public.rfq_providers rp ON rp.id=q.rfq_provider_id WHERE rp.rfq_id=ANY(rfq_ids))),'[]'),
 'quote_items',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.quote_version_items x WHERE rfq_item_id IN (SELECT id FROM public.rfq_items WHERE rfq_id=ANY(rfq_ids))),'[]'),
 'reviews',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.rfq_quote_reviews x WHERE quote_version_id IN (SELECT v.id FROM public.quote_versions v JOIN public.quotes q ON q.id=v.quote_id JOIN public.rfq_providers rp ON rp.id=q.rfq_provider_id WHERE rp.rfq_id=ANY(rfq_ids))),'[]'),
 'bim_models',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.bim_models x WHERE tender_id=t),'[]'),
 'bim_elements',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.bim_elements x WHERE tender_id=t),'[]'),
 'bim_matches',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.bim_budget_matches x WHERE bim_element_id IN (SELECT id FROM public.bim_elements WHERE tender_id=t)),'[]'),
 'competition',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.licitacion_oferentes x WHERE licitacion_id=t),'[]'),
 'asOf',current_date) INTO f;
 RETURN f;
END $$;
REVOKE ALL ON FUNCTION private.prebid_facts(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.prebid_workspace(p_tender_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles:=private.rfq_actor(); f jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.licitaciones WHERE id=p_tender_id AND empresa_id=p.empresa_id) THEN RAISE EXCEPTION 'Tender access denied' USING ERRCODE='42501'; END IF;
 f:=private.prebid_facts(p_tender_id);
 RETURN jsonb_build_object('facts',f,'hash',encode(extensions.digest(f::text,'sha256'),'hex'));
END $$;
REVOKE ALL ON FUNCTION public.prebid_workspace(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.prebid_workspace(uuid) TO authenticated;

CREATE FUNCTION public.prebid_save_version(p_tender_id uuid,p_present boolean,p_expected_hash text,p_offer_amount numeric) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles:=private.rfq_actor(); o public.licitacion_ofertas; f jsonb; s jsonb; v uuid; n integer;
BEGIN
 PERFORM 1 FROM public.licitaciones WHERE id=p_tender_id AND empresa_id=p.empresa_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Tender access denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO o FROM public.licitacion_ofertas WHERE licitacion_id=p_tender_id AND empresa_id=p.empresa_id FOR UPDATE;
 IF NOT FOUND OR o.estado<>'BORRADOR' THEN RAISE EXCEPTION 'Offer must be BORRADOR'; END IF;
 IF p_offer_amount IS NULL OR p_offer_amount<=0 OR p_offer_amount>=1e16 THEN RAISE EXCEPTION 'Positive finite offer amount required'; END IF;
 f:=private.prebid_facts(p_tender_id);
 IF encode(extensions.digest(f::text,'sha256'),'hex') IS DISTINCT FROM p_expected_hash THEN RAISE EXCEPTION 'Workspace changed: refresh before confirmation' USING ERRCODE='P0409'; END IF;
 IF p_present THEN
  IF NOT EXISTS(SELECT 1 FROM public.budget_items WHERE tender_id=p_tender_id AND quantity>0 AND NOT EXISTS(SELECT 1 FROM public.budget_items c WHERE c.parent_id=budget_items.id)) THEN RAISE EXCEPTION 'No measured leaf items'; END IF;
  IF EXISTS(SELECT 1 FROM public.budget_items b WHERE b.tender_id=p_tender_id AND NOT EXISTS(SELECT 1 FROM public.budget_items c WHERE c.parent_id=b.id) AND
   (b.quantity IS NULL OR b.quantity<=0 OR b.quantity>=1e16 OR trim(coalesce(b.unit,''))='' OR NOT (
    EXISTS(SELECT 1 FROM public.budget_item_materials WHERE budget_item_id=b.id) OR EXISTS(SELECT 1 FROM public.budget_item_labor WHERE budget_item_id=b.id) OR
    EXISTS(SELECT 1 FROM public.budget_item_equipment WHERE budget_item_id=b.id) OR EXISTS(SELECT 1 FROM public.budget_item_subcontracts WHERE budget_item_id=b.id)))) THEN RAISE EXCEPTION 'Incomplete measured APU'; END IF;
  IF EXISTS(SELECT 1 FROM public.budget_item_materials m WHERE m.tender_id=p_tender_id AND NOT (
   EXISTS(SELECT 1 FROM public.project_cost_prices x WHERE x.tender_id=p_tender_id AND x.producto_id=m.producto_id AND x.precio_unitario>0) OR
   EXISTS(SELECT 1 FROM public.productos x WHERE x.id=m.producto_id AND x.costo_promedio>0) OR
   EXISTS(SELECT 1 FROM public.cost_observations x WHERE x.producto_id=m.producto_id AND x.empresa_id=p.empresa_id AND x.estado_evidencia='VALIDA' AND x.fuente IN ('FACTURA','RECEPCION') AND x.fecha_observacion<=current_date AND x.precio_unitario>0 AND x.cantidad>0 AND trim(x.unidad)<>''))) THEN RAISE EXCEPTION 'Missing factual material price'; END IF;
 END IF;
 INSERT INTO private.prebid_permits VALUES(txid_current(),p_tender_id) ON CONFLICT DO NOTHING;
 SELECT coalesce(max(version),0)+1 INTO n FROM public.licitacion_oferta_versions WHERE oferta_id=o.id;
 s:=jsonb_build_object('facts',f,'offerAmount',p_offer_amount,'currency','PYG','submittedBy',p.id,'schemaVersion',1);
 INSERT INTO public.licitacion_oferta_versions(empresa_id,oferta_id,tender_id,version,estado,snapshot,snapshot_sha256,created_by)
 VALUES(p.empresa_id,o.id,p_tender_id,n,CASE WHEN p_present THEN 'PRESENTADA' ELSE 'BORRADOR' END,s,encode(extensions.digest(s::text,'sha256'),'hex'),p.id) RETURNING id INTO v;
 UPDATE public.licitacion_ofertas SET monto_total=p_offer_amount,estado=CASE WHEN p_present THEN 'PRESENTADA' ELSE 'BORRADOR' END,
  submitted_version_id=CASE WHEN p_present THEN v ELSE NULL END,updated_at=now() WHERE id=o.id;
 IF p_present THEN UPDATE public.licitaciones SET decision='PRESENTADA' WHERE id=p_tender_id; END IF;
 INSERT INTO public.audit_logs(empresa_id,actor_id,actor_type,action,detail) VALUES(p.empresa_id,p.id,'internal',CASE WHEN p_present THEN 'prebid.presented' ELSE 'prebid.versioned' END,jsonb_build_object('tender_id',p_tender_id,'version_id',v));
 DELETE FROM private.prebid_permits WHERE transaction_id=txid_current() AND tender_id=p_tender_id;
 RETURN jsonb_build_object('id',v,'version',n);
END $$;
REVOKE ALL ON FUNCTION public.prebid_save_version(uuid,boolean,text,numeric) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.prebid_save_version(uuid,boolean,text,numeric) TO authenticated;

CREATE FUNCTION public.prebid_record_outcome(p_tender_id uuid,p_estado text,p_awarded_amount numeric DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles:=private.rfq_actor(); o public.licitacion_ofertas;
BEGIN
 PERFORM 1 FROM public.licitaciones WHERE id=p_tender_id AND empresa_id=p.empresa_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Tender access denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO o FROM public.licitacion_ofertas WHERE licitacion_id=p_tender_id AND empresa_id=p.empresa_id FOR UPDATE;
 IF NOT FOUND OR o.estado<>'PRESENTADA' OR o.submitted_version_id IS NULL THEN RAISE EXCEPTION 'Only submitted offer has an outcome'; END IF;
 IF p_estado NOT IN ('GANADA','PERDIDA') OR p_estado IS NULL THEN RAISE EXCEPTION 'Choose GANADA or PERDIDA'; END IF;
 IF p_estado='GANADA' AND (p_awarded_amount IS NULL OR p_awarded_amount<=0 OR p_awarded_amount>=1e16) THEN RAISE EXCEPTION 'Confirmed awarded amount required'; END IF;
 IF p_estado='PERDIDA' AND p_awarded_amount IS NOT NULL THEN RAISE EXCEPTION 'Lost offer has no awarded amount'; END IF;
 INSERT INTO private.prebid_permits VALUES(txid_current(),p_tender_id) ON CONFLICT DO NOTHING;
 UPDATE public.licitacion_ofertas SET estado=p_estado,
  winning_version_id=CASE WHEN p_estado='GANADA' THEN submitted_version_id END,
  awarded_amount=p_awarded_amount,awarded_confirmed_by=CASE WHEN p_estado='GANADA' THEN p.id END,
  awarded_confirmed_at=CASE WHEN p_estado='GANADA' THEN now() END,updated_at=now() WHERE id=o.id;
 UPDATE public.licitaciones SET decision=p_estado WHERE id=p_tender_id;
 INSERT INTO public.audit_logs(empresa_id,actor_id,actor_type,action,detail) VALUES(p.empresa_id,p.id,'internal','prebid.outcome',jsonb_build_object('tender_id',p_tender_id,'estado',p_estado,'submitted_version_id',o.submitted_version_id,'awarded_amount',p_awarded_amount));
 DELETE FROM private.prebid_permits WHERE transaction_id=txid_current() AND tender_id=p_tender_id;
 RETURN jsonb_build_object('estado',p_estado,'readyForProjectHandoff',p_estado='GANADA','snapshotId',o.submitted_version_id);
END $$;
REVOKE ALL ON FUNCTION public.prebid_record_outcome(uuid,text,numeric) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.prebid_record_outcome(uuid,text,numeric) TO authenticated;
