-- Migration: 20260926010000_autonomous_certificate_workbook_import.sql
-- Forward-only migration to enable autonomous certificate workbook imports.
-- Allows importing non-consecutive certificates (e.g. #6 without #1-5), optional/NULL budget_item_id,
-- and preserves workbook's qty_anterior without requiring prior history in the ERP.
-- NO DELETE, NO TRUNCATE, NO DROP TABLE, NO DATA LOSS.

-- 1. Ensure import_fingerprint exists on project_certificates and index is created
ALTER TABLE public.project_certificates
  ADD COLUMN IF NOT EXISTS import_fingerprint text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_project_certificates_import_fingerprint
  ON public.project_certificates (project_id, import_fingerprint)
  WHERE import_fingerprint IS NOT NULL;

-- 2. Update atomic workbook import RPC
CREATE OR REPLACE FUNCTION public.import_project_certificate_atomically(
  p_project_id uuid,
  p_expected_number integer,
  p_period_start date,
  p_period_end date,
  p_import_fingerprint text,
  p_items jsonb
)
RETURNS TABLE (certificate_id uuid, numero integer, already_imported boolean)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_project_id uuid;
  v_certificate_id uuid;
  v_item_count integer;
  v_inserted_count integer;
  v_existing_number integer;
  v_monto_anterior numeric(18,2);
  v_monto_presente numeric(18,2);
BEGIN
  IF v_user_id IS NULL
     OR NOT public.is_internal_role(ARRAY['administracion', 'admin']::public.user_role[]) THEN
    RAISE EXCEPTION 'Solo administración puede importar certificados';
  END IF;
  IF p_import_fingerprint IS NULL OR p_import_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'La huella del archivo no es válida';
  END IF;
  IF p_period_start IS NULL OR p_period_end IS NULL OR p_period_end < p_period_start THEN
    RAISE EXCEPTION 'El período del certificado es inválido';
  END IF;
  IF p_expected_number IS NULL OR p_expected_number <= 0 THEN
    RAISE EXCEPTION 'El número de certificado es inválido';
  END IF;
  IF p_items IS NULL OR pg_catalog.jsonb_typeof(p_items) IS DISTINCT FROM 'array'
     OR pg_catalog.jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'El certificado no contiene partidas';
  END IF;

  SELECT p.id INTO v_project_id
  FROM public.projects p
  WHERE p.id = p_project_id
    AND p.empresa_id = public.current_empresa_id();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Obra no encontrada para la empresa';
  END IF;

  -- Same file/project retries return the original draft; the unique index
  -- closes the race between concurrent first attempts.
  SELECT c.id, c.numero INTO v_certificate_id, v_existing_number
  FROM public.project_certificates c
  WHERE c.project_id = v_project_id AND c.import_fingerprint = p_import_fingerprint;
  IF FOUND THEN
    RETURN QUERY SELECT v_certificate_id, v_existing_number, true;
    RETURN;
  END IF;

  SELECT pg_catalog.jsonb_array_length(p_items) INTO v_item_count;

  -- Ensure each non-null budget_item_id is linked at most once
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_to_recordset(p_items) AS line(budget_item_id uuid)
    WHERE line.budget_item_id IS NOT NULL
    GROUP BY line.budget_item_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cada partida del presupuesto puede vincularse una sola vez';
  END IF;

  -- Validate that if a budget_item_id is specified, it exists and belongs to this project;
  -- and validate that numeric fields are non-negative.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_to_recordset(p_items) AS line(
      budget_item_id uuid,
      qty_contractual numeric,
      qty_anterior numeric,
      qty_presente numeric,
      precio_unitario numeric
    )
    LEFT JOIN public.budget_items bi
      ON bi.id = line.budget_item_id AND bi.project_id = v_project_id
    WHERE (line.budget_item_id IS NOT NULL AND bi.id IS NULL)
       OR line.qty_contractual IS NULL OR line.qty_contractual < 0
       OR line.qty_anterior IS NULL OR line.qty_anterior < 0
       OR line.qty_presente IS NULL OR line.qty_presente < 0
       OR line.precio_unitario IS NULL OR line.precio_unitario < 0
  ) THEN
    RAISE EXCEPTION 'Hay partidas inválidas o vinculadas a otra obra';
  END IF;

  BEGIN
    INSERT INTO public.project_certificates (
      project_id, numero, period_start, period_end, status, created_by, import_fingerprint
    ) VALUES (
      v_project_id, p_expected_number, p_period_start, p_period_end,
      'BORRADOR', v_user_id, p_import_fingerprint
    ) RETURNING id INTO v_certificate_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT c.id, c.numero INTO v_certificate_id, v_existing_number
    FROM public.project_certificates c
    WHERE c.project_id = v_project_id AND c.import_fingerprint = p_import_fingerprint;
    IF FOUND THEN
      RETURN QUERY SELECT v_certificate_id, v_existing_number, true;
      RETURN;
    END IF;
    RAISE;
  END;

  INSERT INTO public.project_certificate_items (
    certificate_id, budget_item_id, codigo, descripcion, unidad,
    qty_contractual, precio_unitario, qty_anterior, qty_presente, sort_order
  )
  SELECT
    v_certificate_id, line.budget_item_id, line.codigo, line.descripcion, line.unidad,
    line.qty_contractual, line.precio_unitario, line.qty_anterior, line.qty_presente, line.sort_order
  FROM pg_catalog.jsonb_to_recordset(p_items) AS line(
    budget_item_id uuid,
    codigo text,
    descripcion text,
    unidad text,
    qty_contractual numeric,
    precio_unitario numeric,
    qty_anterior numeric,
    qty_presente numeric,
    sort_order integer
  );
  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  IF v_inserted_count <> v_item_count THEN
    RAISE EXCEPTION 'No se pudieron crear todas las partidas del certificado';
  END IF;

  SELECT coalesce(sum(i.monto_anterior), 0), coalesce(sum(i.monto_presente), 0)
    INTO v_monto_anterior, v_monto_presente
  FROM public.project_certificate_items i
  WHERE i.certificate_id = v_certificate_id;
  UPDATE public.project_certificates
  SET monto_anterior = v_monto_anterior,
      monto_presente = v_monto_presente
  WHERE id = v_certificate_id;

  RETURN QUERY SELECT v_certificate_id, p_expected_number, false;
