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
