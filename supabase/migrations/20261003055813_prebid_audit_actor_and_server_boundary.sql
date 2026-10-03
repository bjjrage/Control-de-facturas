-- P1-A: retain the sole TS cost engine behind verified server auth; revoke the
-- unsafe browser finalizer including its original exact signature.
REVOKE ALL ON FUNCTION public.prebid_save_version(uuid,boolean,text,numeric) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.prebid_commit_version(p_tender_id uuid,p_actor_id uuid,p_empresa_id uuid,p_present boolean,p_expected_hash text,p_offer_amount numeric) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles; o public.licitacion_ofertas; f jsonb; s jsonb; v uuid; n integer;
BEGIN
 -- Only the server credential can enter. Actor identity comes from verified server auth,
 -- never from action parameters exposed to the browser.
 IF current_setting('request.jwt.claim.role',true) IS DISTINCT FROM 'service_role'
    AND coalesce(current_setting('request.jwt.claims',true),'{}')::jsonb->>'role' IS DISTINCT FROM 'service_role'
    AND session_user NOT IN ('postgres','supabase_admin') THEN
  RAISE EXCEPTION 'Server-only offer boundary' USING ERRCODE='42501';
 END IF;
 SELECT p0.* INTO p FROM public.profiles p0 JOIN public.empresas e ON e.id=p0.empresa_id
 WHERE p0.id=p_actor_id AND p0.empresa_id=p_empresa_id AND p0.active AND e.active
 AND p0.role IN ('comercial','administracion','admin');
 IF NOT FOUND THEN RAISE EXCEPTION 'Active internal actor required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.licitaciones WHERE id=p_tender_id AND empresa_id=p.empresa_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Tender access denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO o FROM public.licitacion_ofertas WHERE licitacion_id=p_tender_id AND empresa_id=p.empresa_id FOR UPDATE;
 IF NOT FOUND OR o.estado<>'BORRADOR' THEN RAISE EXCEPTION 'Offer must be BORRADOR'; END IF;
 IF p_offer_amount IS NULL OR p_offer_amount::text IN ('NaN','Infinity','-Infinity') OR p_offer_amount<=0 OR p_offer_amount>=1e16 THEN RAISE EXCEPTION 'Positive finite offer amount required'; END IF;
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

REVOKE ALL ON FUNCTION public.prebid_commit_version(uuid,uuid,uuid,boolean,text,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prebid_commit_version(uuid,uuid,uuid,boolean,text,numeric) TO service_role;

-- P1-B: all offer writes, including direct tenant-policy DML, require a real human.
-- The finalizer and outcome RPC establish this permit only after validating actor.
CREATE FUNCTION private.prebid_offer_actor_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.licitacion_ofertas:=CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
BEGIN
 PERFORM 1 FROM public.licitaciones WHERE id=r.licitacion_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM private.prebid_permits WHERE transaction_id=txid_current() AND tender_id=r.licitacion_id) THEN
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles p JOIN public.empresas e ON e.id=p.empresa_id
 WHERE p.id=auth.uid() AND p.empresa_id=r.empresa_id AND p.active AND e.active
 AND p.role IN ('comercial','administracion','admin')) THEN
  RAISE EXCEPTION 'Active internal PREBID offer actor required' USING ERRCODE='42501';
 END IF;
 IF TG_OP='INSERT' AND r.created_by IS DISTINCT FROM auth.uid() THEN
  RAISE EXCEPTION 'Offer creator must be authenticated actor' USING ERRCODE='42501';
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION private.prebid_offer_actor_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER prebid_offer_actor_guard BEFORE INSERT OR UPDATE OR DELETE ON public.licitacion_ofertas
 FOR EACH ROW EXECUTE FUNCTION private.prebid_offer_actor_guard();

-- Legacy analysis uses analysis snapshots / nonfinal decisions and is preserved.
-- Once a canonical offer exists, every final decision uses its canonical lifecycle.
CREATE OR REPLACE FUNCTION private.prebid_tender_history_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.licitacion_ofertas; permitted boolean;
BEGIN
 SELECT * INTO o FROM public.licitacion_ofertas WHERE licitacion_id=OLD.id;
 IF NOT FOUND THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 permitted:=EXISTS(SELECT 1 FROM private.prebid_permits WHERE transaction_id=txid_current() AND tender_id=OLD.id);
 IF TG_OP='DELETE' THEN
  IF o.submitted_version_id IS NOT NULL THEN RAISE EXCEPTION 'Submitted tender history cannot be deleted'; END IF;
  RETURN OLD;
 END IF;
 IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.project_id IS DISTINCT FROM OLD.project_id THEN
  RAISE EXCEPTION 'PREBID history owner cannot be changed';
 END IF;
 IF NEW.decision IS DISTINCT FROM OLD.decision AND NOT permitted AND
  (o.submitted_version_id IS NOT NULL OR NEW.decision IN ('PRESENTADA','GANADA','PERDIDA') OR OLD.decision IN ('PRESENTADA','GANADA','PERDIDA')) THEN
  RAISE EXCEPTION 'Use canonical human offer lifecycle: present before outcome';
 END IF;
 RETURN NEW;
END $$;
