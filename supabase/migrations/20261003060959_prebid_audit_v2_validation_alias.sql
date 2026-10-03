-- Resolve the PL/pgSQL variable/table alias collision found by real V2 SQL tests.
CREATE OR REPLACE FUNCTION private.prebid_validate_settings(s jsonb) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
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
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(s->'generalItems') AS entries(item) GROUP BY entries.item->>'id' HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate general concept id'; END IF;
 ELSE
  FOREACH k IN ARRAY ARRAY['indirectPct','generalPct','financingPct','riskPct'] LOOP
   IF jsonb_typeof(s->k) IS DISTINCT FROM 'number' OR (s->>k)::numeric NOT BETWEEN 0 AND 100 THEN RAISE EXCEPTION 'Invalid legacy percentage'; END IF;
  END LOOP;
 END IF;
 IF jsonb_typeof(s->'marginPct') IS DISTINCT FROM 'number' OR (s->>'marginPct')::numeric NOT BETWEEN 0 AND 99 THEN RAISE EXCEPTION 'Invalid margin on sale'; END IF;
END $$;
