-- Compare current, reviewed, unexpired offers for the same basket/currency/quantities.
-- Freight and VAT are included; a cheap unit price alone is not enough.
CREATE FUNCTION private.rfq_order_is_cheapest(rfq_key uuid, document jsonb) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
  WITH baskets AS (
    SELECT v.id, rp.provider_id,
      sum(round((line->>'quantity')::numeric*vi.precio_unitario*(CASE WHEN v.vat_included THEN 1 ELSE 1+vi.tax_rate/100 END),2))+v.freight AS total
    FROM public.rfqs r
    JOIN public.rfq_providers rp ON rp.rfq_id=r.id AND rp.empresa_id=r.empresa_id AND rp.token_revoked_at IS NULL
    JOIN public.providers provider ON provider.id=rp.provider_id AND provider.empresa_id=r.empresa_id AND provider.active
    JOIN public.quotes q ON q.rfq_provider_id=rp.id AND q.empresa_id=r.empresa_id
    JOIN public.quote_versions v ON v.quote_id=q.id AND v.empresa_id=r.empresa_id
      AND v.version_number=(SELECT max(latest.version_number) FROM public.quote_versions latest WHERE latest.quote_id=q.id)
      AND v.currency::text=document->>'currency' AND v.valid_until>now() AND v.freight IS NOT NULL
    CROSS JOIN jsonb_array_elements(document->'items') line
    JOIN public.quote_version_items vi ON vi.quote_version_id=v.id AND vi.rfq_item_id=(line->>'rfq_item_id')::uuid AND vi.empresa_id=r.empresa_id
      AND vi.precio_unitario>0 AND vi.tax_rate IS NOT NULL AND vi.lead_time_days IS NOT NULL
      AND vi.available_quantity>=(line->>'quantity')::numeric
    WHERE r.id=rfq_key AND EXISTS(SELECT 1 FROM public.rfq_quote_reviews review WHERE review.quote_version_id=v.id AND review.empresa_id=r.empresa_id)
    GROUP BY v.id,rp.provider_id,v.freight
    HAVING count(*)=jsonb_array_length(document->'items')
  )
  SELECT EXISTS(SELECT 1 FROM baskets WHERE provider_id=(document->>'provider_id')::uuid)
    AND NOT EXISTS(SELECT 1 FROM baskets WHERE total<(document->>'total')::numeric);
$fn$;
REVOKE ALL ON FUNCTION private.rfq_order_is_cheapest(uuid,jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.rfq_confirm_orders(p_allocation_id uuid,p_preview_hash text,p_confirm boolean) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles:=private.rfq_actor(); r public.rfqs; a public.rfq_allocations; fresh jsonb; doc jsonb; item jsonb;
 order_id uuid; ids jsonb:='[]'; first_item jsonb; idx integer; selected_cheapest boolean;
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
  selected_cheapest:=private.rfq_order_is_cheapest(r.id,doc);
  INSERT INTO public.authorized_orders(empresa_id,rfq_id,provider_id,quote_version_id,created_from,provider_name,client_name,product,quantity,unit,unit_price,total_price,currency,vat_included,authorized_by,is_cheapest,selection_reason,selection_reason_detail,project_id,rfq_allocation_id,procurement_snapshot)
  VALUES(p.empresa_id,r.id,(doc->>'provider_id')::uuid,(doc->>'quote_version_id')::uuid,'rfq',doc->>'provider_name',r.client_name,
   first_item->>'product',(first_item->>'quantity')::numeric,first_item->>'unit',(first_item->>'unit_price')::numeric,(doc->>'total')::numeric,
   (doc->>'currency')::public.currency_code,(doc->>'vat_included')::boolean,a.authorized_by,selected_cheapest,CASE WHEN selected_cheapest THEN NULL ELSE 'OTRO'::public.selection_reason END,a.justification,r.project_id,a.id,doc) RETURNING id INTO order_id;
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
