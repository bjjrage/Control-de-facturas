-- Additive V2 economics. No backfill or snapshot rewriting: V1 remains valid.
-- Validation only; computeWorkspaceCosts remains the sole economics engine.
CREATE FUNCTION private.prebid_validate_charge(c jsonb) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF jsonb_typeof(c) IS DISTINCT FROM 'object' OR NOT (c ?& ARRAY['mode','value'])
 OR jsonb_typeof(c->'mode') IS DISTINCT FROM 'string' OR c->>'mode' NOT IN ('PERCENT','FIXED') OR jsonb_typeof(c->'value') IS DISTINCT FROM 'number' THEN
  RAISE EXCEPTION 'Explicit PERCENT/FIXED charge required';
 END IF;
 IF (c->>'value')::numeric<0 OR (c->>'value')::numeric>1e15 OR
  (c->>'mode'='PERCENT' AND (c->>'value')::numeric>100) THEN RAISE EXCEPTION 'Invalid charge value'; END IF;
END $$;
REVOKE ALL ON FUNCTION private.prebid_validate_charge(jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION private.prebid_validate_settings(s jsonb) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE k text; r jsonb;
BEGIN
 IF jsonb_typeof(s) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Explicit cost settings required'; END IF;
 IF s ? 'schemaVersion' THEN
  IF s->'schemaVersion' IS DISTINCT FROM '2'::jsonb OR NOT (s ?& ARRAY['indirect','generalItems','financing','risk','marginPct']) THEN RAISE EXCEPTION 'Unknown economics schema version'; END IF;
  FOREACH k IN ARRAY ARRAY['indirect','financing','risk'] LOOP PERFORM private.prebid_validate_charge(s->k); END LOOP;
  IF jsonb_typeof(s->'generalItems') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Itemized general costs required'; END IF;
  IF jsonb_array_length(s->'generalItems')>100 THEN RAISE EXCEPTION 'Too many general concepts'; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(s->'generalItems') LOOP
   IF jsonb_typeof(r->'id') IS DISTINCT FROM 'string' OR length(r->>'id') NOT BETWEEN 1 AND 100 OR
    jsonb_typeof(r->'concept') IS DISTINCT FROM 'string' OR length(trim(r->>'concept')) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'Named general concept and id required';
   END IF;
   PERFORM private.prebid_validate_charge(r);
  END LOOP;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(s->'generalItems') r GROUP BY r->>'id' HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate general concept id'; END IF;
 ELSE
  FOREACH k IN ARRAY ARRAY['indirectPct','generalPct','financingPct','riskPct'] LOOP
   IF jsonb_typeof(s->k) IS DISTINCT FROM 'number' OR (s->>k)::numeric NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'Invalid legacy percentage'; END IF;
  END LOOP;
 END IF;
 IF jsonb_typeof(s->'marginPct') IS DISTINCT FROM 'number' OR (s->>'marginPct')::numeric NOT BETWEEN 0 AND 99 THEN RAISE EXCEPTION 'Invalid margin on sale'; END IF;
END $$;
REVOKE ALL ON FUNCTION private.prebid_validate_settings(jsonb) FROM PUBLIC,anon,authenticated,service_role;
-- Canonical offer lifecycle, immutable database facts and human handoff readiness.
CREATE OR REPLACE FUNCTION private.prebid_offer_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
 PERFORM private.prebid_validate_settings(NEW.cost_settings);
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION private.prebid_offer_fields_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=NEW.created_by AND empresa_id=NEW.empresa_id) THEN RAISE EXCEPTION 'Offer creator tenant mismatch'; END IF;
 IF TG_OP='UPDATE' AND NEW.created_by IS DISTINCT FROM OLD.created_by THEN RAISE EXCEPTION 'Offer creator immutable'; END IF;
 PERFORM private.prebid_validate_settings(NEW.cost_settings);
 RETURN NEW;
END $$;
