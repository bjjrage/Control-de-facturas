-- A retry of the same collection request must return its original receipt.
-- The existing collection function still owns balance, role and treasury checks.
ALTER TABLE public.sales_receipts
  ADD COLUMN IF NOT EXISTS idempotency_key uuid;

CREATE UNIQUE INDEX IF NOT EXISTS sales_receipts_empresa_idempotency_key
  ON public.sales_receipts (empresa_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.registrar_cobro_idempotente(
  p_empresa_id uuid,
  p_sales_document_id uuid,
  p_amount numeric,
  p_method text,
  p_receipt_date date,
  p_reference text,
  p_notes text,
  p_cuenta_id uuid,
  p_created_by uuid,
  p_idempotency_key uuid
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_existing public.sales_receipts;
  v_receipt_id uuid;
  v_receipt_date date := COALESCE(p_receipt_date, CURRENT_DATE);
BEGIN
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'La clave de intento del cobro es obligatoria';
  END IF;
  IF p_amount IS NULL OR p_amount::text IN ('NaN','Infinity','-Infinity')
     OR p_amount <= 0 OR p_amount <> pg_catalog.round(p_amount, 2) THEN
    RAISE EXCEPTION 'El importe del cobro debe tener hasta dos decimales';
  END IF;
  IF auth.uid() IS NULL
     OR p_created_by IS DISTINCT FROM auth.uid()
     OR public.current_empresa_id() IS DISTINCT FROM p_empresa_id
     OR NOT public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]) THEN
    RAISE EXCEPTION 'Acceso denegado para registrar cobro';
  END IF;

  -- Serialize retries of one request before checking balance or creating rows.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_empresa_id::text || ':' || p_idempotency_key::text, 0)
  );
  SELECT * INTO v_existing
  FROM public.sales_receipts
  WHERE empresa_id = p_empresa_id AND idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.sales_document_id IS DISTINCT FROM p_sales_document_id
       OR v_existing.amount IS DISTINCT FROM p_amount
       OR v_existing.method::text IS DISTINCT FROM p_method
       OR v_existing.receipt_date IS DISTINCT FROM v_receipt_date
       OR v_existing.reference IS DISTINCT FROM p_reference
       OR v_existing.notes IS DISTINCT FROM p_notes
       OR v_existing.cuenta_id IS DISTINCT FROM p_cuenta_id
       OR v_existing.created_by IS DISTINCT FROM p_created_by THEN
      RAISE EXCEPTION 'La clave de intento ya pertenece a otro cobro';
    END IF;
    RETURN v_existing.id;
  END IF;

  v_receipt_id := public.registrar_cobro_atomico(
    p_empresa_id, p_sales_document_id, p_amount, p_method,
    v_receipt_date, p_reference, p_notes, p_cuenta_id, p_created_by
  );
  UPDATE public.sales_receipts
    SET idempotency_key = p_idempotency_key
    WHERE id = v_receipt_id AND empresa_id = p_empresa_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El cobro creado no se pudo asociar al intento';
  END IF;
  RETURN v_receipt_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.registrar_cobro_idempotente(uuid,uuid,numeric,text,date,text,text,uuid,uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_cobro_idempotente(uuid,uuid,numeric,text,date,text,text,uuid,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_cobro_idempotente(uuid,uuid,numeric,text,date,text,text,uuid,uuid,uuid) TO service_role;
