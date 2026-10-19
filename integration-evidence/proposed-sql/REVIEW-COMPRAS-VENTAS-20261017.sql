-- FILE: C01-C02-invoice-identity-gates.sql
-- PROPOSED ONLY: C01/C02 identity and financial authorization gates.
-- Target allowed only after exact authorization: kyiihlkncatojvlasoag.
-- No backfill, no deletion, no credential changes, no historical payment changes.
BEGIN;
CREATE TABLE public.invoice_identity_evidence (
  invoice_id uuid PRIMARY KEY REFERENCES public.invoices(id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL,
  attachment_id uuid NOT NULL,
  provider_id uuid NOT NULL,
  file_sha256 text NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  document_tax_id text NOT NULL CHECK (document_tax_id <> ''),
  provider_tax_id text NOT NULL,
  invoice_number text NOT NULL,
  currency public.currency_code NOT NULL,
  total numeric NOT NULL,
  extracted jsonb NOT NULL,
  verified_by uuid NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id,file_sha256),
  UNIQUE (empresa_id,document_tax_id,invoice_number),
  FOREIGN KEY (empresa_id,provider_id) REFERENCES public.providers(empresa_id,id),
  FOREIGN KEY (empresa_id,attachment_id) REFERENCES public.attachments(empresa_id,id)
);
ALTER TABLE public.invoice_identity_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invoice_identity_evidence FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.invoice_identity_evidence TO authenticated;
GRANT SELECT ON public.invoice_identity_evidence TO service_role;
CREATE POLICY invoice_identity_read ON public.invoice_identity_evidence FOR SELECT TO authenticated
USING (empresa_id=public.current_empresa_id() AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));

CREATE FUNCTION public.register_invoice_identity(p_invoice_id uuid,p_attachment_id uuid,p_sha256 text,p_tax_id text,p_extracted jsonb,p_verified_by uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE i public.invoices; provider_tax text; document_tax text;
BEGIN
  SELECT * INTO i FROM public.invoices WHERE id=p_invoice_id FOR UPDATE;
  IF NOT FOUND OR i.attachment_id IS DISTINCT FROM p_attachment_id OR p_attachment_id IS NULL THEN
    RAISE EXCEPTION 'El original no corresponde a la factura';
  END IF;
  SELECT regexp_replace(upper(p.tax_id),'[^A-Z0-9]','','g') INTO provider_tax
    FROM public.providers p WHERE p.id=i.provider_id AND p.empresa_id=i.empresa_id;
  document_tax := regexp_replace(upper(p_tax_id),'[^A-Z0-9]','','g');
  IF document_tax IS NULL OR document_tax='' OR provider_tax IS DISTINCT FROM document_tax THEN
    RAISE EXCEPTION 'El RUC del emisor no coincide con el proveedor';
  END IF;
  IF p_extracted IS NULL OR jsonb_typeof(p_extracted)<>'object' OR
     regexp_replace(upper(p_extracted->>'provider_tax_id'),'[^A-Z0-9]','','g') IS DISTINCT FROM document_tax THEN
    RAISE EXCEPTION 'La lectura no acredita el emisor';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=p_verified_by AND p.empresa_id=i.empresa_id AND p.active
    AND p.role IN ('administracion','admin')) THEN RAISE EXCEPTION 'Verificador interno activo requerido'; END IF;
  IF p_extracted->>'invoice_number' IS DISTINCT FROM i.invoice_number
    OR (p_extracted->>'total')::numeric IS DISTINCT FROM i.total
    OR (p_extracted->>'invoice_date')::date IS DISTINCT FROM i.invoice_date
    OR (NULLIF(p_extracted->>'currency','') IS NOT NULL AND p_extracted->>'currency' IS DISTINCT FROM i.currency::text) THEN
    RAISE EXCEPTION 'Número, fecha e importe no corresponden a la lectura del original';
  END IF;
  INSERT INTO public.invoice_identity_evidence(invoice_id,empresa_id,attachment_id,provider_id,file_sha256,
    document_tax_id,provider_tax_id,invoice_number,currency,total,extracted,verified_by)
  VALUES(i.id,i.empresa_id,i.attachment_id,i.provider_id,p_sha256,document_tax,provider_tax,
    i.invoice_number,i.currency,i.total,p_extracted,p_verified_by)
  ON CONFLICT(invoice_id) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM public.invoice_identity_evidence e WHERE e.invoice_id=i.id AND e.empresa_id=i.empresa_id
    AND e.attachment_id=i.attachment_id AND e.provider_id=i.provider_id AND e.file_sha256=p_sha256
    AND e.document_tax_id=document_tax AND e.invoice_number=i.invoice_number AND e.total=i.total AND e.currency=i.currency) THEN
    RAISE EXCEPTION 'La evidencia previa es distinta; no se puede sobrescribir';
  END IF;
