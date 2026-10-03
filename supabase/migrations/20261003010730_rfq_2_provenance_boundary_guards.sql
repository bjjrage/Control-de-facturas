-- Prior migrations have reached Preview. Close remaining direct-write boundaries additively.
CREATE FUNCTION private.rfq_quote_parent_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE invitation public.rfq_providers;
BEGIN
 IF TG_OP IN ('UPDATE','DELETE') AND EXISTS(SELECT 1 FROM public.quote_versions WHERE quote_id=OLD.id) THEN
  RAISE EXCEPTION 'Quote con historial conserva proveedor y empresa inmutables';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 SELECT * INTO invitation FROM public.rfq_providers WHERE id=NEW.rfq_provider_id;
 IF NOT FOUND OR invitation.empresa_id<>NEW.empresa_id THEN RAISE EXCEPTION 'Quote de otra empresa'; END IF;
 IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM private.rfq_write_permits WHERE transaction_id=txid_current() AND rfq_id=invitation.rfq_id AND kind='quote') THEN
  RAISE EXCEPTION 'Quote requiere envío versionado';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER rfq_2_quote_parent_guard BEFORE INSERT OR UPDATE OR DELETE ON public.quotes FOR EACH ROW EXECUTE FUNCTION private.rfq_quote_parent_guard();
REVOKE ALL ON FUNCTION private.rfq_quote_parent_guard() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.rfq_order_line_insert_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE parent public.authorized_orders;
BEGIN
 SELECT * INTO parent FROM public.authorized_orders WHERE id=NEW.order_id FOR UPDATE;
 IF NOT FOUND OR parent.empresa_id<>NEW.empresa_id THEN RAISE EXCEPTION 'Línea de otra empresa'; END IF;
 IF parent.rfq_allocation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM private.rfq_write_permits WHERE transaction_id=txid_current() AND rfq_id=parent.rfq_id AND kind='order') THEN
  RAISE EXCEPTION 'No agregar líneas a una OC RFQ confirmada';
 END IF;
 IF parent.direct_purchase_preview_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM private.rfq_write_permits WHERE transaction_id=txid_current() AND rfq_id=parent.direct_purchase_preview_id AND kind='direct') THEN
  RAISE EXCEPTION 'No agregar líneas a una OC directa confirmada';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER rfq_2_order_line_insert_guard BEFORE INSERT ON public.authorized_order_items FOR EACH ROW EXECUTE FUNCTION private.rfq_order_line_insert_guard();
REVOKE ALL ON FUNCTION private.rfq_order_line_insert_guard() FROM PUBLIC,anon,authenticated,service_role;

-- Reject precision loss before storing original freight facts. Existing function ACLs persist.
CREATE OR REPLACE FUNCTION public.rfq_submit_version(p_token text,p_offer jsonb,p_items jsonb,p_attachment_id uuid,p_actor_id uuid DEFAULT NULL) RETURNS jsonb
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
 OR (p_offer->>'freight')::numeric<>round((p_offer->>'freight')::numeric,2)
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

CREATE OR REPLACE FUNCTION public.direct_purchase_preview(p_header jsonb,p_items jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles:=private.rfq_actor(); provider public.providers; item jsonb; lines jsonb:='[]';
 qty numeric; price numeric; tax numeric; amount numeric; total numeric:=0; doc jsonb; preview_id uuid; hash text; project_id uuid;
BEGIN
 SELECT * INTO provider FROM public.providers WHERE id=(p_header->>'provider_id')::uuid AND empresa_id=p.empresa_id AND active;
 IF NOT FOUND THEN RAISE EXCEPTION 'Proveedor ajeno/inactivo'; END IF;
 project_id:=nullif(p_header->>'project_id','')::uuid;
 IF project_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.projects WHERE id=project_id AND empresa_id=p.empresa_id) THEN RAISE EXCEPTION 'Proyecto ajeno'; END IF;
 IF nullif(trim(p_header->>'payment_terms'),'') IS NULL OR (p_header->>'freight')::numeric IS NULL OR (p_header->>'freight')::numeric NOT BETWEEN 0 AND 9999999999 OR (p_header->>'freight')::numeric<>round((p_header->>'freight')::numeric,2) THEN RAISE EXCEPTION 'Pago/flete obligatorio'; END IF;
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
