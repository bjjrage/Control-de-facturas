-- Serialize opening a workspace across requests and server instances.
-- Older drafts are retained; a confirmed revision supersedes untouched older
-- duplicates instead of reopening stale measurements indefinitely.
CREATE FUNCTION public.planilla_crear_o_retomar(p_modulo text, p_contexto jsonb, p_rows jsonb, p_base_versions jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  v_empresa uuid := public.current_empresa_id();
  v_planilla public.planillas%ROWTYPE;
  v_confirmed timestamptz;
  v_owner uuid;
BEGIN
  IF auth.uid() IS NULL OR v_empresa IS NULL OR NOT public.is_internal_role(ARRAY['comercial','administracion','admin']::public.user_role[]) THEN
    RAISE EXCEPTION 'No autorizado.' USING ERRCODE='42501';
  END IF;
  IF p_modulo <> 'computo_presupuesto' OR jsonb_typeof(p_contexto) IS DISTINCT FROM 'object'
    OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows)>5000
    OR jsonb_typeof(p_base_versions) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Contexto de workspace inválido.'; END IF;
  v_owner := coalesce(p_contexto->>'projectId',p_contexto->>'id')::uuid;
  IF p_contexto->>'kind'='TENDER' THEN
    IF NOT EXISTS(SELECT 1 FROM public.licitaciones WHERE id=v_owner AND empresa_id=v_empresa) THEN RAISE EXCEPTION 'Licitación no encontrada.' USING ERRCODE='42501'; END IF;
  ELSIF (p_contexto ? 'projectId') OR p_contexto->>'kind'='PROJECT' THEN
    IF NOT EXISTS(SELECT 1 FROM public.projects WHERE id=v_owner AND empresa_id=v_empresa) THEN RAISE EXCEPTION 'Obra no encontrada.' USING ERRCODE='42501'; END IF;
  ELSE RAISE EXCEPTION 'Contexto de workspace inválido.'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_empresa::text||auth.uid()::text||p_modulo||p_contexto::text,0));
  SELECT max(confirmed_at) INTO v_confirmed FROM public.planillas
    WHERE empresa_id=v_empresa AND usuario_id=auth.uid() AND modulo=p_modulo AND contexto=p_contexto AND estado='confirmed';
  SELECT * INTO v_planilla FROM public.planillas
    WHERE empresa_id=v_empresa AND usuario_id=auth.uid() AND modulo=p_modulo AND contexto=p_contexto AND estado='draft'
      AND (v_confirmed IS NULL OR updated_at>=v_confirmed)
    ORDER BY updated_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.planillas(empresa_id,usuario_id,modulo,contexto,snapshot,base_versions,estado)
      VALUES(v_empresa,auth.uid(),p_modulo,p_contexto,jsonb_build_object('rows',p_rows),p_base_versions,'draft') RETURNING * INTO v_planilla;
  END IF;
  RETURN to_jsonb(v_planilla);
END;
$$;
REVOKE ALL ON FUNCTION public.planilla_crear_o_retomar(text,jsonb,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.planilla_crear_o_retomar(text,jsonb,jsonb,jsonb) TO authenticated;
