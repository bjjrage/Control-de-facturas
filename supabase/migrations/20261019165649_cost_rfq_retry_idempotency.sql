-- #25: serialize identical cost requests in the database, excluding the
-- retry's new expiry timestamp from the identity. Existing records are kept.
CREATE INDEX IF NOT EXISTS rfqs_cost_request_lookup
ON public.rfqs(empresa_id,project_id,internal_reference)
WHERE purpose='COST_DISCOVERY';

CREATE FUNCTION public.rfq_create_cost_once(p_header jsonb,p_items jsonb,p_provider_ids uuid[] DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE actor public.profiles; project uuid; request_key text;
  normalized_items jsonb; providers uuid[]; existing public.rfqs; result jsonb;
BEGIN
 SELECT * INTO actor FROM public.profiles WHERE id=auth.uid() AND active AND role IN ('admin','administracion');
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.empresas e WHERE e.id=actor.empresa_id AND e.active
   AND (e.plan IN ('pro','caterpillar') OR actor.is_super_admin)) THEN
   RAISE EXCEPTION 'Costeo requiere un actor y plan activos' USING ERRCODE='42501';
 END IF;
 project:=nullif(p_header->>'project_id','')::uuid;
 IF p_header->>'purpose' IS DISTINCT FROM 'COST_DISCOVERY' OR project IS NULL OR
   NOT EXISTS(SELECT 1 FROM public.projects WHERE id=project AND empresa_id=actor.empresa_id) THEN
   RAISE EXCEPTION 'Obra o propósito de costeo inválidos' USING ERRCODE='42501';
 END IF;
 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 500 THEN
   RAISE EXCEPTION 'Ítems inválidos' USING ERRCODE='22023';
 END IF;
 SELECT jsonb_agg(line ORDER BY line::text) INTO normalized_items FROM (
   SELECT jsonb_build_object('producto_id',nullif(x->>'producto_id','')::uuid,
     'descripcion',btrim(x->>'descripcion'),'cantidad',(x->>'cantidad')::numeric,'unidad',btrim(x->>'unidad')) AS line
   FROM jsonb_array_elements(p_items) x
 ) s;
 SELECT coalesce(array_agg(id ORDER BY id),'{}'::uuid[]) INTO providers
 FROM (SELECT DISTINCT unnest(coalesce(p_provider_ids,'{}'::uuid[])) id) s;
 request_key:='cost-rfq:'||md5(jsonb_build_array(project,p_header->>'product',normalized_items,providers)::text);
 PERFORM pg_advisory_xact_lock(hashtextextended(actor.empresa_id::text||':'||request_key,0));
 SELECT * INTO existing FROM public.rfqs
 WHERE empresa_id=actor.empresa_id AND project_id=project AND purpose='COST_DISCOVERY'
   AND internal_reference=request_key AND expires_at>now()
   AND status IN ('BORRADOR','COTIZANDO','OFERTAS_RECIBIDAS')
 ORDER BY created_at DESC LIMIT 1;
 IF FOUND THEN RETURN jsonb_build_object('id',existing.id,'code',existing.code,'reused',true); END IF;
 result:=public.rfq_create(p_header||jsonb_build_object('internal_reference',request_key),normalized_items,providers);
 RETURN result||jsonb_build_object('reused',false);
END $$;
REVOKE ALL ON FUNCTION public.rfq_create_cost_once(jsonb,jsonb,uuid[]) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.rfq_create_cost_once(jsonb,jsonb,uuid[]) TO authenticated;
