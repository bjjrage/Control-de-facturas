-- PREBID belongs to the canonical licitacion; execution belongs to projects.
-- Existing rows retain their project owner. No history is rewritten.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['budget_items','budget_item_materials','budget_item_labor',
 'budget_item_equipment','budget_item_subcontracts','bim_models','bim_elements',
 'bim_element_groups','project_cost_prices'] LOOP
  EXECUTE format('ALTER TABLE public.%I ALTER COLUMN project_id DROP NOT NULL,
   ADD COLUMN tender_id uuid REFERENCES public.licitaciones(id),
   ADD CONSTRAINT %I CHECK ((project_id IS NULL) <> (tender_id IS NULL))',t,t||'_owner_xor');
  EXECUTE format('CREATE INDEX %I ON public.%I(tender_id) WHERE tender_id IS NOT NULL',t||'_tender_idx',t);
 END LOOP;
END $$;
CREATE UNIQUE INDEX project_cost_prices_tender_product_key ON public.project_cost_prices(tender_id,producto_id);
CREATE UNIQUE INDEX budget_items_tender_code_key ON public.budget_items(tender_id,code);
ALTER TABLE public.rfqs ADD COLUMN tender_id uuid REFERENCES public.licitaciones(id),
 ADD CONSTRAINT rfqs_prebid_context CHECK(tender_id IS NULL OR (project_id IS NULL AND purpose='COST_DISCOVERY'));
CREATE INDEX rfqs_tender_idx ON public.rfqs(tender_id) WHERE tender_id IS NOT NULL;

ALTER TABLE public.licitacion_ofertas
 ADD COLUMN cost_settings jsonb NOT NULL DEFAULT '{"indirectPct":0,"generalPct":0,"financingPct":0,"riskPct":0,"marginPct":0}',
 ADD COLUMN submitted_version_id uuid,
 ADD COLUMN winning_version_id uuid,
 ADD COLUMN awarded_amount numeric(18,2),
 ADD COLUMN awarded_confirmed_by uuid REFERENCES public.profiles(id),
 ADD COLUMN awarded_confirmed_at timestamptz,
 ADD CONSTRAINT prebid_award_positive CHECK(awarded_amount IS NULL OR (awarded_amount>0 AND awarded_amount<1e16));
CREATE TABLE public.licitacion_oferta_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL REFERENCES public.empresas(id),
 oferta_id uuid NOT NULL REFERENCES public.licitacion_ofertas(id), tender_id uuid NOT NULL REFERENCES public.licitaciones(id),
 version integer NOT NULL CHECK(version>0), estado text NOT NULL CHECK(estado IN ('BORRADOR','PRESENTADA')),
 snapshot jsonb NOT NULL, snapshot_sha256 text NOT NULL CHECK(snapshot_sha256 ~ '^[a-f0-9]{64}$'),
 created_by uuid NOT NULL REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(oferta_id,version)
);
ALTER TABLE public.licitacion_ofertas ADD CONSTRAINT prebid_submitted_version_fk FOREIGN KEY(submitted_version_id) REFERENCES public.licitacion_oferta_versions(id),
 ADD CONSTRAINT prebid_winning_version_fk FOREIGN KEY(winning_version_id) REFERENCES public.licitacion_oferta_versions(id);
ALTER TABLE public.licitacion_oferta_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY prebid_versions_read ON public.licitacion_oferta_versions FOR SELECT TO authenticated
 USING(empresa_id=(SELECT public.current_empresa_id()) AND public.is_internal_role(ARRAY['comercial','administracion','admin']::public.user_role[]));
REVOKE ALL ON public.licitacion_oferta_versions FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.licitacion_oferta_versions TO authenticated;
CREATE TABLE private.prebid_permits(transaction_id bigint NOT NULL,tender_id uuid NOT NULL,PRIMARY KEY(transaction_id,tender_id));
REVOKE ALL ON private.prebid_permits FROM PUBLIC,anon,authenticated,service_role;

