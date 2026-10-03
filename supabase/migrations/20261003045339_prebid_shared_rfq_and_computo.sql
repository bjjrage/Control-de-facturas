-- Generalize existing atomic engines, preserving transactions and CAS.
ALTER TABLE public.budget_items ADD COLUMN licitacion_item_id uuid REFERENCES public.licitacion_items(id);

CREATE FUNCTION private.workspace_actor(c jsonb) RETURNS public.profiles LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles:=private.rfq_actor(); owner_id uuid:=(c->>'id')::uuid;
BEGIN
 IF c->>'kind'='TENDER' THEN
  PERFORM 1 FROM public.licitaciones WHERE id=owner_id AND empresa_id=p.empresa_id AND moneda='PYG' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tender context denied'; END IF;
  IF EXISTS(SELECT 1 FROM public.licitacion_ofertas WHERE licitacion_id=owner_id AND estado<>'BORRADOR') THEN RAISE EXCEPTION 'PREBID is frozen'; END IF;
 ELSIF c->>'kind'='PROJECT' THEN
  IF NOT EXISTS(SELECT 1 FROM public.projects WHERE id=owner_id AND empresa_id=p.empresa_id) THEN RAISE EXCEPTION 'Project context denied'; END IF;
 ELSE RAISE EXCEPTION 'Invalid workspace context'; END IF;
 RETURN p;
END $$;
REVOKE ALL ON FUNCTION private.workspace_actor(jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.prebid_import_computo(p_tender_id uuid) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles:=private.workspace_actor(jsonb_build_object('kind','TENDER','id',p_tender_id)); n integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.licitacion_items WHERE licitacion_id=p_tender_id AND empresa_id=p.empresa_id) THEN RAISE EXCEPTION 'No real tender items'; END IF;
 IF EXISTS(SELECT 1 FROM public.licitacion_items WHERE licitacion_id=p_tender_id AND (cantidad IS NULL OR cantidad<=0 OR cantidad>=1e16 OR trim(coalesce(unidad,''))='' OR trim(coalesce(descripcion,''))='')) THEN RAISE EXCEPTION 'Tender items require measured quantities and units'; END IF;
 INSERT INTO public.budget_items(tender_id,licitacion_item_id,code,description,quantity,unit,sort_order)
 SELECT p_tender_id,i.id,'LIC-'||row_number() OVER(ORDER BY i.sort_order,i.id),i.descripcion,i.cantidad,i.unidad,i.sort_order
 FROM public.licitacion_items i WHERE i.licitacion_id=p_tender_id AND i.empresa_id=p.empresa_id
 AND NOT EXISTS(SELECT 1 FROM public.budget_items b WHERE b.tender_id=p_tender_id AND b.licitacion_item_id=i.id);
 GET DIAGNOSTICS n=ROW_COUNT; RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.prebid_import_computo(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.prebid_import_computo(uuid) TO authenticated;

CREATE FUNCTION public.workspace_adopt_price(p_context jsonb,p_product_id uuid,p_source text,p_price numeric DEFAULT NULL,p_quote_item_id uuid DEFAULT NULL) RETURNS numeric
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles:=private.workspace_actor(p_context); owner_id uuid:=(p_context->>'id')::uuid; price numeric; tender uuid; project uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.productos WHERE id=p_product_id AND empresa_id=p.empresa_id AND activo) THEN RAISE EXCEPTION 'Invalid product tenant'; END IF;
 IF p_context->>'kind'='TENDER' THEN tender:=owner_id; ELSE project:=owner_id; END IF;
 IF p_source='MANUAL' THEN price:=p_price; p_quote_item_id:=NULL;
 ELSIF p_source='COTIZACION' THEN
  IF p_quote_item_id IS NULL THEN RAISE EXCEPTION 'Quote item required'; END IF;
  SELECT i.precio_unitario INTO price FROM public.quote_version_items i
  JOIN public.rfq_items ri ON ri.id=i.rfq_item_id AND ri.producto_id=p_product_id AND ri.empresa_id=p.empresa_id
  JOIN public.rfqs r ON r.id=ri.rfq_id AND r.empresa_id=p.empresa_id AND r.project_id IS NOT DISTINCT FROM project AND r.tender_id IS NOT DISTINCT FROM tender
  JOIN public.quote_versions v ON v.id=i.quote_version_id AND v.empresa_id=p.empresa_id AND v.currency='PYG'
  JOIN public.quotes q ON q.id=v.quote_id AND q.empresa_id=p.empresa_id
  JOIN public.rfq_providers rp ON rp.id=q.rfq_provider_id AND rp.rfq_id=r.id AND rp.empresa_id=p.empresa_id AND rp.token_revoked_at IS NULL
  WHERE i.id=p_quote_item_id AND i.empresa_id=p.empresa_id AND (tender IS NULL OR r.purpose='COST_DISCOVERY')
   AND (v.valid_until IS NULL OR v.valid_until>now())
   AND NOT EXISTS(SELECT 1 FROM public.quote_versions newer WHERE newer.quote_id=q.id AND newer.version_number>v.version_number);
 ELSE RAISE EXCEPTION 'Explicit human price source required'; END IF;
 IF price IS NULL OR price<=0 OR price>=1e16 THEN RAISE EXCEPTION 'Finite positive factual price required'; END IF;
 IF tender IS NOT NULL THEN
  INSERT INTO public.project_cost_prices(empresa_id,tender_id,producto_id,precio_unitario,fuente,quote_version_item_id,updated_by)
  VALUES(p.empresa_id,tender,p_product_id,price,p_source,p_quote_item_id,p.id)
  ON CONFLICT(tender_id,producto_id) DO UPDATE SET precio_unitario=excluded.precio_unitario,fuente=excluded.fuente,quote_version_item_id=excluded.quote_version_item_id,updated_by=p.id,updated_at=now();
 ELSE
  INSERT INTO public.project_cost_prices(empresa_id,project_id,producto_id,precio_unitario,fuente,quote_version_item_id,updated_by)
  VALUES(p.empresa_id,project,p_product_id,price,p_source,p_quote_item_id,p.id)
  ON CONFLICT(project_id,producto_id) DO UPDATE SET precio_unitario=excluded.precio_unitario,fuente=excluded.fuente,quote_version_item_id=excluded.quote_version_item_id,updated_by=p.id,updated_at=now();
 END IF;
 INSERT INTO public.audit_logs(empresa_id,actor_id,actor_type,action,detail) VALUES(p.empresa_id,p.id,'internal','workspace.price_adopted',jsonb_build_object('context',p_context,'producto_id',p_product_id,'source',p_source,'quote_item_id',p_quote_item_id,'price',price));
 RETURN price;
