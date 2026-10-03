-- RFQ 2.0: explicit intent, immutable supplier facts, human-only procurement.
-- Historical purpose remains NULL. No default, no inference, no production data rewrite.
ALTER TABLE public.rfqs ADD COLUMN purpose text CHECK (purpose IN ('COST_DISCOVERY','PROCUREMENT'));
ALTER TABLE public.rfq_providers ADD COLUMN token_expires_at timestamptz;
ALTER TABLE public.rfq_providers ADD COLUMN token_revoked_at timestamptz;
ALTER TABLE public.quote_versions ADD COLUMN valid_until timestamptz;
ALTER TABLE public.quote_versions ADD COLUMN freight numeric(14,2) CHECK (freight >= 0);
ALTER TABLE public.quote_version_items ADD COLUMN available_quantity numeric(14,4) CHECK (available_quantity >= 0);
ALTER TABLE public.quote_version_items ADD COLUMN lead_time_days integer CHECK (lead_time_days >= 0);
ALTER TABLE public.quote_version_items ADD COLUMN tax_rate numeric(8,4) CHECK (tax_rate BETWEEN 0 AND 100);
ALTER TABLE public.attachments ADD COLUMN original_sha256 text CHECK(original_sha256 ~ '^[a-f0-9]{64}$');
DO $$ BEGIN IF to_regclass('storage.buckets') IS NOT NULL THEN
 UPDATE storage.buckets SET allowed_mime_types=ARRAY['application/pdf','image/png','image/jpeg','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel','text/csv'],public=false WHERE id='quote-pdfs';
END IF; END $$;
CREATE POLICY rfq_2_quotes_read ON public.quotes FOR SELECT TO authenticated USING(empresa_id=(SELECT public.current_empresa_id()) AND public.is_internal_role(ARRAY['comercial','administracion','admin']::public.user_role[]));
CREATE POLICY rfq_2_versions_read ON public.quote_versions FOR SELECT TO authenticated USING(empresa_id=(SELECT public.current_empresa_id()) AND public.is_internal_role(ARRAY['comercial','administracion','admin']::public.user_role[]));

CREATE TABLE private.rfq_write_permits (
  transaction_id bigint NOT NULL, rfq_id uuid NOT NULL, kind text NOT NULL,
  PRIMARY KEY(transaction_id,rfq_id,kind)
);
REVOKE ALL ON private.rfq_write_permits FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE public.rfq_quote_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL REFERENCES public.empresas(id),
  quote_version_id uuid NOT NULL REFERENCES public.quote_versions(id),
  extraction jsonb NOT NULL, comparison jsonb NOT NULL, resolution text NOT NULL CHECK(length(trim(resolution)) >= 10),
  reviewed_by uuid NOT NULL REFERENCES public.profiles(id), reviewed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX rfq_quote_reviews_version_idx ON public.rfq_quote_reviews(quote_version_id);
ALTER TABLE public.rfq_quote_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY rfq_quote_reviews_read ON public.rfq_quote_reviews FOR SELECT TO authenticated
 USING (empresa_id = (SELECT public.current_empresa_id()));
REVOKE ALL ON public.rfq_quote_reviews FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.rfq_quote_reviews TO authenticated;

CREATE TABLE public.rfq_allocations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL REFERENCES public.empresas(id),
 rfq_id uuid NOT NULL REFERENCES public.rfqs(id), revision integer NOT NULL,
 lines jsonb NOT NULL CHECK(jsonb_typeof(lines)='array'), justification text NOT NULL CHECK(length(trim(justification))>=10),
 created_by uuid NOT NULL REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT now(),
 authorized_by uuid REFERENCES public.profiles(id), authorized_at timestamptz,
 preview jsonb, preview_hash text, confirmed_by uuid REFERENCES public.profiles(id), confirmed_at timestamptz,
 UNIQUE(rfq_id,revision), CHECK((authorized_by IS NULL)=(authorized_at IS NULL)),
 CHECK((confirmed_by IS NULL)=(confirmed_at IS NULL))
);
CREATE INDEX rfq_allocations_empresa_idx ON public.rfq_allocations(empresa_id,rfq_id);
ALTER TABLE public.rfq_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY rfq_allocations_read ON public.rfq_allocations FOR SELECT TO authenticated
 USING(empresa_id=(SELECT public.current_empresa_id()));
REVOKE ALL ON public.rfq_allocations FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.rfq_allocations TO authenticated;

ALTER TABLE public.authorized_orders ADD COLUMN rfq_allocation_id uuid REFERENCES public.rfq_allocations(id);
ALTER TABLE public.authorized_orders ADD COLUMN procurement_snapshot jsonb;
CREATE UNIQUE INDEX rfq_order_once ON public.authorized_orders(rfq_allocation_id,provider_id,currency)
 WHERE rfq_allocation_id IS NOT NULL;
ALTER TABLE public.authorized_order_items ADD COLUMN rfq_item_id uuid REFERENCES public.rfq_items(id);
ALTER TABLE public.authorized_order_items ADD COLUMN quote_version_item_id uuid REFERENCES public.quote_version_items(id);
ALTER TABLE public.authorized_order_items ADD COLUMN tax_rate numeric(8,4);
-- RFQ quantities have four decimals; persist the exact preview without rounding quantities.
ALTER TABLE public.authorized_orders ALTER COLUMN quantity TYPE numeric(18,4);
ALTER TABLE public.authorized_order_items ALTER COLUMN quantity TYPE numeric(18,4);

CREATE FUNCTION private.rfq_actor() RETURNS public.profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles;
BEGIN
 SELECT pr.* INTO p FROM public.profiles pr JOIN public.empresas e ON e.id=pr.empresa_id AND e.active
 WHERE pr.id=auth.uid() AND pr.active AND pr.role IN ('comercial','administracion','admin');
 IF NOT FOUND THEN RAISE EXCEPTION 'Acceso RFQ denegado' USING ERRCODE='42501'; END IF;
 RETURN p;
END $$;
REVOKE ALL ON FUNCTION private.rfq_actor() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.rfq_audit(e uuid,r uuid,a uuid,event text,detail jsonb) RETURNS void
 LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 INSERT INTO public.audit_logs(empresa_id,rfq_id,actor_id,actor_type,action,detail)
 VALUES(e,r,a,CASE WHEN a IS NULL THEN 'provider' ELSE 'internal' END,event,detail);
