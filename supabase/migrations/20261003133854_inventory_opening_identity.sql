-- An opening count is identified by tenant/material/location/effective date/currency,
-- never by the random attempt UUID. Existing confirmed history remains untouched.
CREATE FUNCTION private.inventory_opening_key(e uuid,p uuid,l uuid,c public.currency_code,m jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
SELECT encode(extensions.digest(jsonb_build_array(e,p,l,c,m->>'effective_date')::text,'sha256'),'hex');
$$;
REVOKE ALL ON FUNCTION private.inventory_opening_key(uuid,uuid,uuid,public.currency_code,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION private.inventory_opening_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE k text;
BEGIN
 IF NEW.metadata->>'reason_type' IS DISTINCT FROM 'INITIAL_STOCK' THEN RETURN NEW; END IF;
 IF NEW.movement_type<>'ADJUSTMENT' OR NEW.source_type<>'MANUAL' OR NEW.quantity<=0 OR NEW.to_location_id IS NULL
 OR NEW.from_location_id IS NOT NULL OR NEW.cost_currency IS NULL
 OR coalesce(NEW.metadata->>'effective_date','') !~ '^\d{4}-\d{2}-\d{2}$' THEN
 RAISE EXCEPTION 'Invalid opening count'; END IF;
 PERFORM (NEW.metadata->>'effective_date')::date;
 k:=private.inventory_opening_key(NEW.empresa_id,NEW.producto_id,NEW.to_location_id,NEW.cost_currency,NEW.metadata);
 PERFORM pg_advisory_xact_lock(hashtextextended(k,0));
 IF EXISTS(SELECT 1 FROM public.inventory_movements x WHERE x.empresa_id=NEW.empresa_id AND x.producto_id=NEW.producto_id
 AND x.to_location_id=NEW.to_location_id AND x.cost_currency=NEW.cost_currency AND x.status='CONFIRMED'
 AND x.metadata->>'reason_type'='INITIAL_STOCK' AND x.metadata->>'effective_date'=NEW.metadata->>'effective_date') THEN
 RAISE EXCEPTION 'Opening count already exists; use a reviewed adjustment for corrections'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.inventory_opening_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER inventory_opening_guard BEFORE INSERT ON public.inventory_movements FOR EACH ROW EXECUTE FUNCTION private.inventory_opening_guard();
CREATE INDEX inventory_opening_lookup ON public.inventory_movements(empresa_id,producto_id,to_location_id,cost_currency,(metadata->>'effective_date'))
WHERE status='CONFIRMED' AND metadata->>'reason_type'='INITIAL_STOCK';

ALTER FUNCTION public.inventory_post_manual_movement(uuid,uuid,numeric,text,text,uuid,uuid,uuid,text,public.currency_code,numeric,numeric,uuid,jsonb) SET SCHEMA private;
REVOKE ALL ON FUNCTION private.inventory_post_manual_movement(uuid,uuid,numeric,text,text,uuid,uuid,uuid,text,public.currency_code,numeric,numeric,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.inventory_post_manual_movement(
p_empresa_id uuid,p_producto_id uuid,p_quantity numeric,p_unit text,p_movement_type text,
p_from_location_id uuid DEFAULT NULL,p_to_location_id uuid DEFAULT NULL,p_project_id uuid DEFAULT NULL,p_idempotency_key text DEFAULT NULL,
p_cost_currency public.currency_code DEFAULT NULL,p_unit_cost numeric DEFAULT NULL,p_exchange_rate_to_company numeric DEFAULT NULL,
p_created_by uuid DEFAULT NULL,p_metadata jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE k text; old public.inventory_movements; count_rows integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.profiles p JOIN public.empresas e ON e.id=p.empresa_id WHERE p.id=p_created_by AND p.empresa_id=p_empresa_id
 AND p.active AND e.active AND p.role IN ('administracion','admin') AND e.plan IN ('pro','caterpillar'))
 OR (coalesce(auth.jwt()->>'role','')<>'service_role' AND p_created_by IS DISTINCT FROM auth.uid()) THEN
 RAISE EXCEPTION 'Active inventory actor required' USING ERRCODE='42501'; END IF;
 IF p_metadata->>'reason_type'='INITIAL_STOCK' THEN
  IF upper(trim(p_movement_type))<>'ADJUSTMENT' OR p_quantity IS NULL OR p_quantity<=0 OR p_quantity::text IN ('NaN','Infinity','-Infinity')
  OR p_cost_currency IS NULL OR p_to_location_id IS NULL OR p_from_location_id IS NOT NULL
  OR coalesce(p_metadata->>'effective_date','') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Invalid opening count'; END IF;
  PERFORM (p_metadata->>'effective_date')::date;
  k:=private.inventory_opening_key(p_empresa_id,p_producto_id,p_to_location_id,p_cost_currency,p_metadata);
  PERFORM pg_advisory_xact_lock(hashtextextended(k,0));
  SELECT count(*) INTO count_rows FROM public.inventory_movements x WHERE x.empresa_id=p_empresa_id AND x.producto_id=p_producto_id
  AND x.to_location_id=p_to_location_id AND x.cost_currency=p_cost_currency AND x.status='CONFIRMED'
  AND x.metadata->>'reason_type'='INITIAL_STOCK' AND x.metadata->>'effective_date'=p_metadata->>'effective_date';
  IF count_rows>1 THEN RAISE EXCEPTION 'Historic opening count requires reconciliation; no additional stock posted'; END IF;
  IF count_rows=1 THEN
   SELECT * INTO old FROM public.inventory_movements x WHERE x.empresa_id=p_empresa_id AND x.producto_id=p_producto_id
   AND x.to_location_id=p_to_location_id AND x.cost_currency=p_cost_currency AND x.status='CONFIRMED'
   AND x.metadata->>'reason_type'='INITIAL_STOCK' AND x.metadata->>'effective_date'=p_metadata->>'effective_date';
   IF old.quantity IS DISTINCT FROM p_quantity OR old.unit IS DISTINCT FROM trim(p_unit)
   OR old.unit_cost IS DISTINCT FROM p_unit_cost OR old.project_id IS DISTINCT FROM p_project_id
   OR old.exchange_rate_to_company IS DISTINCT FROM (CASE WHEN p_cost_currency='PYG' THEN 1 ELSE p_exchange_rate_to_company END) THEN
   RAISE EXCEPTION 'Opening count identity has different facts; use a reviewed adjustment'; END IF;
   RETURN old.id;
  END IF;
 END IF;
 RETURN private.inventory_post_manual_movement(p_empresa_id,p_producto_id,p_quantity,p_unit,p_movement_type,p_from_location_id,p_to_location_id,
 p_project_id,p_idempotency_key,p_cost_currency,p_unit_cost,p_exchange_rate_to_company,p_created_by,p_metadata);
END $$;
REVOKE ALL ON FUNCTION public.inventory_post_manual_movement(uuid,uuid,numeric,text,text,uuid,uuid,uuid,text,public.currency_code,numeric,numeric,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.inventory_post_manual_movement(uuid,uuid,numeric,text,text,uuid,uuid,uuid,text,public.currency_code,numeric,numeric,uuid,jsonb) TO authenticated,service_role;
