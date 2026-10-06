-- Additive contract rules and append-only documentary records. No backfill.
CREATE TABLE public.contract_climate_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  version integer NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT','VALIDATED')),
  parameters jsonb NOT NULL CHECK (jsonb_typeof(parameters)='object' AND parameters->>'schemaVersion'='1'),
  validated_by uuid REFERENCES auth.users(id),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(project_id,version)
);
CREATE TABLE public.contract_day_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  workday_id uuid NOT NULL REFERENCES public.project_workday_status(id),
  workday_fingerprint text NOT NULL,
  impediment boolean, conformity boolean,
  document_ref text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (conformity IS DISTINCT FROM true OR length(trim(document_ref))>0)
);
CREATE TABLE public.contract_time_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  days integer NOT NULL CHECK (days>0 AND days<=10000),
  document_ref text NOT NULL CHECK (length(trim(document_ref))>0),
  approved_date date NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX contract_adjustment_document ON public.contract_time_adjustments(project_id,lower(trim(document_ref)));
CREATE TABLE public.certificate_climate_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  certificate_id uuid NOT NULL REFERENCES public.project_certificates(id),
  input_hash text NOT NULL CHECK (input_hash ~ '^[a-f0-9]{64}$'),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot)='object' AND snapshot->'result'->>'status'='COMPLETE'),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Invoker triggers keep tenant/parent checks behind the caller's existing RLS.
CREATE FUNCTION public.guard_contract_climate_record() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE owner_id uuid; day_project uuid; cert record;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Los registros contractuales son inmutables; creá una nueva versión.'; END IF;
  SELECT empresa_id INTO owner_id FROM public.projects WHERE id=NEW.project_id FOR UPDATE;
  IF owner_id IS NULL OR owner_id IS DISTINCT FROM NEW.empresa_id OR owner_id IS DISTINCT FROM public.current_empresa_id()
     OR auth.uid() IS NULL OR NOT public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]) THEN
    RAISE EXCEPTION 'Proyecto contractual no autorizado.';
  END IF;
  NEW.created_by:=auth.uid(); NEW.created_at:=clock_timestamp();
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

DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['contract_climate_policy_versions','contract_day_assessments','contract_time_adjustments','certificate_climate_snapshots'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',tab);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',tab);
    EXECUTE format('GRANT SELECT,INSERT ON public.%I TO authenticated',tab);
    EXECUTE format('GRANT ALL ON public.%I TO service_role',tab);
    EXECUTE format('CREATE INDEX %I ON public.%I(empresa_id,project_id,created_at DESC)',tab||'_project_idx',tab);
    EXECUTE format('CREATE TRIGGER contract_climate_guard BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_contract_climate_record()',tab);
    EXECUTE format($pol$CREATE POLICY contract_climate_read ON public.%I FOR SELECT TO authenticated USING (
      empresa_id=public.current_empresa_id() AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
      AND EXISTS(SELECT 1 FROM public.profiles p JOIN public.empresas e ON e.id=p.empresa_id
        WHERE p.id=auth.uid() AND p.active AND (e.active OR p.is_super_admin) AND (e.plan IN ('pro','caterpillar') OR p.is_super_admin)))$pol$,tab);
    EXECUTE format($pol$CREATE POLICY contract_climate_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (
      empresa_id=public.current_empresa_id() AND created_by=auth.uid()
      AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
      AND EXISTS(SELECT 1 FROM public.profiles p JOIN public.empresas e ON e.id=p.empresa_id
        WHERE p.id=auth.uid() AND p.active AND (e.active OR p.is_super_admin) AND (e.plan IN ('pro','caterpillar') OR p.is_super_admin)))$pol$,tab);
  END LOOP;
END $$;

-- Once an immutable anexo exists, its period cannot silently diverge.
CREATE FUNCTION public.guard_certificate_climate_period() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
BEGIN
  IF (NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.period_start IS DISTINCT FROM OLD.period_start OR NEW.period_end IS DISTINCT FROM OLD.period_end)
     AND EXISTS(SELECT 1 FROM public.certificate_climate_snapshots WHERE certificate_id=OLD.id) THEN
    RAISE EXCEPTION 'El certificado tiene un anexo climático: su proyecto/período está congelado.';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_certificate_climate_period() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER certificate_climate_period_guard BEFORE UPDATE ON public.project_certificates FOR EACH ROW EXECUTE FUNCTION public.guard_certificate_climate_period();