END $$;
REVOKE ALL ON FUNCTION public.workspace_adopt_price(jsonb,uuid,text,numeric,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.workspace_adopt_price(jsonb,uuid,text,numeric,uuid) TO authenticated;

CREATE FUNCTION public.workspace_register_bim(p_context jsonb,p_file_name text,p_storage_path text,p_schema text,p_elements jsonb) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles:=private.workspace_actor(p_context); owner_id uuid:=(p_context->>'id')::uuid; tid uuid; pid uuid; m uuid; x jsonb;
BEGIN
 IF p_context->>'kind'='TENDER' THEN tid:=owner_id; ELSE pid:=owner_id; END IF;
 IF jsonb_typeof(p_elements)<>'array' OR jsonb_array_length(p_elements) NOT BETWEEN 1 AND 50000 THEN RAISE EXCEPTION 'Invalid IFC elements'; END IF;
 IF p_storage_path NOT LIKE (CASE WHEN tid IS NOT NULL THEN 'tenders/' ELSE '' END)||owner_id::text||'/%' OR
  NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='bim-models' AND name=p_storage_path) THEN RAISE EXCEPTION 'IFC storage provenance missing'; END IF;
 INSERT INTO public.bim_models(project_id,tender_id,file_name,storage_path,schema,status,element_count,uploaded_by)
 VALUES(pid,tid,p_file_name,p_storage_path,p_schema,'LISTO',jsonb_array_length(p_elements),p.id) RETURNING id INTO m;
 FOR x IN SELECT value FROM jsonb_array_elements(p_elements) LOOP
  IF trim(coalesce(x->>'ifcGuid',''))='' OR trim(coalesce(x->>'ifcType',''))='' OR
   (x->>'quantityValue')::numeric<0 OR (x->>'quantityValue')::numeric>=1e16 THEN RAISE EXCEPTION 'Invalid IFC element or quantity'; END IF;
  INSERT INTO public.bim_elements(bim_model_id,project_id,tender_id,ifc_guid,ifc_type,express_id,name,building_storey,material,properties,quantity_type,quantity_value,quantity_unit,quantity_source,quantity_property)
  VALUES(m,pid,tid,x->>'ifcGuid',x->>'ifcType',(x->>'expressId')::integer,x->>'name',x->>'buildingStorey',x->>'material',coalesce(x->'properties','{}'),x->>'quantityType',(x->>'quantityValue')::numeric,x->>'quantityUnit',x->>'quantitySource',x->>'quantityProperty');
 END LOOP;
 RETURN m;