$$;
REVOKE ALL ON FUNCTION private.rfq_audit(uuid,uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.rfq_header_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' AND NEW.purpose IS NULL THEN RAISE EXCEPTION 'purpose explícito obligatorio'; END IF;
 IF TG_OP='UPDATE' AND (NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR
  (NEW.purpose IS DISTINCT FROM OLD.purpose AND OLD.purpose IS NOT NULL)) THEN
  RAISE EXCEPTION 'No se puede cambiar empresa o propósito existente'; END IF;
 IF NEW.project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.projects p WHERE p.id=NEW.project_id AND p.empresa_id=NEW.empresa_id) THEN
  RAISE EXCEPTION 'Proyecto de otra empresa'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=NEW.created_by AND p.empresa_id=NEW.empresa_id AND p.active) THEN
  RAISE EXCEPTION 'Creador inválido'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zz_rfq_2_header_guard BEFORE INSERT OR UPDATE ON public.rfqs FOR EACH ROW EXECUTE FUNCTION private.rfq_header_guard();

CREATE FUNCTION public.rfq_create(p_header jsonb,p_items jsonb,p_provider_ids uuid[] DEFAULT '{}') RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles:=private.rfq_actor(); r public.rfqs; item jsonb; vendor uuid; idx integer:=0;
BEGIN
 IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Ítems inválidos'; END IF;
 IF p_header->>'purpose' IS NULL OR p_header->>'purpose' NOT IN ('COST_DISCOVERY','PROCUREMENT') THEN RAISE EXCEPTION 'Elegí purpose'; END IF;
 INSERT INTO public.rfqs(empresa_id,created_by,purpose,quote_type,product,quantity,unit,project_id,specifications,required_date,internal_reference,observations,expires_at)
 VALUES(p.empresa_id,p.id,p_header->>'purpose',coalesce(p_header->>'quote_type','RFQ'),p_header->>'product',1,'lote',
 nullif(p_header->>'project_id','')::uuid,p_header->>'specifications',nullif(p_header->>'required_date','')::date,
 p_header->>'internal_reference',p_header->>'observations',coalesce(nullif(p_header->>'expires_at','')::timestamptz,now()+interval '72 hours')) RETURNING * INTO r;
 FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  IF nullif(trim(item->>'descripcion'),'') IS NULL OR nullif(trim(item->>'unidad'),'') IS NULL
   OR (item->>'cantidad')::numeric IS NULL OR (item->>'cantidad')::numeric NOT BETWEEN 0.0001 AND 9999999999 THEN RAISE EXCEPTION 'Línea inválida'; END IF;
  IF nullif(item->>'producto_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.productos x
   WHERE x.id=(item->>'producto_id')::uuid AND x.empresa_id=p.empresa_id AND x.activo AND trim(x.unidad)=trim(item->>'unidad')) THEN RAISE EXCEPTION 'Producto/unidad de otra empresa o inactivo'; END IF;
  INSERT INTO public.rfq_items(empresa_id,rfq_id,producto_id,descripcion,cantidad,unidad,sort_order)
  VALUES(p.empresa_id,r.id,nullif(item->>'producto_id','')::uuid,trim(item->>'descripcion'),(item->>'cantidad')::numeric,trim(item->>'unidad'),idx);
  idx:=idx+1;
 END LOOP;
 FOREACH vendor IN ARRAY p_provider_ids LOOP
  IF NOT EXISTS(SELECT 1 FROM public.providers v WHERE v.id=vendor AND v.empresa_id=p.empresa_id AND v.active) THEN RAISE EXCEPTION 'Proveedor ajeno/inactivo'; END IF;
  INSERT INTO public.rfq_providers(empresa_id,rfq_id,provider_id,token_expires_at) VALUES(p.empresa_id,r.id,vendor,r.expires_at) ON CONFLICT(rfq_id,provider_id) DO NOTHING;
 END LOOP;
 IF cardinality(p_provider_ids)>0 THEN UPDATE public.rfqs SET status='COTIZANDO' WHERE id=r.id; END IF;
 PERFORM private.rfq_audit(p.empresa_id,r.id,p.id,'rfq.created',jsonb_build_object('purpose',r.purpose,'items',idx));
 RETURN jsonb_build_object('id',r.id,'code',r.code);
END $$;
REVOKE ALL ON FUNCTION public.rfq_create(jsonb,jsonb,uuid[]) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.rfq_create(jsonb,jsonb,uuid[]) TO authenticated;

CREATE FUNCTION public.rfq_invite(p_rfq_id uuid,p_provider_ids uuid[]) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles:=private.rfq_actor(); r public.rfqs; vendor uuid;
BEGIN
 SELECT * INTO r FROM public.rfqs WHERE id=p_rfq_id AND empresa_id=p.empresa_id FOR UPDATE;
 IF NOT FOUND OR r.status NOT IN ('BORRADOR','COTIZANDO','OFERTAS_RECIBIDAS') OR r.expires_at<=now() THEN RAISE EXCEPTION 'RFQ no abierta'; END IF;
 FOREACH vendor IN ARRAY p_provider_ids LOOP
  IF NOT EXISTS(SELECT 1 FROM public.providers WHERE id=vendor AND empresa_id=p.empresa_id AND active) THEN RAISE EXCEPTION 'Proveedor ajeno/inactivo'; END IF;
  INSERT INTO public.rfq_providers(empresa_id,rfq_id,provider_id,token_expires_at) VALUES(p.empresa_id,r.id,vendor,r.expires_at) ON CONFLICT(rfq_id,provider_id) DO NOTHING;
 END LOOP;
 IF r.status='BORRADOR' THEN UPDATE public.rfqs SET status='COTIZANDO' WHERE id=r.id; END IF;
 PERFORM private.rfq_audit(p.empresa_id,r.id,p.id,'rfq.invited',jsonb_build_object('provider_ids',p_provider_ids));
END $$;
REVOKE ALL ON FUNCTION public.rfq_invite(uuid,uuid[]) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.rfq_invite(uuid,uuid[]) TO authenticated;

