-- Winning baseline handoff is a read-only contract; it never creates an execution project.
ALTER TABLE public.licitacion_ofertas ADD COLUMN outcome_snapshot jsonb;
CREATE FUNCTION private.prebid_outcome_snapshot_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM private.prebid_permits WHERE transaction_id=txid_current() AND tender_id=NEW.licitacion_id) THEN
  IF TG_OP='INSERT' AND NEW.outcome_snapshot IS NOT NULL THEN RAISE EXCEPTION 'Outcome snapshot is server-owned'; END IF;
  IF TG_OP='UPDATE' AND NEW.outcome_snapshot IS DISTINCT FROM OLD.outcome_snapshot THEN RAISE EXCEPTION 'Outcome snapshot immutable'; END IF;
 ELSIF TG_OP='UPDATE' AND OLD.estado='PRESENTADA' AND NEW.estado IN ('GANADA','PERDIDA') THEN
  NEW.outcome_snapshot:=jsonb_build_object('estado',NEW.estado,'recordedBy',auth.uid(),'recordedAt',now(),
   'submittedVersionId',NEW.submitted_version_id,'awardedAmount',NEW.awarded_amount,
   'competition',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.licitacion_oferentes x WHERE licitacion_id=NEW.licitacion_id AND empresa_id=NEW.empresa_id),'[]'));
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER prebid_outcome_snapshot_guard BEFORE INSERT OR UPDATE ON public.licitacion_ofertas FOR EACH ROW EXECUTE FUNCTION private.prebid_outcome_snapshot_guard();
REVOKE ALL ON FUNCTION private.prebid_outcome_snapshot_guard() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.prebid_handoff_snapshot(p_tender_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles:=private.rfq_actor(); o public.licitacion_ofertas; v public.licitacion_oferta_versions;
BEGIN
 SELECT * INTO o FROM public.licitacion_ofertas WHERE licitacion_id=p_tender_id AND empresa_id=p.empresa_id AND estado='GANADA';
 IF NOT FOUND OR o.awarded_amount IS NULL OR o.awarded_confirmed_by IS NULL OR o.winning_version_id IS NULL THEN RAISE EXCEPTION 'Not ready for project handoff'; END IF;
 SELECT * INTO v FROM public.licitacion_oferta_versions WHERE id=o.winning_version_id AND oferta_id=o.id AND tender_id=p_tender_id AND empresa_id=p.empresa_id AND estado='PRESENTADA';
 IF NOT FOUND THEN RAISE EXCEPTION 'Winning snapshot provenance missing'; END IF;
 RETURN jsonb_build_object('readyForProjectHandoff',true,'tenderId',p_tender_id,'winningVersionId',v.id,
  'snapshotSha256',v.snapshot_sha256,'snapshot',v.snapshot,'awardedAmount',o.awarded_amount,
  'confirmedBy',o.awarded_confirmed_by,'confirmedAt',o.awarded_confirmed_at,'outcome',o.outcome_snapshot);
END $$;
REVOKE ALL ON FUNCTION public.prebid_handoff_snapshot(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.prebid_handoff_snapshot(uuid) TO authenticated;

-- Recheck canonical unit aliases at the database boundary.
CREATE OR REPLACE FUNCTION public.workspace_apply_bim_quantity(p_context jsonb,p_budget_id uuid,p_elements uuid[],p_expected_version timestamptz,p_quantity numeric) RETURNS numeric
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles:=private.workspace_actor(p_context); b public.budget_items; e public.bim_elements; total numeric:=0; owner_id uuid:=(p_context->>'id')::uuid; u text; eu text;
BEGIN
 SELECT * INTO b FROM public.budget_items WHERE id=p_budget_id FOR UPDATE;
 IF NOT FOUND OR (p_context->>'kind'='TENDER' AND b.tender_id IS DISTINCT FROM owner_id) OR (p_context->>'kind'='PROJECT' AND b.project_id IS DISTINCT FROM owner_id) THEN RAISE EXCEPTION 'Budget context mismatch'; END IF;
 IF b.updated_at IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Budget changed' USING ERRCODE='P0409'; END IF;
 IF cardinality(p_elements) NOT BETWEEN 1 AND 50000 OR (SELECT count(DISTINCT x) FROM unnest(p_elements) x)<>cardinality(p_elements) THEN RAISE EXCEPTION 'Choose unique BIM elements'; END IF;
 u:=private.workspace_unit(b.unit);
 FOR e IN SELECT * FROM public.bim_elements WHERE id=ANY(p_elements) ORDER BY id FOR UPDATE LOOP
  IF e.project_id IS DISTINCT FROM b.project_id OR e.tender_id IS DISTINCT FROM b.tender_id OR e.quantity_value IS NULL THEN RAISE EXCEPTION 'BIM context or measured quantity mismatch'; END IF;
  eu:=private.workspace_unit(e.quantity_unit);
  IF eu IS NULL OR u IS NULL OR eu IS DISTINCT FROM u THEN RAISE EXCEPTION 'BIM unit mismatch: explicit compatible units required'; END IF;
  IF EXISTS(SELECT 1 FROM public.bim_budget_matches WHERE bim_element_id=e.id AND status='CONFIRMADO' AND budget_item_id<>b.id) THEN RAISE EXCEPTION 'BIM element already counted elsewhere'; END IF;
  total:=total+e.quantity_value;
 END LOOP;
 IF (SELECT count(*) FROM public.bim_elements WHERE id=ANY(p_elements))<>cardinality(p_elements) THEN RAISE EXCEPTION 'Missing BIM elements'; END IF;
 IF round(total,4) IS DISTINCT FROM p_quantity OR total<=0 OR total>=1e16 THEN RAISE EXCEPTION 'BIM factual quantity mismatch'; END IF;
 DELETE FROM public.bim_budget_matches WHERE budget_item_id=b.id AND status='CONFIRMADO';
 INSERT INTO public.bim_budget_matches(bim_element_id,budget_item_id,method,status,confirmed_by,confirmed_at)
 SELECT x,b.id,'MANUAL','CONFIRMADO',p.id,now() FROM unnest(p_elements) x;
 UPDATE public.budget_items SET quantity=round(total,4),updated_at=now() WHERE id=b.id;
 RETURN round(total,4);
END $$;