END $$;
REVOKE ALL ON FUNCTION public.workspace_register_bim(jsonb,text,text,text,jsonb) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.workspace_register_bim(jsonb,text,text,text,jsonb) TO authenticated;

CREATE FUNCTION public.workspace_apply_bim_quantity(p_context jsonb,p_budget_id uuid,p_elements uuid[],p_expected_version timestamptz,p_quantity numeric) RETURNS numeric
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles:=private.workspace_actor(p_context); b public.budget_items; e public.bim_elements; total numeric:=0; owner_id uuid:=(p_context->>'id')::uuid; u text; eu text;
BEGIN
 SELECT * INTO b FROM public.budget_items WHERE id=p_budget_id FOR UPDATE;
 IF NOT FOUND OR (p_context->>'kind'='TENDER' AND b.tender_id IS DISTINCT FROM owner_id) OR (p_context->>'kind'='PROJECT' AND b.project_id IS DISTINCT FROM owner_id) THEN RAISE EXCEPTION 'Budget context mismatch'; END IF;
 IF b.updated_at IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'Budget changed' USING ERRCODE='P0409'; END IF;
 IF cardinality(p_elements) NOT BETWEEN 1 AND 50000 OR (SELECT count(DISTINCT x) FROM unnest(p_elements) x)<>cardinality(p_elements) THEN RAISE EXCEPTION 'Choose unique BIM elements'; END IF;
 u:=lower(replace(replace(trim(b.unit),'²','2'),'³','3'));
 FOR e IN SELECT * FROM public.bim_elements WHERE id=ANY(p_elements) ORDER BY id FOR UPDATE LOOP
  IF e.project_id IS DISTINCT FROM b.project_id OR e.tender_id IS DISTINCT FROM b.tender_id OR e.quantity_value IS NULL THEN RAISE EXCEPTION 'BIM context or measured quantity mismatch'; END IF;
  eu:=lower(replace(replace(trim(e.quantity_unit),'²','2'),'³','3'));
  IF eu IS DISTINCT FROM u THEN RAISE EXCEPTION 'BIM unit mismatch: explicit compatible units required'; END IF;
  IF EXISTS(SELECT 1 FROM public.bim_budget_matches WHERE bim_element_id=e.id AND status='CONFIRMADO' AND budget_item_id<>b.id) THEN RAISE EXCEPTION 'BIM element already counted elsewhere'; END IF;
  total:=total+e.quantity_value;
 END LOOP;
 IF (SELECT count(*) FROM public.bim_elements WHERE id=ANY(p_elements))<>cardinality(p_elements) THEN RAISE EXCEPTION 'Missing BIM elements'; END IF;
 IF round(total,4) IS DISTINCT FROM p_quantity OR total<=0 OR total>=1e16 THEN RAISE EXCEPTION 'BIM factual quantity mismatch'; END IF;
 DELETE FROM public.bim_budget_matches WHERE budget_item_id=b.id AND status='CONFIRMADO';
 INSERT INTO public.bim_budget_matches(bim_element_id,budget_item_id,method,status,confirmed_by,confirmed_at)
 SELECT x,b.id,'MANUAL','CONFIRMADO',p.id,now() FROM unnest(p_elements) x;
 UPDATE public.budget_items SET quantity=round(total,4),updated_at=now() WHERE id=b.id;
 RETURN round(total,4);
END $$;
REVOKE ALL ON FUNCTION public.workspace_apply_bim_quantity(jsonb,uuid,uuid[],timestamptz,numeric) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.workspace_apply_bim_quantity(jsonb,uuid,uuid[],timestamptz,numeric) TO authenticated;