END;
$f$;
REVOKE ALL ON FUNCTION public.register_invoice_identity(uuid,uuid,text,text,jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.register_invoice_identity(uuid,uuid,text,text,jsonb,uuid) TO service_role;

CREATE FUNCTION private.require_invoice_identity(p_invoice_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.invoices i
    JOIN public.invoice_identity_evidence e ON e.invoice_id=i.id AND e.empresa_id=i.empresa_id
      AND e.attachment_id=i.attachment_id AND e.provider_id=i.provider_id
      AND e.invoice_number=i.invoice_number AND e.currency=i.currency AND e.total=i.total
    JOIN public.providers p ON p.id=i.provider_id AND p.empresa_id=i.empresa_id
    WHERE i.id=p_invoice_id AND e.document_tax_id=e.provider_tax_id
      AND e.provider_tax_id=regexp_replace(upper(p.tax_id),'[^A-Z0-9]','','g')
  ) THEN RAISE EXCEPTION 'Factura sin identidad documental verificada; relea el original antes de conciliar o pagar'; END IF;
END;
$f$;
REVOKE ALL ON FUNCTION private.require_invoice_identity(uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.invoice_document_matches_order(p_invoice_id uuid,p_order_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS $f$
 SELECT EXISTS (
   SELECT 1 FROM public.invoice_identity_evidence e JOIN public.authorized_orders o ON o.id=p_order_id
     AND o.empresa_id=e.empresa_id AND o.provider_id=e.provider_id AND o.currency=e.currency
   WHERE e.invoice_id=p_invoice_id
   AND (NULLIF(btrim(e.extracted->>'order_reference'),'') IS NULL OR upper(o.code)=ANY(regexp_split_to_array(upper(e.extracted->>'order_reference'),'[^A-Z0-9-]+')))
   AND EXISTS (SELECT 1 FROM jsonb_array_elements(
     CASE WHEN jsonb_typeof(e.extracted->'items')='array' AND jsonb_array_length(e.extracted->'items')>0 THEN e.extracted->'items'
     ELSE jsonb_build_array(jsonb_build_object('description',e.extracted->>'product_description')) END) item
     WHERE pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.translate(pg_catalog.lower(item->>'description'), 'áéíóúüñ', 'aeiouun'),'[^a-z0-9]+',' ','g'))<>'')
   AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(
     CASE WHEN jsonb_typeof(e.extracted->'items')='array' AND jsonb_array_length(e.extracted->'items')>0 THEN e.extracted->'items'
     ELSE jsonb_build_array(jsonb_build_object('description',e.extracted->>'product_description')) END) item
     WHERE pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.translate(pg_catalog.lower(item->>'description'), 'áéíóúüñ', 'aeiouun'),'[^a-z0-9]+',' ','g'))='' OR NOT (
       pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.translate(pg_catalog.lower(item->>'description'), 'áéíóúüñ', 'aeiouun'),'[^a-z0-9]+',' ','g'))=pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.translate(pg_catalog.lower(o.product), 'áéíóúüñ', 'aeiouun'),'[^a-z0-9]+',' ','g')) OR EXISTS (SELECT 1 FROM public.authorized_order_items line
         WHERE line.order_id=o.id AND line.empresa_id=o.empresa_id AND pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.translate(pg_catalog.lower(item->>'description'), 'áéíóúüñ', 'aeiouun'),'[^a-z0-9]+',' ','g'))=pg_catalog.btrim(pg_catalog.regexp_replace(pg_catalog.translate(pg_catalog.lower(line.product), 'áéíóúüñ', 'aeiouun'),'[^a-z0-9]+',' ','g')))
     ))
 );
