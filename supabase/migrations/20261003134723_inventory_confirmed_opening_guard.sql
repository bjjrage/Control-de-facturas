CREATE OR REPLACE FUNCTION private.inventory_opening_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE k text;
BEGIN
 IF NEW.status<>'CONFIRMED' OR NEW.metadata->>'reason_type' IS DISTINCT FROM 'INITIAL_STOCK' THEN RETURN NEW; END IF;
 IF NEW.movement_type<>'ADJUSTMENT' OR NEW.source_type<>'MANUAL' OR NEW.quantity<=0 OR NEW.to_location_id IS NULL
 OR NEW.from_location_id IS NOT NULL OR NEW.cost_currency IS NULL
 OR coalesce(NEW.metadata->>'effective_date','') !~ '^\d{4}-\d{2}-\d{2}$' THEN
 RAISE EXCEPTION 'Invalid opening count'; END IF;
 PERFORM (NEW.metadata->>'effective_date')::date;
 k:=private.inventory_opening_key(NEW.empresa_id,NEW.producto_id,NEW.to_location_id,NEW.cost_currency,NEW.metadata);
 PERFORM pg_advisory_xact_lock(hashtextextended(k,0));
 IF EXISTS(SELECT 1 FROM public.inventory_movements x WHERE x.id<>NEW.id AND x.empresa_id=NEW.empresa_id AND x.producto_id=NEW.producto_id
 AND x.to_location_id=NEW.to_location_id AND x.cost_currency=NEW.cost_currency AND x.status='CONFIRMED'
 AND x.metadata->>'reason_type'='INITIAL_STOCK' AND x.metadata->>'effective_date'=NEW.metadata->>'effective_date') THEN
 RAISE EXCEPTION 'Opening count already exists; use a reviewed adjustment for corrections'; END IF;
 RETURN NEW;
END $$;

DROP TRIGGER inventory_opening_guard ON public.inventory_movements;
CREATE TRIGGER inventory_opening_guard AFTER INSERT OR UPDATE ON public.inventory_movements FOR EACH ROW EXECUTE FUNCTION private.inventory_opening_guard();

CREATE FUNCTION public.inventory_portal_consumption(p_token_hash text,p_product uuid,p_budget uuid,p_quantity numeric,p_attempt uuid,p_metadata jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE link public.warehouse_portal_links; location public.inventory_locations;
BEGIN
 IF coalesce(auth.jwt()->>'role','')<>'service_role' THEN RAISE EXCEPTION 'Server only' USING ERRCODE='42501'; END IF;
 SELECT * INTO link FROM public.warehouse_portal_links WHERE token_hash=p_token_hash FOR UPDATE;
 IF NOT FOUND OR NOT link.active OR (link.expires_at IS NOT NULL AND link.expires_at<=now()) THEN RAISE EXCEPTION 'Portal expired/revoked'; END IF;
 SELECT * INTO location FROM public.inventory_locations WHERE id=link.location_id AND empresa_id=link.empresa_id AND active AND location_type='PROJECT';
 IF NOT FOUND OR location.project_id IS NULL OR p_budget IS NULL OR p_attempt IS NULL THEN RAISE EXCEPTION 'Project, budget and stable attempt required'; END IF;
 RETURN public.inventory_post_movement(p_empresa_id=>link.empresa_id,p_producto_id=>p_product,p_quantity=>p_quantity,p_unit=>(SELECT unidad FROM public.productos WHERE id=p_product AND empresa_id=link.empresa_id AND activo),
 p_movement_type=>'CONSUMPTION',p_from_location_id=>location.id,p_project_id=>location.project_id,p_budget_item_id=>p_budget,
 p_source_type=>'WAREHOUSE_PORTAL',p_source_id=>link.id,p_source_line_id=>p_attempt,
 p_idempotency_key=>'warehouse-portal-consumption:'||link.id::text||':'||p_attempt::text,p_created_by=>NULL,
 p_metadata=>coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object('portal_link_id',link.id));
END $$;
REVOKE ALL ON FUNCTION public.inventory_portal_consumption(text,uuid,uuid,numeric,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_portal_consumption(text,uuid,uuid,numeric,uuid,jsonb) TO service_role;
