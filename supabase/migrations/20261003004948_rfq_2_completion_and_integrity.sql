-- Additive follow-up. 20261003000341 was already deployed to Preview and remains immutable.
ALTER TABLE public.rfqs ADD COLUMN closed_at timestamptz;
ALTER TABLE public.rfqs ADD COLUMN closed_by uuid REFERENCES public.profiles(id);

CREATE FUNCTION public.rfq_close_discovery(p_rfq_id uuid,p_confirm boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles:=private.rfq_actor(); r public.rfqs;
BEGIN
 IF p_confirm IS DISTINCT FROM true THEN RAISE EXCEPTION 'Cierre humano explícito requerido'; END IF;
 SELECT * INTO r FROM public.rfqs WHERE id=p_rfq_id AND empresa_id=p.empresa_id FOR UPDATE;
 IF NOT FOUND OR r.purpose IS DISTINCT FROM 'COST_DISCOVERY' THEN RAISE EXCEPTION 'RFQ no es descubrimiento de costos'; END IF;
 IF r.closed_at IS NOT NULL THEN RETURN; END IF;
 INSERT INTO private.rfq_write_permits VALUES(txid_current(),r.id,'close') ON CONFLICT DO NOTHING;
 UPDATE public.rfqs SET closed_at=now(),closed_by=p.id,expires_at=least(expires_at,now()) WHERE id=r.id;
 PERFORM private.rfq_audit(p.empresa_id,r.id,p.id,'rfq.discovery.closed','{"orders_created":0}');
 DELETE FROM private.rfq_write_permits WHERE transaction_id=txid_current() AND rfq_id=r.id AND kind='close';
END $$;
REVOKE ALL ON FUNCTION public.rfq_close_discovery(uuid,boolean) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.rfq_close_discovery(uuid,boolean) TO authenticated;

CREATE FUNCTION private.rfq_closure_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.closed_at IS NOT NULL AND (NEW.closed_at IS DISTINCT FROM OLD.closed_at OR NEW.closed_by IS DISTINCT FROM OLD.closed_by OR NEW.expires_at IS DISTINCT FROM OLD.expires_at) THEN RAISE EXCEPTION 'Descubrimiento cerrado inmutable'; END IF;
 IF NEW.closed_at IS DISTINCT FROM OLD.closed_at AND NOT EXISTS(SELECT 1 FROM private.rfq_write_permits WHERE transaction_id=txid_current() AND rfq_id=NEW.id AND kind='close') THEN RAISE EXCEPTION 'Usar cierre humano de descubrimiento'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER rfq_2_closure_guard BEFORE UPDATE ON public.rfqs FOR EACH ROW EXECUTE FUNCTION private.rfq_closure_guard();
REVOKE ALL ON FUNCTION private.rfq_closure_guard() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.rfq_order_snapshot_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.rfq_allocation_id IS NOT NULL OR OLD.direct_purchase_preview_id IS NOT NULL THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'OC confirmada conserva provenance y no puede borrarse'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','facturado_amount']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','facturado_amount']) THEN RAISE EXCEPTION 'Snapshot confirmado de OC inmutable'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER rfq_2_order_snapshot_immutable BEFORE UPDATE OR DELETE ON public.authorized_orders FOR EACH ROW EXECUTE FUNCTION private.rfq_order_snapshot_guard();
REVOKE ALL ON FUNCTION private.rfq_order_snapshot_guard() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.rfq_order_line_snapshot_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE order_row public.authorized_orders;
BEGIN
 SELECT * INTO order_row FROM public.authorized_orders WHERE id=OLD.order_id FOR UPDATE;
 IF order_row.rfq_allocation_id IS NOT NULL OR order_row.direct_purchase_preview_id IS NOT NULL THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Línea de OC confirmada inmutable'; END IF;
  IF (to_jsonb(NEW)-'quantity_invoiced') IS DISTINCT FROM (to_jsonb(OLD)-'quantity_invoiced') THEN RAISE EXCEPTION 'Línea de OC confirmada inmutable'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER rfq_2_order_line_snapshot_immutable BEFORE UPDATE OR DELETE ON public.authorized_order_items FOR EACH ROW EXECUTE FUNCTION private.rfq_order_line_snapshot_guard();
REVOKE ALL ON FUNCTION private.rfq_order_line_snapshot_guard() FROM PUBLIC,anon,authenticated,service_role;

CREATE INDEX rfq_reviews_empresa_idx ON public.rfq_quote_reviews(empresa_id);
CREATE INDEX rfq_allocations_created_by_idx ON public.rfq_allocations(created_by);
CREATE INDEX direct_preview_empresa_idx ON public.direct_purchase_previews(empresa_id);
CREATE INDEX rfq_order_item_quote_idx ON public.authorized_order_items(quote_version_item_id);
CREATE INDEX rfq_order_item_item_idx ON public.authorized_order_items(rfq_item_id);

CREATE OR REPLACE FUNCTION private.rfq_resolve_allocation(r public.rfqs,lines jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
   OR fact.unit_price IS NULL OR fact.unit_price<=0 OR round(quantity*fact.unit_price,2)<0.01 OR quantity>fact.available_quantity OR fact.valid_until IS NULL OR fact.valid_until<=now()
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

CREATE OR REPLACE FUNCTION public.direct_purchase_preview(p_header jsonb,p_items jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
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
  IF round(qty*price,2)<0.01 THEN RAISE EXCEPTION 'Importe de línea menor a 0.01'; END IF;
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
