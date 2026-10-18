-- Create a manually reviewed purchase invoice and all of its lines in one transaction.
-- Original identity verification and OC matching remain explicit subsequent gates.
CREATE FUNCTION public.create_invoice_with_lines_atomico(
  p_empresa_id uuid,
  p_actor_id uuid,
  p_header jsonb,
  p_items jsonb
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $function$
DECLARE
  v_invoice_id uuid;
  v_provider_id uuid;
  v_attachment_id uuid;
  v_item jsonb;
  v_description text;
  v_quantity numeric;
  v_unit_price numeric;
  v_subtotal numeric;
  v_unit text;
  v_index integer := 0;
BEGIN
  IF auth.uid() IS NULL OR p_actor_id IS DISTINCT FROM auth.uid()
     OR p_empresa_id IS DISTINCT FROM public.current_empresa_id()
     OR NOT public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]) THEN
    RAISE EXCEPTION 'Acceso denegado para crear factura';
  END IF;
  IF p_header IS NULL OR pg_catalog.jsonb_typeof(p_header) <> 'object'
     OR p_items IS NULL OR pg_catalog.jsonb_typeof(p_items) <> 'array'
     OR pg_catalog.jsonb_array_length(p_items) > 200 THEN
    RAISE EXCEPTION 'Datos de factura invalidos';
  END IF;
  v_provider_id := (p_header->>'provider_id')::uuid;
  v_attachment_id := NULLIF(p_header->>'attachment_id', '')::uuid;
  IF NOT EXISTS (SELECT 1 FROM public.providers
                 WHERE id=v_provider_id AND empresa_id=p_empresa_id) THEN
    RAISE EXCEPTION 'Proveedor no disponible para esta empresa';
  END IF;
  IF v_attachment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.attachments
    WHERE id=v_attachment_id AND empresa_id=p_empresa_id
  ) THEN
    RAISE EXCEPTION 'Adjunto no disponible para esta empresa';
  END IF;

  INSERT INTO public.invoices (
    empresa_id, provider_id, invoice_number, invoice_date, due_date,
    currency, exchange_rate, subtotal, vat, total, timbrado,
    attachment_id, observations, created_by
  ) VALUES (
    p_empresa_id, v_provider_id, p_header->>'invoice_number',
    (p_header->>'invoice_date')::date, NULLIF(p_header->>'due_date','')::date,
    (p_header->>'currency')::public.currency_code,
    NULLIF(p_header->>'exchange_rate','')::numeric,
    NULLIF(p_header->>'subtotal','')::numeric,
    NULLIF(p_header->>'vat','')::numeric,
    (p_header->>'total')::numeric,
    p_header->>'timbrado', v_attachment_id, p_header->>'observations', p_actor_id
  ) RETURNING id INTO v_invoice_id;

  FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_items) LOOP
    IF pg_catalog.jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'Linea de factura invalida';
    END IF;
    v_description := pg_catalog.btrim(v_item->>'description');
    v_unit := NULLIF(pg_catalog.btrim(v_item->>'unit'), '');
    v_quantity := NULLIF(v_item->>'quantity','')::numeric;
    v_unit_price := NULLIF(v_item->>'unit_price','')::numeric;
    v_subtotal := NULLIF(v_item->>'subtotal','')::numeric;
    IF v_description IS NULL OR v_description='' OR pg_catalog.length(v_description)>500
       OR (v_unit IS NOT NULL AND pg_catalog.length(v_unit)>60)
       OR (v_quantity IS NOT NULL AND (v_quantity::text IN ('NaN','Infinity','-Infinity')
         OR v_quantity<=0 OR v_quantity<>pg_catalog.round(v_quantity,2)))
       OR (v_unit_price IS NOT NULL AND (v_unit_price::text IN ('NaN','Infinity','-Infinity')
         OR v_unit_price<0 OR v_unit_price<>pg_catalog.round(v_unit_price,4)))
       OR (v_subtotal IS NOT NULL AND (v_subtotal::text IN ('NaN','Infinity','-Infinity')
         OR v_subtotal<0 OR v_subtotal<>pg_catalog.round(v_subtotal,2))) THEN
      RAISE EXCEPTION 'Linea de factura invalida';
    END IF;
    INSERT INTO public.invoice_items (
      empresa_id, invoice_id, product_description, quantity, unit,
      unit_price, subtotal, sort_order
    ) VALUES (
      p_empresa_id, v_invoice_id, v_description, v_quantity, v_unit,
      v_unit_price, v_subtotal, v_index
    );
    v_index := v_index + 1;
  END LOOP;
  RETURN v_invoice_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_invoice_with_lines_atomico(uuid,uuid,jsonb,jsonb)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_invoice_with_lines_atomico(uuid,uuid,jsonb,jsonb)
  TO authenticated;