$f$;
REVOKE ALL ON FUNCTION private.invoice_document_matches_order(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.guard_invoice_order_match_tenant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE i public.invoices; o public.authorized_orders;
BEGIN
  SELECT * INTO i FROM public.invoices WHERE id=NEW.invoice_id FOR UPDATE;
  IF NOT FOUND OR i.empresa_id IS DISTINCT FROM NEW.empresa_id THEN RAISE EXCEPTION 'Factura ajena a la empresa'; END IF;
  SELECT * INTO o FROM public.authorized_orders WHERE id=NEW.authorized_order_id FOR UPDATE;
  IF NOT FOUND OR o.empresa_id IS DISTINCT FROM NEW.empresa_id THEN RAISE EXCEPTION 'OC ajena a la empresa'; END IF;
  IF i.provider_id IS DISTINCT FROM o.provider_id OR i.currency IS DISTINCT FROM o.currency THEN
    RAISE EXCEPTION 'Proveedor y moneda deben coincidir con la OC';
  END IF;
  PERFORM private.require_invoice_identity(i.id);
  IF NOT private.invoice_document_matches_order(i.id,NEW.authorized_order_id) THEN
    RAISE EXCEPTION 'El producto o la referencia del original no coincide con la OC; requiere revisión documental explícita';
  END IF;
  RETURN NEW;
END;
$f$;
DROP TRIGGER zzz_r3_invoice_order_match_tenant ON public.invoice_order_matches;
CREATE TRIGGER zzz_r3_invoice_order_match_tenant BEFORE INSERT OR UPDATE ON public.invoice_order_matches
FOR EACH ROW EXECUTE FUNCTION private.guard_invoice_order_match_tenant();

CREATE FUNCTION private.guard_invoice_verified_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
  IF NEW.status IN ('MATCH','APROBADO_EXCEPCION','APTO_PARA_PAGO','PAGADO') THEN
    PERFORM private.require_invoice_identity(OLD.id);
    IF NEW.provider_id IS DISTINCT FROM OLD.provider_id OR NEW.attachment_id IS DISTINCT FROM OLD.attachment_id
      OR NEW.invoice_number IS DISTINCT FROM OLD.invoice_number OR NEW.currency IS DISTINCT FROM OLD.currency
      OR NEW.total IS DISTINCT FROM OLD.total THEN
      RAISE EXCEPTION 'La factura verificada no puede cambiar identidad ni importes durante autorización';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.invoice_order_matches m JOIN public.authorized_orders o ON o.id=m.authorized_order_id
      WHERE m.invoice_id=NEW.id AND m.empresa_id=NEW.empresa_id AND o.empresa_id=NEW.empresa_id
        AND o.provider_id=NEW.provider_id AND o.currency=NEW.currency
        AND private.invoice_document_matches_order(NEW.id,o.id)
    ) THEN RAISE EXCEPTION 'Factura sin OC válida para pago'; END IF;
  END IF;
  RETURN NEW;
END;
$f$;
REVOKE ALL ON FUNCTION private.guard_invoice_verified_status() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER zzzz_invoice_verified_status BEFORE UPDATE OF status,provider_id,attachment_id,invoice_number,currency,total
ON public.invoices FOR EACH ROW EXECUTE FUNCTION private.guard_invoice_verified_status();

