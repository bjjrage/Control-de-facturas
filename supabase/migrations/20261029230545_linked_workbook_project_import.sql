-- Source precision must survive operational persistence, not only the archive.
-- An amount based on provisional quantities is not a confirmed contract amount.
ALTER TABLE public.projects ALTER COLUMN contract_amount DROP NOT NULL;
ALTER TABLE public.budget_item_materials ALTER COLUMN cantidad_por_unidad_ejecutada TYPE numeric;
ALTER TABLE public.budget_item_labor ALTER COLUMN horas_por_unidad_ejecutada TYPE numeric;
ALTER TABLE public.budget_item_equipment ALTER COLUMN horas_por_unidad_ejecutada TYPE numeric;
ALTER TABLE public.budget_item_labor ALTER COLUMN costo_hora TYPE numeric;
ALTER TABLE public.budget_item_equipment ALTER COLUMN costo_hora TYPE numeric;
ALTER TABLE public.budget_item_materials ADD COLUMN precio_unitario_origen numeric CHECK (precio_unitario_origen >= 0);
ALTER TABLE public.budget_items ADD COLUMN workbook_schedule jsonb;

CREATE FUNCTION public.create_linked_workbook_project(p_session uuid, p_expected_revision integer, p_project jsonb, p_candidate jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' SET statement_timeout = '60s'
AS $$
DECLARE
  s public.workbook_import_sessions%ROWTYPE;
  v_empresa uuid := public.current_empresa_id();
  v_project uuid;
  v_product uuid;
  v_plan uuid;
  v_key text;
  v_products jsonb := '{}'::jsonb;
  v_result jsonb;
  v_recipes jsonb := p_candidate->'linkedRecipes'->'recipes';
  v_lines integer;
  v_schedules integer := 0;
  v_materials integer := 0;
  v_labor integer := 0;
  v_equipment integer := 0;
  v_transport integer := 0;
  v_reference boolean := p_project->>'quantityStatus' = 'REFERENCE';
  v_pending jsonb := '[]'::jsonb;
  rec record;
  plan jsonb;
BEGIN
  IF auth.uid() IS NULL OR v_empresa IS NULL OR NOT public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]) THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p JOIN public.empresas e ON e.id=p.empresa_id WHERE p.id=auth.uid() AND (e.plan IN ('pro','caterpillar') OR p.is_super_admin)) THEN
    RAISE EXCEPTION 'El plan no permite importar obras.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO s FROM public.workbook_import_sessions WHERE id=p_session AND empresa_id=v_empresa FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Sesión no encontrada.'; END IF;
  IF s.status='CONFIRMED' AND s.confirmed_project_id IS NOT NULL THEN
    RETURN jsonb_build_object('projectId',s.confirmed_project_id,'applied',s.candidate->'linkedImportResult');
  END IF;
  IF s.status<>'ANALYZED' OR s.working_revision<>p_expected_revision OR s.analyzed_structure_hash IS DISTINCT FROM s.structure_hash THEN
    RAISE EXCEPTION 'La planilla cambió o no terminó de analizarse. Actualizá la vista previa.';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_empresa::text||s.original_file_hash,0));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_empresa::text||coalesce(p_project->>'code',''),0));
  IF coalesce(p_project->>'name','')='' OR coalesce(p_project->>'code','')='' OR coalesce(p_project->>'regime','') NOT IN ('PUBLIC_WORK','PRIVATE_WORK','OTHER') OR coalesce(p_project->>'quantityStatus','') NOT IN ('REFERENCE','CONFIRMED') THEN
    RAISE EXCEPTION 'Falta confirmar nombre, código, régimen o estado de cantidades.';
  END IF;
  IF jsonb_typeof(v_recipes) IS DISTINCT FROM 'array' OR jsonb_array_length(v_recipes)=0 OR jsonb_array_length(p_candidate->'linkedRecipes'->'issues')<>0 THEN
    RAISE EXCEPTION 'Las recetas tienen observaciones pendientes.';
  END IF;
  IF jsonb_array_length(v_recipes)<>jsonb_array_length(p_candidate->'budgetItems') OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_candidate->'budgetItems') b GROUP BY b->>'code' HAVING count(*)>1
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_recipes) r GROUP BY r->>'budgetCode' HAVING count(*)>1
  ) OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_recipes) r WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_candidate->'budgetItems') b WHERE b->>'code'=r->>'budgetCode')
  ) THEN RAISE EXCEPTION 'Partidas y recetas no tienen una correspondencia única.'; END IF;
  IF EXISTS (SELECT 1 FROM public.workbook_import_sessions WHERE empresa_id=v_empresa AND original_file_hash=s.original_file_hash AND status='CONFIRMED' AND confirmed_project_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Esta planilla ya tiene una obra creada; usá la obra existente.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.projects WHERE empresa_id=v_empresa AND code=p_project->>'code') THEN RAISE EXCEPTION 'Ya existe una obra con ese código.'; END IF;
  INSERT INTO public.projects(empresa_id,name,code,client,location,budget_total,contract_amount,contract_regime,created_by)
  VALUES(v_empresa,p_project->>'name',p_project->>'code',s.interpretation->'project'->'client'->>'value',s.interpretation->'project'->'location'->>'value',
    (p_candidate->>'budgetTotal')::numeric,CASE WHEN v_reference THEN NULL ELSE (p_candidate->>'budgetTotal')::numeric END,p_project->>'regime',auth.uid()) RETURNING id INTO v_project;
  INSERT INTO public.budget_items(project_id,code,description,unit,quantity,unit_price,sort_order)
  SELECT v_project,b->>'code',b->>'description',r->>'unit',(b->>'quantity')::numeric,(b->>'unitPrice')::numeric,(n-1)::integer
  FROM jsonb_array_elements(p_candidate->'budgetItems') WITH ORDINALITY t(b,n)
  JOIN jsonb_array_elements(v_recipes) r ON r->>'budgetCode'=b->>'code';
  UPDATE public.budget_items b SET workbook_schedule=t.schedule
  FROM jsonb_array_elements(coalesce(p_candidate->'linkedRecipes'->'relativeSchedule','[]'::jsonb)) t(schedule)
  WHERE b.project_id=v_project AND b.code=t.schedule->>'budgetCode';
  -- Match catalogs exactly, scoped to the company. Never overwrite a catalog
  -- price or stock. Missing resources get deterministic source SKUs.
  FOR rec IN SELECT DISTINCT l->>'code' code,l->>'description' description,l->>'unit' unit
    FROM jsonb_array_elements(v_recipes) r CROSS JOIN LATERAL jsonb_array_elements(r->'lines') l WHERE l->>'kind'='MATERIAL'
  LOOP
    v_key := md5(coalesce(rec.code,'')||'|'||lower(trim(rec.description))||'|'||lower(trim(rec.unit)));
    SELECT id INTO v_product FROM public.productos WHERE empresa_id=v_empresa AND sku='WB:'||v_key;
    IF v_product IS NULL THEN
      IF (SELECT count(*) FROM public.productos WHERE empresa_id=v_empresa AND activo AND lower(trim(nombre))=lower(trim(rec.description)) AND lower(trim(unidad))=lower(trim(rec.unit)))>1 THEN
        RAISE EXCEPTION 'Material ambiguo en catálogo: %',rec.description;
      END IF;
      SELECT id INTO v_product FROM public.productos WHERE empresa_id=v_empresa AND activo AND lower(trim(nombre))=lower(trim(rec.description)) AND lower(trim(unidad))=lower(trim(rec.unit));
    END IF;
    IF v_product IS NULL THEN
      INSERT INTO public.productos(empresa_id,nombre,unidad,sku,created_by) VALUES(v_empresa,rec.description,rec.unit,'WB:'||v_key,auth.uid())
      ON CONFLICT(empresa_id,sku) DO UPDATE SET sku=EXCLUDED.sku RETURNING id INTO v_product;
    END IF;
    v_products := v_products || jsonb_build_object(v_key,v_product);
  END LOOP;
  INSERT INTO public.budget_item_materials(empresa_id,project_id,budget_item_id,producto_id,cantidad_por_unidad_ejecutada,desperdicio_pct,precio_unitario_origen)
  SELECT v_empresa,v_project,b.id,(v_products->>md5(coalesce(l->>'code','')||'|'||lower(trim(l->>'description'))||'|'||lower(trim(l->>'unit'))))::uuid,
    sum((l->>'quantity')::numeric),0,sum((l->>'quantity')::numeric*(l->>'price')::numeric)/sum((l->>'quantity')::numeric)
  FROM jsonb_array_elements(v_recipes) r JOIN public.budget_items b ON b.project_id=v_project AND b.code=r->>'budgetCode'
  CROSS JOIN LATERAL jsonb_array_elements(r->'lines') l WHERE l->>'kind'='MATERIAL'
  GROUP BY b.id,(v_products->>md5(coalesce(l->>'code','')||'|'||lower(trim(l->>'description'))||'|'||lower(trim(l->>'unit'))))::uuid;
  GET DIAGNOSTICS v_materials=ROW_COUNT;
  INSERT INTO public.budget_item_labor(empresa_id,project_id,budget_item_id,rol,horas_por_unidad_ejecutada,costo_hora)
  SELECT v_empresa,v_project,b.id,l->>'description',sum((l->>'quantity')::numeric),sum((l->>'quantity')::numeric*(l->>'price')::numeric)/sum((l->>'quantity')::numeric)
  FROM jsonb_array_elements(v_recipes) r JOIN public.budget_items b ON b.project_id=v_project AND b.code=r->>'budgetCode'
  CROSS JOIN LATERAL jsonb_array_elements(r->'lines') l WHERE l->>'kind'='LABOR' GROUP BY b.id,l->>'description';
  GET DIAGNOSTICS v_labor=ROW_COUNT;
  INSERT INTO public.budget_item_equipment(empresa_id,project_id,budget_item_id,tipo_equipo,horas_por_unidad_ejecutada,costo_hora)
  SELECT v_empresa,v_project,b.id,l->>'description',sum((l->>'quantity')::numeric),sum((l->>'quantity')::numeric*(l->>'price')::numeric)/sum((l->>'quantity')::numeric)
  FROM jsonb_array_elements(v_recipes) r JOIN public.budget_items b ON b.project_id=v_project AND b.code=r->>'budgetCode'
  CROSS JOIN LATERAL jsonb_array_elements(r->'lines') l WHERE l->>'kind'='EQUIPMENT' GROUP BY b.id,l->>'description';
  GET DIAGNOSTICS v_equipment=ROW_COUNT;
  INSERT INTO public.budget_item_subcontracts(empresa_id,project_id,budget_item_id,descripcion,precio_por_unidad)
  SELECT v_empresa,v_project,b.id,'Transporte · '||(l->>'description'),sum((l->>'quantity')::numeric*(l->>'price')::numeric)
  FROM jsonb_array_elements(v_recipes) r JOIN public.budget_items b ON b.project_id=v_project AND b.code=r->>'budgetCode'
  CROSS JOIN LATERAL jsonb_array_elements(r->'lines') l WHERE l->>'kind'='TRANSPORT' GROUP BY b.id,l->>'description';
  GET DIAGNOSTICS v_transport=ROW_COUNT;
  IF coalesce((p_project->>'applySchedule')::boolean,false) THEN
    IF EXISTS (SELECT 1 FROM public.profiles p JOIN public.empresas e ON e.id=p.empresa_id WHERE p.id=auth.uid() AND (e.plan='caterpillar' OR p.is_super_admin)) THEN
      FOR plan IN SELECT value FROM jsonb_array_elements(p_candidate->'schedulePlans') LOOP
        INSERT INTO public.project_schedule_plans(project_id,label,is_active) VALUES(v_project,coalesce(nullif(plan->>'label',''),plan->>'planVersion'),v_schedules=0) RETURNING id INTO v_plan;
        INSERT INTO public.project_schedule_plan_months(plan_id,month_index,programado_pct)
        SELECT v_plan,(m->>'monthIndex')::integer,(m->>'programadoPct')::numeric FROM jsonb_array_elements(plan->'months') m;
        v_schedules := v_schedules+1;
      END LOOP;
    ELSE v_pending := v_pending||jsonb_build_array(jsonb_build_object('section','CRONOGRAMA','reason','El plan requiere Caterpillar; se conserva el cronograma documental.')); END IF;
  END IF;
  INSERT INTO public.inventory_locations(empresa_id,name,location_type,project_id,is_primary,created_by)
  VALUES(v_empresa,left('Obra: '||(p_project->>'name'),180)||' · '||(p_project->>'code'),'PROJECT',v_project,true,auth.uid());
  v_result := jsonb_build_object('project',true,'budgetItems',jsonb_array_length(v_recipes),'recipes',jsonb_array_length(v_recipes),'materials',v_materials,'labor',v_labor,'equipment',v_equipment,'transport',v_transport,
    'certificateItems',0,'staffItems',0,'scheduleVersions',v_schedules,'weatherDays',0,'executionEntries',0);
  UPDATE public.workbook_import_sessions SET status='CONFIRMED',confirmed_project_id=v_project,confirmed_at=now(),
    candidate=p_candidate||jsonb_build_object('quantityStatus',p_project->>'quantityStatus','linkedImportResult',v_result) WHERE id=s.id AND empresa_id=v_empresa;
  PERFORM public.log_audit_event(p_action=>'project.workbook_imported',p_detail=>jsonb_build_object('project_id',v_project,'source_fingerprint',s.original_file_hash,'session_id',s.id,'applied',v_result,'quantity_status',p_project->>'quantityStatus'));
  RETURN jsonb_build_object('projectId',v_project,'applied',v_result,'pending',v_pending);
END;
$$;
REVOKE ALL ON FUNCTION public.create_linked_workbook_project(uuid,integer,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_linked_workbook_project(uuid,integer,jsonb,jsonb) TO authenticated;