CREATE OR REPLACE FUNCTION "public"."planilla_confirmar_computo"("p_planilla_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_empresa_id     uuid;
  v_planilla       record;
  v_project_id     uuid;
  v_tender_id uuid;
  v_row            jsonb;
  v_row_id         text;
  v_deleted        boolean;
  v_code           text;
  v_description    text;
  v_unit           text;
  v_quantity       numeric;
  v_unit_price     numeric;
  v_style          jsonb;
  v_existing_id    uuid;
  v_base_updated   timestamptz;
  v_current_updated timestamptz;
  v_max_sort       integer;
  v_new_id         uuid;
  v_inserted       integer := 0;
  v_updated        integer := 0;
  v_deleted_count  integer := 0;
  v_code_to_id     jsonb := '{}'::jsonb;
  v_parent_code    text;
  v_parent_id      uuid;
  v_dot_idx        integer;
BEGIN
  v_empresa_id := public.current_empresa_id();
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'No se pudo determinar la empresa del usuario autenticado.';
  END IF;

  SELECT * INTO v_planilla
  FROM public.planillas
  WHERE id = p_planilla_id AND empresa_id = v_empresa_id
  FOR UPDATE;

  IF v_planilla IS NULL THEN
    RAISE EXCEPTION 'Planilla % no encontrada o sin permisos.', p_planilla_id;
  END IF;

  IF v_planilla.modulo <> 'computo_presupuesto' THEN
    RAISE EXCEPTION 'Esta función solo confirma planillas de cómputo/presupuesto.';
  END IF;

  IF v_planilla.estado = 'confirmed' THEN
    RETURN jsonb_build_object(
      'already_confirmed', true,
      'planilla_id', v_planilla.id,
      'result', v_planilla.applied_result
    );
  END IF;

  IF v_planilla.estado = 'cancelled' THEN
    RAISE EXCEPTION 'La planilla % está cancelada y no puede confirmarse.', p_planilla_id;
  END IF;

  v_project_id := coalesce(v_planilla.contexto->>'projectId',CASE WHEN v_planilla.contexto->>'kind'='PROJECT' THEN v_planilla.contexto->>'id' END)::uuid;
  v_tender_id := coalesce(v_planilla.contexto->>'tenderId',CASE WHEN v_planilla.contexto->>'kind'='TENDER' THEN v_planilla.contexto->>'id' END)::uuid;
  IF (v_project_id IS NULL) = (v_tender_id IS NULL) THEN RAISE EXCEPTION 'Exactly one workspace owner required'; END IF;
  IF v_tender_id IS NOT NULL THEN
    PERFORM 1 FROM public.licitaciones WHERE id=v_tender_id AND empresa_id=v_empresa_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Tender tenant mismatch'; END IF;
    IF EXISTS(SELECT 1 FROM public.licitacion_ofertas WHERE licitacion_id=v_tender_id AND estado<>'BORRADOR') THEN RAISE EXCEPTION 'PREBID is frozen'; END IF;
  ELSIF NOT EXISTS(SELECT 1 FROM public.projects WHERE id=v_project_id AND empresa_id=v_empresa_id) THEN RAISE EXCEPTION 'Project tenant mismatch'; END IF;

  FOR v_row IN SELECT * FROM jsonb_array_elements(v_planilla.snapshot->'rows')
  LOOP
    v_row_id := v_row->>'_rowId';
    CONTINUE WHEN v_row_id IS NULL OR left(v_row_id, 4) = 'new:';

    v_existing_id := v_row_id::uuid;
    v_deleted := coalesce((v_row->>'_deleted')::boolean, false);

    SELECT updated_at INTO v_current_updated
    FROM public.budget_items
    WHERE id = v_existing_id AND (project_id = v_project_id OR tender_id = v_tender_id);

    v_base_updated := NULLIF(v_planilla.base_versions->>v_row_id, '')::timestamptz;

    IF v_current_updated IS NULL THEN
      RAISE EXCEPTION 'CONFLICTO_CONCURRENCIA: la partida % ya no existe (fue eliminada).', v_row_id
        USING ERRCODE = 'P0409';
    END IF;

    IF v_base_updated IS NULL OR v_current_updated <> v_base_updated THEN
      RAISE EXCEPTION 'CONFLICTO_CONCURRENCIA: la partida % cambió desde que se abrió la planilla.', v_row_id
        USING ERRCODE = 'P0409';
    END IF;

    IF v_deleted THEN
      DELETE FROM public.budget_items WHERE id = v_existing_id AND (project_id = v_project_id OR tender_id = v_tender_id);
      v_deleted_count := v_deleted_count + 1;
    ELSE
      v_code        := v_row->>'code';
      v_description := v_row->>'description';
      v_unit        := NULLIF(v_row->>'unit', '');
      v_quantity    := NULLIF(v_row->>'quantity', '')::numeric;
      v_unit_price  := NULLIF(v_row->>'unit_price', '')::numeric;
      v_style       := coalesce(v_row->'_style', '{}'::jsonb);

      IF v_code IS NULL OR trim(v_code) = '' THEN
        RAISE EXCEPTION 'La partida % no puede quedar sin código.', v_row_id;
      END IF;
      IF v_description IS NULL OR trim(v_description) = '' THEN
        RAISE EXCEPTION 'La partida % no puede quedar sin descripción.', v_row_id;
      END IF;

      UPDATE public.budget_items
      SET code = v_code, description = v_description, unit = v_unit,
          quantity = v_quantity, unit_price = v_unit_price, style = v_style
      WHERE id = v_existing_id AND (project_id = v_project_id OR tender_id = v_tender_id);
      v_updated := v_updated + 1;

      v_code_to_id := v_code_to_id || jsonb_build_object(v_code, v_existing_id::text);
    END IF;
  END LOOP;

  SELECT coalesce(max(sort_order), 0) INTO v_max_sort
  FROM public.budget_items WHERE (project_id = v_project_id OR tender_id = v_tender_id);

  FOR v_row IN SELECT * FROM jsonb_array_elements(v_planilla.snapshot->'rows')
  LOOP
    v_row_id := v_row->>'_rowId';
    CONTINUE WHEN v_row_id IS NULL OR left(v_row_id, 4) <> 'new:';
    CONTINUE WHEN coalesce((v_row->>'_deleted')::boolean, false);

    v_code        := v_row->>'code';
    v_description := v_row->>'description';
    v_unit        := NULLIF(v_row->>'unit', '');
    v_quantity    := NULLIF(v_row->>'quantity', '')::numeric;
    v_unit_price  := NULLIF(v_row->>'unit_price', '')::numeric;
    v_style       := coalesce(v_row->'_style', '{}'::jsonb);

    IF v_code IS NULL OR trim(v_code) = '' THEN
      RAISE EXCEPTION 'Una fila nueva no puede quedar sin código.';
    END IF;
    IF v_description IS NULL OR trim(v_description) = '' THEN
      RAISE EXCEPTION 'Una fila nueva no puede quedar sin descripción.';
    END IF;

    v_parent_id := NULL;
    v_dot_idx := length(v_code) - position('.' in reverse(v_code));
    IF position('.' in v_code) > 0 THEN
      v_parent_code := left(v_code, v_dot_idx);
      v_parent_id := NULLIF(v_code_to_id->>v_parent_code, '')::uuid;
      IF v_parent_id IS NULL THEN
        SELECT id INTO v_parent_id FROM public.budget_items
        WHERE (project_id = v_project_id OR tender_id = v_tender_id) AND code = v_parent_code;
      END IF;
    END IF;

    v_max_sort := v_max_sort + 1;
    INSERT INTO public.budget_items (
      project_id, tender_id, parent_id, code, description, unit, quantity, unit_price, sort_order, style
    ) VALUES (
      v_project_id, v_tender_id, v_parent_id, v_code, v_description, v_unit, v_quantity, v_unit_price, v_max_sort, v_style
    ) RETURNING id INTO v_new_id;
    v_inserted := v_inserted + 1;

    v_code_to_id := v_code_to_id || jsonb_build_object(v_code, v_new_id::text);
  END LOOP;

  UPDATE public.planillas
  SET estado = 'confirmed',
      confirmed_at = now(),
      confirmed_by = auth.uid(),
      applied_result = jsonb_build_object(
        'inserted', v_inserted, 'updated', v_updated, 'deleted', v_deleted_count
      )
  WHERE id = p_planilla_id;

  RETURN jsonb_build_object(
    'already_confirmed', false,
    'planilla_id', p_planilla_id,
    'result', jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'deleted', v_deleted_count)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rfq_create(p_header jsonb,p_items jsonb,p_provider_ids uuid[] DEFAULT '{}') RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles:=private.rfq_actor(); r public.rfqs; item jsonb; vendor uuid; idx integer:=0;
BEGIN
 IF p_items IS NULL OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Ítems inválidos'; END IF;
 IF p_header->>'purpose' IS NULL OR p_header->>'purpose' NOT IN ('COST_DISCOVERY','PROCUREMENT') THEN RAISE EXCEPTION 'Elegí purpose'; END IF;
 INSERT INTO public.rfqs(empresa_id,created_by,purpose,quote_type,product,quantity,unit,project_id,tender_id,specifications,required_date,internal_reference,observations,expires_at)
 VALUES(p.empresa_id,p.id,p_header->>'purpose',coalesce(p_header->>'quote_type','RFQ'),p_header->>'product',1,'lote',
 nullif(p_header->>'project_id','')::uuid,nullif(p_header->>'tender_id','')::uuid,p_header->>'specifications',nullif(p_header->>'required_date','')::date,
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