CREATE FUNCTION private.guard_payment_invoice_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE i public.invoices; o public.payment_orders; target_op uuid; target_empresa uuid;
BEGIN
  IF TG_OP='UPDATE' AND (NEW.payment_order_id IS DISTINCT FROM OLD.payment_order_id
    OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id) THEN
    RAISE EXCEPTION 'Los vínculos de OP no pueden reasignarse; quite y vuelva a vincular antes de ejecutar';
  END IF;
  IF TG_OP='DELETE' THEN target_op:=OLD.payment_order_id;target_empresa:=OLD.empresa_id;
  ELSE target_op:=NEW.payment_order_id;target_empresa:=NEW.empresa_id; END IF;
  -- Same lock order as execution: OP first, then its invoice. Execution holds
  -- the OP lock through treasury posting; concurrent unlink waits and fails.
  SELECT * INTO o FROM public.payment_orders WHERE id=target_op FOR UPDATE;
  IF NOT FOUND OR o.empresa_id IS DISTINCT FROM target_empresa OR o.status<>'EMITIDA' THEN
    RAISE EXCEPTION 'Solo se modifican vínculos de una OP emitida de esta empresa';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  SELECT * INTO i FROM public.invoices WHERE id=NEW.invoice_id FOR UPDATE;
  IF NOT FOUND OR i.empresa_id IS DISTINCT FROM NEW.empresa_id OR i.status<>'APTO_PARA_PAGO'
    OR o.provider_id IS DISTINCT FROM i.provider_id THEN
    RAISE EXCEPTION 'Solo facturas verificadas aptas para pago del mismo proveedor y empresa';
  END IF;
  PERFORM private.require_invoice_identity(i.id);
  RETURN NEW;
END;
$f$;
REVOKE ALL ON FUNCTION private.guard_payment_invoice_identity() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER zzzz_payment_invoice_identity BEFORE INSERT OR UPDATE OR DELETE ON public.payment_order_invoices
FOR EACH ROW EXECUTE FUNCTION private.guard_payment_invoice_identity();
COMMIT;