-- Supplier facts are immutable. Only the atomic submission RPC may append them.
CREATE FUNCTION private.rfq_quote_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Oferta inmutable: crear nueva versión'; END IF;
 IF TG_TABLE_NAME='quote_versions' THEN
  SELECT rp.rfq_id INTO r FROM public.quotes q JOIN public.rfq_providers rp ON rp.id=q.rfq_provider_id WHERE q.id=NEW.quote_id;
 ELSE
  SELECT rp.rfq_id INTO r FROM public.quote_versions v JOIN public.quotes q ON q.id=v.quote_id JOIN public.rfq_providers rp ON rp.id=q.rfq_provider_id WHERE v.id=NEW.quote_version_id;
 END IF;
 IF NOT EXISTS(SELECT 1 FROM private.rfq_write_permits WHERE transaction_id=txid_current() AND rfq_id=r AND kind='quote') THEN RAISE EXCEPTION 'Usar envío atómico de versión'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER rfq_2_quote_immutable BEFORE INSERT OR UPDATE OR DELETE ON public.quote_versions FOR EACH ROW EXECUTE FUNCTION private.rfq_quote_guard();
CREATE TRIGGER rfq_2_quote_item_immutable BEFORE INSERT OR UPDATE OR DELETE ON public.quote_version_items FOR EACH ROW EXECUTE FUNCTION private.rfq_quote_guard();
CREATE FUNCTION private.rfq_document_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.quote_versions WHERE pdf_attachment_id=OLD.id) THEN RAISE EXCEPTION 'Documento original de cotización inmutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER rfq_2_document_immutable BEFORE UPDATE OR DELETE ON public.attachments FOR EACH ROW EXECUTE FUNCTION private.rfq_document_guard();
REVOKE ALL ON FUNCTION private.rfq_document_guard() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.rfq_submit_version(p_token text,p_offer jsonb,p_items jsonb,p_attachment_id uuid,p_actor_id uuid DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE rp public.rfq_providers; r public.rfqs; q uuid; v uuid; version integer; item jsonb; ri public.rfq_items;
 total numeric:=0; price numeric; available numeric; rate numeric; lead integer; until_at timestamptz;
BEGIN
 -- service_role only; internal caller supplies a verified active profile, provider caller supplies only its token.
 SELECT * INTO rp FROM public.rfq_providers WHERE token=p_token;
 IF NOT FOUND THEN RAISE EXCEPTION 'Link inválido'; END IF;
 SELECT * INTO r FROM public.rfqs WHERE id=rp.rfq_id AND empresa_id=rp.empresa_id FOR UPDATE;
 IF NOT FOUND OR rp.token_revoked_at IS NOT NULL OR coalesce(rp.token_expires_at,r.expires_at)<=now()
  OR r.expires_at<=now() OR r.status NOT IN ('BORRADOR','COTIZANDO','OFERTAS_RECIBIDAS') THEN RAISE EXCEPTION 'Link vencido/revocado o RFQ cerrada'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.providers WHERE id=rp.provider_id AND empresa_id=r.empresa_id AND active) THEN RAISE EXCEPTION 'Proveedor inválido'; END IF;
 IF p_actor_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=p_actor_id AND empresa_id=r.empresa_id AND active AND role IN ('comercial','administracion','admin')) THEN RAISE EXCEPTION 'Actor inválido'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.attachments WHERE id=p_attachment_id AND empresa_id=r.empresa_id AND rfq_provider_id=rp.id AND bucket='quote-pdfs') THEN RAISE EXCEPTION 'Documento original obligatorio de este proveedor'; END IF;
 until_at:=(p_offer->>'valid_until')::timestamptz;
 IF until_at IS NULL OR until_at<=now() OR (p_offer->>'freight')::numeric IS NULL OR (p_offer->>'freight')::numeric NOT BETWEEN 0 AND 9999999999
 OR nullif(trim(p_offer->>'payment_terms'),'') IS NULL OR nullif(trim(p_offer->>'budget_number'),'') IS NULL THEN RAISE EXCEPTION 'Validez, flete y condiciones obligatorios'; END IF;
 IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items)=0 OR jsonb_array_length(p_items)>500 THEN RAISE EXCEPTION 'Oferta estructurada obligatoria'; END IF;
 IF (SELECT count(DISTINCT value->>'rfq_item_id') FROM jsonb_array_elements(p_items))<>jsonb_array_length(p_items) THEN RAISE EXCEPTION 'Ítem repetido'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  SELECT * INTO ri FROM public.rfq_items WHERE id=(item->>'rfq_item_id')::uuid AND rfq_id=r.id AND empresa_id=r.empresa_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ítem ajeno a RFQ/empresa'; END IF;
  price:=(item->>'precio_unitario')::numeric; available:=(item->>'available_quantity')::numeric;
  rate:=(item->>'tax_rate')::numeric; lead:=(item->>'lead_time_days')::integer;
  IF available IS NULL OR available NOT BETWEEN 0 AND 9999999999 OR rate IS NULL OR rate NOT BETWEEN 0 AND 100 OR lead IS NULL OR lead NOT BETWEEN 0 AND 3650
  OR available<>round(available,4) OR rate<>round(rate,4) OR (price IS NOT NULL AND (price NOT BETWEEN 0.0001 AND 9999999999 OR price<>round(price,4))) OR (available>0 AND price IS NULL) THEN RAISE EXCEPTION 'Precio/disponibilidad/impuesto/plazo inválidos'; END IF;
  total:=total+coalesce(price,0)*least(available,ri.cantidad)*(CASE WHEN (p_offer->>'vat_included')::boolean THEN 1 ELSE 1+rate/100 END);
 END LOOP;
 total:=round(total+(p_offer->>'freight')::numeric,2);
 IF total<=0 THEN RAISE EXCEPTION 'Oferta sin importe positivo'; END IF;
 INSERT INTO private.rfq_write_permits VALUES(txid_current(),r.id,'quote') ON CONFLICT DO NOTHING;
 SELECT id INTO q FROM public.quotes WHERE rfq_provider_id=rp.id AND empresa_id=r.empresa_id;
 IF q IS NULL THEN INSERT INTO public.quotes(empresa_id,rfq_provider_id) VALUES(r.empresa_id,rp.id) RETURNING id INTO q; END IF;
 SELECT coalesce(max(version_number),0)+1 INTO version FROM public.quote_versions WHERE quote_id=q;
 INSERT INTO public.quote_versions(empresa_id,quote_id,version_number,budget_number,unit_price,total_price,currency,invoice_available,vat_included,delivery_time,offer_validity,payment_terms,observations,pdf_attachment_id,valid_until,freight)
 VALUES(r.empresa_id,q,version,p_offer->>'budget_number',total,total,(p_offer->>'currency')::public.currency_code,
 (p_offer->>'invoice_available')::boolean,(p_offer->>'vat_included')::boolean,coalesce(p_offer->>'delivery_time','Por línea'),until_at::text,
 p_offer->>'payment_terms',p_offer->>'observations',p_attachment_id,until_at,(p_offer->>'freight')::numeric) RETURNING id INTO v;
 FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  INSERT INTO public.quote_version_items(empresa_id,quote_version_id,rfq_item_id,precio_unitario,available_quantity,tax_rate,lead_time_days,observaciones,cargado_por)
  VALUES(r.empresa_id,v,(item->>'rfq_item_id')::uuid,(item->>'precio_unitario')::numeric,(item->>'available_quantity')::numeric,(item->>'tax_rate')::numeric,(item->>'lead_time_days')::integer,item->>'observaciones',CASE WHEN p_actor_id IS NULL THEN 'PROVEEDOR' ELSE 'INTERNO' END);
 END LOOP;
 UPDATE public.rfq_providers SET status='RESPONDIDO',responded_at=now() WHERE id=rp.id;
 UPDATE public.rfqs SET status='OFERTAS_RECIBIDAS' WHERE id=r.id;
 PERFORM private.rfq_audit(r.empresa_id,r.id,p_actor_id,'rfq.quote.version_submitted',jsonb_build_object('version_id',v,'version_number',version,'rfq_provider_id',rp.id,'attachment_id',p_attachment_id));
 DELETE FROM private.rfq_write_permits WHERE transaction_id=txid_current() AND rfq_id=r.id AND kind='quote';
 RETURN jsonb_build_object('versionId',v,'versionNumber',version,'totalPrice',total);
