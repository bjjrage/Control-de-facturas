-- Close the crash window between invoice INSERT and invoice_jobs.invoice_id.
-- The lease and its fencing token are validated while holding the job row lock;
-- invoice, checkpoint and audit then commit or roll back as one unit.
BEGIN;

CREATE OR REPLACE FUNCTION public.create_invoice_from_job(
  p_empresa_id uuid,
  p_job_id uuid,
  p_expected_attempts integer,
  p_invoice jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_job public.invoice_jobs;
  v_invoice_id uuid;
  v_provider_id uuid;
  v_attachment_id uuid;
  v_invoice_number text;
  v_invoice_date date;
  v_currency public.currency_code;
  v_subtotal numeric;
  v_vat numeric;
  v_total numeric;
  v_timbrado text;
  v_created_by uuid;
  v_actor_type text;
  v_actor_label text;
  v_key text;
BEGIN
  PERFORM private.b11_require_financial_actor(p_empresa_id);
  IF auth.role() IS DISTINCT FROM 'service_role' AND auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated financial actor required' USING ERRCODE='42501';
  END IF;

  IF p_expected_attempts IS NULL OR p_expected_attempts < 1
     OR p_invoice IS NULL OR pg_catalog.jsonb_typeof(p_invoice) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid invoice job request' USING ERRCODE='22023';
  END IF;
  FOR v_key IN SELECT pg_catalog.jsonb_object_keys(p_invoice) LOOP
    IF v_key NOT IN ('provider_id','invoice_number','invoice_date','currency',
                     'subtotal','vat','total','timbrado','attachment_id') THEN
      RAISE EXCEPTION 'Unsupported invoice field: %',v_key USING ERRCODE='22023';
    END IF;
  END LOOP;

  SELECT j.* INTO v_job
  FROM public.invoice_jobs j
  WHERE j.id=p_job_id
  FOR UPDATE;
  IF NOT FOUND OR v_job.empresa_id IS DISTINCT FROM p_empresa_id THEN
    RAISE EXCEPTION 'Invoice job not found for tenant' USING ERRCODE='42501';
  END IF;
  IF v_job.status IS DISTINCT FROM 'processing'::public.invoice_job_status
     OR v_job.attempts IS DISTINCT FROM p_expected_attempts
     OR v_job.invoice_id IS NOT NULL THEN
    RAISE EXCEPTION 'Invoice job lease is stale or already checkpointed' USING ERRCODE='40001';
  END IF;

  v_provider_id := (p_invoice->>'provider_id')::uuid;
  v_invoice_number := pg_catalog.btrim(p_invoice->>'invoice_number');
  v_invoice_date := (p_invoice->>'invoice_date')::date;
  v_currency := (p_invoice->>'currency')::public.currency_code;
  v_total := (p_invoice->>'total')::numeric;
  IF p_invoice ? 'subtotal' AND p_invoice->'subtotal' <> 'null'::jsonb THEN
    v_subtotal := (p_invoice->>'subtotal')::numeric;
  END IF;
  IF p_invoice ? 'vat' AND p_invoice->'vat' <> 'null'::jsonb THEN
    v_vat := (p_invoice->>'vat')::numeric;
  END IF;
  IF p_invoice ? 'attachment_id' AND p_invoice->'attachment_id' <> 'null'::jsonb THEN
    v_attachment_id := (p_invoice->>'attachment_id')::uuid;
  END IF;
  v_timbrado := NULLIF(pg_catalog.btrim(p_invoice->>'timbrado'),'');

  IF v_provider_id IS NULL OR v_invoice_number IS NULL OR v_invoice_number=''
     OR v_invoice_date IS NULL OR v_currency IS NULL OR v_total IS NULL
     OR v_total::text IN ('NaN','Infinity','-Infinity') OR v_total <= 0
     OR v_total <> pg_catalog.trunc(v_total,2)
     OR (v_subtotal IS NOT NULL AND (v_subtotal::text IN ('NaN','Infinity','-Infinity')
          OR v_subtotal < 0 OR v_subtotal <> pg_catalog.trunc(v_subtotal,2)))
     OR (v_vat IS NOT NULL AND (v_vat::text IN ('NaN','Infinity','-Infinity')
          OR v_vat < 0 OR v_vat <> pg_catalog.trunc(v_vat,2))) THEN
    RAISE EXCEPTION 'Invoice fields contain invalid or non-canonical amounts' USING ERRCODE='22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.providers p
    WHERE p.id=v_provider_id AND p.empresa_id=p_empresa_id
  ) THEN
    RAISE EXCEPTION 'Provider does not belong to invoice job tenant' USING ERRCODE='42501';
  END IF;
  IF v_attachment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.attachments a
    WHERE a.id=v_attachment_id AND a.empresa_id=p_empresa_id
      AND a.bucket='invoice-files'
  ) THEN
    RAISE EXCEPTION 'Attachment does not belong to invoice job tenant' USING ERRCODE='42501';
  END IF;

  IF auth.role()='service_role' THEN
    v_created_by := v_job.created_by;
    v_actor_type := 'system';
    v_actor_label := 'invoice-reconciliation-worker';
  ELSE
    v_created_by := auth.uid();
    v_actor_type := 'internal';
    v_actor_label := NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id=v_created_by AND p.empresa_id=p_empresa_id
  ) THEN
    RAISE EXCEPTION 'Invoice job creator does not belong to job tenant' USING ERRCODE='42501';
  END IF;

  INSERT INTO public.invoices(
    empresa_id,provider_id,invoice_number,invoice_date,currency,
    subtotal,vat,total,timbrado,attachment_id,created_by
  ) VALUES (
    p_empresa_id,v_provider_id,v_invoice_number,v_invoice_date,v_currency,
    v_subtotal,v_vat,v_total,v_timbrado,v_attachment_id,v_created_by
  ) RETURNING id INTO v_invoice_id;

  UPDATE public.invoice_jobs j
  SET invoice_id=v_invoice_id,provider_id=v_provider_id,updated_at=pg_catalog.now()
  WHERE j.id=p_job_id AND j.empresa_id=p_empresa_id
    AND j.status='processing'::public.invoice_job_status
    AND j.attempts=p_expected_attempts AND j.invoice_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice job lease changed during invoice creation' USING ERRCODE='40001';
  END IF;

  INSERT INTO public.audit_logs(
    empresa_id,actor_id,actor_type,actor_label,action,invoice_id,detail
  ) VALUES (
    p_empresa_id,v_created_by,v_actor_type,v_actor_label,'invoice.created',v_invoice_id,
    pg_catalog.jsonb_build_object('source','invoice_job','job_id',p_job_id,'attempts',p_expected_attempts)
  );

  RETURN pg_catalog.jsonb_build_object('ok',true,'invoice_id',v_invoice_id,'duplicate',false);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_invoice_from_job(uuid,uuid,integer,jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_invoice_from_job(uuid,uuid,integer,jsonb)
  TO authenticated,service_role;

-- Storage paths are caller-visible metadata, so delete_invoice must only ask
-- the application to remove objects under an owned invoice-files prefix. A
-- path shared by another metadata row is retained even if metadata cleanup
-- for this invoice succeeds.
CREATE OR REPLACE FUNCTION public.delete_invoice(
  p_empresa_id uuid,
  p_invoice_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_invoice_empresa uuid;
  v_status public.invoice_status;
  v_attachment_id uuid;
  v_cleanup_bucket text;
  v_cleanup_path text;
  v_attachment public.attachments;
  v_op record;
  v_locked_ops uuid[] := ARRAY[]::uuid[];
  v_owned_path boolean := false;
BEGIN
  PERFORM private.b11_require_financial_actor(p_empresa_id);
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.is_internal_role(ARRAY['admin']::public.user_role[]) THEN
    RAISE EXCEPTION 'Solo un administrador puede eliminar una factura' USING ERRCODE='42501';
  END IF;

  FOR v_op IN
    SELECT po.id,po.status
    FROM public.payment_order_invoices poi
    JOIN public.payment_orders po ON po.id=poi.payment_order_id
    WHERE poi.invoice_id=p_invoice_id AND poi.empresa_id=p_empresa_id
    ORDER BY po.id FOR UPDATE OF po
  LOOP
    IF v_op.status='EJECUTADA' THEN
      RAISE EXCEPTION 'No se puede eliminar una factura vinculada a una OP ejecutada' USING ERRCODE='55000';
    END IF;
    v_locked_ops := pg_catalog.array_append(v_locked_ops,v_op.id);
  END LOOP;

  SELECT i.empresa_id,i.status,i.attachment_id
    INTO v_invoice_empresa,v_status,v_attachment_id
  FROM public.invoices i WHERE i.id=p_invoice_id FOR UPDATE;
  IF NOT FOUND OR v_invoice_empresa IS DISTINCT FROM p_empresa_id THEN
    RAISE EXCEPTION 'Factura no encontrada o no pertenece a esta empresa' USING ERRCODE='42501';
  END IF;
  IF v_status IN ('APTO_PARA_PAGO','PAGADO') THEN
    RAISE EXCEPTION 'No se puede eliminar una factura apta para pago o pagada' USING ERRCODE='55000';
  END IF;

  IF v_attachment_id IS NOT NULL THEN
    SELECT a.* INTO v_attachment
    FROM public.attachments a
    WHERE a.id=v_attachment_id AND a.empresa_id=p_empresa_id FOR UPDATE;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payment_order_invoices poi
    WHERE poi.invoice_id=p_invoice_id
      AND (poi.empresa_id IS DISTINCT FROM p_empresa_id
        OR NOT (poi.payment_order_id=ANY(v_locked_ops)))
  ) THEN
    RAISE EXCEPTION 'Los vínculos de OP cambiaron durante el borrado; reintente' USING ERRCODE='40001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.payment_order_invoices poi
    JOIN public.payment_orders po ON po.id=poi.payment_order_id
    WHERE poi.invoice_id=p_invoice_id AND poi.empresa_id=p_empresa_id AND po.status='EJECUTADA'
  ) THEN
    RAISE EXCEPTION 'No se puede eliminar una factura vinculada a una OP ejecutada' USING ERRCODE='55000';
  END IF;

  -- Lock child source rows in invoice -> authorized-order -> invoice-line ->
  -- order-line order. Delete them while the invoice is still visible so their
  -- guards and recompute triggers can validate the tenant and update counters.
  PERFORM o.id
  FROM public.authorized_orders o
  JOIN public.invoice_order_matches iom ON iom.authorized_order_id=o.id
  WHERE iom.invoice_id=p_invoice_id AND iom.empresa_id=p_empresa_id AND o.empresa_id=p_empresa_id
  ORDER BY o.id FOR UPDATE OF o;
  PERFORM l.id FROM public.invoice_items l
  WHERE l.invoice_id=p_invoice_id AND l.empresa_id=p_empresa_id
  ORDER BY l.id FOR UPDATE;
  PERFORM oi.id
  FROM public.authorized_order_items oi
  JOIN public.invoice_item_matches m ON m.order_item_id=oi.id
  JOIN public.invoice_items l ON l.id=m.invoice_item_id
  WHERE l.invoice_id=p_invoice_id AND l.empresa_id=p_empresa_id
    AND m.empresa_id=p_empresa_id AND oi.empresa_id=p_empresa_id
  ORDER BY oi.order_id,oi.id FOR UPDATE OF oi;

  DELETE FROM public.invoice_item_matches m
  USING public.invoice_items l
  WHERE m.invoice_item_id=l.id AND m.empresa_id=p_empresa_id
    AND l.invoice_id=p_invoice_id AND l.empresa_id=p_empresa_id;
  DELETE FROM public.invoice_order_matches iom
  WHERE iom.invoice_id=p_invoice_id AND iom.empresa_id=p_empresa_id;
  DELETE FROM public.invoice_items l
  WHERE l.invoice_id=p_invoice_id AND l.empresa_id=p_empresa_id;
  DELETE FROM public.payment_order_invoices poi WHERE poi.invoice_id=p_invoice_id AND poi.empresa_id=p_empresa_id;
  DELETE FROM public.invoice_exceptions e WHERE e.invoice_id=p_invoice_id AND e.empresa_id=p_empresa_id;
  DELETE FROM public.audit_logs a WHERE a.invoice_id=p_invoice_id AND (a.empresa_id=p_empresa_id OR a.empresa_id IS NULL);
  DELETE FROM public.invoices i WHERE i.id=p_invoice_id AND i.empresa_id=p_empresa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'La factura cambió durante el borrado' USING ERRCODE='40001'; END IF;

  IF v_attachment.id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.attachment_id=v_attachment.id) THEN
    BEGIN
      DELETE FROM public.attachments a
      WHERE a.id=v_attachment.id AND a.empresa_id=p_empresa_id
      RETURNING a.bucket,a.path INTO v_cleanup_bucket,v_cleanup_path;
    EXCEPTION WHEN foreign_key_violation OR raise_exception THEN
      v_cleanup_bucket := NULL;
      v_cleanup_path := NULL;
    END;
    IF v_cleanup_bucket IS NOT NULL THEN
      v_owned_path := v_cleanup_bucket='invoice-files'
        AND pg_catalog.strpos(v_cleanup_path,pg_catalog.chr(92))=0
        AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.unnest(pg_catalog.string_to_array(v_cleanup_path,'/')) AS path_segment(part)
          WHERE path_segment.part IN ('','.','..')
        )
        AND (
        pg_catalog.split_part(v_cleanup_path,'/',1)=p_empresa_id::text
        OR EXISTS (
          SELECT 1 FROM public.providers p
          WHERE p.empresa_id=p_empresa_id
            AND p.id::text=pg_catalog.split_part(v_cleanup_path,'/',1)
        )
      );
      IF NOT v_owned_path OR EXISTS (
        SELECT 1 FROM public.attachments a
        WHERE a.bucket=v_cleanup_bucket AND a.path=v_cleanup_path
      ) THEN
        v_cleanup_bucket := NULL;
        v_cleanup_path := NULL;
      END IF;
    END IF;
  END IF;

  RETURN pg_catalog.jsonb_build_object('ok',true,'attachment_id',v_attachment_id,
    'cleanup_bucket',v_cleanup_bucket,'cleanup_path',v_cleanup_path);
END;
$function$;

COMMIT;