-- FILE: C01-payment-execution-recheck.sql
-- PROPOSED ONLY. Re-check typed original identity for every locked invoice.
BEGIN;
CREATE OR REPLACE FUNCTION public.ejecutar_orden_pago_atomica(p_empresa_id uuid, p_op_id uuid, p_cuenta_id uuid DEFAULT NULL::uuid, p_created_by uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_op public.payment_orders;
  v_account_currency public.currency_code;
  v_invoice_currency public.currency_code;
  v_invoice_count integer;
  v_link_count integer;
  v_total numeric;
  v_locked_id uuid;
BEGIN
  IF auth.uid() IS NULL
     OR p_created_by IS DISTINCT FROM auth.uid()
     OR public.current_empresa_id() IS DISTINCT FROM p_empresa_id
     OR NOT public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]) THEN
    RAISE EXCEPTION 'Acceso denegado para ejecutar orden de pago';
  END IF;

  SELECT * INTO v_op FROM public.payment_orders po
  WHERE po.id = p_op_id AND po.empresa_id = p_empresa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orden de pago no encontrada'; END IF;
  IF v_op.status <> 'EMITIDA' THEN
    RAISE EXCEPTION 'La orden de pago ya fue ejecutada o anulada';
  END IF;

  FOR v_locked_id IN
    SELECT poi.invoice_id FROM public.payment_order_invoices poi
    WHERE poi.payment_order_id=p_op_id AND poi.empresa_id=p_empresa_id ORDER BY poi.invoice_id FOR UPDATE OF poi
  LOOP NULL; END LOOP;
  SELECT count(*) INTO v_link_count FROM public.payment_order_invoices poi
  WHERE poi.payment_order_id = p_op_id AND poi.empresa_id = p_empresa_id;
  IF v_link_count = 0 THEN RAISE EXCEPTION 'La orden de pago no tiene facturas vinculadas'; END IF;

  -- Stable lock ordering prevents invoice/payment races and deadlocks.
  FOR v_locked_id IN
    SELECT i.id
    FROM public.payment_order_invoices poi
    JOIN public.invoices i ON i.id = poi.invoice_id
    WHERE poi.payment_order_id = p_op_id AND poi.empresa_id = p_empresa_id
    ORDER BY i.id
    FOR UPDATE OF i
  LOOP
    PERFORM private.require_invoice_identity(v_locked_id);
  END LOOP;

  SELECT count(*), coalesce(sum(i.total), 0)
    INTO v_invoice_count, v_total
  FROM public.payment_order_invoices poi
  JOIN public.invoices i ON i.id = poi.invoice_id
  WHERE poi.payment_order_id = p_op_id AND poi.empresa_id = p_empresa_id
    AND i.empresa_id = p_empresa_id AND i.provider_id = v_op.provider_id
    AND i.status = 'APTO_PARA_PAGO';
  IF v_invoice_count <> v_link_count THEN
    RAISE EXCEPTION 'La OP contiene facturas ajenas, pagadas, anuladas o de otro proveedor';
  END IF;

  SELECT i.currency INTO v_invoice_currency
  FROM public.payment_order_invoices poi
  JOIN public.invoices i ON i.id = poi.invoice_id
  WHERE poi.payment_order_id = p_op_id AND poi.empresa_id = p_empresa_id
  ORDER BY i.id LIMIT 1;
  IF EXISTS (
    SELECT 1 FROM public.payment_order_invoices poi
    JOIN public.invoices i ON i.id = poi.invoice_id
    WHERE poi.payment_order_id = p_op_id AND poi.empresa_id = p_empresa_id
      AND i.currency IS DISTINCT FROM v_invoice_currency
  ) THEN
    RAISE EXCEPTION 'Una OP no puede agrupar facturas de monedas distintas';
  END IF;

  IF p_cuenta_id IS NOT NULL THEN
    SELECT c.moneda INTO v_account_currency
    FROM public.cuentas_financieras c
    WHERE c.id = p_cuenta_id AND c.empresa_id = p_empresa_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cuenta financiera no encontrada para la empresa'; END IF;
    IF EXISTS (
      SELECT 1 FROM public.payment_order_invoices poi
      JOIN public.invoices i ON i.id = poi.invoice_id
      WHERE poi.payment_order_id = p_op_id AND poi.empresa_id = p_empresa_id
        AND (i.empresa_id IS DISTINCT FROM p_empresa_id
          OR i.currency IS DISTINCT FROM v_account_currency)
    ) THEN
      RAISE EXCEPTION 'La moneda de la cuenta no coincide con todas las facturas de la OP';
    END IF;
  END IF;

  UPDATE public.payment_orders po
  SET status = 'EJECUTADA', executed_at = pg_catalog.now(), cuenta_id = p_cuenta_id
  WHERE po.id = p_op_id AND po.empresa_id = p_empresa_id AND po.status = 'EMITIDA';
  IF NOT FOUND THEN RAISE EXCEPTION 'La OP cambió de estado durante la ejecución'; END IF;

  UPDATE public.invoices i
  SET status = 'PAGADO', updated_at = pg_catalog.now()
  WHERE i.id IN (
    SELECT poi.invoice_id FROM public.payment_order_invoices poi
    WHERE poi.payment_order_id = p_op_id AND poi.empresa_id = p_empresa_id
  ) AND i.empresa_id = p_empresa_id;

  IF p_cuenta_id IS NOT NULL AND v_total > 0 THEN
    PERFORM public.registrar_movimiento_tesoreria(
      p_empresa_id := p_empresa_id,
      p_cuenta_id := p_cuenta_id,
      p_monto := -v_total,
      p_tipo := 'PAGO',
      p_fecha := CURRENT_DATE,
      p_motivo := 'Pago OP ' || v_op.code,
      p_payment_order_id := p_op_id,
      p_created_by := p_created_by,
      p_permitir_negativo := true
    );
  END IF;
END;
$function$
;
COMMIT;