END $$;
REVOKE ALL ON FUNCTION public.rfq_submit_version(text,jsonb,jsonb,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rfq_submit_version(text,jsonb,jsonb,uuid,uuid) TO service_role;

CREATE FUNCTION public.rfq_review_quote(p_version_id uuid,p_extraction jsonb,p_comparison jsonb,p_resolution text) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles:=private.rfq_actor(); r uuid; review uuid;
BEGIN
 SELECT rp.rfq_id INTO r FROM public.quote_versions v JOIN public.quotes q ON q.id=v.quote_id JOIN public.rfq_providers rp ON rp.id=q.rfq_provider_id
 WHERE v.id=p_version_id AND v.empresa_id=p.empresa_id AND q.empresa_id=p.empresa_id AND rp.empresa_id=p.empresa_id;
 IF r IS NULL THEN RAISE EXCEPTION 'Versión ajena'; END IF;
 PERFORM 1 FROM public.rfqs WHERE id=r FOR UPDATE;
 INSERT INTO public.rfq_quote_reviews(empresa_id,quote_version_id,extraction,comparison,resolution,reviewed_by)
 VALUES(p.empresa_id,p_version_id,p_extraction,p_comparison,p_resolution,p.id) RETURNING id INTO review;
 PERFORM private.rfq_audit(p.empresa_id,r,p.id,'rfq.quote.reviewed',jsonb_build_object('review_id',review,'version_id',p_version_id,'resolution',p_resolution));
 RETURN review;
END $$;
REVOKE ALL ON FUNCTION public.rfq_review_quote(uuid,jsonb,jsonb,text) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.rfq_review_quote(uuid,jsonb,jsonb,text) TO authenticated;

-- Resolve every price, quantity limit, supplier and term from DB, never client values.
CREATE FUNCTION private.rfq_resolve_allocation(r public.rfqs,lines jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE line jsonb; fact record; result jsonb:='[]'; quantity numeric;
BEGIN
 IF r.purpose IS DISTINCT FROM 'PROCUREMENT' OR r.status NOT IN ('OFERTAS_RECIBIDAS','COTIZANDO') THEN RAISE EXCEPTION 'RFQ no habilitada para compra'; END IF;
 IF lines IS NULL OR jsonb_typeof(lines)<>'array' OR jsonb_array_length(lines) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Asignación vacía/inválida'; END IF;
 IF (SELECT count(DISTINCT value->>'quote_version_item_id') FROM jsonb_array_elements(lines))<>jsonb_array_length(lines) THEN RAISE EXCEPTION 'Línea duplicada'; END IF;
 FOR line IN SELECT value FROM jsonb_array_elements(lines) LOOP
  quantity:=(line->>'quantity')::numeric;
  SELECT vi.id AS quote_version_item_id,vi.rfq_item_id,vi.precio_unitario AS unit_price,vi.available_quantity,vi.tax_rate,vi.lead_time_days,
   i.descripcion AS product,i.producto_id,i.unidad AS unit,i.cantidad AS requested_quantity,
   v.id AS quote_version_id,v.version_number,v.currency,v.vat_included,v.freight,v.payment_terms,v.valid_until,v.pdf_attachment_id,
   rp.id AS rfq_provider_id,rp.provider_id,provider.name AS provider_name,
   (SELECT x.id FROM public.rfq_quote_reviews x WHERE x.quote_version_id=v.id AND x.empresa_id=r.empresa_id ORDER BY x.reviewed_at DESC,x.id LIMIT 1) AS review_id
   INTO fact FROM public.quote_version_items vi
   JOIN public.rfq_items i ON i.id=vi.rfq_item_id AND i.rfq_id=r.id AND i.empresa_id=r.empresa_id
   JOIN public.quote_versions v ON v.id=vi.quote_version_id AND v.empresa_id=r.empresa_id
   JOIN public.quotes q ON q.id=v.quote_id AND q.empresa_id=r.empresa_id
   JOIN public.rfq_providers rp ON rp.id=q.rfq_provider_id AND rp.rfq_id=r.id AND rp.empresa_id=r.empresa_id
   JOIN public.providers provider ON provider.id=rp.provider_id AND provider.empresa_id=r.empresa_id AND provider.active
   WHERE vi.id=(line->>'quote_version_item_id')::uuid AND vi.empresa_id=r.empresa_id AND rp.token_revoked_at IS NULL
   AND v.version_number=(SELECT max(version_number) FROM public.quote_versions WHERE quote_id=q.id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Cotización no pertenece a RFQ/empresa o versión obsoleta'; END IF;
  IF quantity IS NULL OR quantity NOT BETWEEN 0.0001 AND 9999999999 OR quantity<>round(quantity,4)
   OR fact.unit_price IS NULL OR fact.unit_price<=0 OR quantity>fact.available_quantity OR fact.valid_until IS NULL OR fact.valid_until<=now()
   OR fact.tax_rate IS NULL OR fact.freight IS NULL OR fact.lead_time_days IS NULL OR fact.review_id IS NULL THEN RAISE EXCEPTION 'Oferta incompleta, vencida, sin revisión o disponibilidad insuficiente'; END IF;
  result:=result||jsonb_build_array(to_jsonb(fact)||jsonb_build_object('quantity',quantity,'net',round(quantity*fact.unit_price,2),
   'tax',CASE WHEN fact.vat_included THEN round(quantity*fact.unit_price*fact.tax_rate/(100+fact.tax_rate),2) ELSE round(quantity*fact.unit_price*fact.tax_rate/100,2) END,
   'total',round(quantity*fact.unit_price*(CASE WHEN fact.vat_included THEN 1 ELSE 1+fact.tax_rate/100 END),2),
   'expected_delivery_date',current_date+fact.lead_time_days));
 END LOOP;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(result) l GROUP BY l->>'rfq_item_id'
  HAVING sum((l->>'quantity')::numeric)>max((l->>'requested_quantity')::numeric)) THEN RAISE EXCEPTION 'Sobreasignación'; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION private.rfq_resolve_allocation(public.rfqs,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.rfq_save_allocation(p_rfq_id uuid,p_lines jsonb,p_justification text,p_expected_revision integer) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles:=private.rfq_actor(); r public.rfqs; revision integer; resolved jsonb; a uuid;
BEGIN
 SELECT * INTO r FROM public.rfqs WHERE id=p_rfq_id AND empresa_id=p.empresa_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'RFQ ajena'; END IF;
 SELECT coalesce(max(x.revision),0) INTO revision FROM public.rfq_allocations x WHERE rfq_id=r.id;
 IF revision IS DISTINCT FROM p_expected_revision THEN RAISE EXCEPTION 'Asignación cambió, recargá'; END IF;
 resolved:=private.rfq_resolve_allocation(r,p_lines);
 INSERT INTO public.rfq_allocations(empresa_id,rfq_id,revision,lines,justification,created_by)
 VALUES(p.empresa_id,r.id,revision+1,resolved,p_justification,p.id) RETURNING id INTO a;
 PERFORM private.rfq_audit(p.empresa_id,r.id,p.id,'rfq.allocation.saved',jsonb_build_object('allocation_id',a,'revision',revision+1,'justification',p_justification));
 RETURN jsonb_build_object('id',a,'revision',revision+1,'lines',resolved);
END $$;
REVOKE ALL ON FUNCTION public.rfq_save_allocation(uuid,jsonb,text,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.rfq_save_allocation(uuid,jsonb,text,integer) TO authenticated;

CREATE FUNCTION public.rfq_authorize_allocation(p_allocation_id uuid,p_confirm boolean) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles:=private.rfq_actor(); r public.rfqs; a public.rfq_allocations; resolved jsonb;
BEGIN
 IF p_confirm IS DISTINCT FROM true THEN RAISE EXCEPTION 'Autorización humana explícita requerida'; END IF;
 SELECT * INTO a FROM public.rfq_allocations WHERE id=p_allocation_id AND empresa_id=p.empresa_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Asignación ajena'; END IF;
 SELECT * INTO r FROM public.rfqs WHERE id=a.rfq_id AND empresa_id=p.empresa_id FOR UPDATE;
 IF a.revision<>(SELECT max(revision) FROM public.rfq_allocations WHERE rfq_id=r.id) THEN RAISE EXCEPTION 'Asignación obsoleta'; END IF;
 resolved:=private.rfq_resolve_allocation(r,a.lines);
 IF resolved IS DISTINCT FROM a.lines THEN RAISE EXCEPTION 'Datos cambiaron: guardar nueva asignación'; END IF;
 IF a.authorized_at IS NULL THEN
  UPDATE public.rfq_allocations SET authorized_by=p.id,authorized_at=now() WHERE id=a.id;
  PERFORM private.rfq_audit(p.empresa_id,r.id,p.id,'rfq.allocation.authorized',jsonb_build_object('allocation_id',a.id));
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.rfq_authorize_allocation(uuid,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.rfq_authorize_allocation(uuid,boolean) TO authenticated;

CREATE FUNCTION public.rfq_preview_orders(p_allocation_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles:=private.rfq_actor(); r public.rfqs; a public.rfq_allocations; resolved jsonb; orders jsonb; hash text;
BEGIN
 SELECT * INTO a FROM public.rfq_allocations WHERE id=p_allocation_id AND empresa_id=p.empresa_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Asignación ajena'; END IF;
 SELECT * INTO r FROM public.rfqs WHERE id=a.rfq_id AND empresa_id=p.empresa_id FOR UPDATE;
 IF a.authorized_at IS NULL OR a.confirmed_at IS NOT NULL OR a.revision<>(SELECT max(revision) FROM public.rfq_allocations WHERE rfq_id=r.id) THEN RAISE EXCEPTION 'Asignación no autorizada/vigente'; END IF;
 resolved:=private.rfq_resolve_allocation(r,a.lines);
 IF resolved IS DISTINCT FROM a.lines THEN RAISE EXCEPTION 'Oferta cambió'; END IF;
 SELECT jsonb_agg(x.doc ORDER BY x.doc->>'provider_id',x.doc->>'currency') INTO orders FROM (
 SELECT jsonb_build_object('provider_id',l->>'provider_id','provider_name',max(l->>'provider_name'),'currency',l->>'currency',
  'quote_version_id',max(l->>'quote_version_id'),'vat_included',bool_and((l->>'vat_included')::boolean),
  'freight',max((l->>'freight')::numeric),'payment_terms',max(l->>'payment_terms'),'valid_until',min(l->>'valid_until'),
  'rfq_id',r.id,'allocation_id',a.id,'project_id',r.project_id,'items',jsonb_agg(l ORDER BY l->>'rfq_item_id',l->>'quote_version_item_id'),
  'line_total',sum((l->>'total')::numeric),'tax_total',sum((l->>'tax')::numeric),
  'total',sum((l->>'total')::numeric)+max((l->>'freight')::numeric)) AS doc
 FROM jsonb_array_elements(resolved) l GROUP BY l->>'provider_id',l->>'currency') x;
 hash:=md5(orders::text);
 UPDATE public.rfq_allocations SET preview=orders,preview_hash=hash WHERE id=a.id;
 PERFORM private.rfq_audit(p.empresa_id,r.id,p.id,'rfq.orders.previewed',jsonb_build_object('allocation_id',a.id,'hash',hash));
 RETURN jsonb_build_object('allocationId',a.id,'hash',hash,'orders',orders);
END $$;
REVOKE ALL ON FUNCTION public.rfq_preview_orders(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.rfq_preview_orders(uuid) TO authenticated;

CREATE FUNCTION private.rfq_order_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.rfq_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM private.rfq_write_permits WHERE transaction_id=txid_current() AND rfq_id=NEW.rfq_id AND kind='order') THEN
 RAISE EXCEPTION 'OC RFQ requiere confirmación de preview'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER rfq_2_order_guard BEFORE INSERT ON public.authorized_orders FOR EACH ROW EXECUTE FUNCTION private.rfq_order_guard();

CREATE FUNCTION public.rfq_confirm_orders(p_allocation_id uuid,p_preview_hash text,p_confirm boolean) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles:=private.rfq_actor(); r public.rfqs; a public.rfq_allocations; fresh jsonb; doc jsonb; item jsonb;
 order_id uuid; ids jsonb:='[]'; first_item jsonb; idx integer;
BEGIN
 IF p_confirm IS DISTINCT FROM true THEN RAISE EXCEPTION 'Confirmación humana explícita requerida'; END IF;
 SELECT * INTO a FROM public.rfq_allocations WHERE id=p_allocation_id AND empresa_id=p.empresa_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Asignación ajena'; END IF;
 SELECT * INTO r FROM public.rfqs WHERE id=a.rfq_id AND empresa_id=p.empresa_id FOR UPDATE;
 SELECT * INTO a FROM public.rfq_allocations WHERE id=p_allocation_id;
 IF a.preview_hash IS NULL OR a.preview_hash IS DISTINCT FROM p_preview_hash OR a.authorized_at IS NULL THEN RAISE EXCEPTION 'Preview inválido'; END IF;
 IF a.confirmed_at IS NOT NULL THEN
  SELECT jsonb_agg(id ORDER BY id) INTO ids FROM public.authorized_orders WHERE rfq_allocation_id=a.id;
  RETURN jsonb_build_object('orderIds',ids,'alreadyConfirmed',true);
 END IF;
 IF a.revision<>(SELECT max(revision) FROM public.rfq_allocations WHERE rfq_id=r.id) THEN RAISE EXCEPTION 'Asignación obsoleta'; END IF;
 fresh:=public.rfq_preview_orders(a.id);
 IF fresh->>'hash' IS DISTINCT FROM p_preview_hash THEN RAISE EXCEPTION 'Preview cambió'; END IF;
 INSERT INTO private.rfq_write_permits VALUES(txid_current(),r.id,'order') ON CONFLICT DO NOTHING;
 FOR doc IN SELECT value FROM jsonb_array_elements(a.preview) LOOP
  first_item:=doc->'items'->0;
  INSERT INTO public.authorized_orders(empresa_id,rfq_id,provider_id,quote_version_id,created_from,provider_name,client_name,product,quantity,unit,unit_price,total_price,currency,vat_included,authorized_by,is_cheapest,selection_reason,selection_reason_detail,project_id,rfq_allocation_id,procurement_snapshot)
  VALUES(p.empresa_id,r.id,(doc->>'provider_id')::uuid,(doc->>'quote_version_id')::uuid,'rfq',doc->>'provider_name',r.client_name,
   first_item->>'product',(first_item->>'quantity')::numeric,first_item->>'unit',(first_item->>'unit_price')::numeric,(doc->>'total')::numeric,
   (doc->>'currency')::public.currency_code,(doc->>'vat_included')::boolean,a.authorized_by,false,'OTRO',a.justification,r.project_id,a.id,doc) RETURNING id INTO order_id;
  idx:=0;
  FOR item IN SELECT value FROM jsonb_array_elements(doc->'items') LOOP
   INSERT INTO public.authorized_order_items(empresa_id,order_id,product,quantity,unit,unit_price,total_price,producto_id,sort_order,rfq_item_id,quote_version_item_id,tax_rate,expected_delivery_date)
   VALUES(p.empresa_id,order_id,item->>'product',(item->>'quantity')::numeric,item->>'unit',(item->>'unit_price')::numeric,(item->>'total')::numeric,
    nullif(item->>'producto_id','')::uuid,idx,(item->>'rfq_item_id')::uuid,(item->>'quote_version_item_id')::uuid,(item->>'tax_rate')::numeric,
    (item->>'expected_delivery_date')::date);
   idx:=idx+1;
  END LOOP;
  ids:=ids||jsonb_build_array(order_id);
 END LOOP;
 UPDATE public.rfq_allocations SET confirmed_by=p.id,confirmed_at=now() WHERE id=a.id;
 UPDATE public.rfqs SET status='AUTORIZADO' WHERE id=r.id;
 PERFORM private.rfq_audit(p.empresa_id,r.id,p.id,'rfq.orders.confirmed',jsonb_build_object('allocation_id',a.id,'preview_hash',p_preview_hash,'order_ids',ids));
 DELETE FROM private.rfq_write_permits WHERE transaction_id=txid_current() AND rfq_id=r.id AND kind='order';
 RETURN jsonb_build_object('orderIds',ids,'alreadyConfirmed',false);
END $$;
REVOKE ALL ON FUNCTION public.rfq_confirm_orders(uuid,text,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.rfq_confirm_orders(uuid,text,boolean) TO authenticated;

-- Retire the previous selection -> OC shortcut, including direct REST callers.
CREATE OR REPLACE FUNCTION public.select_and_authorize_offer_atomically(p_empresa_id uuid,p_actor_id uuid,p_rfq_id uuid,p_rfq_provider_id uuid,p_quote_version_id uuid,p_selection_reason public.selection_reason DEFAULT NULL,p_selection_reason_detail text DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'RFQ 2.0: usar asignación, autorización, preview y confirmación humana'; END $$;

CREATE FUNCTION public.rfq_revoke_link(p_rfq_id uuid,p_rfq_provider_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles:=private.rfq_actor();
BEGIN
 PERFORM 1 FROM public.rfqs WHERE id=p_rfq_id AND empresa_id=p.empresa_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'RFQ ajena'; END IF;
 UPDATE public.rfq_providers SET token_revoked_at=now() WHERE id=p_rfq_provider_id AND rfq_id=p_rfq_id AND empresa_id=p.empresa_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invitación ajena'; END IF;
 PERFORM private.rfq_audit(p.empresa_id,p_rfq_id,p.id,'rfq.link.revoked',jsonb_build_object('invitation_id',p_rfq_provider_id));
END $$;
REVOKE ALL ON FUNCTION public.rfq_revoke_link(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.rfq_revoke_link(uuid,uuid) TO authenticated;
CREATE FUNCTION public.rfq_renew_link(p_rfq_id uuid,p_rfq_provider_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles:=private.rfq_actor(); r public.rfqs;
BEGIN
 SELECT * INTO r FROM public.rfqs WHERE id=p_rfq_id AND empresa_id=p.empresa_id FOR UPDATE;
 IF NOT FOUND OR r.status NOT IN ('BORRADOR','COTIZANDO','OFERTAS_RECIBIDAS') OR r.expires_at<=now() THEN RAISE EXCEPTION 'RFQ no abierta'; END IF;
 UPDATE public.rfq_providers SET token=encode(extensions.gen_random_bytes(32),'hex'),token_expires_at=r.expires_at,token_revoked_at=NULL
 WHERE id=p_rfq_provider_id AND rfq_id=r.id AND empresa_id=p.empresa_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Invitación ajena'; END IF;
 PERFORM private.rfq_audit(p.empresa_id,r.id,p.id,'rfq.link.renewed',jsonb_build_object('invitation_id',p_rfq_provider_id));
END $$;
REVOKE ALL ON FUNCTION public.rfq_renew_link(uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.rfq_renew_link(uuid,uuid) TO authenticated;

CREATE FUNCTION private.rfq_child_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.rfqs;
BEGIN
 SELECT * INTO r FROM public.rfqs WHERE id=NEW.rfq_id FOR UPDATE;
 IF NOT FOUND OR NEW.empresa_id IS DISTINCT FROM r.empresa_id THEN RAISE EXCEPTION 'Línea/invitación de otra empresa'; END IF;
 IF TG_OP='UPDATE' AND (NEW.rfq_id IS DISTINCT FROM OLD.rfq_id OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id) THEN RAISE EXCEPTION 'No mover línea/invitación'; END IF;
 IF TG_TABLE_NAME='rfq_providers' THEN
  IF NOT EXISTS(SELECT 1 FROM public.providers WHERE id=NEW.provider_id AND empresa_id=r.empresa_id AND active) THEN RAISE EXCEPTION 'Proveedor ajeno/inactivo'; END IF;
  IF TG_OP='UPDATE' AND NEW.provider_id IS DISTINCT FROM OLD.provider_id THEN RAISE EXCEPTION 'No cambiar proveedor invitado'; END IF;
 ELSE
  IF NEW.producto_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.productos WHERE id=NEW.producto_id AND empresa_id=r.empresa_id AND activo) THEN RAISE EXCEPTION 'Producto ajeno/inactivo'; END IF;
  IF TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM public.quote_version_items WHERE rfq_item_id=OLD.id) THEN RAISE EXCEPTION 'Ítem cotizado inmutable'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zz_rfq_2_item_guard BEFORE INSERT OR UPDATE ON public.rfq_items FOR EACH ROW EXECUTE FUNCTION private.rfq_child_guard();
CREATE TRIGGER zz_rfq_2_invitation_guard BEFORE INSERT OR UPDATE ON public.rfq_providers FOR EACH ROW EXECUTE FUNCTION private.rfq_child_guard();
REVOKE ALL ON FUNCTION private.rfq_child_guard() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.rfq_header_guard(),private.rfq_quote_guard(),private.rfq_order_guard() FROM PUBLIC,anon,authenticated,service_role;

-- Direct purchase stays separate from RFQ, with a persisted exact preview and confirmation.
CREATE TABLE public.direct_purchase_previews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid NOT NULL REFERENCES public.empresas(id),
 created_by uuid NOT NULL REFERENCES public.profiles(id),created_at timestamptz NOT NULL DEFAULT now(),
 snapshot jsonb NOT NULL,preview_hash text NOT NULL,confirmed_at timestamptz,order_id uuid REFERENCES public.authorized_orders(id)
);
ALTER TABLE public.direct_purchase_previews ENABLE ROW LEVEL SECURITY;
CREATE POLICY direct_purchase_previews_read ON public.direct_purchase_previews FOR SELECT TO authenticated
 USING(empresa_id=(SELECT public.current_empresa_id()));
REVOKE ALL ON public.direct_purchase_previews FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.direct_purchase_previews TO authenticated;
ALTER TABLE public.authorized_orders ADD COLUMN direct_purchase_preview_id uuid REFERENCES public.direct_purchase_previews(id);
CREATE UNIQUE INDEX direct_order_once ON public.authorized_orders(direct_purchase_preview_id) WHERE direct_purchase_preview_id IS NOT NULL;

CREATE FUNCTION public.direct_purchase_preview(p_header jsonb,p_items jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles:=private.rfq_actor(); provider public.providers; item jsonb; lines jsonb:='[]';
 qty numeric; price numeric; tax numeric; amount numeric; total numeric:=0; doc jsonb; preview_id uuid; hash text; project_id uuid;
BEGIN
 SELECT * INTO provider FROM public.providers WHERE id=(p_header->>'provider_id')::uuid AND empresa_id=p.empresa_id AND active;
 IF NOT FOUND THEN RAISE EXCEPTION 'Proveedor ajeno/inactivo'; END IF;
 project_id:=nullif(p_header->>'project_id','')::uuid;
 IF project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.projects WHERE id=project_id AND empresa_id=p.empresa_id) THEN RAISE EXCEPTION 'Proyecto ajeno'; END IF;
 IF nullif(trim(p_header->>'payment_terms'),'') IS NULL OR (p_header->>'freight')::numeric IS NULL OR (p_header->>'freight')::numeric NOT BETWEEN 0 AND 9999999999 THEN RAISE EXCEPTION 'Pago/flete obligatorio'; END IF;
 IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Ítems inválidos'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  qty:=(item->>'quantity')::numeric;price:=(item->>'unit_price')::numeric;tax:=(item->>'tax_rate')::numeric;
  IF qty IS NULL OR qty NOT BETWEEN 0.0001 AND 9999999999 OR qty<>round(qty,4) OR price IS NULL OR price NOT BETWEEN 0.0001 AND 9999999999 OR price<>round(price,4)
   OR tax IS NULL OR tax NOT BETWEEN 0 AND 100 OR nullif(trim(item->>'product'),'') IS NULL OR nullif(trim(item->>'unit'),'') IS NULL THEN RAISE EXCEPTION 'Línea inválida'; END IF;
  IF nullif(item->>'producto_id','') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.productos WHERE id=(item->>'producto_id')::uuid AND empresa_id=p.empresa_id AND activo AND trim(unidad)=trim(item->>'unit')) THEN RAISE EXCEPTION 'Producto/unidad ajeno'; END IF;
  amount:=round(qty*price*(CASE WHEN (p_header->>'vat_included')::boolean THEN 1 ELSE 1+tax/100 END),2);total:=total+amount;
  lines:=lines||jsonb_build_array(jsonb_build_object('product',trim(item->>'product'),'quantity',qty,'unit',trim(item->>'unit'),'unit_price',price,'tax_rate',tax,'total_price',amount,
   'producto_id',nullif(item->>'producto_id','')::uuid,'expected_delivery_date',nullif(item->>'expected_delivery_date','')::date));
 END LOOP;
 doc:=jsonb_build_object('provider_id',provider.id,'provider_name',provider.name,'project_id',project_id,'currency',(p_header->>'currency')::public.currency_code,
  'vat_included',(p_header->>'vat_included')::boolean,'payment_terms',p_header->>'payment_terms','freight',(p_header->>'freight')::numeric,'items',lines,'total',total+(p_header->>'freight')::numeric);
 hash:=md5(doc::text);
 INSERT INTO public.direct_purchase_previews(empresa_id,created_by,snapshot,preview_hash) VALUES(p.empresa_id,p.id,doc,hash) RETURNING id INTO preview_id;
 INSERT INTO public.audit_logs(empresa_id,actor_id,action,detail) VALUES(p.empresa_id,p.id,'order.direct.previewed',jsonb_build_object('preview_id',preview_id,'hash',hash));
 RETURN jsonb_build_object('id',preview_id,'hash',hash,'snapshot',doc);
END $$;
REVOKE ALL ON FUNCTION public.direct_purchase_preview(jsonb,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.direct_purchase_preview(jsonb,jsonb) TO authenticated;

CREATE FUNCTION public.direct_purchase_confirm(p_preview_id uuid,p_hash text,p_confirm boolean) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles:=private.rfq_actor(); preview public.direct_purchase_previews; doc jsonb; item jsonb; first_item jsonb; v_order_id uuid; idx integer:=0;
BEGIN
 IF p_confirm IS DISTINCT FROM true THEN RAISE EXCEPTION 'Confirmación humana requerida'; END IF;
 SELECT * INTO preview FROM public.direct_purchase_previews WHERE id=p_preview_id AND empresa_id=p.empresa_id FOR UPDATE;
 IF NOT FOUND OR preview.preview_hash IS DISTINCT FROM p_hash THEN RAISE EXCEPTION 'Preview ajeno/modificado'; END IF;
 IF preview.confirmed_at IS NOT NULL THEN RETURN preview.order_id; END IF;
 doc:=preview.snapshot;first_item:=doc->'items'->0;
 IF NOT EXISTS(SELECT 1 FROM public.providers WHERE id=(doc->>'provider_id')::uuid AND empresa_id=p.empresa_id AND active) THEN RAISE EXCEPTION 'Proveedor inválido'; END IF;
 IF doc->>'project_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.projects WHERE id=(doc->>'project_id')::uuid AND empresa_id=p.empresa_id) THEN RAISE EXCEPTION 'Proyecto inválido'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(doc->'items') LOOP
  IF item->>'producto_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.productos WHERE id=(item->>'producto_id')::uuid AND empresa_id=p.empresa_id AND activo AND trim(unidad)=item->>'unit') THEN RAISE EXCEPTION 'Producto/unidad inválido'; END IF;
 END LOOP;
 INSERT INTO private.rfq_write_permits VALUES(txid_current(),preview.id,'direct') ON CONFLICT DO NOTHING;
 INSERT INTO public.authorized_orders(empresa_id,provider_id,provider_name,product,quantity,unit,unit_price,total_price,currency,vat_included,authorized_by,is_cheapest,created_from,project_id,direct_purchase_preview_id,procurement_snapshot)
 VALUES(p.empresa_id,(doc->>'provider_id')::uuid,doc->>'provider_name',first_item->>'product',(first_item->>'quantity')::numeric,first_item->>'unit',
 (first_item->>'unit_price')::numeric,(doc->>'total')::numeric,(doc->>'currency')::public.currency_code,(doc->>'vat_included')::boolean,p.id,false,'manual',nullif(doc->>'project_id','')::uuid,preview.id,doc) RETURNING id INTO v_order_id;
 FOR item IN SELECT value FROM jsonb_array_elements(doc->'items') LOOP
  INSERT INTO public.authorized_order_items(empresa_id,order_id,product,quantity,unit,unit_price,total_price,producto_id,expected_delivery_date,tax_rate,sort_order)
  VALUES(p.empresa_id,v_order_id,item->>'product',(item->>'quantity')::numeric,item->>'unit',(item->>'unit_price')::numeric,(item->>'total_price')::numeric,
  nullif(item->>'producto_id','')::uuid,nullif(item->>'expected_delivery_date','')::date,(item->>'tax_rate')::numeric,idx);idx:=idx+1;
 END LOOP;
 UPDATE public.direct_purchase_previews SET confirmed_at=now(),order_id=v_order_id WHERE id=preview.id;
 INSERT INTO public.audit_logs(empresa_id,actor_id,authorized_order_id,action,detail) VALUES(p.empresa_id,p.id,v_order_id,'order.direct.confirmed',jsonb_build_object('preview_id',preview.id,'hash',p_hash));
 DELETE FROM private.rfq_write_permits WHERE transaction_id=txid_current() AND rfq_id=preview.id AND kind='direct';
 RETURN v_order_id;
END $$;
REVOKE ALL ON FUNCTION public.direct_purchase_confirm(uuid,text,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.direct_purchase_confirm(uuid,text,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION private.rfq_order_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.rfq_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM private.rfq_write_permits WHERE transaction_id=txid_current() AND rfq_id=NEW.rfq_id AND kind='order') THEN RAISE EXCEPTION 'OC RFQ requiere confirmación de preview'; END IF;
 IF NEW.created_from='manual' AND NOT EXISTS(SELECT 1 FROM private.rfq_write_permits WHERE transaction_id=txid_current() AND rfq_id=NEW.direct_purchase_preview_id AND kind='direct') THEN RAISE EXCEPTION 'Compra directa requiere confirmación de preview'; END IF;
 RETURN NEW;
END $$;
