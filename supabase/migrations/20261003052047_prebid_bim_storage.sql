-- Storage buckets are environment configuration: fresh Preview replay needs the IFC bucket.
-- Keep an already configured bucket intact; do not rewrite production configuration.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 VALUES('bim-models','bim-models',false,52428800,ARRAY['application/octet-stream','application/x-step','text/plain'])
 ON CONFLICT(id) DO NOTHING;
CREATE INDEX bim_models_storage_provenance_idx ON public.bim_models(storage_path);
CREATE FUNCTION private.prebid_bim_file_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.bucket_id='bim-models' AND EXISTS(SELECT 1 FROM public.bim_models WHERE storage_path=OLD.name AND tender_id IS NOT NULL) THEN RAISE EXCEPTION 'Original tender IFC is immutable'; END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
CREATE TRIGGER prebid_bim_file_guard BEFORE UPDATE OR DELETE ON storage.objects FOR EACH ROW EXECUTE FUNCTION private.prebid_bim_file_guard();
REVOKE ALL ON FUNCTION private.prebid_bim_file_guard() FROM PUBLIC,anon,authenticated,service_role;

-- Same known aliases as lib/bim/matching.ts, rechecked at the RPC boundary.
CREATE FUNCTION private.workspace_unit(raw text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE lower(translate(trim(raw),'²³úó','23uo'))
 WHEN 'm2' THEN 'm2' WHEN 'mts2' THEN 'm2' WHEN 'metro cuadrado' THEN 'm2' WHEN 'metros cuadrados' THEN 'm2'
 WHEN 'm3' THEN 'm3' WHEN 'mts3' THEN 'm3' WHEN 'metro cubico' THEN 'm3' WHEN 'metros cubicos' THEN 'm3'
 WHEN 'ml' THEN 'm' WHEN 'm' THEN 'm' WHEN 'mt' THEN 'm' WHEN 'mts' THEN 'm' WHEN 'metro' THEN 'm' WHEN 'metros' THEN 'm' WHEN 'metro lineal' THEN 'm' WHEN 'metros lineales' THEN 'm'
 WHEN 'kg' THEN 'kg' WHEN 'kilo' THEN 'kg' WHEN 'kilos' THEN 'kg' WHEN 'kilogramo' THEN 'kg' WHEN 'kilogramos' THEN 'kg'
 WHEN 'u' THEN 'u' WHEN 'un' THEN 'u' WHEN 'und' THEN 'u' WHEN 'unid' THEN 'u' WHEN 'unidad' THEN 'u' WHEN 'unidades' THEN 'u' WHEN 'pza' THEN 'u' WHEN 'pieza' THEN 'u'
 WHEN 'gl' THEN 'gl' WHEN 'global' THEN 'gl' ELSE NULL END
$$;
REVOKE ALL ON FUNCTION private.workspace_unit(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.workspace_apply_bim_quantity(p_context jsonb,p_budget_id uuid,p_elements uuid[],p_expected_version timestamptz,p_quantity numeric) RETURNS numeric
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles:=private.workspace_actor(p_context); b public.budget_items; e public.bim_elements; total numeric:=0; owner_id uuid:=(p_context->>'id')::uuid; u text; eu text;
BEGIN
 SELECT * INTO b FROM public.budget_items WHERE id=p_budget_id FOR UPDATE;
 IF NOT FOUND OR (p_context->>'kind'='TENDER' AND b.tender_id IS DISTINCT FROM owner_id) OR (p_context->>'kind'='PROJECT' AND b.project_id IS DISTINCT FROM owner_id) THEN RAISE EXCEPTION 'Budget context mismatch'; END IF;
 IF b.updated_at IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Budget changed' USING ERRCODE='P0409'; END IF;
 IF cardinality(p_elements) NOT BETWEEN 1 AND 50000 OR (SELECT count(DISTINCT x) FROM unnest(p_elements) x)<>cardinality(p_elements) THEN RAISE EXCEPTION 'Choose unique BIM elements'; END IF;
 u:=lower(replace(replace(trim(b.unit),'²','2'),'³','3'));
 FOR e IN SELECT * FROM public.bim_elements WHERE id=ANY(p_elements) ORDER BY id FOR UPDATE LOOP
  IF e.project_id IS DISTINCT FROM b.project_id OR e.tender_id IS DISTINCT FROM b.tender_id OR e.quantity_value IS NULL THEN RAISE EXCEPTION 'BIM context or measured quantity mismatch'; END IF;
  eu:=lower(replace(replace(trim(e.quantity_unit),'²','2'),'³','3'));
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
