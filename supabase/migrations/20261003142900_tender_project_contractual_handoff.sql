-- Atomic human handoff. PREBID rows are never updated/reparented.
ALTER TABLE public.projects ADD COLUMN source_tender_id uuid REFERENCES public.licitaciones(id),
 ADD COLUMN source_winning_version_id uuid REFERENCES public.licitacion_oferta_versions(id);
CREATE UNIQUE INDEX projects_single_tender_handoff ON public.projects(empresa_id,source_tender_id) WHERE source_tender_id IS NOT NULL;
ALTER TABLE public.projects ALTER COLUMN anticipo_pct DROP NOT NULL, ALTER COLUMN devolucion_anticipo_pct DROP NOT NULL,
 ALTER COLUMN retencion_pct DROP NOT NULL, ALTER COLUMN iva_pct DROP NOT NULL;

CREATE TABLE public.project_contract_baselines(
 project_id uuid PRIMARY KEY REFERENCES public.projects(id),
 empresa_id uuid NOT NULL REFERENCES public.empresas(id),
 tender_id uuid NOT NULL REFERENCES public.licitaciones(id),
 winning_version_id uuid NOT NULL REFERENCES public.licitacion_oferta_versions(id),
 snapshot_sha256 text NOT NULL CHECK(snapshot_sha256 ~ '^[a-f0-9]{64}$'),
 winning_snapshot jsonb NOT NULL,
 awarded_amount numeric(18,2) NOT NULL CHECK(awarded_amount>0 AND awarded_amount<1e16),
 awarded_confirmed_by uuid NOT NULL REFERENCES public.profiles(id), awarded_confirmed_at timestamptz NOT NULL,
 created_by uuid NOT NULL REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(empresa_id,tender_id));
ALTER TABLE public.project_contract_baselines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.project_contract_baselines FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.project_contract_baselines TO authenticated;
CREATE POLICY project_baseline_read ON public.project_contract_baselines FOR SELECT TO authenticated
 USING(empresa_id=(SELECT public.current_empresa_id()) AND public.is_internal_role(ARRAY['comercial','administracion','admin']::public.user_role[]));
CREATE TABLE private.project_handoff_permits(transaction_id bigint NOT NULL,tender_id uuid NOT NULL,PRIMARY KEY(transaction_id,tender_id));
REVOKE ALL ON private.project_handoff_permits FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.project_baseline_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP<>'INSERT' OR NOT EXISTS(SELECT 1 FROM private.project_handoff_permits WHERE transaction_id=txid_current() AND tender_id=NEW.tender_id) THEN RAISE EXCEPTION 'Contract baseline is immutable and server-owned'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.projects p JOIN public.licitacion_oferta_versions v ON v.id=p.source_winning_version_id WHERE p.id=NEW.project_id AND p.empresa_id=NEW.empresa_id AND p.source_tender_id=NEW.tender_id AND v.id=NEW.winning_version_id AND v.snapshot=NEW.winning_snapshot AND v.snapshot_sha256=NEW.snapshot_sha256) THEN RAISE EXCEPTION 'Baseline provenance mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER project_baseline_guard BEFORE INSERT OR UPDATE OR DELETE ON public.project_contract_baselines FOR EACH ROW EXECUTE FUNCTION private.project_baseline_guard();
CREATE FUNCTION private.project_handoff_origin_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.source_tender_id IS NOT NULL THEN RAISE EXCEPTION 'Contractual project history cannot be deleted'; END IF; RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND (NEW.source_tender_id IS DISTINCT FROM OLD.source_tender_id OR NEW.source_winning_version_id IS DISTINCT FROM OLD.source_winning_version_id OR (OLD.source_tender_id IS NOT NULL AND (NEW.empresa_id<>OLD.empresa_id OR NEW.tender_id IS DISTINCT FROM OLD.tender_id))) THEN RAISE EXCEPTION 'Project handoff provenance immutable'; END IF;
 IF TG_OP='INSERT' AND (NEW.source_tender_id IS NOT NULL OR NEW.source_winning_version_id IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM private.project_handoff_permits WHERE transaction_id=txid_current() AND tender_id=NEW.source_tender_id) THEN RAISE EXCEPTION 'Use explicit human handoff'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER project_handoff_origin_guard BEFORE INSERT OR UPDATE OR DELETE ON public.projects FOR EACH ROW EXECUTE FUNCTION private.project_handoff_origin_guard();