-- Resolves a row's owner, including descendants. Used by policies and write guards.
CREATE FUNCTION private.workspace_owner(t text,r jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o jsonb;
BEGIN
 IF t IN ('bim_budget_matches','bim_group_matches') THEN
  IF t='bim_budget_matches' THEN SELECT to_jsonb(e) INTO o FROM public.bim_elements e WHERE id=(r->>'bim_element_id')::uuid;
  ELSE SELECT to_jsonb(g) INTO o FROM public.bim_element_groups g WHERE id=(r->>'group_id')::uuid; END IF;
 ELSIF t IN ('rfq_items','rfq_providers') THEN SELECT to_jsonb(x) INTO o FROM public.rfqs x WHERE id=(r->>'rfq_id')::uuid;
 ELSIF t='quotes' THEN SELECT to_jsonb(x) INTO o FROM public.rfqs x JOIN public.rfq_providers rp ON rp.rfq_id=x.id WHERE rp.id=(r->>'rfq_provider_id')::uuid;
 ELSIF t='quote_versions' THEN SELECT to_jsonb(x) INTO o FROM public.rfqs x JOIN public.rfq_providers rp ON rp.rfq_id=x.id JOIN public.quotes q ON q.rfq_provider_id=rp.id WHERE q.id=(r->>'quote_id')::uuid;
 ELSIF t='quote_version_items' THEN SELECT to_jsonb(x) INTO o FROM public.rfqs x JOIN public.rfq_providers rp ON rp.rfq_id=x.id JOIN public.quotes q ON q.rfq_provider_id=rp.id JOIN public.quote_versions v ON v.quote_id=q.id WHERE v.id=(r->>'quote_version_id')::uuid;
 ELSIF t='rfq_quote_reviews' THEN SELECT private.workspace_owner('quote_versions',to_jsonb(v)) INTO o FROM public.quote_versions v WHERE id=(r->>'quote_version_id')::uuid;
 ELSIF t='licitacion_oferta_items' THEN SELECT jsonb_build_object('tender_id',x.licitacion_id,'empresa_id',x.empresa_id) INTO o FROM public.licitacion_ofertas x WHERE id=(r->>'oferta_id')::uuid;
 ELSIF t='planillas' THEN
  o:=jsonb_build_object('tender_id',coalesce(r->'contexto'->>'tenderId',CASE WHEN r->'contexto'->>'kind'='TENDER' THEN r->'contexto'->>'id' END),
   'project_id',coalesce(r->'contexto'->>'projectId',CASE WHEN r->'contexto'->>'kind'='PROJECT' THEN r->'contexto'->>'id' END),'empresa_id',r->>'empresa_id');
 ELSE o:=r; END IF;
 IF o->>'tender_id' IS NOT NULL THEN
  RETURN (SELECT jsonb_build_object('tender_id',l.id,'project_id',NULL,'empresa_id',l.empresa_id) FROM public.licitaciones l WHERE l.id=(o->>'tender_id')::uuid);
 ELSIF o->>'project_id' IS NOT NULL THEN
  RETURN (SELECT jsonb_build_object('tender_id',NULL,'project_id',p.id,'empresa_id',p.empresa_id) FROM public.projects p WHERE p.id=(o->>'project_id')::uuid);
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.workspace_owner(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.prebid_can_read(t text,r jsonb) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT (private.workspace_owner(t,r)->>'tender_id') IS NOT NULL
 AND (private.workspace_owner(t,r)->>'empresa_id')::uuid=public.current_empresa_id()
 AND public.is_internal_role(ARRAY['comercial','administracion','admin']::public.user_role[])
$$;
REVOKE ALL ON FUNCTION public.prebid_can_read(text,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.prebid_can_read(text,jsonb) TO authenticated;

CREATE FUNCTION private.prebid_write_guard() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 o jsonb; other jsonb; tid uuid; e uuid; parent jsonb;
BEGIN
 o:=private.workspace_owner(TG_TABLE_NAME,r); tid:=(o->>'tender_id')::uuid; e:=(o->>'empresa_id')::uuid;
 IF TG_OP='UPDATE' THEN
  other:=private.workspace_owner(TG_TABLE_NAME,to_jsonb(OLD));
  IF (other->>'tender_id' IS NOT NULL OR tid IS NOT NULL) AND o IS DISTINCT FROM other THEN RAISE EXCEPTION 'Owner provenance immutable'; END IF;
 END IF;
 -- Cross-owner links are invalid even if both owners happen to share a tenant.
 IF r->>'budget_item_id' IS NOT NULL THEN
  SELECT private.workspace_owner('budget_items',to_jsonb(b)) INTO parent FROM public.budget_items b WHERE id=(r->>'budget_item_id')::uuid;
  IF parent IS DISTINCT FROM o THEN RAISE EXCEPTION 'Budget item context mismatch'; END IF;
 END IF;
 IF TG_TABLE_NAME IN ('bim_elements','bim_element_groups') THEN
  SELECT private.workspace_owner('bim_models',to_jsonb(b)) INTO parent FROM public.bim_models b WHERE id=(r->>'bim_model_id')::uuid;
  IF parent IS DISTINCT FROM o THEN RAISE EXCEPTION 'BIM model context mismatch'; END IF;
 END IF;
 IF TG_TABLE_NAME='budget_items' AND r->>'parent_id' IS NOT NULL THEN
  SELECT private.workspace_owner('budget_items',to_jsonb(b)) INTO parent FROM public.budget_items b WHERE id=(r->>'parent_id')::uuid;
  IF parent IS DISTINCT FROM o THEN RAISE EXCEPTION 'Parent context mismatch'; END IF;
 END IF;
 IF tid IS NULL THEN RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END; END IF;
 IF r->>'empresa_id' IS NOT NULL AND (r->>'empresa_id')::uuid<>e THEN RAISE EXCEPTION 'Tenant mismatch'; END IF;
 -- Serialize every workspace mutation against presentation/outcome.
 PERFORM 1 FROM public.licitaciones WHERE id=tid FOR UPDATE;
 IF EXISTS(SELECT 1 FROM public.licitacion_ofertas WHERE licitacion_id=tid AND estado<>'BORRADOR') THEN
  RAISE EXCEPTION 'PREBID is frozen: submitted commercial history is immutable';
 END IF;
 IF TG_OP<>'DELETE' AND TG_TABLE_NAME='rfqs' AND (r->>'project_id' IS NOT NULL OR r->>'purpose'<>'COST_DISCOVERY') THEN RAISE EXCEPTION 'Tender RFQ requires COST_DISCOVERY without project'; END IF;
 IF TG_OP<>'DELETE' AND TG_TABLE_NAME='bim_models' AND r->>'storage_path' NOT LIKE 'tenders/'||tid::text||'/%' THEN RAISE EXCEPTION 'BIM storage owner mismatch'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION private.prebid_write_guard() FROM PUBLIC,anon,authenticated,service_role;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['budget_items','budget_item_materials','budget_item_labor','budget_item_equipment',
 'budget_item_subcontracts','bim_models','bim_elements','bim_element_groups','bim_budget_matches','bim_group_matches',
 'project_cost_prices','rfqs','rfq_items','rfq_providers','quotes','quote_versions','quote_version_items','rfq_quote_reviews',
 'planillas','licitacion_oferta_items'] LOOP
  EXECUTE format('CREATE TRIGGER prebid_context_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.prebid_write_guard()',t);
  IF t IN ('budget_items','bim_models','bim_elements','bim_element_groups','bim_budget_matches','bim_group_matches','planillas') THEN
   EXECUTE format('CREATE POLICY prebid_owner_access ON public.%I TO authenticated USING(public.prebid_can_read(%L,to_jsonb(%I))) WITH CHECK(public.prebid_can_read(%L,to_jsonb(%I)))',t,t,t,t,t);
  END IF;
 END LOOP;
END $$;

-- Adopted quote provenance is enforced in the database too, including direct API writes.
CREATE FUNCTION private.prebid_price_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE price numeric;
BEGIN
 IF NEW.tender_id IS NULL THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.productos WHERE id=NEW.producto_id AND empresa_id=NEW.empresa_id AND activo) THEN RAISE EXCEPTION 'Product tenant mismatch'; END IF;
 IF NEW.fuente='MANUAL' THEN
  NEW.quote_version_item_id:=NULL;
 ELSIF NEW.fuente='COTIZACION' THEN
  SELECT i.precio_unitario INTO price FROM public.quote_version_items i
  JOIN public.rfq_items ri ON ri.id=i.rfq_item_id AND ri.empresa_id=NEW.empresa_id AND ri.producto_id=NEW.producto_id
  JOIN public.rfqs r ON r.id=ri.rfq_id AND r.empresa_id=NEW.empresa_id AND r.tender_id=NEW.tender_id AND r.project_id IS NULL AND r.purpose='COST_DISCOVERY'
  JOIN public.quote_versions v ON v.id=i.quote_version_id AND v.empresa_id=NEW.empresa_id AND v.currency='PYG'
  JOIN public.quotes q ON q.id=v.quote_id AND q.empresa_id=NEW.empresa_id
  JOIN public.rfq_providers rp ON rp.id=q.rfq_provider_id AND rp.rfq_id=r.id AND rp.empresa_id=NEW.empresa_id AND rp.token_revoked_at IS NULL
  WHERE i.id=NEW.quote_version_item_id AND i.empresa_id=NEW.empresa_id
   AND (v.valid_until IS NULL OR v.valid_until>now())
   AND NOT EXISTS(SELECT 1 FROM public.quote_versions newer WHERE newer.quote_id=q.id AND newer.version_number>v.version_number);
  IF price IS NULL OR price<=0 OR price>=1e16 THEN RAISE EXCEPTION 'Invalid current quote provenance'; END IF;
  NEW.precio_unitario:=price;
 ELSE RAISE EXCEPTION 'Human adoption requires MANUAL or COTIZACION'; END IF;
 IF NEW.precio_unitario IS NULL OR NEW.precio_unitario<=0 OR NEW.precio_unitario>=1e16 THEN RAISE EXCEPTION 'Finite positive price required'; END IF;
 IF auth.uid() IS NULL OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=auth.uid() AND empresa_id=NEW.empresa_id AND active AND role IN ('comercial','administracion','admin')) THEN RAISE EXCEPTION 'Human price adoption required'; END IF;
 NEW.updated_by:=auth.uid(); NEW.updated_at:=now(); RETURN NEW;
END $$;
CREATE TRIGGER prebid_factual_price BEFORE INSERT OR UPDATE ON public.project_cost_prices FOR EACH ROW EXECUTE FUNCTION private.prebid_price_guard();
REVOKE ALL ON FUNCTION private.prebid_price_guard() FROM PUBLIC,anon,authenticated,service_role;

CREATE POLICY prebid_bim_storage_read ON storage.objects FOR SELECT TO authenticated
 USING(bucket_id='bim-models' AND (storage.foldername(name))[1]='tenders' AND EXISTS(SELECT 1 FROM public.licitaciones l WHERE l.id::text=(storage.foldername(name))[2] AND l.empresa_id=(SELECT public.current_empresa_id())));
CREATE POLICY prebid_bim_storage_insert ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id='bim-models' AND (storage.foldername(name))[1]='tenders' AND public.is_internal_role(ARRAY['comercial','administracion','admin']::public.user_role[]) AND EXISTS(SELECT 1 FROM public.licitaciones l WHERE l.id::text=(storage.foldername(name))[2] AND l.empresa_id=(SELECT public.current_empresa_id()) AND NOT EXISTS(SELECT 1 FROM public.licitacion_ofertas o WHERE o.licitacion_id=l.id AND o.estado<>'BORRADOR')));
-- No tender Storage UPDATE/DELETE grant: uploaded evidence is retained.
