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
