-- Authenticated, tenant-scoped, atomic import into the SAME operational book
-- used by manual entry. No new workday states, sensors, or approval bypass.
CREATE OR REPLACE FUNCTION public.import_workbook_workdays(
  p_project_id uuid, p_days jsonb, p_source_hash text
) RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE actor public.profiles; owner_id uuid; expected integer; actual integer;
BEGIN
  SELECT * INTO actor FROM public.profiles WHERE id = auth.uid();
  SELECT empresa_id INTO owner_id FROM public.projects WHERE id = p_project_id FOR UPDATE;
  IF auth.uid() IS NULL OR actor.role NOT IN ('admin','administracion') OR owner_id IS NULL OR owner_id IS DISTINCT FROM actor.empresa_id THEN
    RAISE EXCEPTION 'Obra no autorizada';
  END IF;
  IF p_source_hash IS NULL OR p_source_hash !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p_days) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Fuente de importación inválida'; END IF;
  expected := jsonb_array_length(p_days);
  IF expected < 1 OR expected > 20000 THEN RAISE EXCEPTION 'Cantidad de jornadas inválida'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_days) AS d(date text, code text, source text)
    WHERE d.date IS NULL OR d.date !~ '^\d{4}-\d{2}-\d{2}$' OR d.code IS NULL OR d.code NOT IN ('B','LL','HH','O') OR coalesce(length(d.source),0) = 0 OR length(d.source)>400)
    OR (SELECT count(DISTINCT d.date) FROM jsonb_to_recordset(p_days) AS d(date text)) <> expected THEN RAISE EXCEPTION 'Jornadas inválidas o duplicadas'; END IF;
  -- Never replace an existing decision, including a proposal, on re-import.
  IF EXISTS(SELECT 1 FROM jsonb_to_recordset(p_days) AS d(date date, code text)
    JOIN public.project_workday_status w ON w.project_id=p_project_id AND w.work_date=d.date
    WHERE w.decision_status<>'CONFIRMED' OR
      (CASE WHEN w.classification='WORKABLE' THEN 'B' WHEN w.classification='NON_WORKABLE_RAIN' THEN 'LL' WHEN w.reason_code='TERRAIN_SATURATED' THEN 'HH' ELSE 'O' END)<>d.code)
    THEN RAISE EXCEPTION 'Una jornada existente difiere de la planilla; requiere revisión'; END IF;
  INSERT INTO public.climate_events(project_id,event_date,source,local_source,status,raw_source_payload)
    SELECT p_project_id,d.date,'MANUAL','MANUAL','OBSERVED',jsonb_build_object('kind','WORKBOOK','sha256',p_source_hash,'cell',d.source)
    FROM jsonb_to_recordset(p_days) AS d(date date,code text,source text) WHERE d.code='LL'
    ON CONFLICT (project_id,event_date) DO NOTHING;
  INSERT INTO public.project_workday_status(project_id,work_date,classification,reason_code,climate_event_id,source,decision_status,proposed_automatically,confirmed_by,confirmed_at,notes)
    SELECT p_project_id,d.date,
      CASE d.code WHEN 'B' THEN 'WORKABLE' WHEN 'LL' THEN 'NON_WORKABLE_RAIN' ELSE 'NON_WORKABLE_OTHER' END,
      CASE d.code WHEN 'HH' THEN 'TERRAIN_SATURATED' WHEN 'O' THEN 'OTHER' ELSE NULL END,
      CASE WHEN d.code='LL' THEN e.id ELSE NULL END,
      'MANUAL','CONFIRMED',false,auth.uid(),now(),
      'Planilla '||p_source_hash||' · '||d.source||' · código '||d.code
    FROM jsonb_to_recordset(p_days) AS d(date date,code text,source text)
    LEFT JOIN public.climate_events e ON e.project_id=p_project_id AND e.event_date=d.date
    ON CONFLICT (project_id,work_date) DO NOTHING;
  SELECT count(*) INTO actual FROM jsonb_to_recordset(p_days) AS d(date date,code text)
    JOIN public.project_workday_status w ON w.project_id=p_project_id AND w.work_date=d.date AND w.decision_status='CONFIRMED'
    WHERE (CASE WHEN w.classification='WORKABLE' THEN 'B' WHEN w.classification='NON_WORKABLE_RAIN' THEN 'LL' WHEN w.reason_code='TERRAIN_SATURATED' THEN 'HH' ELSE 'O' END)=d.code;
  IF actual<>expected THEN RAISE EXCEPTION 'La lectura posterior del Libro de Obra no coincide'; END IF;
  RETURN actual;
END $$;
REVOKE ALL ON FUNCTION public.import_workbook_workdays(uuid,jsonb,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.import_workbook_workdays(uuid,jsonb,text) TO authenticated;