-- FILE: V01-V02-collection-guard.sql
-- PROPOSED ONLY. Requires exact user authorization for kyiihlkncatojvlasoag.
-- Replaces only the collection function; preserves signature, auth, row lock,
-- account/currency validation, receipts, treasury, ownership and existing ACL.
-- Rejects positive NC/proforma/remission receipts and accounts for issued NC.
BEGIN;
CREATE OR REPLACE FUNCTION "public"."registrar_cobro_atomico"("p_empresa_id" "uuid", "p_sales_document_id" "uuid", "p_amount" numeric, "p_method" "text", "p_receipt_date" "date" DEFAULT CURRENT_DATE, "p_reference" "text" DEFAULT NULL::"text", "p_notes" "text" DEFAULT NULL::"text", "p_cuenta_id" "uuid" DEFAULT NULL::"uuid", "p_created_by" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_doc public.sales_documents;
  v_account_currency public.currency_code;
  v_receipt_id uuid;
  v_credit_total numeric;
BEGIN
  IF auth.uid() IS NULL
     OR p_created_by IS DISTINCT FROM auth.uid()
     OR public.current_empresa_id() IS DISTINCT FROM p_empresa_id
     OR NOT public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]) THEN
    RAISE EXCEPTION 'Acceso denegado para registrar cobro';
  END IF;
  SELECT * INTO v_doc FROM public.sales_documents d
  WHERE d.id = p_sales_document_id AND d.empresa_id = p_empresa_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Documento de venta no encontrado'; END IF;
  IF v_doc.status NOT IN ('EMITIDA','COBRADA_PARCIAL') THEN
    RAISE EXCEPTION 'Solo se registran cobros en documentos emitidos';
  END IF;
  IF v_doc.doc_type NOT IN ('FACTURA','NOTA_VENTA') THEN
    RAISE EXCEPTION 'Este tipo de documento no admite cobros positivos';
  END IF;
  IF v_doc.doc_type='NOTA_VENTA' AND EXISTS (
    SELECT 1 FROM public.sales_documents child
    WHERE child.source_document_id=v_doc.id AND child.empresa_id=v_doc.empresa_id
      AND child.client_id=v_doc.client_id AND child.currency=v_doc.currency
      AND child.doc_type='FACTURA' AND child.status IN ('EMITIDA','COBRADA_PARCIAL','COBRADA')
  ) THEN RAISE EXCEPTION 'La nota de venta ya fue facturada'; END IF;
  SELECT COALESCE(SUM(n.total),0) INTO v_credit_total
  FROM public.sales_documents n
  WHERE n.source_document_id=v_doc.id AND n.empresa_id=v_doc.empresa_id
    AND n.client_id=v_doc.client_id AND n.currency=v_doc.currency
    AND n.doc_type='NOTA_CREDITO' AND n.status IN ('EMITIDA','COBRADA_PARCIAL','COBRADA');
  IF p_amount IS NULL OR p_amount <= 0 OR p_amount - (v_doc.total - v_doc.cobrado_amount - v_credit_total) > 0.01 THEN
    RAISE EXCEPTION 'El monto de cobro es inválido o supera el saldo del documento';
  END IF;
  IF p_created_by IS NULL THEN RAISE EXCEPTION 'El actor del cobro es obligatorio'; END IF;

  IF p_cuenta_id IS NOT NULL THEN
    SELECT c.moneda INTO v_account_currency FROM public.cuentas_financieras c
    WHERE c.id = p_cuenta_id AND c.empresa_id = p_empresa_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Cuenta financiera no encontrada para la empresa'; END IF;
    IF v_account_currency IS DISTINCT FROM v_doc.currency THEN
      RAISE EXCEPTION 'La moneda de la cuenta no coincide con la del documento';
    END IF;
  END IF;

  INSERT INTO public.sales_receipts (
    empresa_id, sales_document_id, amount, receipt_date, method, reference,
    notes, cuenta_id, created_by
  ) VALUES (
    p_empresa_id, p_sales_document_id, p_amount, coalesce(p_receipt_date, CURRENT_DATE),
    p_method::public.receipt_method, p_reference, p_notes, p_cuenta_id, p_created_by
  ) RETURNING id INTO v_receipt_id;

  IF p_cuenta_id IS NOT NULL THEN
    PERFORM public.registrar_movimiento_tesoreria(
      p_empresa_id := p_empresa_id,
      p_cuenta_id := p_cuenta_id,
      p_monto := p_amount,
      p_tipo := 'COBRO',
      p_fecha := coalesce(p_receipt_date, CURRENT_DATE),
      p_motivo := 'Cobro comprobante ' || v_doc.code,
      p_sales_receipt_id := v_receipt_id,
      p_created_by := p_created_by,
      p_permitir_negativo := true
    );
  END IF;
  RETURN v_receipt_id;
