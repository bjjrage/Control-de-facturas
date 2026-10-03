-- Preserve human notes as part of the exact immutable direct purchase snapshot.
-- Previous migrations are deployed; existing grants remain unchanged.
CREATE OR REPLACE FUNCTION public.direct_purchase_preview(p_header jsonb,p_items jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles:=private.rfq_actor(); provider public.providers; item jsonb; lines jsonb:='[]';
 qty numeric; price numeric; tax numeric; amount numeric; total numeric:=0; doc jsonb; preview_id uuid; hash text; project_id uuid;
BEGIN
 IF length(coalesce(p_header->>'observations',''))>5000 THEN RAISE EXCEPTION 'Observaciones demasiado largas'; END IF;
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
  'vat_included',(p_header->>'vat_included')::boolean,'payment_terms',p_header->>'payment_terms','observations',nullif(p_header->>'observations',''),'freight',(p_header->>'freight')::numeric,'items',lines,'total',total+(p_header->>'freight')::numeric);
 hash:=md5(doc::text);
 INSERT INTO public.direct_purchase_previews(empresa_id,created_by,snapshot,preview_hash) VALUES(p.empresa_id,p.id,doc,hash) RETURNING id INTO preview_id;
 INSERT INTO public.audit_logs(empresa_id,actor_id,action,detail) VALUES(p.empresa_id,p.id,'order.direct.previewed',jsonb_build_object('preview_id',preview_id,'hash',hash));
 RETURN jsonb_build_object('id',preview_id,'hash',hash,'snapshot',doc);
END $$;