REVOKE ALL ON FUNCTION private.project_baseline_guard(),private.project_handoff_origin_guard() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.prebid_create_project(p_tender_id uuid,p_confirm boolean DEFAULT false) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE actor public.profiles:=private.rfq_actor(); tender public.licitaciones; offer public.licitacion_ofertas; winner public.licitacion_oferta_versions;
 pid uuid; existing public.projects; row jsonb; f jsonb; ids jsonb:='{}'; nid uuid; parent uuid; code text; table_name text; list_name text;
BEGIN
 IF p_confirm IS DISTINCT FROM true THEN RAISE EXCEPTION 'Explicit human handoff confirmation required'; END IF;
 SELECT * INTO tender FROM public.licitaciones WHERE id=p_tender_id AND empresa_id=actor.empresa_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Tender access denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO offer FROM public.licitacion_ofertas WHERE licitacion_id=tender.id AND empresa_id=actor.empresa_id FOR UPDATE;
 IF NOT FOUND OR tender.decision IS DISTINCT FROM 'GANADA' OR offer.estado IS DISTINCT FROM 'GANADA'
 OR offer.awarded_amount IS NULL OR offer.awarded_amount<=0 OR offer.awarded_amount>=1e16 OR offer.awarded_confirmed_by IS NULL OR offer.awarded_confirmed_at IS NULL OR offer.winning_version_id IS NULL THEN RAISE EXCEPTION 'GANADA with confirmed award and winning snapshot required'; END IF;
 SELECT * INTO winner FROM public.licitacion_oferta_versions WHERE id=offer.winning_version_id AND id=offer.submitted_version_id AND oferta_id=offer.id AND tender_id=tender.id AND empresa_id=actor.empresa_id AND estado='PRESENTADA';
 IF NOT FOUND OR winner.snapshot_sha256 IS DISTINCT FROM encode(extensions.digest(winner.snapshot::text,'sha256'),'hex')
 OR winner.snapshot->>'currency' IS DISTINCT FROM 'PYG' OR winner.snapshot->'facts'->'context'->>'id' IS DISTINCT FROM tender.id::text THEN RAISE EXCEPTION 'Invalid winning snapshot provenance'; END IF;
 SELECT * INTO existing FROM public.projects WHERE empresa_id=actor.empresa_id AND source_tender_id=tender.id;
 IF FOUND THEN
  IF existing.source_winning_version_id<>winner.id OR NOT EXISTS(SELECT 1 FROM public.project_contract_baselines b WHERE b.project_id=existing.id AND b.snapshot_sha256=winner.snapshot_sha256 AND b.awarded_amount=offer.awarded_amount) THEN RAISE EXCEPTION 'Existing handoff does not match winner'; END IF;
  RETURN jsonb_build_object('success',true,'already_existed',true,'project_id',existing.id,'project_code',existing.code);
 END IF;
 IF tender.project_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.projects WHERE empresa_id=actor.empresa_id AND tender_id IN(tender.id::text,tender.dncp_nro)) THEN RAISE EXCEPTION 'Legacy handoff exists: human reconciliation required, no duplicate project'; END IF;
 f:=winner.snapshot->'facts';
 IF jsonb_typeof(f->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(f->'items')=0 THEN RAISE EXCEPTION 'Winning measured budget required'; END IF;
 INSERT INTO private.project_handoff_permits VALUES(txid_current(),tender.id);
 code:='OBRA-LIC-'||tender.id::text;
 INSERT INTO public.projects(empresa_id,name,code,client,comitente,contract_amount,budget_total,created_by,tender_id,source_tender_id,source_winning_version_id,anticipo_pct,devolucion_anticipo_pct,retencion_pct,iva_pct)
 VALUES(actor.empresa_id,tender.titulo,code,tender.comitente_nombre,tender.comitente_nombre,offer.awarded_amount,(winner.snapshot->>'offerAmount')::numeric,actor.id,tender.id::text,tender.id,winner.id,NULL,NULL,NULL,NULL) RETURNING id INTO pid;
 INSERT INTO public.project_contract_baselines(project_id,empresa_id,tender_id,winning_version_id,snapshot_sha256,winning_snapshot,awarded_amount,awarded_confirmed_by,awarded_confirmed_at,created_by)
 VALUES(pid,actor.empresa_id,tender.id,winner.id,winner.snapshot_sha256,winner.snapshot,offer.awarded_amount,offer.awarded_confirmed_by,offer.awarded_confirmed_at,actor.id);
 -- Create all budget rows first, then restore hierarchy using new IDs.
 FOR row IN SELECT value FROM jsonb_array_elements(f->'items') LOOP
  IF row->>'tender_id' IS DISTINCT FROM tender.id::text OR row->>'project_id' IS NOT NULL THEN RAISE EXCEPTION 'Snapshot budget owner mismatch'; END IF;
  nid:=gen_random_uuid();ids:=ids||jsonb_build_object(row->>'id',nid);
  INSERT INTO public.budget_items(id,project_id,code,description,unit,quantity,unit_price,sort_order,quantity_per_unit,material_requirement,style)
  VALUES(nid,pid,row->>'code',row->>'description',row->>'unit',(row->>'quantity')::numeric,(row->>'unit_price')::numeric,coalesce((row->>'sort_order')::integer,0),(row->>'quantity_per_unit')::numeric,coalesce(row->>'material_requirement','UNKNOWN'),coalesce(row->'style','{}'));
 END LOOP;
 FOR row IN SELECT value FROM jsonb_array_elements(f->'items') LOOP
  IF row->>'parent_id' IS NOT NULL THEN
   parent:=(ids->>(row->>'parent_id'))::uuid;
   IF parent IS NULL THEN RAISE EXCEPTION 'Snapshot parent missing'; END IF;
   UPDATE public.budget_items SET parent_id=parent WHERE id=(ids->>(row->>'id'))::uuid;
  END IF;
 END LOOP;
 -- Reuse existing APU tables: copy facts, never reparent source records.
 FOR table_name,list_name IN SELECT * FROM (VALUES('budget_item_materials','materials'),('budget_item_labor','labor'),('budget_item_equipment','equipment'),('budget_item_subcontracts','subcontracts')) x LOOP
  FOR row IN SELECT value FROM jsonb_array_elements(coalesce(f->list_name,'[]')) LOOP
   IF row->>'empresa_id' IS DISTINCT FROM actor.empresa_id::text OR row->>'tender_id' IS DISTINCT FROM tender.id::text OR NOT ids ? (row->>'budget_item_id') THEN RAISE EXCEPTION 'Snapshot APU context mismatch'; END IF;
   row:=row||jsonb_build_object('id',gen_random_uuid(),'project_id',pid,'tender_id',NULL,'budget_item_id',(ids->>(row->>'budget_item_id'))::uuid,'created_at',now(),'updated_at',now());
   EXECUTE format('INSERT INTO public.%I SELECT (jsonb_populate_record(NULL::public.%I,$1)).*',table_name,table_name) USING row;
  END LOOP;
 END LOOP;
 FOR row IN SELECT value FROM jsonb_array_elements(coalesce(f->'prices','[]')) LOOP
  IF row->>'empresa_id' IS DISTINCT FROM actor.empresa_id::text OR row->>'tender_id' IS DISTINCT FROM tender.id::text THEN RAISE EXCEPTION 'Snapshot price context mismatch'; END IF;
  row:=row||jsonb_build_object('id',gen_random_uuid(),'project_id',pid,'tender_id',NULL,'created_at',now());
  INSERT INTO public.project_cost_prices SELECT (jsonb_populate_record(NULL::public.project_cost_prices,row)).*;
 END LOOP;
 INSERT INTO public.inventory_locations(empresa_id,name,location_type,project_id,created_by) VALUES(actor.empresa_id,'Depósito de obra','PROJECT',pid,actor.id);
 INSERT INTO public.audit_logs(empresa_id,actor_id,actor_type,action,detail) VALUES(actor.empresa_id,actor.id,'internal','prebid.project_handoff',jsonb_build_object('tender_id',tender.id,'project_id',pid,'winning_version_id',winner.id,'snapshot_sha256',winner.snapshot_sha256,'awarded_amount',offer.awarded_amount));
 DELETE FROM private.project_handoff_permits WHERE transaction_id=txid_current() AND tender_id=tender.id;
 RETURN jsonb_build_object('success',true,'already_existed',false,'project_id',pid,'project_code',code);
END $$;
REVOKE ALL ON FUNCTION public.prebid_create_project(uuid,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.prebid_create_project(uuid,boolean) TO authenticated;
-- Close the obsolete caller-supplied budget/award bypass, including service callers.
REVOKE ALL ON FUNCTION public.convertir_licitacion_a_proyecto_atomico(uuid,text,text,text,text,text,numeric,numeric,integer,numeric,numeric,date,date,text,uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