END;
$$;


CREATE FUNCTION private.guard_sales_credit_financial_source()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE source_doc public.sales_documents; active_new boolean; active_old boolean; credit_sum numeric; source_id uuid;
BEGIN
  active_new := NEW.doc_type='NOTA_CREDITO' AND NEW.status IN ('EMITIDA','COBRADA_PARCIAL','COBRADA');
  active_old := TG_OP='UPDATE' AND OLD.doc_type='NOTA_CREDITO' AND OLD.status IN ('EMITIDA','COBRADA_PARCIAL','COBRADA');
  IF NOT active_new AND NOT active_old THEN RETURN NEW; END IF;
  IF active_old AND (NEW.doc_type IS DISTINCT FROM OLD.doc_type OR NEW.source_document_id IS DISTINCT FROM OLD.source_document_id
    OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.client_id IS DISTINCT FROM OLD.client_id OR NEW.currency IS DISTINCT FROM OLD.currency
    OR NEW.total IS DISTINCT FROM OLD.total OR NEW.status='BORRADOR') THEN
    RAISE EXCEPTION 'La identidad y el importe de una NC emitida son inmutables; anule y emita la corrección';
  END IF;
  source_id := CASE WHEN active_new THEN NEW.source_document_id ELSE OLD.source_document_id END;
  IF source_id IS NULL THEN
    IF NEW.total IS NULL OR NEW.total::text IN ('NaN','Infinity','-Infinity') OR NEW.total<=0 THEN
      RAISE EXCEPTION 'El importe de la NC debe ser positivo y finito';
    END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO source_doc FROM public.sales_documents WHERE id=source_id FOR UPDATE;
  IF NOT FOUND OR source_doc.doc_type<>'FACTURA' OR source_doc.status NOT IN ('EMITIDA','COBRADA_PARCIAL','COBRADA')
    OR source_doc.empresa_id IS DISTINCT FROM NEW.empresa_id OR source_doc.client_id IS DISTINCT FROM NEW.client_id
    OR source_doc.currency IS DISTINCT FROM NEW.currency THEN
    RAISE EXCEPTION 'La NC requiere una factura emitida del mismo cliente, empresa y moneda';
  END IF;
  IF active_new THEN
    SELECT COALESCE(SUM(n.total),0) INTO credit_sum FROM public.sales_documents n
    WHERE n.source_document_id=source_id AND n.id<>NEW.id AND n.doc_type='NOTA_CREDITO'
      AND n.empresa_id=NEW.empresa_id AND n.client_id=NEW.client_id AND n.currency=NEW.currency
      AND n.status IN ('EMITIDA','COBRADA_PARCIAL','COBRADA');
    IF NEW.total IS NULL OR NEW.total::text IN ('NaN','Infinity','-Infinity') OR NEW.total<=0 OR credit_sum+NEW.total>source_doc.total THEN
      RAISE EXCEPTION 'Las notas de crédito acumuladas superan el importe de la factura';
    END IF;
  END IF;
  RETURN NEW;
END;
$f$;
REVOKE ALL ON FUNCTION private.guard_sales_credit_financial_source() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER sales_credit_financial_source BEFORE INSERT OR UPDATE OF status,total,source_document_id,doc_type,currency,client_id,empresa_id
ON public.sales_documents FOR EACH ROW EXECUTE FUNCTION private.guard_sales_credit_financial_source();
COMMIT;


