CREATE FUNCTION public.inventory_portal_receipt(p_token_hash text,p_order uuid,p_date date,p_received_by text,p_remision text,p_attempt uuid,p_notes text,p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE link public.warehouse_portal_links; location public.inventory_locations; receipt jsonb; movements uuid[]; k text;
BEGIN
 IF coalesce(auth.jwt()->>'role','')<>'service_role' THEN RAISE EXCEPTION 'Server only' USING ERRCODE='42501'; END IF;
 SELECT * INTO link FROM public.warehouse_portal_links WHERE token_hash=p_token_hash FOR UPDATE;
 IF NOT FOUND OR NOT link.active OR (link.expires_at IS NOT NULL AND link.expires_at<=now()) OR p_attempt IS NULL THEN RAISE EXCEPTION 'Portal expired/revoked or attempt missing'; END IF;
 SELECT * INTO location FROM public.inventory_locations WHERE id=link.location_id AND empresa_id=link.empresa_id AND active AND location_type='PROJECT';
 IF NOT FOUND OR location.project_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.authorized_orders WHERE id=p_order AND project_id=location.project_id AND empresa_id=link.empresa_id) THEN RAISE EXCEPTION 'Order outside portal context'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.profiles p JOIN public.empresas e ON e.id=p.empresa_id WHERE p.id=link.created_by AND p.empresa_id=link.empresa_id AND p.active AND e.active AND p.role IN ('administracion','admin')) THEN RAISE EXCEPTION 'Active portal sponsor required'; END IF;
 k:='warehouse-portal-receipt:'||link.id::text||':'||p_attempt::text;
 receipt:=public.inventory_create_receipt(link.empresa_id,p_order,p_date,p_received_by,location.id,p_remision,k,link.created_by,p_notes,p_items);
 movements:=public.inventory_confirm_receipt(link.empresa_id,(receipt->>'receipt_id')::uuid,location.id,k,link.created_by);
 RETURN receipt||jsonb_build_object('movements',movements,'portal_link_id',link.id);
END $$;
REVOKE ALL ON FUNCTION public.inventory_portal_receipt(text,uuid,date,text,text,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_portal_receipt(text,uuid,date,text,text,uuid,text,jsonb) TO service_role;

-- Permit the commercial role only through the validated canonical OC receipt
-- RPC; the generic posting function remains unavailable to authenticated API callers.
DO $$
DECLARE d text;
BEGIN
 SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='inventory_post_movement';
 IF position('NOT public.is_internal_role(ARRAY[''administracion'',''admin'']::public.user_role[])' in d)=0 THEN RAISE EXCEPTION 'Unexpected posting contract'; END IF;
 d:=replace(d,'NOT public.is_internal_role(ARRAY[''administracion'',''admin'']::public.user_role[])',
 'NOT (public.is_internal_role(ARRAY[''administracion'',''admin'']::public.user_role[]) OR (v_type = ''RECEIPT'' AND v_source_type = ''OC_RECEPCION'' AND public.is_internal_role(ARRAY[''comercial'']::public.user_role[])))');
 EXECUTE d;
END $$;
