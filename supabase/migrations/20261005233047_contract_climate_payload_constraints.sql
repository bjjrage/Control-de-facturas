-- NULL must not satisfy mandatory JSON fields; preserve append-only records.
ALTER TABLE public.contract_climate_policy_versions ADD CONSTRAINT contract_climate_schema_required
  CHECK ((parameters->>'schemaVersion') IS NOT DISTINCT FROM '1');
ALTER TABLE public.certificate_climate_snapshots ADD CONSTRAINT certificate_climate_payload_required
  CHECK ((snapshot->'result'->>'status') IS NOT DISTINCT FROM 'COMPLETE'
    AND (snapshot->'result'->>'engine') IS NOT DISTINCT FROM 'EXCESS_ELIGIBLE_DAYS_V1'
    AND jsonb_typeof(snapshot->'inputs'->'policies') IS NOT DISTINCT FROM 'array'
    AND jsonb_typeof(snapshot->'result'->'dates') IS NOT DISTINCT FROM 'array'
    AND jsonb_typeof(snapshot->'result'->'groups') IS NOT DISTINCT FROM 'array');
CREATE INDEX contract_assessment_workday_idx ON public.contract_day_assessments(workday_id,created_at DESC);
CREATE INDEX certificate_climate_latest_idx ON public.certificate_climate_snapshots(certificate_id,created_at DESC);