-- FILE: C03-bulk-due-date.sql
-- PROPOSED ONLY. No backfill and no application until exact authorization.
-- Adds nullable due_date to existing allowlist, parsing and atomic INSERT.
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
  v_due_date date;
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
    IF v_key NOT IN ('provider_id','invoice_number','invoice_date','due_date','currency',
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
  v_due_date := NULLIF(p_invoice->>'due_date','')::date;
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
    empresa_id,provider_id,invoice_number,invoice_date,due_date,currency,
    subtotal,vat,total,timbrado,attachment_id,created_by
  ) VALUES (
    p_empresa_id,v_provider_id,v_invoice_number,v_invoice_date,v_due_date,v_currency,
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


COMMIT;


-- FILE: V06-sales-item-tenant.sql
-- PROPOSED ONLY. Validate both parent and child company without backfill.
BEGIN;
CREATE FUNCTION private.guard_sales_item_tenant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE parent_empresa uuid;
BEGIN
 SELECT d.empresa_id INTO parent_empresa FROM public.sales_documents d WHERE d.id=NEW.sales_document_id FOR KEY SHARE;
 IF NOT FOUND OR parent_empresa IS DISTINCT FROM NEW.empresa_id THEN
   RAISE EXCEPTION 'El ítem y el documento de venta deben pertenecer a la misma empresa';
 END IF;
 RETURN NEW;
END;
$f$;
REVOKE ALL ON FUNCTION private.guard_sales_item_tenant() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER zzzz_sales_item_tenant BEFORE INSERT OR UPDATE ON public.sales_document_items
FOR EACH ROW EXECUTE FUNCTION private.guard_sales_item_tenant();
CREATE OR REPLACE FUNCTION "public"."recompute_sales_document"("p_doc" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_total numeric(14,2);
  v_neto numeric(14,2);
  v_vat numeric(14,2);
  v_cobrado numeric(14,2);
  v_status public.sales_doc_status;
BEGIN
  IF p_doc IS NULL THEN RETURN; END IF;
  PERFORM private.b11_require_financial_actor((SELECT empresa_id FROM public.sales_documents WHERE id=p_doc FOR UPDATE));

  SELECT
    coalesce(sum(i.line_total), 0),
    coalesce(sum(CASE WHEN i.vat_rate = 0 THEN i.line_total
      ELSE pg_catalog.round(i.line_total / (1 + i.vat_rate / 100.0), 2) END), 0),
    coalesce(sum(CASE WHEN i.vat_rate = 0 THEN 0
      ELSE i.line_total - pg_catalog.round(i.line_total / (1 + i.vat_rate / 100.0), 2) END), 0)
  INTO v_total, v_neto, v_vat
  FROM public.sales_document_items i
  WHERE i.sales_document_id = p_doc AND i.empresa_id=(SELECT empresa_id FROM public.sales_documents WHERE id=p_doc);

  SELECT coalesce(sum(r.amount), 0) INTO v_cobrado
  FROM public.sales_receipts r
  WHERE r.sales_document_id = p_doc AND r.reversed_at IS NULL AND r.empresa_id=(SELECT empresa_id FROM public.sales_documents WHERE id=p_doc);

  SELECT d.status INTO v_status FROM public.sales_documents d WHERE d.id = p_doc;

  UPDATE public.sales_documents d SET
    subtotal = v_neto,
    vat_amount = v_vat,
    total = v_total,
    cobrado_amount = v_cobrado,
    status = CASE
      WHEN v_status IN ('BORRADOR', 'ANULADA') THEN v_status
      WHEN v_cobrado <= 0 THEN 'EMITIDA'::public.sales_doc_status
      WHEN v_cobrado >= v_total THEN 'COBRADA'::public.sales_doc_status
      ELSE 'COBRADA_PARCIAL'::public.sales_doc_status
    END
  WHERE d.id = p_doc;
END;
$$;


COMMIT;
