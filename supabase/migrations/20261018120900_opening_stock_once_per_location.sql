-- #16: the effective date describes the count; it is not part of its identity.
-- Historical rows remain untouched. Corrections use a reviewed adjustment.
CREATE OR REPLACE FUNCTION private.inventory_opening_key(e uuid,p uuid,l uuid,c public.currency_code,m jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
SELECT encode(extensions.digest(jsonb_build_array(e,p,l,c)::text,'sha256'),'hex');
$$;
REVOKE ALL ON FUNCTION private.inventory_opening_key(uuid,uuid,uuid,public.currency_code,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;

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
 AND x.metadata->>'reason_type'='INITIAL_STOCK') THEN
 RAISE EXCEPTION 'Opening count already exists; use a reviewed adjustment for corrections'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.inventory_opening_guard() FROM PUBLIC,anon,authenticated,service_role;