END;
$$;

REVOKE ALL ON FUNCTION public.import_project_certificate_atomically(uuid, integer, date, date, text, jsonb)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.import_project_certificate_atomically(uuid, integer, date, date, text, jsonb)
  TO authenticated;

-- 3. Update trigger function guard_project_certificate_create to bypass imported certificates
CREATE OR REPLACE FUNCTION public.guard_project_certificate_create()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_project_id uuid;
  v_latest_num integer;
  v_latest_status text;
BEGIN
  IF auth.uid() IS NULL
     OR NOT public.is_internal_role(ARRAY['administracion', 'admin']::public.user_role[]) THEN
    RAISE EXCEPTION 'Solo administración puede crear certificados';
  END IF;

  SELECT p.id INTO v_project_id
  FROM public.projects p
  WHERE p.id = NEW.project_id
    AND p.empresa_id = public.current_empresa_id()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proyecto no encontrado para la empresa';
  END IF;
  IF NEW.status IS DISTINCT FROM 'BORRADOR' THEN
    RAISE EXCEPTION 'Un certificado nuevo debe comenzar en borrador';
  END IF;

  -- Imported certificates represent autonomous contractual documents which
  -- may not be consecutive (e.g. Cert #6 without 1-5).
  IF NEW.import_fingerprint IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.numero, c.status::text
    INTO v_latest_num, v_latest_status
  FROM public.project_certificates c
  WHERE c.project_id = NEW.project_id
  ORDER BY c.numero DESC
  LIMIT 1;

  IF v_latest_num IS NOT NULL AND v_latest_status NOT IN ('APROBADO', 'FACTURADO') THEN
    RAISE EXCEPTION 'El certificado anterior debe estar aprobado antes de crear otro';
  END IF;
  IF NEW.numero IS DISTINCT FROM coalesce(v_latest_num, 0) + 1 THEN
    RAISE EXCEPTION 'El número del certificado cambió; actualizá la pantalla e intentá de nuevo';
  END IF;

  RETURN NEW;
END;
$$;
