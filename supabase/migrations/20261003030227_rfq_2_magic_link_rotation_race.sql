-- Close token-rotation race; keep the RFQ-then-invitation lock order.
BEGIN;

-- Lock order matches link rotation/revocation: RFQ first, invitation second.
-- Re-read the token after the parent lock so a concurrently rotated token cannot submit.
CREATE OR REPLACE FUNCTION public.rfq_submit_version(p_token text,p_offer jsonb,p_items jsonb,p_attachment_id uuid,p_actor_id uuid DEFAULT NULL) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE invitation_id uuid; parent_rfq_id uuid; rp public.rfq_providers; r public.rfqs; target_quote_id uuid; version_id uuid;
 version_number integer; item jsonb; ri public.rfq_items; total numeric:=0; price numeric; available numeric; rate numeric;
 lead integer; until_at timestamptz;
BEGIN
 SELECT invitation.id,invitation.rfq_id INTO invitation_id,parent_rfq_id FROM public.rfq_providers invitation WHERE invitation.token=p_token;
 IF NOT FOUND THEN RAISE EXCEPTION 'Link inválido'; END IF;
 SELECT * INTO r FROM public.rfqs WHERE id=parent_rfq_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Link inválido'; END IF;
 SELECT * INTO rp FROM public.rfq_providers WHERE id=invitation_id AND token=p_token FOR UPDATE;
 IF NOT FOUND OR rp.rfq_id<>r.id OR rp.empresa_id<>r.empresa_id THEN RAISE EXCEPTION 'Link inválido/rotado'; END IF;
 IF rp.token_revoked_at IS NOT NULL OR coalesce(rp.token_expires_at,r.expires_at)<=now()
  OR r.expires_at<=now() OR r.status NOT IN ('BORRADOR','COTIZANDO','OFERTAS_RECIBIDAS') THEN RAISE EXCEPTION 'Link vencido/revocado o RFQ cerrada'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.providers WHERE id=rp.provider_id AND empresa_id=r.empresa_id AND active) THEN RAISE EXCEPTION 'Proveedor inválido/inactivo'; END IF;
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
 SELECT c.id INTO target_quote_id FROM public.quotes c WHERE c.rfq_provider_id=rp.id AND c.empresa_id=r.empresa_id;
 IF target_quote_id IS NULL THEN INSERT INTO public.quotes(empresa_id,rfq_provider_id) VALUES(r.empresa_id,rp.id) RETURNING id INTO target_quote_id; END IF;
 SELECT coalesce(max(v.version_number),0)+1 INTO version_number FROM public.quote_versions v WHERE v.quote_id=target_quote_id;
 INSERT INTO public.quote_versions(empresa_id,quote_id,version_number,budget_number,unit_price,total_price,currency,invoice_available,vat_included,delivery_time,offer_validity,payment_terms,observations,pdf_attachment_id,valid_until,freight)
 VALUES(r.empresa_id,target_quote_id,version_number,p_offer->>'budget_number',total,total,(p_offer->>'currency')::public.currency_code,
  (p_offer->>'invoice_available')::boolean,(p_offer->>'vat_included')::boolean,coalesce(p_offer->>'delivery_time','Por línea'),until_at::text,
  p_offer->>'payment_terms',p_offer->>'observations',p_attachment_id,until_at,(p_offer->>'freight')::numeric) RETURNING id INTO version_id;
 FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  INSERT INTO public.quote_version_items(empresa_id,quote_version_id,rfq_item_id,precio_unitario,available_quantity,tax_rate,lead_time_days,observaciones,cargado_por)
  VALUES(r.empresa_id,version_id,(item->>'rfq_item_id')::uuid,(item->>'precio_unitario')::numeric,(item->>'available_quantity')::numeric,
   (item->>'tax_rate')::numeric,(item->>'lead_time_days')::integer,item->>'observaciones',CASE WHEN p_actor_id IS NULL THEN 'PROVEEDOR' ELSE 'INTERNO' END);
 END LOOP;
 UPDATE public.rfq_providers SET status='RESPONDIDO',responded_at=now() WHERE id=rp.id;
 UPDATE public.rfqs SET status='OFERTAS_RECIBIDAS' WHERE id=r.id;
 PERFORM private.rfq_audit(r.empresa_id,r.id,p_actor_id,'rfq.quote.version_submitted',jsonb_build_object('version_id',version_id,'version_number',version_number,'rfq_provider_id',rp.id,'attachment_id',p_attachment_id));
 DELETE FROM private.rfq_write_permits WHERE transaction_id=txid_current() AND rfq_id=r.id AND kind='quote';
 RETURN jsonb_build_object('versionId',version_id,'versionNumber',version_number,'totalPrice',total);
END $$;

REVOKE ALL ON FUNCTION public.rfq_submit_version(text,jsonb,jsonb,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rfq_submit_version(text,jsonb,jsonb,uuid,uuid) TO service_role;


COMMIT;
