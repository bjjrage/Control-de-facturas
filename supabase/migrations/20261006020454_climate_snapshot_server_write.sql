-- Certificate climate snapshots are computed by an authorized server action.
-- Authenticated clients must not be able to submit a forged COMPLETE payload.
REVOKE INSERT ON public.certificate_climate_snapshots FROM authenticated;
DROP POLICY IF EXISTS contract_climate_insert ON public.certificate_climate_snapshots;

CREATE OR REPLACE FUNCTION public.guard_contract_climate_record() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE owner_id uuid; actor_empresa uuid; day_project uuid; cert record;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Los registros contractuales son inmutables; creá una nueva versión.'; END IF;
  SELECT empresa_id INTO owner_id FROM public.projects WHERE id=NEW.project_id FOR UPDATE;
  IF owner_id IS NULL OR owner_id IS DISTINCT FROM NEW.empresa_id THEN
    RAISE EXCEPTION 'Proyecto contractual no autorizado.';
  END IF;

  IF TG_TABLE_NAME='certificate_climate_snapshots' AND auth.role()='service_role' THEN
    -- The only service-role insertion path is the server action, which first
    -- authorizes an active internal administrator and computes this snapshot.
    SELECT p.empresa_id INTO actor_empresa
    FROM public.profiles p JOIN public.empresas e ON e.id=p.empresa_id
    WHERE p.id=NEW.created_by AND p.active
      AND p.role IN ('administracion','admin')
      AND (e.active OR p.is_super_admin)
      AND (e.plan IN ('pro','caterpillar') OR p.is_super_admin);
    IF actor_empresa IS DISTINCT FROM owner_id THEN
      RAISE EXCEPTION 'Actor del anexo climático no autorizado para el proyecto.';
    END IF;
    NEW.created_at:=clock_timestamp();
  ELSE
    IF owner_id IS DISTINCT FROM public.current_empresa_id()
       OR auth.uid() IS NULL
       OR NOT public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]) THEN
      RAISE EXCEPTION 'Proyecto contractual no autorizado.';
    END IF;
    NEW.created_by:=auth.uid(); NEW.created_at:=clock_timestamp();
  END IF;

  IF TG_TABLE_NAME='contract_climate_policy_versions' THEN
    SELECT coalesce(max(version),0)+1 INTO NEW.version FROM public.contract_climate_policy_versions WHERE project_id=NEW.project_id;
    NEW.validated_by:=CASE WHEN NEW.status='VALIDATED' THEN auth.uid() ELSE NULL END;
  ELSIF TG_TABLE_NAME='contract_day_assessments' THEN
    SELECT project_id INTO day_project FROM public.project_workday_status WHERE id=NEW.workday_id;
    IF day_project IS DISTINCT FROM NEW.project_id THEN RAISE EXCEPTION 'Jornada de otro proyecto.'; END IF;
  ELSIF TG_TABLE_NAME='contract_time_adjustments' THEN
    IF NEW.approved_date>current_date THEN RAISE EXCEPTION 'Fecha de aprobación futura.'; END IF;
  ELSIF TG_TABLE_NAME='certificate_climate_snapshots' THEN
    SELECT project_id,status,period_start,period_end INTO cert FROM public.project_certificates WHERE id=NEW.certificate_id FOR UPDATE;
    IF cert.project_id IS DISTINCT FROM NEW.project_id OR cert.status IS DISTINCT FROM 'BORRADOR'
       OR cert.period_start::text IS DISTINCT FROM NEW.snapshot->'result'->>'periodStart'
       OR cert.period_end::text IS DISTINCT FROM NEW.snapshot->'result'->>'periodEnd' THEN
      RAISE EXCEPTION 'El anexo sólo puede asociarse al mismo proyecto y período de un certificado borrador.';
    END IF;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.guard_contract_climate_record() FROM PUBLIC,anon,authenticated;
